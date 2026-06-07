import { useEffect, useState } from 'react'
import { businesses, dayRecords, products, sales, saleEvents } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { BusinessRead, ProductRead, SaleRead } from '../api/types'

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

function isTodayLocked(biz: BusinessRead | null): boolean {
  if (!biz) return false
  const ch = biz.settings.closing_hour
  if (typeof ch !== 'number') return false
  return new Date().getHours() < ch
}

// Returns true if the date falls on a day not in the business's opening_days.
// opening_days uses 0=Mon...6=Sun; JS getDay() returns 0=Sun...6=Sat.
function isNonWorkingDay(dateStr: string, biz: BusinessRead | null): boolean {
  if (!biz) return false
  const opening_days = biz.settings.opening_days as number[] | undefined
  if (!Array.isArray(opening_days) || opening_days.length === 0) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  const jsDay = new Date(y, m - 1, d).getDay()   // 0=Sun...6=Sat
  const appDay = (jsDay + 6) % 7                  // 0=Mon...6=Sun
  return !opening_days.includes(appDay)
}

export default function BackfillForm({ onSaved }: Props) {
  const { t } = useLanguage()
  const [date, setDate]           = useState(localYesterday)
  const [customers, setCustomers] = useState('')
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [biz, setBiz]             = useState<BusinessRead | null>(null)
  const [unitsSold, setUnitsSold] = useState<Record<number, string>>({})
  const [saving, setSaving]       = useState(false)
  const [feedback, setFeedback]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [overwriteId, setOverwriteId] = useState<number | null>(null)

  // hourly breakdown (optional)
  const [showHourly, setShowHourly] = useState(false)
  const [hourlyData, setHourlyData] = useState<Record<number, string>>({})

  useEffect(() => {
    products.list().then(setProductList).catch(() => {})
    businesses.me().then(setBiz).catch(() => {})
  }, [])

  const locked = isTodayLocked(biz)
  const nonWorking = isNonWorkingDay(date, biz)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (nonWorking) return
    const cust = parseInt(customers)
    if (isNaN(cust) || cust < 0) return
    setSaving(true)
    setFeedback(null)
    setOverwriteId(null)
    try {
      const day = await dayRecords.create({ date, customers: cust })
      for (const p of productList) {
        const val = parseFloat(unitsSold[p.id] ?? '')
        if (!isNaN(val) && val > 0) {
          await sales.create({ day_record_id: day.id, product_id: p.id, units_sold: val })
        }
      }

      if (showHourly) {
        const slots = Object.entries(hourlyData)
          .map(([h, v]) => ({ hour: parseInt(h), customers: parseFloat(v) }))
          .filter(s => !isNaN(s.customers) && s.customers > 0)
        if (slots.length > 0) {
          await saleEvents.backfillHourly(date, slots)
        }
      }

      // Reset form fields except date — stay on the date that was just saved
      setCustomers('')
      setUnitsSold({})
      setHourlyData({})
      setFeedback({ ok: true, msg: 'Saved!' })
      onSaved()
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Save failed'
      if (raw.toLowerCase().includes('already exists')) {
        // Find the existing record's ID so the user can overwrite it.
        try {
          const records = await dayRecords.list()
          const existing = records.find(r => r.date === date)
          if (existing) {
            setOverwriteId(existing.id)
          } else {
            setFeedback({ ok: false, msg: t('alreadyHasEntry') })
          }
        } catch {
          setFeedback({ ok: false, msg: t('alreadyHasEntry') })
        }
      } else {
        setFeedback({ ok: false, msg: raw })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleOverwrite() {
    if (overwriteId === null) return
    const cust = parseInt(customers)
    if (isNaN(cust) || cust < 0) return
    setSaving(true)
    setFeedback(null)
    try {
      await dayRecords.update(overwriteId, { customers: cust })
      const existingSales: SaleRead[] = await sales.list(overwriteId)
      for (const p of productList) {
        const val = parseFloat(unitsSold[p.id] ?? '')
        const ex = existingSales.find(s => s.product_id === p.id)
        if (ex) {
          if (!isNaN(val) && val >= 0) await sales.update(ex.id, { units_sold: val })
        } else if (!isNaN(val) && val > 0) {
          await sales.create({ day_record_id: overwriteId, product_id: p.id, units_sold: val })
        }
      }
      setOverwriteId(null)
      setCustomers('')
      setUnitsSold({})
      setHourlyData({})
      setFeedback({ ok: true, msg: 'Updated!' })
      onSaved()
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Update failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-sm">

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
          {t('whichDayFilling')}
        </label>
        <input
          type="date" required
          value={date}
          max={locked ? localYesterday() : localToday()}
          onChange={e => { setDate(e.target.value); setFeedback(null) }}
          className="w-full border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-3
                     text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700
                     focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <p className="text-xs text-slate-400 mt-1.5">
          {locked
            ? t('todayStillOpen')
            : t('clickCalendar')}
        </p>
        {nonWorking && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20
                         border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            {t('nonWorkingDayMsg')}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
          {t('howManyCustomersThatDay')}
        </label>
        <input
          type="number" min="0" required placeholder="0"
          value={customers} onChange={e => setCustomers(e.target.value)}
          disabled={nonWorking}
          className="w-full border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-3
                     text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700
                     focus:outline-none focus:ring-2 focus:ring-teal-500
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {productList.length > 0 && (
        <fieldset
          disabled={nonWorking}
          className="border border-teal-100 dark:border-teal-800 rounded-2xl p-4 bg-teal-50/30 dark:bg-teal-900/10 disabled:opacity-50"
        >
          <legend className="text-sm font-semibold text-slate-600 dark:text-slate-400 px-1">{t('whatDidYouSell')}</legend>
          <div className="space-y-3 mt-2">
            {productList.map(p => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{p.name}</span>
                <input
                  type="number" min="0"
                  step={p.unit_mode === 'decimal' ? '0.01' : '1'}
                  placeholder="0"
                  value={unitsSold[p.id] ?? ''}
                  onChange={e => setUnitsSold(prev => ({ ...prev, [p.id]: e.target.value }))}
                  className="w-24 border border-slate-300 dark:border-slate-600 rounded-xl px-2 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <span className="text-xs text-slate-400 w-8">{p.unit}</span>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {/* ── Optional hourly breakdown ── */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowHourly(v => !v)}
          disabled={nonWorking}
          className="w-full flex items-center justify-between px-4 py-3
                     text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700
                     transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>
            {t('addHourlyBreakdown')} <span className="text-slate-400 font-normal">({t('optionalLabel')})</span>
          </span>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${showHourly ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showHourly && (
          <div className="border-t border-slate-100 dark:border-slate-700 px-4 pb-4 pt-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/50">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('hourlyBreakdownDesc')}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 max-w-xs">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400 w-11 shrink-0 text-right tabular-nums">
                    {fmtHour(h)}
                  </span>
                  <input
                    type="number" min="0" placeholder="—"
                    value={hourlyData[h] ?? ''}
                    onChange={e => setHourlyData(prev => ({ ...prev, [h]: e.target.value }))}
                    className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm
                               bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100
                               focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          : 'text-red-700 bg-red-50'}`}>
          {feedback.msg}
        </p>
      )}

      {overwriteId !== null ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-4 space-y-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            A record for this date already exists. Overwrite it with this data, or cancel?
          </p>
          <div className="flex gap-2">
            <button
              type="button" onClick={handleOverwrite} disabled={saving}
              className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300
                         text-white font-medium py-2 rounded-xl text-sm transition-colors"
            >
              {saving ? t('savingLabel') : 'Overwrite'}
            </button>
            <button
              type="button" onClick={() => setOverwriteId(null)} disabled={saving}
              className="flex-1 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600
                         border border-slate-300 dark:border-slate-600
                         text-slate-700 dark:text-slate-200 font-medium py-2 rounded-xl text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="submit" disabled={saving || nonWorking}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 dark:disabled:bg-teal-900
                     text-white font-medium py-3 rounded-xl transition-colors text-base"
        >
          {saving ? t('savingLabel') : t('saveThisDay')}
        </button>
      )}
    </form>
  )
}
