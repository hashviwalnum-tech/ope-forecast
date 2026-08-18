import { useRef, useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrency } from '../contexts/CurrencyContext'
import {
  findInvertedOptions, frameOrder, num, planBudget, scoreOption,
  type BudgetItem as BudgetSpec, type Option,
} from '../lib/planningTools'

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

function DecisionPlanner() {
  const { t } = useLanguage()
  const [decisions, setDecisions] = useState<Decision[]>([
    { name: t('toolboxOptionPlaceholder', { n: 'A' }), best: '', worst: '', likely: '' },
    { name: t('toolboxOptionPlaceholder', { n: 'B' }), best: '', worst: '', likely: '' },
  ])
  const [alpha, setAlpha] = useState(50)  // Hurwicz optimism 0–100
  const [calculated, setCalculated] = useState(false)

  function update(i: number, field: keyof Decision, val: string) {
    setDecisions(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d))
    setCalculated(false)
  }

  const filled = decisions.filter(d => d.best !== '' && d.worst !== '' && d.likely !== '')

  const options: Option[] = filled.map(d => ({
    name: d.name || '?',
    best: num(d.best),
    likely: num(d.likely),
    worst: num(d.worst),
  }))

  // "Playing safe" reads the worst-case field. If the owner filled best and
  // worst the wrong way round, the tool would confidently recommend the option
  // with the highest BEST case as the safest one — the opposite of the advice
  // they asked for. Say so instead of answering.
  const inverted = findInvertedOptions(options)

  const results = options.map(o => scoreOption(o, alpha / 100))

  const safest  = results.length > 0 ? results.reduce((a, b) => a.maximin > b.maximin ? a : b) : null
  const average = results.length > 0 ? results.reduce((a, b) => a.ev       > b.ev       ? a : b) : null
  const boldest = results.length > 0 ? results.reduce((a, b) => a.maximax  > b.maximax  ? a : b) : null
  const hurwicz = results.length > 0 ? results.reduce((a, b) => a.hurwicz  > b.hurwicz  ? a : b) : null

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 leading-relaxed">{t('toolboxDecisionDesc')}</p>

      {decisions.map((d, i) => (
        <div key={i} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/20 p-4 space-y-3">
          <div>
            <Label>{t('toolboxOptionName', { n: String(i + 1) })}</Label>
            <Input value={d.name} onChange={v => update(i, 'name', v)} placeholder={t('toolboxOptionPlaceholder', { n: String(i + 1) })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>{t('toolboxBestCase')}</Label>
              <Input value={d.best}   onChange={v => update(i, 'best', v)}   placeholder={t('toolboxNumPlaceholder400')} type="number" />
            </div>
            <div>
              <Label>{t('toolboxMostLikely')}</Label>
              <Input value={d.likely} onChange={v => update(i, 'likely', v)} placeholder={t('toolboxNumPlaceholder250')} type="number" />
            </div>
            <div>
              <Label>{t('toolboxWorstCase')}</Label>
              <Input value={d.worst}  onChange={v => update(i, 'worst', v)}  placeholder={t('toolboxNumPlaceholder100')} type="number" />
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
            {t('toolboxAddOption')}
          </button>
        )}
        {decisions.length > 2 && (
          <button
            onClick={() => setDecisions(prev => prev.slice(0, -1))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500
                       hover:bg-slate-50 transition-colors"
          >
            {t('toolboxRemoveOption')}
          </button>
        )}
      </div>

      {inverted.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20
                      border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 leading-relaxed">
          {t('toolboxInvertedWarning', { names: inverted.join(', ') })}
        </p>
      )}

      {filled.length >= 2 && inverted.length === 0 && (
        <button
          onClick={() => setCalculated(true)}
          className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 transition-colors"
        >
          {t('toolboxWhichBetter')}
        </button>
      )}

      {calculated && inverted.length === 0 && results.length >= 2 && (
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ResultBadge label={t('toolboxPlayingSafe')} value={t('toolboxGoWith', { name: safest?.name ?? '?' })} highlight={true} />
            <ResultBadge label={t('toolboxOnAverage')}   value={t('toolboxGoWith', { name: average?.name ?? '?' })} highlight={true} />
            <ResultBadge label={t('toolboxFeelingBold')} value={t('toolboxGoWith', { name: boldest?.name ?? '?' })} highlight={true} />
          </div>

          <div className="rounded-xl bg-teal-50/60 border border-teal-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600">{t('toolboxHowBold')}</p>
              <span className="text-xs text-teal-700 font-semibold">
                {alpha < 30 ? t('toolboxCautious') : alpha < 70 ? t('toolboxBalanced') : t('toolboxBold')}
              </span>
            </div>
            <input
              type="range" min={0} max={100} value={alpha}
              onChange={e => setAlpha(Number(e.target.value))}
              className="w-full accent-teal-600"
            />
            <p className="text-xs text-slate-500 mt-2">
              {t('toolboxAtConfidence', { name: hurwicz?.name ?? '?' })}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">{t('toolboxExpectedValues')}</p>
            <div className="space-y-1">
              {results.map((r, i) => (
                <div key={i} className="flex justify-between text-xs text-slate-600">
                  <span>{r.name}</span>
                  <span className="font-medium tabular-nums">{r.ev.toFixed(1)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">{t('toolboxEVNote')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tool 2: "How does this ordering decision feel?" (Gain vs. loss framing) ───

function OrderFraming() {
  const { t } = useLanguage()
  const { symbol: cur, signedMoney } = useCurrency()
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

  const f = frameOrder({
    orderMore: qMore, orderLess: qLess,
    sellPrice: sell, costPrice: cost, expectedDemand: demand,
  })

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 leading-relaxed">{t('toolboxFramingDesc')}</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('toolboxOrderMore')}</Label>
          <Input value={orderMore} onChange={setOrderMore} placeholder={`${t('egPrefix')} 80`} type="number" />
        </div>
        <div>
          <Label>{t('toolboxOrderLess')}</Label>
          <Input value={orderLess} onChange={setOrderLess} placeholder={`${t('egPrefix')} 50`} type="number" />
        </div>
        <div>
          <Label>{t('toolboxSellPrice')}</Label>
          <Input value={sellPrice} onChange={setSellPrice} placeholder={`${t('egPrefix')} 5.00`} type="number" prefix={cur} />
        </div>
        <div>
          <Label>{t('toolboxCostPrice')}</Label>
          <Input value={costPrice} onChange={setCostPrice} placeholder={`${t('egPrefix')} 2.50`} type="number" prefix={cur} />
        </div>
        <div className="col-span-2">
          <Label>{t('toolboxExpectedSales')}</Label>
          <Input value={expectedDemand} onChange={setExpectedDemand} placeholder={`${t('egPrefix')} 65`} type="number" />
        </div>
      </div>

      {ready && (
        <button
          onClick={() => setShown(true)}
          className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 transition-colors"
        >
          {t('toolboxShowBothSides')}
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
              {t('toolboxGainFrame')}
            </button>
            <button
              onClick={() => setFrame('loss')}
              className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                frame === 'loss'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-700'
              }`}
            >
              {t('toolboxLossFrame')}
            </button>
          </div>

          {frame === 'gain' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-emerald-700 mb-1">
                  {t('toolboxOrderDemandStrong', { qty: String(qMore) })}
                </p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">
                  {signedMoney(f.moreUpside)}
                </p>
                <p className="text-xs text-slate-500 mt-1">{t('toolboxProfitAllUnits', { qty: String(qMore) })}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-emerald-700 mb-1">
                  {t('toolboxOrderDemandStrong', { qty: String(qLess) })}
                </p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">
                  {signedMoney(f.lessUpside)}
                </p>
                <p className="text-xs text-slate-500 mt-1">{t('toolboxProfitFillOrder', { qty: String(qLess) })}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {/* Over-ordering eats into profit, but often does NOT wipe it out.
                  Printing a still-positive figure bare inside a red panel read
                  as a loss, so the number is signed and the panel follows the
                  sign — red only when it really is a loss. */}
              <div className={`rounded-xl p-4 border ${f.moreDownside < 0
                ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-800'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800'}`}>
                <p className={`text-xs font-semibold mb-1 ${f.moreDownside < 0
                  ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {t('toolboxOrderDemandWeak', { qty: String(qMore) })}
                </p>
                <p className={`text-2xl font-bold tabular-nums ${f.moreDownside < 0
                  ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {signedMoney(f.moreDownside)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {f.moreUnsold > 0
                    ? t('toolboxUnsoldWaste', { extra: String(f.moreUnsold) })
                    : t('toolboxDemandExceeds')}
                </p>
                {f.moreDownside > 0 && f.moreUnsold > 0 && (
                  <p className="text-xs text-slate-500 mt-1">{t('toolboxStillProfitNote')}</p>
                )}
              </div>
              <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800 p-4">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 mb-1">
                  {t('toolboxOrderDemandStrong', { qty: String(qLess) })}
                </p>
                <p className="text-2xl font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                  {signedMoney(-f.lessMissed)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {t('toolboxMissedProfit', { n: String(f.lessShort) })}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-teal-50/60 border border-teal-100 px-4 py-3 text-xs text-slate-600 leading-relaxed">
            {t('toolboxOpeTip')}
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
  const { t } = useLanguage()
  const { symbol: cur, money, signedMoney } = useCurrency()
  const [budget, setBudget] = useState('')
  const [items, setItems] = useState<BudgetItem[]>([
    { name: '', cost: '', profit: '', maxQty: '' },
    { name: '', cost: '', profit: '', maxQty: '' },
  ])
  const [result, setResult] = useState<ReturnType<typeof planBudget> | null>(null)

  function updateItem(i: number, field: keyof BudgetItem, val: string) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
    setResult(null)
  }

  function optimize() {
    const spec: BudgetSpec[] = items
      .filter(it => it.name)
      .map(it => ({
        name: it.name,
        cost: num(it.cost),
        profit: num(it.profit),
        maxQty: num(it.maxQty),
      }))
    if (!spec.length) return
    const hasBudget = budget !== '' && num(budget) > 0
    setResult(planBudget(hasBudget ? num(budget) : null, spec))
  }

  const filledCount = items.filter(it => it.name && num(it.cost) > 0 && num(it.profit) > 0 && num(it.maxQty) > 0).length

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 leading-relaxed">{t('toolboxBudgetDesc')}</p>

      <div>
        <Label>{t('toolboxMyBudget')}</Label>
        <Input value={budget} onChange={setBudget} placeholder={`${t('egPrefix')} 500`} type="number" prefix={cur} />
      </div>

      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/20 p-4 space-y-2">
            <div>
              <Label>{t('toolboxItemName', { n: String(i + 1) })}</Label>
              <Input value={item.name} onChange={v => updateItem(i, 'name', v)} placeholder={t('toolboxItemNamePlaceholder')} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>{t('toolboxCostPerUnit')}</Label>
                <Input value={item.cost}   onChange={v => updateItem(i, 'cost', v)}   prefix={cur} type="number" placeholder="1.50" />
              </div>
              <div>
                <Label>{t('toolboxProfitPerUnit')}</Label>
                <Input value={item.profit} onChange={v => updateItem(i, 'profit', v)} prefix={cur} type="number" placeholder="2.00" />
              </div>
              <div>
                <Label>{t('toolboxMaxUnits')}</Label>
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
            {t('toolboxAddItem')}
          </button>
        )}
        {items.length > 2 && (
          <button
            onClick={() => setItems(prev => prev.slice(0, -1))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500
                       hover:bg-slate-50 transition-colors"
          >
            {t('toolboxRemoveItem')}
          </button>
        )}
      </div>

      {filledCount >= 1 && (
        <button
          onClick={optimize}
          className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 transition-colors"
        >
          {t('toolboxWhatOrder')}
        </button>
      )}

      {result && result.allocation.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            {budget
              ? t('toolboxWithBudget', { currency: cur, budget: num(budget).toFixed(0) })
              : t('toolboxWithoutBudget')}
          </p>
          {result.allocation.map((r, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-teal-50/60
                                    border border-teal-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">{r.name}</p>
                <p className="text-xs text-slate-500">{t('toolboxItemCosts', { currency: cur, amount: r.spend.toFixed(2) })}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-teal-700">{t('toolboxItemUnits', { qty: String(r.qty) })}</p>
                <p className="text-xs text-emerald-600">{t('toolboxItemProfit', { currency: cur, profit: r.earn.toFixed(2) })}</p>
              </div>
            </div>
          ))}
          <div className="flex justify-between rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 px-4 py-3">
            <div>
              <p className="text-xs text-slate-500">{t('toolboxTotalSpend')}</p>
              <p className="text-sm font-semibold text-slate-700 tabular-nums">{money(result.totalSpend)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">{t('toolboxTotalProfit')}</p>
              <p className="text-sm font-bold text-emerald-600 tabular-nums">{signedMoney(result.totalEarn)}</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {result.approximate ? t('toolboxApproximateNote') : t('toolboxRatioNote')}
          </p>
        </div>
      )}

      {result && result.allocation.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3">
          {t('toolboxNoBudgetFit')}
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
  const { t } = useLanguage()

  // The initialiser used to advance `nextId` as it built the list, which
  // mutates a ref during render — under StrictMode it runs twice, so the
  // counter ran ahead of the list it was numbering. Build the list purely,
  // then derive the counter from it.
  const [items, setItems] = useState<CheckItem[]>(() => {
    try {
      const saved = localStorage.getItem(CHECKLIST_KEY)
      if (saved) {
        const parsed: CheckItem[] = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed
      }
    } catch { /* ignore */ }
    // Starter list, written in the owner's language. It used to be hardcoded
    // English on the grounds that saved items should not change when the
    // language is switched — true, but the fix is to translate ONCE at
    // creation and store the result, not to show a Hebrew or Japanese owner
    // three English tasks the first time they open the tool.
    return [
      { id: 1, text: t('toolboxStarterOrdering'), done: false },
      { id: 2, text: t('toolboxStarterLogSales'), done: false },
      { id: 3, text: t('toolboxStarterOutliers'), done: false },
    ]
  })
  const nextId = useRef(items.length ? Math.max(...items.map(i => i.id)) + 1 : 1)
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
      <p className="text-sm text-slate-500 leading-relaxed">{t('toolboxChecklistDesc')}</p>

      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">{t('toolboxChecklistEmpty')}</p>
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
          placeholder={t('toolboxAddTaskPlaceholder')}
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
          {t('toolboxAddTaskBtn')}
        </button>
      </div>

      {doneCount > 0 && (
        <button
          onClick={clearDone}
          className="text-xs text-slate-400 hover:text-rose-500 transition-colors"
        >
          {t('toolboxClearDone', { n: String(doneCount), s: doneCount !== 1 ? 's' : '' })}
        </button>
      )}
    </div>
  )
}

// ── AdvancedToolbox ───────────────────────────────────────────────────────────

export default function AdvancedToolbox() {
  const { t } = useLanguage()
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3 text-sm text-slate-600 leading-relaxed">
        {t('toolboxIntro')}
      </div>

      <Section
        title={t('toolboxDecisionTitle')}
        subtitle={t('toolboxDecisionSubtitle')}
        defaultOpen={true}
      >
        <DecisionPlanner />
      </Section>

      <Section
        title={t('toolboxBudgetTitle')}
        subtitle={t('toolboxBudgetSubtitle')}
      >
        <BudgetOptimizer />
      </Section>

      <Section
        title={t('toolboxChecklistTitle')}
        subtitle={t('toolboxChecklistSubtitle')}
      >
        <Checklist />
      </Section>

      <Section
        title={t('toolboxFramingTitle')}
        subtitle={t('toolboxFramingSubtitle')}
      >
        <OrderFraming />
      </Section>
    </div>
  )
}
