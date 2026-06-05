import { useRef, useState } from 'react'

// ── shared primitives ─────────────────────────────────────────────────────────

function Section({
  title, subtitle, children, defaultOpen = false,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl border border-teal-100 dark:border-slate-700 overflow-hidden bg-teal-25 dark:bg-slate-800 shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 px-6 py-4 text-left
                   hover:bg-teal-50/40 dark:hover:bg-slate-700/40 transition-colors"
      >
        <div>
          <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>
        </div>
        <svg
          className={`w-5 h-5 text-teal-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-6 pb-6 pt-2 border-t border-teal-100 dark:border-slate-700">{children}</div>}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{children}</label>
}

function Input({
  value, onChange, placeholder, type = 'text', prefix,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  prefix?: string
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full border border-slate-200 dark:border-slate-600 rounded-xl text-sm
                    text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700
                    placeholder:text-slate-400 dark:placeholder:text-slate-500 py-2.5
                    focus:outline-none focus:ring-2 focus:ring-teal-400
                    ${prefix ? 'pl-7 pr-3' : 'px-3'}`}
      />
    </div>
  )
}

function ResultBadge({
  label, value, highlight,
}: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${highlight
      ? 'bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700'
      : 'bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700'}`}>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? 'text-teal-700 dark:text-teal-300' : 'text-slate-700 dark:text-slate-200'}`}>{value}</p>
    </div>
  )
}

// ── Tool 1: "Which option is better?" (Decision planner) ─────────────────────

interface Decision {
  name: string
  best: string
  worst: string
  likely: string
}

const emptyDecision = (): Decision => ({ name: '', best: '', worst: '', likely: '' })

function num(s: string): number {
  const n = parseFloat(s.replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}

function DecisionPlanner() {
  const [decisions, setDecisions] = useState<Decision[]>([
    { name: 'Option A', best: '', worst: '', likely: '' },
    { name: 'Option B', best: '', worst: '', likely: '' },
  ])
  const [alpha, setAlpha] = useState(50)  // Hurwicz optimism 0–100
  const [calculated, setCalculated] = useState(false)

  function update(i: number, field: keyof Decision, val: string) {
    setDecisions(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d))
    setCalculated(false)
  }

  const filled = decisions.filter(d => d.best !== '' && d.worst !== '' && d.likely !== '')

  const results = filled.map(d => {
    const b = num(d.best), w = num(d.worst), l = num(d.likely)
    const ev = 0.25 * w + 0.50 * l + 0.25 * b
    const h = (alpha / 100) * b + (1 - alpha / 100) * w
    return { name: d.name || '?', ev, maximin: w, maximax: b, hurwicz: h }
  })

  const safest  = results.length > 0 ? results.reduce((a, b) => a.maximin > b.maximin ? a : b) : null
  const average = results.length > 0 ? results.reduce((a, b) => a.ev       > b.ev       ? a : b) : null
  const boldest = results.length > 0 ? results.reduce((a, b) => a.maximax  > b.maximax  ? a : b) : null
  const hurwicz = results.length > 0 ? results.reduce((a, b) => a.hurwicz  > b.hurwicz  ? a : b) : null

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 leading-relaxed">
        Enter your options with best, worst, and most-likely outcomes — Ope tells you which wins
        under different mindsets.
      </p>

      {decisions.map((d, i) => (
        <div key={i} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/20 p-4 space-y-3">
          <div>
            <Label>Option {i + 1} name</Label>
            <Input value={d.name} onChange={v => update(i, 'name', v)} placeholder={`Option ${i + 1}`} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Best case</Label>
              <Input value={d.best}   onChange={v => update(i, 'best', v)}   placeholder="e.g. 400" type="number" />
            </div>
            <div>
              <Label>Most likely</Label>
              <Input value={d.likely} onChange={v => update(i, 'likely', v)} placeholder="e.g. 250" type="number" />
            </div>
            <div>
              <Label>Worst case</Label>
              <Input value={d.worst}  onChange={v => update(i, 'worst', v)}  placeholder="e.g. 100" type="number" />
            </div>
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        {decisions.length < 3 && (
          <button
            onClick={() => setDecisions(prev => [...prev, emptyDecision()])}
            className="px-3 py-1.5 rounded-lg border border-teal-200 text-xs text-teal-600
                       hover:bg-teal-50 transition-colors"
          >
            + Add another option
          </button>
        )}
        {decisions.length > 2 && (
          <button
            onClick={() => setDecisions(prev => prev.slice(0, -1))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500
                       hover:bg-slate-50 transition-colors"
          >
            Remove last
          </button>
        )}
      </div>

      {filled.length >= 2 && (
        <button
          onClick={() => setCalculated(true)}
          className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 transition-colors"
        >
          Which option is better?
        </button>
      )}

      {calculated && results.length >= 2 && (
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ResultBadge
              label="Playing it safe →"
              value={`Go with ${safest?.name}`}
              highlight={true}
            />
            <ResultBadge
              label="On average →"
              value={`Go with ${average?.name}`}
              highlight={true}
            />
            <ResultBadge
              label="Feeling bold →"
              value={`Go with ${boldest?.name}`}
              highlight={true}
            />
          </div>

          <div className="rounded-xl bg-teal-50/60 border border-teal-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600">
                How bold are you feeling right now?
              </p>
              <span className="text-xs text-teal-700 font-semibold">
                {alpha < 30 ? 'Cautious' : alpha < 70 ? 'Balanced' : 'Bold'}
              </span>
            </div>
            <input
              type="range" min={0} max={100} value={alpha}
              onChange={e => setAlpha(Number(e.target.value))}
              className="w-full accent-teal-600"
            />
            <p className="text-xs text-slate-500 mt-2">
              At your confidence level → <strong className="text-teal-700">go with {hurwicz?.name}</strong>
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Expected values</p>
            <div className="space-y-1">
              {results.map((r, i) => (
                <div key={i} className="flex justify-between text-xs text-slate-600">
                  <span>{r.name}</span>
                  <span className="font-medium tabular-nums">{r.ev.toFixed(1)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Expected value uses a balanced weighting: worst 25%, likely 50%, best 25%.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tool 2: "How does this ordering decision feel?" (Gain vs. loss framing) ───

function OrderFraming() {
  const [orderMore, setOrderMore]         = useState('')
  const [orderLess, setOrderLess]         = useState('')
  const [sellPrice, setSellPrice]         = useState('')
  const [costPrice, setCostPrice]         = useState('')
  const [expectedDemand, setExpectedDemand] = useState('')
  const [frame, setFrame]                 = useState<'gain' | 'loss'>('gain')
  const [shown, setShown]                 = useState(false)

  const qMore = num(orderMore)
  const qLess = num(orderLess)
  const sell  = num(sellPrice)
  const cost  = num(costPrice)
  const demand = num(expectedDemand)
  const margin = sell - cost

  const ready = qMore > 0 && qLess > 0 && sell > 0 && cost > 0 && demand > 0 && margin > 0

  // "Order more" scenarios
  const moreGain  = Math.min(qMore, demand) * margin                         // sold what we ordered
  const moreLoss  = Math.min(qMore, demand) * margin - Math.max(0, qMore - demand) * cost  // unsold units wasted
  // "Order less" scenarios
  const lessGain  = Math.min(qLess, demand) * margin                          // sold all
  const lessMissed = Math.max(0, demand - qLess) * margin                     // missed sales

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 leading-relaxed">
        See the same ordering choice from two angles — what you could gain, and what you could lose.
        Studies show losses feel about twice as bad as equal gains, so it helps to see both.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>If you order MORE (units)</Label>
          <Input value={orderMore} onChange={setOrderMore} placeholder="e.g. 80" type="number" />
        </div>
        <div>
          <Label>If you order LESS (units)</Label>
          <Input value={orderLess} onChange={setOrderLess} placeholder="e.g. 50" type="number" />
        </div>
        <div>
          <Label>Selling price per unit</Label>
          <Input value={sellPrice} onChange={setSellPrice} placeholder="e.g. 5.00" type="number" prefix="€" />
        </div>
        <div>
          <Label>What you pay per unit</Label>
          <Input value={costPrice} onChange={setCostPrice} placeholder="e.g. 2.50" type="number" prefix="€" />
        </div>
        <div className="col-span-2">
          <Label>How many you expect to sell</Label>
          <Input value={expectedDemand} onChange={setExpectedDemand} placeholder="e.g. 65" type="number" />
        </div>
      </div>

      {ready && (
        <button
          onClick={() => setShown(true)}
          className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 transition-colors"
        >
          Show me both sides
        </button>
      )}

      {shown && ready && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => setFrame('gain')}
              className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                frame === 'gain'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              What could I gain?
            </button>
            <button
              onClick={() => setFrame('loss')}
              className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                frame === 'loss'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-700'
              }`}
            >
              What could I lose?
            </button>
          </div>

          {frame === 'gain' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-emerald-700 mb-1">
                  Order {qMore} — if demand is strong
                </p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">
                  +€{moreGain.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">profit if you sell all {qMore} units</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-emerald-700 mb-1">
                  Order {qLess} — if demand is strong
                </p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">
                  +€{lessGain.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">profit if demand exactly fills your {qLess}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-rose-50 border border-rose-100 p-4">
                <p className="text-xs font-semibold text-rose-700 mb-1">
                  Order {qMore} — if demand is weak
                </p>
                <p className="text-2xl font-bold text-rose-700 tabular-nums">
                  €{moreLoss.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {qMore > demand
                    ? `${qMore - demand} unsold units @ €${cost.toFixed(2)} each wasted`
                    : 'demand exceeds order — you sell everything'}
                </p>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-100 p-4">
                <p className="text-xs font-semibold text-rose-700 mb-1">
                  Order {qLess} — if demand is strong
                </p>
                <p className="text-2xl font-bold text-rose-700 tabular-nums">
                  -€{lessMissed.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  missed profit from {Math.max(0, demand - qLess)} customers you couldn't serve
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-teal-50/60 border border-teal-100 px-4 py-3 text-xs text-slate-600 leading-relaxed">
            <strong className="text-teal-700">Ope tip:</strong> Losses feel roughly twice as painful as equivalent
            gains to most people. That's why Ope's default recommendations include a safety buffer — it's not
            just math, it's accounting for how bad running out actually feels.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tool 3: "Get the most from my budget" (greedy allocation) ────────────────

interface BudgetItem {
  name: string
  cost: string       // cost per unit to buy
  profit: string     // profit per unit when sold
  maxQty: string     // maximum units available to order
}

function BudgetOptimizer() {
  const [budget, setBudget] = useState('')
  const [items, setItems] = useState<BudgetItem[]>([
    { name: '', cost: '', profit: '', maxQty: '' },
    { name: '', cost: '', profit: '', maxQty: '' },
  ])
  const [result, setResult] = useState<{ name: string; qty: number; spend: number; earn: number }[] | null>(null)

  function updateItem(i: number, field: keyof BudgetItem, val: string) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
    setResult(null)
  }

  function optimize() {
    const filled = items.filter(it => it.name && num(it.cost) > 0 && num(it.profit) > 0 && num(it.maxQty) > 0)
    if (filled.length === 0) return

    const hasBudget = budget !== '' && num(budget) > 0
    let remaining = hasBudget ? num(budget) : Infinity

    // Greedy fractional knapsack: sort by profit-per-cost ratio descending
    const sorted = [...filled].sort((a, b) =>
      (num(b.profit) / num(b.cost)) - (num(a.profit) / num(a.cost))
    )

    const allocation: typeof result = []
    for (const item of sorted) {
      const c = num(item.cost), p = num(item.profit), max = Math.floor(num(item.maxQty))
      const afford = hasBudget ? Math.min(max, Math.floor(remaining / c)) : max
      if (afford > 0) {
        allocation.push({ name: item.name, qty: afford, spend: afford * c, earn: afford * p })
        remaining -= afford * c
      }
    }
    setResult(allocation)
  }

  const filledCount = items.filter(it => it.name && num(it.cost) > 0 && num(it.profit) > 0 && num(it.maxQty) > 0).length
  const totalSpend  = result?.reduce((s, r) => s + r.spend, 0) ?? 0
  const totalEarn   = result?.reduce((s, r) => s + r.earn, 0) ?? 0

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 leading-relaxed">
        Tell Ope what you could buy and how much profit each item makes — it'll suggest the best split
        to get the most out of your budget.
      </p>

      <div>
        <Label>My budget (optional — leave blank for unlimited)</Label>
        <Input value={budget} onChange={setBudget} placeholder="e.g. 500" type="number" prefix="€" />
      </div>

      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/20 p-4 space-y-2">
            <div>
              <Label>Item {i + 1} name</Label>
              <Input value={item.name} onChange={v => updateItem(i, 'name', v)} placeholder="e.g. Oranges" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Cost/unit</Label>
                <Input value={item.cost}   onChange={v => updateItem(i, 'cost', v)}   prefix="€" type="number" placeholder="1.50" />
              </div>
              <div>
                <Label>Profit/unit</Label>
                <Input value={item.profit} onChange={v => updateItem(i, 'profit', v)} prefix="€" type="number" placeholder="2.00" />
              </div>
              <div>
                <Label>Max units</Label>
                <Input value={item.maxQty} onChange={v => updateItem(i, 'maxQty', v)} type="number" placeholder="100" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {items.length < 6 && (
          <button
            onClick={() => setItems(prev => [...prev, { name: '', cost: '', profit: '', maxQty: '' }])}
            className="px-3 py-1.5 rounded-lg border border-teal-200 text-xs text-teal-600
                       hover:bg-teal-50 transition-colors"
          >
            + Add item
          </button>
        )}
        {items.length > 2 && (
          <button
            onClick={() => setItems(prev => prev.slice(0, -1))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500
                       hover:bg-slate-50 transition-colors"
          >
            Remove last
          </button>
        )}
      </div>

      {filledCount >= 1 && (
        <button
          onClick={optimize}
          className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 transition-colors"
        >
          What should I order?
        </button>
      )}

      {result && result.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            {budget ? `With a €${num(budget).toFixed(0)} budget, order:` : 'Order:'}
          </p>
          {result.map((r, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-teal-50/60
                                    border border-teal-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">{r.name}</p>
                <p className="text-xs text-slate-500">costs €{r.spend.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-teal-700">{r.qty} units</p>
                <p className="text-xs text-emerald-600">+€{r.earn.toFixed(2)} profit</p>
              </div>
            </div>
          ))}
          <div className="flex justify-between rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 px-4 py-3">
            <div>
              <p className="text-xs text-slate-500">Total spend</p>
              <p className="text-sm font-semibold text-slate-700 tabular-nums">€{totalSpend.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Expected profit</p>
              <p className="text-sm font-bold text-emerald-600 tabular-nums">+€{totalEarn.toFixed(2)}</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Items are ordered by profit-per-cost ratio. This is a simple guide — actual profit depends
            on real demand, which Ope forecasts on your dashboard.
          </p>
        </div>
      )}

      {result && result.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3">
          No items could fit in the budget. Try increasing your budget or reducing item costs.
        </p>
      )}
    </div>
  )
}

// ── Tool 4: "My action list" (lightweight planning checklist) ─────────────────

const CHECKLIST_KEY = 'ope_toolbox_checklist_v1'

interface CheckItem {
  id: number
  text: string
  done: boolean
}

function Checklist() {
  const nextId = useRef(1)

  const [items, setItems] = useState<CheckItem[]>(() => {
    try {
      const saved = localStorage.getItem(CHECKLIST_KEY)
      if (saved) {
        const parsed: CheckItem[] = JSON.parse(saved)
        if (parsed.length > 0) {
          nextId.current = Math.max(...parsed.map(i => i.id)) + 1
        }
        return parsed
      }
    } catch { /* ignore */ }
    // default starter list
    return [
      { id: nextId.current++, text: 'Check this week\'s ordering recommendations', done: false },
      { id: nextId.current++, text: 'Log yesterday\'s sales', done: false },
      { id: nextId.current++, text: 'Review any new outlier alerts', done: false },
    ]
  })
  const [newText, setNewText] = useState('')

  function save(updated: CheckItem[]) {
    setItems(updated)
    try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(updated)) } catch { /* ignore */ }
  }

  function toggle(id: number) {
    save(items.map(it => it.id === id ? { ...it, done: !it.done } : it))
  }

  function remove(id: number) {
    save(items.filter(it => it.id !== id))
  }

  function add() {
    if (!newText.trim()) return
    save([...items, { id: nextId.current++, text: newText.trim(), done: false }])
    setNewText('')
  }

  function clearDone() {
    save(items.filter(it => !it.done))
  }

  const doneCount = items.filter(it => it.done).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 leading-relaxed">
        Your personal action list — stays saved between visits.
      </p>

      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">
            Your list is empty. Add something to get started.
          </p>
        )}
        {items.map(item => (
          <div
            key={item.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
              item.done
                ? 'bg-slate-50/60 dark:bg-slate-700/30 border-slate-100 dark:border-slate-700'
                : 'bg-teal-25 dark:bg-slate-800 border-slate-200 dark:border-slate-600'
            }`}
          >
            <button
              onClick={() => toggle(item.id)}
              className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                item.done ? 'bg-teal-500 border-teal-500' : 'border-slate-300 hover:border-teal-400'
              }`}
            >
              {item.done && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <span className={`flex-1 text-sm ${item.done ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>
              {item.text}
            </span>
            <button
              onClick={() => remove(item.id)}
              className="text-slate-300 hover:text-rose-400 transition-colors p-0.5 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add a task…"
          className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600
                     text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700
                     placeholder:text-slate-400 dark:placeholder:text-slate-500
                     focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <button
          onClick={add}
          disabled={!newText.trim()}
          className="px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          Add
        </button>
      </div>

      {doneCount > 0 && (
        <button
          onClick={clearDone}
          className="text-xs text-slate-400 hover:text-rose-500 transition-colors"
        >
          Clear {doneCount} completed item{doneCount !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}

// ── AdvancedToolbox ───────────────────────────────────────────────────────────

export default function AdvancedToolbox() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3 text-sm text-slate-600 leading-relaxed">
        These tools help you think through decisions, compare choices, and plan your week — all in
        plain language, no maths degree required. Most owners won't need them every day, but they're
        here when you want to think a bit deeper.
      </div>

      <Section
        title="Which option is better?"
        subtitle="Enter two or three choices with best, worst, and likely outcomes — get a plain-language recommendation."
        defaultOpen={true}
      >
        <DecisionPlanner />
      </Section>

      <Section
        title="How does this ordering decision feel?"
        subtitle="See the same order choice framed as what you could gain vs. what you could lose."
      >
        <OrderFraming />
      </Section>

      <Section
        title="Get the most from my budget"
        subtitle="Enter items with their cost and profit — Ope shows the best way to spend your budget."
      >
        <BudgetOptimizer />
      </Section>

      <Section
        title="My action list"
        subtitle="A simple to-do list that stays saved between visits."
      >
        <Checklist />
      </Section>
    </div>
  )
}
