/**
 * Taps saved on the phone until the server has them.
 *
 * A tap used to go straight to the server and, with no signal, failed after a
 * few minutes of retrying — the sale was gone unless the owner noticed and
 * tapped again. On café Wi-Fi in a rush, that is the worst thing Ope can do.
 * Now every tap is written to the phone first, then sent; a tap that cannot be
 * sent waits and goes later, keeping the time it was made (the server stores
 * that time, not the time it arrived — see backend engine/offline_taps.py).
 *
 * This file is the logic only, with no React Native in it, so it runs under
 * `node --test`. TapQueueContext supplies the storage and the sending.
 */

export interface QueuedTap {
  /** Unique on this phone; how a tap is found again to undo it. */
  key: string
  businessId: number
  productId: number | null
  /** When the owner tapped, ISO UTC with milliseconds. */
  tappedAt: string
}

/** A tap the server refused for good (a deleted product, or too old to add). */
export interface FailedTap extends QueuedTap {
  message: string
}

export interface QueueState {
  queued: QueuedTap[]
  failed: FailedTap[]
}

export const EMPTY: QueueState = { queued: [], failed: [] }

/**
 * What sending one tap came to.
 * `retry` — no signal, the server asleep or erroring, or the sign-in needing a
 * refresh: try again later. Anything else the server said no to is final.
 */
export type SendResult =
  | { ok: true; eventId: number }
  | { ok: false; retry: true }
  | { ok: false; retry: false; message: string }

export type Sender = (tap: QueuedTap, sentAt: string) => Promise<SendResult>

/** Whether an HTTP status means "try again later" rather than "no". */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 401 || status === 403 || status === 408 || status === 429
}

let counter = 0
export function newKey(now: number = Date.now()): string {
  counter = (counter + 1) % 1_000_000
  return `${now.toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function makeTap(businessId: number, productId: number | null, now: Date = new Date()): QueuedTap {
  return { key: newKey(now.getTime()), businessId, productId, tappedAt: now.toISOString() }
}

export function parseState(raw: string | null): QueueState {
  if (!raw) return EMPTY
  try {
    const v = JSON.parse(raw) as Partial<QueueState>
    return {
      queued: Array.isArray(v.queued) ? v.queued.filter(isTap) : [],
      failed: Array.isArray(v.failed) ? v.failed.filter(isTap) as FailedTap[] : [],
    }
  } catch {
    return EMPTY
  }
}

function isTap(x: unknown): x is QueuedTap {
  const t = x as QueuedTap
  return !!t && typeof t.key === 'string' && typeof t.businessId === 'number' &&
    (t.productId === null || typeof t.productId === 'number') && typeof t.tappedAt === 'string'
}

export function enqueue(s: QueueState, tap: QueuedTap): QueueState {
  return { ...s, queued: [...s.queued, tap] }
}

/** Takes a tap out before it was sent — the owner undid it. */
export function withdraw(s: QueueState, key: string): QueueState {
  return { ...s, queued: s.queued.filter(t => t.key !== key) }
}

export function dismissFailed(s: QueueState, businessId: number): QueueState {
  return { ...s, failed: s.failed.filter(t => t.businessId !== businessId) }
}

/** How many taps are waiting, per product (`null` = a customer), for one business. */
export function waitingCounts(s: QueueState, businessId: number): Map<number | null, number> {
  const m = new Map<number | null, number>()
  for (const t of s.queued) {
    if (t.businessId === businessId) m.set(t.productId, (m.get(t.productId) ?? 0) + 1)
  }
  return m
}

export interface FlushOutcome {
  sent: { tap: QueuedTap; eventId: number }[]
  refused: FailedTap[]
  /** True when sending stopped early because a tap has to wait. */
  stalled: boolean
}

/**
 * Sends waiting taps oldest first, stopping at the first that has to wait —
 * if one cannot get through, the rest will not either, and stopping keeps
 * them in order. A refused tap is set aside with the reason and sending goes on.
 *
 * Returns what happened; `applyFlush` folds it into the state. Kept apart so a
 * tap queued *while* this runs is not lost when the result is saved.
 */
export async function flush(
  queued: readonly QueuedTap[],
  send: Sender,
  now: () => Date = () => new Date(),
): Promise<FlushOutcome> {
  const out: FlushOutcome = { sent: [], refused: [], stalled: false }
  for (const tap of queued) {
    let r: SendResult
    try {
      r = await send(tap, now().toISOString())
    } catch {
      r = { ok: false, retry: true }
    }
    if (r.ok) out.sent.push({ tap, eventId: r.eventId })
    else if (r.retry) { out.stalled = true; break }
    else out.refused.push({ ...tap, message: r.message })
  }
  return out
}

export function applyFlush(s: QueueState, o: FlushOutcome): QueueState {
  const done = new Set([...o.sent.map(x => x.tap.key), ...o.refused.map(x => x.key)])
  return {
    queued: s.queued.filter(t => !done.has(t.key)),
    failed: [...s.failed, ...o.refused],
  }
}
