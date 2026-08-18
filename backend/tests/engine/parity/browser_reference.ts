// FROZEN. This is the browser implementation of the planning toolbox as it
// stood immediately before the maths moved to backend/app/engine/planning.py.
//
// It is not part of the app and nothing imports it except run_browser.mjs. It
// exists so the claim "the port changed no numbers" stays checkable rather
// than being a one-off assertion in a commit message: run_browser.mjs feeds it
// the same cases as the engine and diff.py compares the two.
//
// Do not fix bugs here. If the engine's behaviour is meant to change, the
// parity check has stopped being meaningful for that function and should be
// narrowed or retired — not quietly edited to agree.

// The maths behind the advanced planning toolbox.
//
// Lifted out of AdvancedToolbox.tsx so it can be given known-answer tests the
// way every other formula in Ope is (spec §11), and so the mobile app can
// reuse it rather than reimplementing four sets of decision rules.
//
// These are calculators over numbers the owner types in — hypotheticals, not
// business history — which is why they live here rather than in the backend
// forecasting engine.

/**
 * Read a number out of one of the toolbox's `type="number"` fields.
 *
 * The browser normalises those to a dot-decimal string whatever the owner's
 * locale, so this stays a plain dot parser. It does handle a comma decimal,
 * because a PASTED value skips that normalisation — and the old version
 * stripped the comma out, turning "12,50" into 1250. A hundredfold error in a
 * price field, silently.
 *
 * Free text and CSV cells are a different problem and go through
 * `parseLocaleNumber` in lib/money.ts, which knows the owner's conventions.
 */
export function num(s: string): number {
  const raw = s.trim()
  // A comma with no dot alongside it can only be a decimal mark here.
  const normalised = raw.includes(',') && !raw.includes('.')
    ? raw.replace(',', '.')
    : raw
  const n = parseFloat(normalised.replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}

// ── Decision under uncertainty (spec §7.5) ──────────────────────────────────

export interface Option {
  name: string
  best: number
  likely: number
  worst: number
}

export interface OptionScores {
  name: string
  /** Weighted average of the three estimates — the "on average" answer. */
  ev: number
  /** Worst case. Maximin picks the option whose worst case is least bad. */
  maximin: number
  /** Best case. Maximax picks the option with the highest ceiling. */
  maximax: number
  /** Hurwicz: α·best + (1−α)·worst. */
  hurwicz: number
}

/**
 * Weights for the three-point estimate.
 *
 * The textbook PERT weighting is (worst + 4·likely + best) / 6. This uses
 * 1-2-1 instead, which leans less hard on the middle guess — deliberate, since
 * an owner's "most likely" is a gut figure rather than a measured mode. Both
 * are weighted averages of the same three numbers; neither is a true expected
 * value, because that would need real probabilities. The UI says "on average"
 * rather than claiming more than that.
 */
const W_WORST = 0.25
const W_LIKELY = 0.5
const W_BEST = 0.25

export function scoreOption(o: Option, alpha: number): OptionScores {
  const a = Math.min(1, Math.max(0, alpha))
  return {
    name: o.name,
    ev: W_WORST * o.worst + W_LIKELY * o.likely + W_BEST * o.best,
    maximin: o.worst,
    maximax: o.best,
    hurwicz: a * o.best + (1 - a) * o.worst,
  }
}

/**
 * Options whose three estimates are out of order — a best case below the worst
 * case, or a likely outside the two.
 *
 * Without this the tool answers confidently on nonsense: "playing safe" reads
 * the worst-case field, so an owner who filled the columns the wrong way round
 * is told to pick the option with the highest *best* case as the safe one —
 * the exact opposite of the advice they asked for.
 */
export function findInvertedOptions(options: Option[]): string[] {
  return options
    .filter(o => o.best < o.worst || o.likely > o.best || o.likely < o.worst)
    .map(o => o.name)
}

// ── Gain vs loss framing (prospect theory, spec §7.5) ────────────────────────

export interface FramingInput {
  orderMore: number
  orderLess: number
  sellPrice: number
  costPrice: number
  expectedDemand: number
}

export interface FramingResult {
  margin: number
  /** Profit from the larger order when demand shows up. */
  moreUpside: number
  /** Profit from the smaller order when demand shows up (capped by stock). */
  lessUpside: number
  /** Profit from the larger order when demand disappoints — wasted stock is
   *  subtracted, so this can still be a profit, or a real loss. */
  moreDownside: number
  /** Units left unsold on the larger order when demand disappoints. */
  moreUnsold: number
  /** Profit given up by the smaller order when demand is strong. */
  lessMissed: number
  /** Units of demand the smaller order could not serve. */
  lessShort: number
}

export function frameOrder(input: FramingInput): FramingResult {
  const { orderMore, orderLess, sellPrice, costPrice, expectedDemand } = input
  const margin = sellPrice - costPrice
  const moreUnsold = Math.max(0, orderMore - expectedDemand)
  const lessShort = Math.max(0, expectedDemand - orderLess)
  return {
    margin,
    moreUpside: Math.min(orderMore, expectedDemand) * margin,
    lessUpside: Math.min(orderLess, expectedDemand) * margin,
    moreDownside: Math.min(orderMore, expectedDemand) * margin - moreUnsold * costPrice,
    moreUnsold,
    lessMissed: lessShort * margin,
    lessShort,
  }
}

// ── Budget allocation (spec §7.5 "linear programming") ──────────────────────

export interface BudgetItem {
  name: string
  /** Cost to buy one unit. */
  cost: number
  /** Profit made on one unit sold. */
  profit: number
  /** Most units worth ordering. */
  maxQty: number
}

export interface Allocation {
  name: string
  qty: number
  spend: number
  earn: number
}

export interface BudgetPlan {
  allocation: Allocation[]
  totalSpend: number
  totalEarn: number
  /**
   * True when the answer is a good guess rather than the provably best one.
   * Only happens on inputs far larger than a small business would type.
   */
  approximate: boolean
}

/**
 * The old version sorted by profit-per-cost and bought greedily down the list.
 *
 * That is only optimal when you can buy fractions of a unit. You cannot buy
 * two-thirds of a crate, and once quantities are whole numbers greedy can miss
 * badly: with €100, item A at €60 returning €65 (ratio 1.083) and item B at
 * €50 returning €50 (ratio 1.00), greedy buys one A for €65 profit and then
 * cannot afford a B — while two Bs would have returned €100. That is 35% of
 * the profit left on the table, presented as "what to order" with no hint it
 * was a guess.
 *
 * This solves it exactly instead, as a bounded knapsack. Quantities are split
 * into powers of two so any count up to maxQty can still be formed, which
 * keeps it fast enough to run as the owner types.
 */
export function planBudget(budget: number | null, items: BudgetItem[]): BudgetPlan {
  const usable = items.filter(it => it.cost > 0 && it.profit > 0 && it.maxQty >= 1)
  if (!usable.length) return { allocation: [], totalSpend: 0, totalEarn: 0, approximate: false }

  // No budget: nothing is scarce, so take everything worth taking.
  if (budget === null || budget <= 0) {
    const allocation = usable.map(it => ({
      name: it.name,
      qty: Math.floor(it.maxQty),
      spend: Math.floor(it.maxQty) * it.cost,
      earn: Math.floor(it.maxQty) * it.profit,
    }))
    return {
      allocation,
      totalSpend: allocation.reduce((s, a) => s + a.spend, 0),
      totalEarn: allocation.reduce((s, a) => s + a.earn, 0),
      approximate: false,
    }
  }

  // Work in whole units of money so the table is an integer grid. Cents, so
  // that ordinary prices land on exact grid points — a coarser grid has to
  // round each unit cost UP, and that rounding accumulates over dozens of
  // units until the plan quietly leaves a unit's worth of budget unspent.
  // Only a budget larger than any small business would type falls back to a
  // coarser grid, and that case says so via `approximate`.
  const MAX_CELLS = 300_000
  const step = Math.max(0.01, budget / MAX_CELLS)
  const cap = Math.floor(budget / step + 1e-6)

  // Round each cost UP to a whole step, so a plan can never exceed the budget.
  const cells: { item: number; qty: number; cost: number; profit: number }[] = []
  usable.forEach((it, i) => {
    const unitCost = Math.ceil(it.cost / step - 1e-6)
    if (unitCost <= 0 || unitCost > cap) return
    const affordable = Math.min(Math.floor(it.maxQty), Math.floor(cap / unitCost))
    // Powers of two, then the remainder — any quantity up to `affordable` is
    // then reachable as a sum of these, so nothing is lost by splitting.
    let left = affordable
    let k = 1
    while (left > 0) {
      const take = Math.min(k, left)
      cells.push({ item: i, qty: take, cost: take * unitCost, profit: take * it.profit })
      left -= take
      k *= 2
    }
  })

  if (!cells.length) return { allocation: [], totalSpend: 0, totalEarn: 0, approximate: false }

  const best = new Float64Array(cap + 1)
  // took[c * cells.length + j] — whether pseudo-item j was taken at capacity c.
  const took = new Uint8Array((cap + 1) * cells.length)

  for (let j = 0; j < cells.length; j++) {
    const { cost, profit } = cells[j]
    for (let c = cap; c >= cost; c--) {
      const candidate = best[c - cost] + profit
      if (candidate > best[c] + 1e-9) {
        best[c] = candidate
        took[c * cells.length + j] = 1
      }
    }
  }

  // Walk the decisions back to recover how many of each item to buy.
  const qty = new Array(usable.length).fill(0)
  let c = cap
  for (let j = cells.length - 1; j >= 0; j--) {
    if (c >= cells[j].cost && took[c * cells.length + j]) {
      qty[cells[j].item] += cells[j].qty
      c -= cells[j].cost
    }
  }

  const allocation: Allocation[] = usable
    .map((it, i) => ({
      name: it.name,
      qty: qty[i],
      spend: qty[i] * it.cost,
      earn: qty[i] * it.profit,
    }))
    .filter(a => a.qty > 0)
    // Biggest commitment first, so the owner reads the important line first.
    .sort((a, b) => b.spend - a.spend)

  return {
    allocation,
    totalSpend: allocation.reduce((s, a) => s + a.spend, 0),
    totalEarn: allocation.reduce((s, a) => s + a.earn, 0),
    // Costs were rounded up to a whole step. At cent granularity that is exact
    // for any ordinary price; only a very large budget coarsens the grid.
    approximate: step > 0.01 + 1e-9,
  }
}
