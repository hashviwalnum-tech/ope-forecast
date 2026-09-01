/**
 * Stock is either counted or estimated, and the screen must not confuse them.
 *
 * Run with:  npm test       (from web/)
 *
 * The real case that prompted this: Soft Drink, counted at 1,375 on 2026-08-01,
 * projected at 393 after sales. The card said "393 cups in stock".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { describeStock, pendingArrivalQty } from './stockLabel.ts'

test('a projection that differs from the count is labelled an estimate', () => {
  const label = describeStock({
    current_stock: 1375, projected_stock: 393, stock_as_of_date: '2026-08-01',
  })
  assert.deepEqual(label, {
    kind: 'estimated', qty: 393, counted: 1375, countedOn: '2026-08-01',
  })
})

test('a projection matching the count is just the count', () => {
  assert.deepEqual(
    describeStock({ current_stock: 500, projected_stock: 500 }),
    { kind: 'counted', qty: 500 },
  )
})

test('rounding is not mistaken for a change', () => {
  // The API rounds whole-unit products, so 393 vs 393.4 is the same number.
  assert.deepEqual(
    describeStock({ current_stock: 393.4, projected_stock: 393 }),
    { kind: 'counted', qty: 393 },
  )
})

test('no baseline means we say we do not know, never a number', () => {
  assert.deepEqual(describeStock({ stock_untracked: true, current_stock: 12 }), { kind: 'untracked' })
  assert.deepEqual(describeStock({}), { kind: 'untracked' })
  assert.deepEqual(describeStock({ current_stock: null, projected_stock: null }), { kind: 'untracked' })
})

test('with no projection we show what the owner counted', () => {
  assert.deepEqual(describeStock({ current_stock: 80 }), { kind: 'counted', qty: 80 })
})

test('an estimate with no recorded count date still says it is an estimate', () => {
  assert.deepEqual(
    describeStock({ current_stock: 100, projected_stock: 20 }),
    { kind: 'estimated', qty: 20, counted: 100, countedOn: null },
  )
})

// ── what is already on the way ─────────────────────────────────────────────

test('only orders still in transit count as on the way', () => {
  const orders = [
    { status: 'pending', quantity: 1642 },
    { status: 'pending', quantity: 1319 },
    { status: 'arrived', quantity: 500 },
    { status: 'cancelled', quantity: 999 },
  ]
  assert.equal(pendingArrivalQty(orders), 2961)
})

test('an order the app has auto-marked as landed is not still on the way', () => {
  // `effective_status` reflects the "assume orders arrive on time" setting and
  // wins over the stored status.
  const orders = [
    { status: 'pending', effective_status: 'arrived', quantity: 400 },
    { status: 'pending', effective_status: 'pending', quantity: 50 },
  ]
  assert.equal(pendingArrivalQty(orders), 50)
})

test('no orders means nothing on the way', () => {
  assert.equal(pendingArrivalQty([]), 0)
  assert.equal(pendingArrivalQty(null), 0)
  assert.equal(pendingArrivalQty(undefined), 0)
})
