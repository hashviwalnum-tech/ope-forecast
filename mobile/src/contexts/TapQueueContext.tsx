/**
 * Keeps the phone's waiting taps (lib/tapQueue.ts) on the device and sends them.
 *
 * Saved per signed-in person, so a different owner signing in on the same
 * phone never sends — or sees — someone else's taps. Sending is tried straight
 * after each tap, every 20 seconds while anything is waiting, and whenever the
 * app comes back to the front.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { AppState } from 'react-native'
import * as api from '../api/client'
import {
  EMPTY, applyFlush, dismissFailed, enqueue, flush, makeTap, parseState, waitingCounts, withdraw,
  type FailedTap, type QueueState, type QueuedTap,
} from '../lib/tapQueue'
import { useBusiness } from './BusinessContext'

const RETRY_EVERY_MS = 20_000
const storageKey = (userId: string) => `ope.tapQueue.v1.${userId}`

type SentListener = (tap: QueuedTap, eventId: number) => void

interface TapQueueValue {
  /** Saves a tap on the phone and starts sending it. */
  add: (productId: number | null) => QueuedTap | null
  /** Takes back a tap not yet sent. False if it has already gone. */
  takeBack: (key: string) => boolean
  /** Waiting taps for the business on screen, by product (`null` = customer). */
  waiting: Map<number | null, number>
  waitingTotal: number
  /** Taps the server refused, for the business on screen. */
  refused: FailedTap[]
  clearRefused: () => void
  /** Called once for each tap the server confirms. */
  onSent: (fn: SentListener) => () => void
}

const Ctx = createContext<TapQueueValue | null>(null)

export function TapQueueProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { business } = useBusiness()
  const bizId = business?.id ?? null
  const [state, setState] = useState<QueueState>(EMPTY)
  const ref = useRef<QueueState>(EMPTY)
  const loaded = useRef(false)
  const writing = useRef<Promise<void>>(Promise.resolve())
  const flushing = useRef(false)
  const takenBack = useRef(new Set<string>())
  const listeners = useRef(new Set<SentListener>())

  const update = useCallback((fn: (s: QueueState) => QueueState) => {
    ref.current = fn(ref.current)
    setState(ref.current)
    const snapshot = JSON.stringify(ref.current)
    // Writes go in order, so an older state never lands after a newer one.
    writing.current = writing.current
      .then(() => AsyncStorage.setItem(storageKey(userId), snapshot))
      .catch(() => { /* storage full or unavailable: the tap is still in memory */ })
    return writing.current
  }, [userId])

  const send = useCallback(async () => {
    if (flushing.current || !loaded.current || ref.current.queued.length === 0) return
    flushing.current = true
    try {
      const outcome = await flush(ref.current.queued, api.saleEvents.sendQueued)
      await update(s => applyFlush(s, outcome))
      for (const { tap, eventId } of outcome.sent) {
        if (takenBack.current.delete(tap.key)) {
          // Undone while it was on its way: it reached the server anyway.
          void api.saleEvents.delete(eventId).catch(() => {})
          continue
        }
        listeners.current.forEach(fn => fn(tap, eventId))
      }
    } finally {
      flushing.current = false
    }
  }, [update])

  useEffect(() => {
    loaded.current = false
    // Someone else signed in: their taps are under their own key, already saved.
    ref.current = EMPTY
    setState(EMPTY)
    let alive = true
    AsyncStorage.getItem(storageKey(userId))
      .catch(() => null)
      .then(raw => {
        if (!alive) return
        // A tap made before loading finished is kept alongside the saved ones.
        const saved = parseState(raw)
        ref.current = { queued: [...saved.queued, ...ref.current.queued], failed: saved.failed }
        setState(ref.current)
        loaded.current = true
        void send()
      })
    return () => { alive = false }
  }, [userId, send])

  useEffect(() => {
    if (state.queued.length === 0) return
    const id = setInterval(() => void send(), RETRY_EVERY_MS)
    return () => clearInterval(id)
  }, [state.queued.length, send])

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void send() })
    return () => sub.remove()
  }, [send])

  const add = useCallback((productId: number | null) => {
    if (bizId === null) return null
    const tap = makeTap(bizId, productId)
    void update(s => enqueue(s, tap)).then(() => send())
    return tap
  }, [bizId, update, send])

  const takeBack = useCallback((key: string) => {
    if (!ref.current.queued.some(t => t.key === key)) return false
    if (flushing.current) takenBack.current.add(key)
    void update(s => withdraw(s, key))
    return true
  }, [update])

  const clearRefused = useCallback(() => {
    if (bizId !== null) void update(s => dismissFailed(s, bizId))
  }, [bizId, update])

  const onSent = useCallback((fn: SentListener) => {
    listeners.current.add(fn)
    return () => { listeners.current.delete(fn) }
  }, [])

  const value = useMemo<TapQueueValue>(() => {
    const waiting = bizId === null ? new Map<number | null, number>() : waitingCounts(state, bizId)
    let waitingTotal = 0
    waiting.forEach(n => { waitingTotal += n })
    return {
      add, takeBack, waiting, waitingTotal,
      refused: state.failed.filter(t => t.businessId === bizId),
      clearRefused, onSent,
    }
  }, [state, bizId, add, takeBack, clearRefused, onSent])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTapQueue(): TapQueueValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTapQueue must be used inside TapQueueProvider')
  return v
}
