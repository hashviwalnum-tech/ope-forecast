import { useEffect, useState } from 'react'
import { dayRecords, products, sales } from '../api/client'
import type { ProductRead } from '../api/types'

function localToday(): string {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

interface Props { onSaved: () => void }

export default function LogDayForm({ onSaved }: Props) {
  const [customers, setCustomers] = useState('')
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [unitsSold, setUnitsSold] = useState<Record<number, string>>({})
  const [saving, setSaving]       = useState(false)
  const [feedback, setFeedback]   = useState<{ ok: boolean; msg: string } | null>(null)

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
      const day = await dayRecords.create({ date: localToday(), customers: cust })
      for (const p of productList) {
        const val = parseFloat(unitsSold[p.id] ?? '')
        if (!isNaN(val) && val > 0) {
          await sales.create({ day_record_id: day.id, product_id: p.id, units_sold: val })
        }
      }
      setCustomers('')
      setUnitsSold({})
      setFeedback({ ok: true, msg: 'Saved!' })
      onSaved()
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Save failed'
      const msg = raw.includes('409') || raw.toLowerCase().includes('already')
        ? "Today's already been logged — find it in Past Days to edit it."
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
          How many customers today?
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
          <legend className="text-sm font-semibold text-slate-600 px-1">What did you sell today?</legend>
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
        {saving ? 'Saving…' : 'Save today'}
      </button>
    </form>
  )
}
