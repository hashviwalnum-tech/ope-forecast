import { useEffect, useState } from 'react'
import { businesses, dayRecords, products, sales } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { BusinessRead, ProductRead, SaleRead } from '../api/types'

function localToday(): string {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

function fmtHour(h: number, lang: string): string {
  if (lang === 'he') return `${h}:00`
  if (h === 0)  return '12 am'
  if (h < 12)   return `${h} am`
  if (h === 12) return '12 pm'
  return `${h - 12} pm`
}

interface Props { onSaved: () => void }

export default function LogDayForm({ onSaved }: Props) {
  const { t, lang } = useLanguage()
  const [customers, setCustomers] = useState('')
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [biz, setBiz]             = useState<BusinessRead | null>(null)
  const [unitsSold, setUnitsSold] = useState<Record<number, string>>({})
  const [saving, setSaving]       = useState(false)
  const [feedback, setFeedback]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [warning, setWarning]     = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [overwriteId, setOverwriteId] = useState<number | null>(null)

  useEffect(() => {
    products.list().then(setProductList).catch(() => {})
    businesses.me().then(setBiz).catch(() => {})
  }, [])

  function todayLockReason(): string | null {
    if (!biz) return null
    const oh = biz.settings.opening_hour
    const ch = biz.settings.closing_hour
    if (typeof oh !== 'number' || typeof ch !== 'number') return null
    const now = new Date().getHours()
    if (now >= ch) return null  // day is finished — allow
    if (now < oh) {
      return t('todayNotStarted', { opens: fmtHour(oh, lang), closes: fmtHour(ch, lang) })
    }
    return t('todayStillOpenMsg', { closes: fmtHour(ch, lang) })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setValidationError(null)
    const cust = parseInt(customers)
    if (customers.trim() === '' || isNaN(cust) || cust < 0) {
      setValidationError(t('validationCustomersRequired'))
      return
    }
    if (cust === 0) {
      if (!window.confirm(t('confirmZeroCustomers'))) return
    } else if (cust > 500) {
      if (!window.confirm(t('confirmLargeCount', { n: String(cust) }))) return
    }
    setSaving(true)
    setFeedback(null)
    setWarning(null)
    setOverwriteId(null)
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
      setFeedback({ ok: true, msg: t('savedFeedback') })
      if (day.warning) setWarning(day.warning)
      onSaved()
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Save failed'
      if (raw.toLowerCase().includes('already exists')) {
        try {
          const records = await dayRecords.list()
          const existing = records.find(r => r.date === localToday())
          if (existing) {
            setOverwriteId(existing.id)
          } else {
            setFeedback({ ok: false, msg: t('todayAlreadyLoggedMsg') })
          }
        } catch {
          setFeedback({ ok: false, msg: t('todayAlreadyLoggedMsg') })
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
    setValidationError(null)
    const cust = parseInt(customers)
    if (customers.trim() === '' || isNaN(cust) || cust < 0) {
      setValidationError(t('validationCustomersRequired'))
      return
    }
    if (cust === 0) {
      if (!window.confirm(t('confirmZeroCustomers'))) return
    } else if (cust > 500) {
      if (!window.confirm(t('confirmLargeCount', { n: String(cust) }))) return
    }
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
      setFeedback({ ok: true, msg: t('savedFeedback') })
      onSaved()
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Update failed' })
    } finally {
      setSaving(false)
    }
  }

  const lockReason = todayLockReason()
  if (lockReason) {
    return (
      <div className="max-w-sm rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 space-y-2">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">{t('notReadyToLogYet')}</p>
            <p className="text-sm text-amber-700 mt-1 leading-relaxed">{lockReason}</p>
          </div>
        </div>
        <p className="text-xs text-amber-600 pl-8">
          {t('fixEarlierDayNote')}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-sm">

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          {t('howManyCustomersToday')}
        </label>
        <input
          type="number" min="0" required placeholder="0"
          value={customers}
          onChange={e => { setCustomers(e.target.value); setValidationError(null) }}
          className={`w-full border rounded-xl px-3 py-3 text-slate-900
                     focus:outline-none focus:ring-2 focus:ring-teal-500 ${
            validationError ? 'border-red-400' : 'border-slate-300'
          }`}
        />
        {validationError && (
          <p className="text-sm text-red-600 mt-1">{validationError}</p>
        )}
      </div>

      {productList.length > 0 && (
        <fieldset className="border border-teal-100 rounded-2xl p-4 bg-teal-50/30">
          <legend className="text-sm font-semibold text-slate-600 px-1">{t('whatDidYouSellToday')}</legend>
          <div className="space-y-3 mt-2">
            {productList.map(p => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-slate-700">{p.name}</span>
                <input
                  type="number" min="0"
                  step={p.unit_mode === 'decimal' ? '0.01' : '1'}
                  placeholder="0"
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
          : 'text-red-700 bg-red-50'}`}>
          {feedback.msg}
        </p>
      )}

      {warning && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3">
          <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-700 leading-relaxed">{warning}</p>
        </div>
      )}

      {overwriteId !== null ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 space-y-3">
          <p className="text-sm font-medium text-amber-800">
            {t('todayOverwritePrompt')}
          </p>
          <div className="flex gap-2">
            <button
              type="button" onClick={handleOverwrite} disabled={saving}
              className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300
                         text-white font-medium py-2 rounded-xl text-sm transition-colors"
            >
              {saving ? t('savingLabel') : t('overwriteBtn')}
            </button>
            <button
              type="button" onClick={() => setOverwriteId(null)} disabled={saving}
              className="flex-1 bg-white hover:bg-slate-50 border border-slate-300
                         text-slate-700 font-medium py-2 rounded-xl text-sm transition-colors"
            >
              {t('cancelBtn')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="submit" disabled={saving}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300
                     text-white font-medium py-3 rounded-xl transition-colors text-base"
        >
          {saving ? t('savingLabel') : t('saveTodayBtn')}
        </button>
      )}
    </form>
  )
}
