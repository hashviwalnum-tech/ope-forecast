import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { regulars as api } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrency } from '../contexts/CurrencyContext'
import { useTheme } from '../contexts/ThemeContext'
import type { MonthlyVisits, RegularCreate, RegularProfitabilityRead, RegularRead, RegularUpdate } from '../api/types'

// Dates are formatted in the language the owner PICKED in Ope, not the one
// their browser happens to be set to.  Passing `undefined` follows the browser,
// so an owner who had switched Ope to English still read Hebrew dates.
//
// Money is NOT formatted here any more.  These used to be module-level helpers
// hardcoded to US dollars with the decimal places forced to zero, which was
// wrong twice over: the currency belongs to the business, and the number of
// decimal places belongs to the currency.  Both now come from useCurrency().

function fmtDate(d: string | null, lang: string) {
  if (!d) return null
  return new Date(d).toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' })
}

function liveClv(avgSpend: number, freq: number, years: number) {
  return freq * 52 * avgSpend * years
}

// ── Profitability chart (per regular) ────────────────────────────────────────

function ProfitabilityChart({ regularId }: { regularId: number }) {
  const { t, lang } = useLanguage()
  const { money } = useCurrency()
  const { isDark } = useTheme()
  const [data, setData] = useState<RegularProfitabilityRead | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.profitability(regularId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [regularId])

  if (loading) return (
    <p className="text-xs text-slate-400 dark:text-slate-500 py-2">{t('loadingLabel')}</p>
  )

  const hasAnyData = data && (data.this_month > 0 || data.this_year > 0 || data.all_time > 0)

  if (!data || !hasAnyData) return (
    <p className="text-xs text-slate-400 dark:text-slate-500 py-2">{t('profitabilityNoData')}</p>
  )

  const chartData = [
    { label: t('profitabilityThisMonth'), value: data.this_month },
    { label: t('profitabilityThisYear'), value: data.this_year },
    { label: t('profitabilityAllTime'), value: data.all_time },
  ]

  const tickFill = isDark ? '#94a3b8' : '#64748b'
  const gridStroke = isDark ? '#334155' : '#e2e8f0'
  const barColors = ['#4e8b87', '#3a7470', '#2c5f5c']

  // Whole units only on a chart axis — but the currency, and whether it even
  // HAS decimal places, come from the business's setting.
  const fmt = (v: number) => money(v)

  // Churn chart data — only include months that have at least one visit, OR the last 6 months to show trend
  const monthNames = [
    t('monthJan'), t('monthFeb'), t('monthMar'), t('monthApr'),
    t('monthMay'), t('monthJun'), t('monthJul'), t('monthAug'),
    t('monthSep'), t('monthOct'), t('monthNov'), t('monthDec'),
  ]
  const churnData = (data.monthly_visits ?? []).map((mv: MonthlyVisits) => ({
    label: `${monthNames[mv.month - 1]} ${String(mv.year).slice(2)}`,
    visits: mv.visits,
  }))

  const hasChurnData = churnData.some(d => d.visits > 0)

  // Detect declining trend: last 3 months avg vs prior 3 months avg
  const last3 = churnData.slice(-3)
  const prior3 = churnData.slice(-6, -3)
  const last3Avg = last3.reduce((s, d) => s + d.visits, 0) / Math.max(1, last3.length)
  const prior3Avg = prior3.reduce((s, d) => s + d.visits, 0) / Math.max(1, prior3.length)
  const declining = prior3Avg > 0 && last3Avg < prior3Avg * 0.7  // >30% drop

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-4">
      {/* Revenue profitability chart */}
      <div>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
          {t('profitabilityTitle', { name: data.name })}
        </p>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: tickFill }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: tickFill }}
              width={48}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmt}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12, borderRadius: 8,
                border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#e2e8f0' : '#334155',
              }}
              formatter={(value) => [fmt(typeof value === 'number' ? value : 0), t('profitabilityTooltipLabel')]}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={barColors[i % barColors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {data.first_visit_date && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            {t('firstVisitLabel', { date: fmtDate(data.first_visit_date, lang) ?? '' })}
          </p>
        )}
      </div>

      {/* Churn / visit frequency chart */}
      {hasChurnData && (
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            {t('churnChartTitle')}
          </p>
          {declining && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2 font-medium">
              ⚠ {t('churnDecliningNote')}
            </p>
          )}
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={churnData} margin={{ top: 4, right: 8, left: -24, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: tickFill }}
                axisLine={false}
                tickLine={false}
                interval={churnData.length > 6 ? 1 : 0}
              />
              <YAxis
                tick={{ fontSize: 9, fill: tickFill }}
                width={32}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                minTickGap={4}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12, borderRadius: 8,
                  border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                  background: isDark ? '#1e293b' : '#fff',
                  color: isDark ? '#e2e8f0' : '#334155',
                }}
                formatter={(value) => [value, t('churnTooltipVisits')]}
              />
              <Line
                type="monotone"
                dataKey="visits"
                stroke={declining ? '#f59e0b' : '#4e8b87'}
                strokeWidth={2}
                dot={{ r: 3, fill: declining ? '#f59e0b' : '#4e8b87' }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RegularsPanel() {
  const { t, lang } = useLanguage()
  const { money, symbol, step } = useCurrency()
  const [rows, setRows]         = useState<RegularRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [adding, setAdding]     = useState(false)
  const [editing, setEditing]   = useState<RegularRead | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [visitMsg, setVisitMsg] = useState<string | null>(null)
  const [visitErr, setVisitErr] = useState<string | null>(null)
  const [showOptional, setShowOptional] = useState(false)
  const [expandedProfit, setExpandedProfit] = useState<Set<number>>(new Set())

  const [profMap, setProfMap] = useState<Record<number, RegularProfitabilityRead>>({})

  const [visitAmounts, setVisitAmounts] = useState<Record<number, string>>({})
  const [visitRecording, setVisitRecording] = useState<number | null>(null)

  const [form, setForm] = useState<RegularCreate>({
    name: '', visit_frequency_per_week: 1, avg_spend: 0, expected_lifespan_years: 3,
  })

  function resetForm() {
    setForm({ name: '', visit_frequency_per_week: 1, avg_spend: 0, expected_lifespan_years: 3 })
    setError(null)
    setShowOptional(false)
  }

  async function toggleFavorite(r: RegularRead) {
    try {
      await api.update(r.id, { is_favorite: !r.is_favorite })
      load()
    } catch { /* ignore */ }
  }

  async function load() {
    setLoading(true)
    try {
      const data = await api.list()
      setRows(data)
      const defaults: Record<number, string> = {}
      for (const r of data) {
        defaults[r.id] = String(r.today_amount ?? r.avg_spend)
      }
      setVisitAmounts(defaults)

      // Load profitability for all regulars so it's visible inline without a click
      const profResults = await Promise.allSettled(data.map(r => api.profitability(r.id)))
      const newProfMap: Record<number, RegularProfitabilityRead> = {}
      profResults.forEach((res, i) => {
        if (res.status === 'fulfilled') newProfMap[data[i].id] = res.value
      })
      setProfMap(newProfMap)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function startAdd() { resetForm(); setEditing(null); setAdding(true) }
  function startEdit(r: RegularRead) {
    setForm({
      name: r.name,
      visit_frequency_per_week: r.visit_frequency_per_week,
      avg_spend: r.avg_spend,
      expected_lifespan_years: r.expected_lifespan_years,
      notes: r.notes ?? undefined,
      is_favorite: r.is_favorite,
      first_visit_date: r.first_visit_date ?? undefined,
    })
    setEditing(r)
    setAdding(false)
    setShowOptional(r.visit_frequency_per_week !== 1 || r.expected_lifespan_years !== 3 || r.first_visit_date != null)
  }
  function cancel() { setAdding(false); setEditing(null); resetForm() }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        const upd: RegularUpdate = {
          name: form.name,
          visit_frequency_per_week: form.visit_frequency_per_week,
          avg_spend: form.avg_spend,
          expected_lifespan_years: form.expected_lifespan_years,
          notes: form.notes,
        }
        await api.update(editing.id, upd)
      } else {
        await api.create(form)
      }
      cancel()
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function del(id: number) {
    if (!confirm(t('removeRegularConfirm'))) return
    await api.delete(id)
    load()
  }

  async function recordVisit(id: number, name: string) {
    setVisitRecording(id)
    setVisitMsg(null)
    setVisitErr(null)
    try {
      const amountStr = visitAmounts[id]
      const amount_paid = amountStr ? parseFloat(amountStr) : undefined
      await api.recordVisit(id, amount_paid != null && !isNaN(amount_paid) ? { amount_paid } : undefined)
      setVisitMsg(t('visitRecordedFor', { name }))
      setTimeout(() => setVisitMsg(null), 3000)
      load()
    } catch (e: unknown) {
      setVisitErr(e instanceof Error ? e.message : 'Could not record visit')
      setTimeout(() => setVisitErr(null), 4000)
    } finally {
      setVisitRecording(null)
    }
  }

  function toggleProfit(id: number) {
    setExpandedProfit(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const showForm = adding || editing !== null
  const clvPreview = liveClv(form.avg_spend, form.visit_frequency_per_week, form.expected_lifespan_years ?? 3)

  return (
    <div className="space-y-6">

      {visitMsg && (
        <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 px-4 py-3 text-sm text-teal-700 dark:text-teal-300">
          {visitMsg}
        </div>
      )}
      {visitErr && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {visitErr}
        </div>
      )}

      {!showForm && (
        <button
          onClick={startAdd}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 text-white
                     text-sm font-semibold hover:bg-teal-700 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('addARegular')}
        </button>
      )}

      {showForm && (
        <div className="rounded-2xl border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-700 dark:text-slate-200">
            {editing ? t('editRegularTitle') : t('addARegular')}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('nameLabel')}</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={`${t('egPrefix')} ${t('egRegularName')}`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                           bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t('avgSpendLabel')}
              </label>
              <input
                type="number" min="0" step="0.5"
                value={form.avg_spend}
                onChange={e => setForm(f => ({ ...f, avg_spend: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                           bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>
          </div>

          <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 px-4 py-3">
            <p className="text-xs text-teal-600 dark:text-teal-400 font-medium">
              {t('clvEstimateText', { years: String(form.expected_lifespan_years ?? 3) })}
              <span className="text-teal-800 dark:text-teal-200 font-bold ml-1">{money(clvPreview)}</span>
            </p>
            <p className="text-[11px] text-teal-500 dark:text-teal-500 mt-0.5">
              {t('clvFormulaText', {
                freq: String(form.visit_frequency_per_week),
                spend: String(form.avg_spend),
                years: String(form.expected_lifespan_years ?? 3),
              })}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowOptional(o => !o)}
            className="text-xs text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
          >
            {showOptional ? '▴' : '▾'} {t('optionalDetailsToggle')}
          </button>

          {showOptional && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {t('visitsPerWeek')}
                </label>
                <input
                  type="number" min="0.1" step="0.5"
                  value={form.visit_frequency_per_week}
                  onChange={e => setForm(f => ({ ...f, visit_frequency_per_week: parseFloat(e.target.value) || 0 }))}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {t('expectedLoyalty')}
                </label>
                <input
                  type="number" min="0.5" step="0.5"
                  value={form.expected_lifespan_years}
                  onChange={e => setForm(f => ({ ...f, expected_lifespan_years: parseFloat(e.target.value) || 1 }))}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('firstVisitDateLabel')}</label>
                <input
                  type="date"
                  value={form.first_visit_date ?? ''}
                  onChange={e => setForm(f => ({ ...f, first_visit_date: e.target.value || undefined }))}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
                <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{t('firstVisitDateDesc')}</p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('notesOptional')}</label>
                <input
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value || undefined }))}
                  placeholder={`${t('egPrefix')} ${t('egRegularNotes')}`}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving || !form.name}
              className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold
                         hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? t('savingLabel') : t('saveLabel')}
            </button>
            <button
              onClick={cancel}
              className="px-5 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm
                         hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              {t('cancelBtn')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{t('savingLabel')}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 p-8 text-center">
          <p className="text-sm text-teal-600 dark:text-teal-400 font-medium">{t('noRegularsEmptyTitle')}</p>
          <p className="text-xs text-teal-400 dark:text-teal-600 mt-1">
            {t('noRegularsEmptyDesc')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...rows].sort((a, b) => {
            if (a.is_favorite === b.is_favorite) return a.name.localeCompare(b.name)
            return a.is_favorite ? -1 : 1
          }).map(r => (
            <div
              key={r.id}
              className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm"
            >
              <div className="flex flex-wrap gap-4 items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => toggleFavorite(r)}
                      title={r.is_favorite ? t('unfavoriteLabel') : t('favoriteLabel')}
                      className={`text-lg leading-none transition-colors ${r.is_favorite ? 'text-amber-400 hover:text-amber-500' : 'text-slate-300 dark:text-slate-600 hover:text-amber-300'}`}
                    >★</button>
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{r.name}</span>
                    <span className="text-xs bg-teal-50 dark:bg-teal-900/40 text-teal-600 dark:text-teal-300 border border-teal-100 dark:border-teal-800
                                     rounded-full px-2 py-0.5 font-medium">
                      CLV {money(r.clv)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {r.visit_frequency_per_week}×/week · ${r.avg_spend}/visit · {r.expected_lifespan_years} yr
                  </p>
                  {r.notes && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 italic">{r.notes}</p>}
                  {r.last_visit_date && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {t('lastVisitLabel', { date: fmtDate(r.last_visit_date, lang) ?? '' })}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(r)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs
                               hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    {t('editBtn')}
                  </button>
                  <button
                    onClick={() => del(r.id)}
                    className="px-3 py-1.5 rounded-lg border border-rose-100 dark:border-rose-900 text-rose-500 dark:text-rose-400 text-xs
                               hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  >
                    {t('removeBtn')}
                  </button>
                </div>
              </div>

              {/* Inline profitability summary */}
              {profMap[r.id] && (profMap[r.id].all_time > 0) && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700
                                flex flex-wrap gap-x-5 gap-y-1">
                  <div>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{t('profitabilityThisMonth')}</span>
                    <span className="ml-1.5 text-sm font-semibold text-teal-700 dark:text-teal-300">
                      {money(profMap[r.id].this_month)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{t('profitabilityThisYear')}</span>
                    <span className="ml-1.5 text-sm font-semibold text-teal-700 dark:text-teal-300">
                      {money(profMap[r.id].this_year)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{t('profitabilityAllTime')}</span>
                    <span className="ml-1.5 text-sm font-semibold text-teal-700 dark:text-teal-300">
                      {money(profMap[r.id].all_time)}
                    </span>
                  </div>
                </div>
              )}

              {/* Record visit row */}
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                  {r.today_amount != null ? t('updateTodaysTotalLabel') : t('recordVisitAmountLabel')}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400 dark:text-slate-500">{symbol}</span>
                  <input
                    type="number"
                    min="0"
                    step={step}
                    value={visitAmounts[r.id] ?? (r.today_amount ?? r.avg_spend)}
                    onChange={e => setVisitAmounts(a => ({ ...a, [r.id]: e.target.value }))}
                    className="w-20 text-sm px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg
                               bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200
                               focus:outline-none focus:ring-2 focus:ring-teal-300 tabular-nums"
                  />
                </div>
                <button
                  onClick={() => recordVisit(r.id, r.name)}
                  disabled={visitRecording === r.id}
                  className={`px-3 py-1.5 rounded-lg text-white text-xs font-semibold
                             hover:bg-teal-700 disabled:opacity-50 transition-colors
                             ${r.today_amount != null ? 'bg-teal-500' : 'bg-teal-600'}`}
                >
                  {visitRecording === r.id
                    ? '…'
                    : r.today_amount != null
                      ? t('updateVisitBtn')
                      : t('recordVisit')}
                </button>
                {r.today_amount != null && (
                  <span className="text-xs text-teal-600 dark:text-teal-400 font-medium">
                    {t('todayLoggedLabel', { amount: String(r.today_amount.toFixed(2)) })}
                  </span>
                )}
              </div>

              {/* Profitability chart (expandable) */}
              <div className="mt-2">
                <button
                  onClick={() => toggleProfit(r.id)}
                  className="text-xs text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
                >
                  {expandedProfit.has(r.id) ? '▴' : '▾'} {t('showProfitabilityBtn')}
                </button>
                {expandedProfit.has(r.id) && <ProfitabilityChart regularId={r.id} />}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {t('regularsNote')}
      </p>
    </div>
  )
}
