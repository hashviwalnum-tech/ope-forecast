/**
 * Known-answer tests for the advanced planning toolbox (spec §11, §12).
 *
 * Run with:  npm test       (from web/)
 *
 * Every formula here is textbook, so the expected answers are worked by hand
 * in the test rather than taken from what the code happens to return.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  findInvertedOptions, frameOrder, num, planBudget, scoreOption,
  type BudgetItem, type Option,
} from './planningTools.ts'

const close = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, msg ?? `expected ${b}, got ${a}`)

// ── reading numbers out of text fields ─────────────────────────────────────

test('currency symbols and spaces are ignored, negatives are kept', () => {
  close(num('€1,50'.replace(',', '.')), 1.5)
  close(num('  42 '), 42)
  close(num('-50'), -50)          // a worst case can be a loss
  close(num(''), 0)
  close(num('abc'), 0)
})

// ── decision under uncertainty ─────────────────────────────────────────────

const opt = (name: string, worst: number, likely: number, best: number): Option =>
  ({ name, worst, likely, best })

test('maximin is the worst case and maximax the best case', () => {
  const s = scoreOption(opt('A', 100, 250, 400), 0.5)
  close(s.maximin, 100)
  close(s.maximax, 400)
})

test('the average weights worst/likely/best 25/50/25', () => {
  // 0.25·100 + 0.50·250 + 0.25·400 = 25 + 125 + 100 = 250
  close(scoreOption(opt('A', 100, 250, 400), 0.5).ev, 250)
})

test('Hurwicz at full optimism is the best case, at zero the worst case', () => {
  close(scoreOption(opt('A', 100, 250, 400), 1).hurwicz, 400)
  close(scoreOption(opt('A', 100, 250, 400), 0).hurwicz, 100)
  // α=0.5 → 0.5·400 + 0.5·100 = 250
  close(scoreOption(opt('A', 100, 250, 400), 0.5).hurwicz, 250)
  // α=0.3 → 0.3·400 + 0.7·100 = 120 + 70 = 190
  close(scoreOption(opt('A', 100, 250, 400), 0.3).hurwicz, 190)
})

test('an out-of-range optimism setting is clamped rather than extrapolated', () => {
  close(scoreOption(opt('A', 100, 250, 400), 2).hurwicz, 400)
  close(scoreOption(opt('A', 100, 250, 400), -1).hurwicz, 100)
})

test('estimates entered the wrong way round are caught, not answered', () => {
  // The tool reads "playing safe" off the worst-case field. An owner who fills
  // best and worst the wrong way round would otherwise be told to pick the
  // option with the highest BEST case as the safest one.
  assert.deepEqual(findInvertedOptions([opt('Stay open late', 400, 250, 100)]), ['Stay open late'])
  // likely above best, and likely below worst, are wrong too
  assert.deepEqual(findInvertedOptions([opt('A', 100, 500, 400)]), ['A'])
  assert.deepEqual(findInvertedOptions([opt('B', 100, 50, 400)]), ['B'])
  // a sensible set raises nothing
  assert.deepEqual(findInvertedOptions([opt('C', 100, 250, 400)]), [])
  // equal values are fine — a certain outcome is not an error
  assert.deepEqual(findInvertedOptions([opt('D', 200, 200, 200)]), [])
})

// ── gain vs loss framing ───────────────────────────────────────────────────

test('ordering more earns more when demand shows up, capped by demand', () => {
  // sell 5, cost 2.50 → margin 2.50; demand 65
  const r = frameOrder({ orderMore: 80, orderLess: 50, sellPrice: 5, costPrice: 2.5, expectedDemand: 65 })
  close(r.margin, 2.5)
  close(r.moreUpside, 65 * 2.5)   // 162.50 — can only sell the 65 who came
  close(r.lessUpside, 50 * 2.5)   // 125.00 — ran out after 50
})

test('the downside of over-ordering subtracts the cost of what went unsold', () => {
  const r = frameOrder({ orderMore: 80, orderLess: 50, sellPrice: 5, costPrice: 2.5, expectedDemand: 65 })
  // 65 sold × 2.50 margin = 162.50, minus 15 unsold × 2.50 cost = 37.50 → 125
  close(r.moreDownside, 125)
  close(r.moreUnsold, 15)
  // Note this is still a PROFIT. The UI must not print it as a loss.
  assert.ok(r.moreDownside > 0)
})

test('over-ordering far enough really does turn into a loss', () => {
  const r = frameOrder({ orderMore: 200, orderLess: 50, sellPrice: 5, costPrice: 2.5, expectedDemand: 65 })
  // 162.50 earned, 135 unsold × 2.50 = 337.50 wasted → −175
  close(r.moreDownside, -175)
  assert.ok(r.moreDownside < 0)
})

test('under-ordering gives up the margin on the customers turned away', () => {
  const r = frameOrder({ orderMore: 80, orderLess: 50, sellPrice: 5, costPrice: 2.5, expectedDemand: 65 })
  close(r.lessShort, 15)
  close(r.lessMissed, 15 * 2.5)   // 37.50
})

test('nothing is missed or wasted when the order matches demand exactly', () => {
  const r = frameOrder({ orderMore: 65, orderLess: 65, sellPrice: 5, costPrice: 2.5, expectedDemand: 65 })
  close(r.moreUnsold, 0)
  close(r.lessShort, 0)
  close(r.lessMissed, 0)
  close(r.moreDownside, r.moreUpside)
})

// ── budget allocation ──────────────────────────────────────────────────────

const item = (name: string, cost: number, profit: number, maxQty: number): BudgetItem =>
  ({ name, cost, profit, maxQty })

const qtyOf = (plan: ReturnType<typeof planBudget>, name: string) =>
  plan.allocation.find(a => a.name === name)?.qty ?? 0

test('the case the old greedy version got 35% wrong', () => {
  // €100. A: €60 → €65 profit (ratio 1.083). B: €50 → €50 profit (ratio 1.00).
  // Greedy takes the better ratio first: one A for €65, then cannot afford a B.
  // Two Bs cost exactly €100 and return €100.
  const plan = planBudget(100, [item('A', 60, 65, 1), item('B', 50, 50, 2)])
  close(plan.totalEarn, 100)
  assert.equal(qtyOf(plan, 'B'), 2)
  assert.equal(qtyOf(plan, 'A'), 0)
  assert.ok(plan.totalSpend <= 100)
})

test('a mixed plan is found when mixing beats loading up on one item', () => {
  // €500. Flowers €12 → €13 (ratio 1.083, up to 40). Vases €100 → €95 (0.95, up to 5).
  // All-flowers: 40 × 12 = €480 spent, €520 profit, €20 idle.
  // 33 flowers (€396) + 1 vase (€100) = €496 spent, €429 + €95 = €524.
  const plan = planBudget(500, [item('Flowers', 12, 13, 40), item('Vases', 100, 95, 5)])
  close(plan.totalEarn, 524)
  assert.equal(qtyOf(plan, 'Flowers'), 33)
  assert.equal(qtyOf(plan, 'Vases'), 1)
  assert.ok(plan.totalSpend <= 500)
})

test('the budget is never exceeded', () => {
  for (const budget of [1, 7, 33, 90, 250, 1000]) {
    const plan = planBudget(budget, [
      item('Cake', 7, 8, 12), item('Coffee', 3, 3.2, 30), item('Tart', 11, 12.5, 8),
    ])
    assert.ok(plan.totalSpend <= budget + 1e-6, `spent ${plan.totalSpend} of ${budget}`)
  }
})

test('a budget too small for anything returns an empty plan rather than nonsense', () => {
  const plan = planBudget(2, [item('Cake', 7, 8, 12)])
  assert.deepEqual(plan.allocation, [])
  close(plan.totalEarn, 0)
})

test('with no budget set, everything worth ordering is ordered', () => {
  const plan = planBudget(null, [item('Cake', 7, 8, 12), item('Coffee', 3, 3.2, 30)])
  assert.equal(qtyOf(plan, 'Cake'), 12)
  assert.equal(qtyOf(plan, 'Coffee'), 30)
  close(plan.totalEarn, 12 * 8 + 30 * 3.2)
})

test('items with a missing or nonsensical figure are left out, not treated as free', () => {
  const plan = planBudget(100, [
    item('Good', 10, 5, 5),
    item('NoCost', 0, 5, 5),
    item('NoProfit', 10, 0, 5),
    item('NoQty', 10, 5, 0),
  ])
  assert.deepEqual(plan.allocation.map(a => a.name), ['Good'])
})

test('quantity limits are respected', () => {
  // Budget would buy 20, but only 3 are available.
  const plan = planBudget(1000, [item('Rare', 50, 80, 3)])
  assert.equal(qtyOf(plan, 'Rare'), 3)
  close(plan.totalSpend, 150)
})

test('an ordinary small-business budget is solved exactly, not approximated', () => {
  const plan = planBudget(500, [item('Flowers', 12, 13, 40), item('Vases', 100, 95, 5)])
  assert.equal(plan.approximate, false)
})

test('the answer beats what plain greedy would have produced, across many random cases', () => {
  // Greedy is what the tool used to do. It is a valid plan, never a better one.
  const greedy = (budget: number, items: BudgetItem[]) => {
    let left = budget
    let earn = 0
    for (const it of [...items].sort((a, b) => b.profit / b.cost - a.profit / a.cost)) {
      const n = Math.min(Math.floor(it.maxQty), Math.floor(left / it.cost))
      if (n > 0) { earn += n * it.profit; left -= n * it.cost }
    }
    return earn
  }

  let rng = 12345
  const rand = (n: number) => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n) + 1

  let improved = 0
  for (let trial = 0; trial < 300; trial++) {
    const items = Array.from({ length: 3 }, (_, i) =>
      item(`i${i}`, rand(40), rand(50), rand(10)))
    const budget = rand(300)
    const plan = planBudget(budget, items)
    const g = greedy(budget, items)
    assert.ok(plan.totalSpend <= budget + 1e-6, 'over budget')
    assert.ok(plan.totalEarn >= g - 1e-6,
      `worse than greedy: ${plan.totalEarn} < ${g} (budget ${budget})`)
    if (plan.totalEarn > g + 1e-6) improved++
  }
  // If this never fired, the test would be proving nothing.
  assert.ok(improved > 0, 'greedy was never beaten — the comparison is not exercising anything')
})

test('the reported totals match the plan it printed', () => {
  const plan = planBudget(500, [item('Flowers', 12, 13, 40), item('Vases', 100, 95, 5)])
  close(plan.totalSpend, plan.allocation.reduce((s, a) => s + a.qty * (a.spend / a.qty), 0))
  close(plan.totalEarn, plan.allocation.reduce((s, a) => s + a.earn, 0))
})
