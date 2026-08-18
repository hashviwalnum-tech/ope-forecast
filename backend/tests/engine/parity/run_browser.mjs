// Run the ORIGINAL browser implementation over the shared parity cases.
//
// This is the "before" side of the move: it imports browser_reference.ts, a
// frozen copy of web/src/lib/planningTools.ts as it stood when the maths lived
// in the browser, so its answers can be diffed against
// backend/app/engine/planning.py. The live app no longer has this code.
//
// Usage (from backend/):
//   node tests/engine/parity/run_browser.mjs cases.json > browser_out.json
//
// Field names are converted to the engine's snake_case so the two outputs
// compare directly.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const toolsPath = join(here, 'browser_reference.ts')
const { findInvertedOptions, frameOrder, planBudget, scoreOption } = await import(
  'file://' + toolsPath.replace(/\\/g, '/')
)

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))

/** The winner on one criterion; first wins a tie — the reduce the UI used. */
const leader = (scores, key) =>
  scores.length ? scores.reduce((a, b) => (b[key] > a[key] ? b : a)).name : null

const out = {}

out.decision = cases.decision.map(c => {
  const options = c.options.map(o => ({
    name: o.name, best: o.best, likely: o.likely, worst: o.worst,
  }))
  const scores = options.map(o => scoreOption(o, c.alpha))
  return {
    scores: scores.map(s => ({
      name: s.name, ev: s.ev, maximin: s.maximin,
      maximax: s.maximax, hurwicz: s.hurwicz,
    })),
    inverted: findInvertedOptions(options),
    safest: leader(scores, 'maximin'),
    on_average: leader(scores, 'ev'),
    boldest: leader(scores, 'maximax'),
    at_confidence: leader(scores, 'hurwicz'),
  }
})

out.framing = cases.framing.map(c => {
  const f = frameOrder({
    orderMore: c.order_more,
    orderLess: c.order_less,
    sellPrice: c.sell_price,
    costPrice: c.cost_price,
    expectedDemand: c.expected_demand,
  })
  return {
    margin: f.margin,
    more_upside: f.moreUpside,
    less_upside: f.lessUpside,
    more_downside: f.moreDownside,
    more_unsold: f.moreUnsold,
    less_missed: f.lessMissed,
    less_short: f.lessShort,
  }
})

out.budget = cases.budget.map(c => {
  const plan = planBudget(
    c.budget,
    c.items.map(i => ({
      name: i.name, cost: i.cost, profit: i.profit, maxQty: i.max_qty,
    })),
  )
  return {
    allocation: plan.allocation.map(a => ({
      name: a.name, qty: a.qty, spend: a.spend, earn: a.earn,
    })),
    total_spend: plan.totalSpend,
    total_earn: plan.totalEarn,
    approximate: plan.approximate,
  }
})

process.stdout.write(JSON.stringify(out, null, 1) + '\n')
