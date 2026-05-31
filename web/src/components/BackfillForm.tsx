import { useEffect, useState } from 'react'
import { dayRecords, products, sales, saleEvents } from '../api/client'
import type { ProductRead } from '../api/types'

function localToday(): string {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

function localYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

function fmtHour(h: number): string {
  if (h === 0)  return '12 am'
  if (h < 12)  return `${h} am`
  if (h === 12) return '12 pm'
  return `${h - 12} pm`
}

interface Props { onSaved: () => void }

export default function BackfillForm({ onSaved }: Props) {
  const [date, setDate]           = useState(localYesterday)
  const [customers, setCustomers] = useState('')
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [unitsSold, setUnitsSold] = useState<Record<number, string>>({})
  const [saving, setSaving]       = useState(false)
  const [feedback, setFeedback]   = useState<{ ok: boolean; msg: string } | null>(null)

  // hourly breakdown (optional)
  const [showHourly, setShowHourly] = useState(false)
  const [hourlyData, setHourlyData] = useState<Record<number, string>>({})

  useEffect(() => {
    products.list().then(setProductList).catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cust = parseInt(customers)
    if (isNaN(cust) || cust < 0) return
    setSaving(true)
    setFeedback(null)
    try {
      const day = await dayRecords.create({ date, customers: cust })
      for (const p of productList) {
        const val = parseFloat(unitsSold[p.id] ?? '')
        if (!isNaN(val) && val > 0) {
          await sales.create({ day_record_id: day.id, product_id: p.id, units_sold: val })
        }
      }

      // Optional hourly breakdown — submit if any hour was filled in
      if (showHourly) {
        const slots = Object.entries(hourlyData)
          .map(([h, v]) => ({ hour: parseInt(h), customers: parseFloat(v) }))
          .filter(s => !isNaN(s.customers) && s.customers > 0)
        if (slots.length > 0) {
          await saleEvents.backfillHourly(date, slots)
        }
      }

      setCustomers('')
      setUnitsSold({})
      setHourlyData({})
      setDate(localYesterday())
      setFeedback({ ok: true, msg: 'Saved!' })
      onSaved()
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Save failed'
      const msg = raw.includes('409') || raw.toLowerCase().includes('already')
        ? "There's already an entry for that day — find it in Past Days to edit it."
        : raw
      setFeedback({ ok: false, msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-sm">

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Which day are you filling in?
        </label>
        <input
          type="date" required
          value={date}
          max={localToday()}
          onChange={e => setDate(e.target.value)}
          className="w-full border border-slate-300 rounded-xl px-3 py-3 text-slate-900
                     focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <p className="text-xs text-slate-400 mt-1.5">
          Click the field to open a calendar. Future dates are blocked.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          How many customers that day?
        </label>
        <input
          type="number" min="0" required placeholder="0"
          value={customers} onChange={e => setCustomers(e.target.value)}
          className="w-full border border-slate-300 rounded-xl px-3 py-3 text-slate-900
                     focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {productList.length > 0 && (
        <fieldset className="border border-teal-100 rounded-2xl p-4 bg-teal-50/30">
          <legend className="text-sm font-semibold text-slate-600 px-1">What did you sell that day?</legend>
          <div className="space-y-3 mt-2">
            {productList.map(p => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-slate-700">{p.name}</span>
                <input
                  type="number" min="0" step="0.01" placeholder="0"
                  value={unitsSold[p.id] ?? ''}
                  onChange={e => setUnitsSold(prev => ({ ...prev, [p.id]: e.target.value }))}
                  className="w-24 border border-slate-300 rounded-xl px-2 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <span className="text-xs text-slate-400 w-8">{p.unit}</span>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {/* ── Optional hourly breakdown ── */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowHourly(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3
                     text-sm font-medium text-slate-600 hover:bg-slate-50
                     transition-colors text-left"
        >
          <span>Add hourly breakdown <span className="text-slate-400 font-normal">(optional)</span></span>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${showHourly ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showHourly && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3 bg-slate-50/50">
            <p className="text-xs text-slate-500 leading-relaxed">
              If you have a breakdown by hour (e.g. from your register), enter it here.
              It feeds the <strong>Busy Hours</strong> and staffing features.
              Leave any hour blank to skip it.
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 max-w-xs">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-11 shrink-0 text-right tabular-nums">
                    {fmtHour(h)}
                  </span>
                  <input
                    type="number" min="0" placeholder="—"
                    value={hourlyData[h] ?? ''}
                    onChange={e => setHourlyData(prev => ({ ...prev, [h]: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm
                               bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {feedback && (
        <p className={`text-sm rounded-xl px-3 py-2.5 ${feedback.ok
          ? 'text-emerald-700 bg-emerald-50'
          : 'text-red-600 bg-red-50'}`}>
          {feedback.msg}
        </p>
      )}

      <button
        type="submit" disabled={saving}
        className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300
                   text-white font-medium py-3 rounded-xl transition-colors text-base"
      >
        {saving ? 'Saving…' : 'Save this day'}
      </button>
    </form>
  )
}
