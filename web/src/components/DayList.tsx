import { useEffect, useMemo, useState } from 'react'
import { dayRecords, products as productsApi, sales as salesApi } from '../api/client'
import LoadError from './LoadError'
import { useLanguage } from '../contexts/LanguageContext'
import type { DayRecordRead, ProductRead, SaleRead } from '../api/types'

function weekdayLabel(dateStr: string, t: ReturnType<typeof useLanguage>['t']): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const jsDay = new Date(y, m - 1, d).getDay()  // 0=Sun…6=Sat
  const keys = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'] as const
  return t(keys[jsDay])
}

/** Months present in the data, newest first, as `YYYY-MM`. */
function monthsOf(days: { date: string }[]): string[] {
  return [...new Set(days.map(d => d.date.slice(0, 7)))].sort().reverse()
}

/** "August 2026", in the language the owner picked in Ope. */
function monthLabel(ym: string, lang: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const RECENT = 'recent'
const RECENT_DAYS = 30

interface Props { refreshKey: number }

export default function DayList({ refreshKey }: Props) {
  const { t, lang } = useLanguage()
  const [days, setDays]         = useState<DayRecordRead[]>([])
  const [allSales, setAllSales] = useState<SaleRead[]>([])
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<unknown>(null)

  // Edit state
  const [editId, setEditId]           = useState<number | null>(null)
  const [editCustomers, setEditCustomers] = useState('')
  const [editSales, setEditSales]     = useState<Record<number, string>>({})
  const [saving, setSaving]           = useState(false)
  const [editError, setEditError]     = useState<string | null>(null)

  // A year of trading is 300+ rows. Rendering the lot made this screen 12,025px
  // tall on a phone — 14 screenfuls, 6,250 elements — with no way to reach a
  // particular date but scrolling. Default to the recent weeks; the rest is a
  // month away.
  const [period, setPeriod] = useState<string>(RECENT)

  async function load() {
    setLoading(true)
    try {
      const [d, s, p] = await Promise.all([
        dayRecords.list(),
        salesApi.list(),
        productsApi.list(),
      ])
      setDays([...d].reverse())
      setAllSales(s)
      setProductList(p)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [refreshKey])

  const months = useMemo(() => monthsOf(days), [days])
  const shown = useMemo(() => {
    if (period !== RECENT) return days.filter(d => d.date.startsWith(period))
    return days.slice(0, RECENT_DAYS)      // `days` is already newest-first
  }, [days, period])

  function startEdit(day: DayRecordRead) {
    setEditId(day.id)
    setEditError(null)
    setEditCustomers(String(day.customers))
    const current: Record<number, string> = {}
    for (const s of allSales.filter(s => s.day_record_id === day.id)) {
      current[s.product_id] = String(s.units_sold)
    }
    setEditSales(current)
  }

  async function saveEdit(day: DayRecordRead) {
    setSaving(true)
    try {
      await dayRecords.update(day.id, { customers: parseInt(editCustomers) })

      for (const p of productList) {
        const val = parseFloat(editSales[p.id] ?? '')
        const existing = allSales.find(
          s => s.day_record_id === day.id && s.product_id === p.id
        )
        if (existing) {
          if (!isNaN(val) && val >= 0) {
            await salesApi.update(existing.id, { units_sold: val })
          }
        } else if (!isNaN(val) && val > 0) {
          await salesApi.create({ day_record_id: day.id, product_id: p.id, units_sold: val })
        }
      }

      setEditId(null)
      await load()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm(t('deleteDayConfirm'))) return
    try {
      for (const s of allSales.filter(s => s.day_record_id === id)) {
        await salesApi.delete(s.id)
      }
      await dayRecords.delete(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleUndo(id: number) {
    try {
      await dayRecords.undo(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed')
    }
  }

  if (loading) return <p role="status" aria-live="polite" className="text-teal-700 dark:text-teal-300 text-sm animate-pulse">{t('loadingYourDays')}</p>
  if (error)   return <LoadError error={error} onRetry={load} />
  if (!days.length) return (
    <div className="py-12 text-center">
      <div className="w-14 h-14 mb-4 mx-auto rounded-full bg-teal-50 flex items-center justify-center dark:bg-slate-800">
        <svg className="w-7 h-7 text-teal-700 dark:text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="text-slate-600 text-sm max-w-xs mx-auto leading-relaxed dark:text-slate-300">
        {t('noDaysLoggedYet', { addToday: t('logToday') })}
      </p>
    </div>
  )

  return (
    <div className="max-w-full">

      {/* Which stretch of history to show */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label htmlFor="daylist-period" className="inline-flex items-center min-h-11 text-sm text-slate-700 dark:text-slate-200">
          {t('showingPeriodLabel')}
        </label>
        <select
          id="daylist-period"
          value={period}
          onChange={e => { setPeriod(e.target.value); setEditId(null) }}
          className="min-h-11 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700
                     text-slate-900 dark:text-slate-100 px-3 text-sm
                     focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value={RECENT}>{t('lastNDays', { n: String(RECENT_DAYS) })}</option>
          {months.map(ym => (
            <option key={ym} value={ym}>{monthLabel(ym, lang)}</option>
          ))}
        </select>
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {t('daysShownOfTotal', { shown: String(shown.length), total: String(days.length) })}
        </span>
      </div>

      {/* ── Phone: one card per day. A 14-column table on a 390px screen made
             the whole PAGE scroll sideways to 896px, header and all. ── */}
      <ul className="sm:hidden space-y-2 list-none p-0 m-0">
        {shown.map(day => {
          const daySales = allSales.filter(s => s.day_record_id === day.id)
          const isFlagged = day.outlier_status === 'flagged'
          return (
            <li
              key={day.id}
              className={`rounded-xl border px-4 py-3 ${
                isFlagged
                  ? 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {weekdayLabel(day.date, t)} · {day.date}
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  <strong className="tabular-nums">{day.customers}</strong>{' '}
                  <span className="text-slate-600 dark:text-slate-300">{t('customersLabel').toLowerCase()}</span>
                </p>
              </div>
              {isFlagged && (
                <p className="mt-1 inline-block px-2 py-0.5 text-xs rounded-full
                              bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200">
                  {t('unusualBadge')}
                </p>
              )}
              {daySales.length > 0 && (
                /* Folded away by default: a shop with eleven products turns
                   every card into a paragraph, and thirty of those is a screen
                   the owner has to scroll past rather than read. */
                <details className="mt-1.5 group">
                  <summary className="text-sm text-teal-800 dark:text-teal-300 cursor-pointer
                                      min-h-11 flex items-center gap-1
                                      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
                    <svg className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {t('whatSoldThatDay', { n: String(daySales.length) })}
                  </summary>
                  <ul className="mt-1 ps-5 space-y-0.5 list-none">
                    {daySales.map(sale => {
                      const prod = productList.find(pr => pr.id === sale.product_id)
                      if (!prod) return null
                      return (
                        <li key={sale.id ?? sale.product_id} className="text-sm text-slate-700 dark:text-slate-200">
                          {prod.name}: <strong className="tabular-nums">{sale.units_sold}</strong> {prod.unit}
                        </li>
                      )
                    })}
                  </ul>
                </details>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => startEdit(day)}
                  className="min-h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-600
                             text-sm font-medium text-slate-700 dark:text-slate-200
                             hover:bg-teal-50 dark:hover:bg-slate-700
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                >
                  {t('editBtn')}
                </button>
                {day.prev_customers != null && (
                  <button
                    onClick={() => handleUndo(day.id)}
                    className="min-h-11 px-4 rounded-xl border border-amber-300 dark:border-amber-700
                               text-sm font-medium text-amber-800 dark:text-amber-300
                               hover:bg-amber-50 dark:hover:bg-amber-900/20
                               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
                  >
                    {t('undoLabel')}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(day.id)}
                  className="min-h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-600
                             text-sm font-medium text-slate-700 dark:text-slate-200
                             hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                >
                  {t('deleteBtn')}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {/* ── Wider screens: the table, scrolling inside its own box ── */}
      <div className="hidden sm:block overflow-x-auto max-w-full" role="region" aria-label={t('pastDays')} tabIndex={0}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-200 dark:border-slate-700 text-left text-xs font-semibold
                         text-slate-600 dark:text-slate-300 uppercase tracking-wider">
            <th className="py-2 pr-4 whitespace-nowrap">{t('dateColLabel')}</th>
            <th className="py-2 pr-4">{t('dayColLabel')}</th>
            <th className="py-2 pr-4">{t('customersLabel')}</th>
            {productList.map(p => (
              <th key={p.id} className="py-2 pr-4 whitespace-nowrap">
                {p.name} <span className="font-normal text-slate-600 dark:text-slate-300">({p.unit})</span>
              </th>
            ))}
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {shown.map(day => {
            const daySales = allSales.filter(s => s.day_record_id === day.id)
            const isEditing = editId === day.id

            if (isEditing) {
              return (
                <tr key={day.id} className="border-b border-slate-100 bg-teal-50 dark:bg-slate-800 dark:border-slate-700">
                  <td className="py-2 pr-4 text-slate-600 text-xs dark:text-slate-300">{day.date}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{weekdayLabel(day.date, t)}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="number" min="0"
                      value={editCustomers}
                      onChange={e => setEditCustomers(e.target.value)}
                      className="w-20 border border-slate-300 rounded px-2 py-0.5 text-sm dark:border-slate-600"
                    />
                  </td>
                  {productList.map(p => (
                    <td key={p.id} className="py-2 pr-4">
                      <input
                        type="number" min="0" step="0.01"
                        value={editSales[p.id] ?? ''}
                        onChange={e => setEditSales(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-20 border border-slate-300 rounded px-2 py-0.5 text-sm dark:border-slate-600"
                      />
                    </td>
                  ))}
                  <td className="py-2" colSpan={editError ? productList.length + 3 : 1}>
                    {editError ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200
                                      rounded-lg px-3 py-2 leading-relaxed max-w-xs">
                          {editError}
                        </p>
                        <button
                          onClick={() => { setEditId(null); setEditError(null) }}
                          className="text-sm text-slate-700 dark:text-slate-200 hover:underline text-start min-h-11 px-1 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                        >
                          {t('dismissBtn')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          onClick={() => saveEdit(day)} disabled={saving}
                          className="text-teal-600 hover:underline font-medium disabled:opacity-50"
                        >
                          {saving ? '…' : t('saveLabel')}
                        </button>
                        <button
                          onClick={() => { setEditId(null); setEditError(null) }}
                          className="text-slate-600 hover:underline dark:text-slate-300"
                        >
                          {t('cancelBtn')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            }

            const isFlagged = day.outlier_status === 'flagged'
            return (
              <tr key={day.id}
                className={`border-b border-slate-100 dark:border-slate-700 ${
                  isFlagged ? 'bg-amber-50/60 dark:bg-amber-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
                }`}
              >
                <td className="py-2 pr-4 text-slate-600 text-xs whitespace-nowrap dark:text-slate-300">
                  {day.date}
                  {isFlagged && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full dark:text-amber-300">
                      {t('unusualBadge')}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{weekdayLabel(day.date, t)}</td>
                <td className="py-2 pr-4 font-semibold text-slate-800 dark:text-slate-100">{day.customers}</td>
                {productList.map(p => {
                  const sale = daySales.find(s => s.product_id === p.id)
                  return (
                    <td key={p.id} className="py-2 pr-4 text-slate-600 dark:text-slate-300">
                      {sale != null ? sale.units_sold : <span className="text-slate-300">—</span>}
                    </td>
                  )
                })}
                <td className="py-2">
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => startEdit(day)}
                      className="min-w-11 min-h-11 px-2 rounded-lg text-sm font-medium
                                 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-slate-700
                                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                    >
                      {t('editBtn')}
                    </button>
                    {day.prev_customers != null && (
                      <button
                        onClick={() => handleUndo(day.id)}
                        title={`${t('undoLabel')}: ${t('restoreToPrevious', { n: String(day.prev_customers) })}`}
                        className="min-w-11 min-h-11 px-2 rounded-lg text-sm font-medium
                                   text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20
                                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
                      >
                        {t('undoLabel')}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(day.id)}
                      className="min-w-11 min-h-11 px-2 rounded-lg text-slate-600 dark:text-slate-300
                                 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20
                                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                      aria-label={t('a11yDelete')}
                      title={t('deleteBtn')}
                    >
                      <svg className="w-4 h-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300 mt-3">{t('daysTotal', { n: String(days.length) })}</p>
    </div>
  )
}
