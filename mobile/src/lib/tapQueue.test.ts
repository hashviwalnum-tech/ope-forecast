/**
 * Taps made without signal are kept and sent later, in order, never twice.
 * Run: npm test   (from mobile/)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY, applyFlush, dismissFailed, enqueue, flush, isRetryableStatus, makeTap,
  parseState, waitingCounts, withdraw, type QueuedTap, type SendResult,
} from './tapQueue.ts'

const at = (min: number) => new Date(Date.UTC(2026, 9, 11, 10, min, 0, 0))

test('with no signal every tap waits, and none is lost', async () => {
  let s = EMPTY
  for (let i = 0; i < 3; i++) s = enqueue(s, makeTap(1, null, at(i)))
  const o = await flush(s.queued, async () => ({ ok: false, retry: true }))
  s = applyFlush(s, o)
  assert.equal(s.queued.length, 3)
  assert.equal(s.failed.length, 0)
})

test('when the signal returns they are sent oldest first, keeping their times', async () => {
  let s = EMPTY
  for (let i = 0; i < 3; i++) s = enqueue(s, makeTap(1, i, at(i)))
  const seen: string[] = []
  const o = await flush(s.queued, async (t) => { seen.push(t.tappedAt); return { ok: true, eventId: seen.length } })
  s = applyFlush(s, o)
  assert.deepEqual(seen, [at(0), at(1), at(2)].map(d => d.toISOString()))
  assert.equal(s.queued.length, 0)
})

test('sending stops at the first tap that has to wait, so order is kept', async () => {
  let s = EMPTY
  for (let i = 0; i < 4; i++) s = enqueue(s, makeTap(1, null, at(i)))
  let calls = 0
  const o = await flush(s.queued, async (): Promise<SendResult> =>
    ++calls === 2 ? { ok: false, retry: true } : { ok: true, eventId: calls })
  s = applyFlush(s, o)
  assert.equal(calls, 2, 'did not keep sending after the connection dropped')
  assert.equal(s.queued.length, 3)
  assert.equal(s.queued[0].tappedAt, at(1).toISOString())
})

test('a sender that throws counts as no signal, not as a refusal', async () => {
  const s = enqueue(EMPTY, makeTap(1, null, at(0)))
  const o = await flush(s.queued, async () => { throw new TypeError('Network request failed') })
  assert.equal(applyFlush(s, o).queued.length, 1)
})

test('a tap the server refuses is set aside with the reason, and the rest still go', async () => {
  let s = EMPTY
  s = enqueue(s, makeTap(1, 99, at(0)))       // a product since deleted
  s = enqueue(s, makeTap(1, null, at(1)))
  const o = await flush(s.queued, async (t): Promise<SendResult> =>
    t.productId === 99 ? { ok: false, retry: false, message: 'Product not found' } : { ok: true, eventId: 7 })
  s = applyFlush(s, o)
  assert.equal(s.queued.length, 0)
  assert.equal(s.failed.length, 1)
  assert.equal(s.failed[0].message, 'Product not found')
})

test('a tap made while sending is in progress is not dropped', async () => {
  let s = enqueue(EMPTY, makeTap(1, null, at(0)))
  const sending = s.queued
  const late = makeTap(1, null, at(1))
  const o = await flush(sending, async () => { s = enqueue(s, late); return { ok: true, eventId: 1 } })
  s = applyFlush(s, o)
  assert.deepEqual(s.queued.map(t => t.key), [late.key])
})

test('an undone tap that was still waiting is never sent', () => {
  const a = makeTap(1, null, at(0)); const b = makeTap(1, null, at(1))
  const s = withdraw(enqueue(enqueue(EMPTY, a), b), b.key)
  assert.deepEqual(s.queued.map(t => t.key), [a.key])
})

test('waiting counts are per product and per business', () => {
  let s = EMPTY
  s = enqueue(s, makeTap(1, null, at(0)))
  s = enqueue(s, makeTap(1, null, at(1)))
  s = enqueue(s, makeTap(1, 5, at(2)))
  s = enqueue(s, makeTap(2, null, at(3)))
  const m = waitingCounts(s, 1)
  assert.equal(m.get(null), 2)
  assert.equal(m.get(5), 1)
  assert.equal(waitingCounts(s, 2).get(null), 1)
})

test('saved state survives a restart, and damaged storage starts empty instead of crashing', () => {
  const s = enqueue(EMPTY, makeTap(1, 3, at(0)))
  assert.deepEqual(parseState(JSON.stringify(s)), s)
  assert.deepEqual(parseState('{not json'), EMPTY)
  assert.deepEqual(parseState(null), EMPTY)
  assert.deepEqual(parseState(JSON.stringify({ queued: [{ junk: 1 }], failed: 'x' })), EMPTY)
})

test('dismissing refusals clears only that business', () => {
  const tap = (b: number): QueuedTap => makeTap(b, null, at(0))
  const s = { queued: [], failed: [{ ...tap(1), message: 'm' }, { ...tap(2), message: 'm' }] }
  assert.deepEqual(dismissFailed(s, 1).failed.map(t => t.businessId), [2])
})

test('which server answers mean "try later"', () => {
  for (const st of [500, 502, 503, 401, 403, 408, 429]) assert.ok(isRetryableStatus(st), String(st))
  for (const st of [400, 404, 422]) assert.ok(!isRetryableStatus(st), String(st))
})

test('keys are unique even for taps in the same millisecond', () => {
  const keys = new Set(Array.from({ length: 1000 }, () => makeTap(1, null, at(0)).key))
  assert.equal(keys.size, 1000)
})
