import { useEffect, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart,
  CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { analytics } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import type { MonthlyResponse, MonthSummary } from '../api/types'
import { addCardToHome, isCardOnHome, removeCardFromHome } from '../lib/homeLayout'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDateShort(s: string): string {
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [, m, d] = s.split('-')
  return `${parseInt(d)} ${months[parseInt(m)]}`
}

function MomBadge({ pct }: { pct: number | null }) {
  const { t } = useLanguage()
  if (pct === null) return <span className="text-slate-400 dark:text-slate-500 text-sm">{t('firstMonth')}</span>
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold
      ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
      <span>{up ? '▲' : '▼'}</span>
      <span>{Math.abs(pct).toFixed(1)}%</span>
    </span>
  )
}

// ── not-enough-data state ─────────────────────────────────────────────────────

function NotEnoughData({ message }: { message?: string }) {
  const { t } = useLanguage()
  return (
    <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
      <div className="w-14 h-14 mb-4 rounded-full bg-teal-50 dark:bg-teal-900/20 flex items-center
                      justify-center mx-auto">
        <svg className="w-7 h-7 text-teal-300 dark:text-teal-600" fill="none" viewBox="0 0 24 24"
             stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0
               002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2
               2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2
               2 0 01-2-2z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">{t('trendsNoHistoryTitle')}</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
        {message ?? t('trendsNoHistoryMsg')}
      </p>
    </div>
  )
}

// ── month-over-month comparison card ─────────────────────────────────────────

function MomCard({ current, prev }: { current: MonthSummary; prev: MonthSummary }) {
  const { t } = useLanguage()
  const change = current.mom_pct_change
  const up = change !== null && change >= 0

  return (
    <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-4">
        {t('momTitle')}
      </h2>
      <div className="flex items-stretch gap-4">

        {/* Previous month */}
        <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">{prev.month_label}</p>
          <p className="text-2xl font-bold text-slate-600 dark:text-slate-300 tabular-nums">
            {prev.avg_daily_customers.toFixed(1)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t('avgCustomersPerDay')}</p>
          <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">
            {prev.total_customers.toLocaleString()} total · {prev.logged_days} days logged
          </p>
        </div>

        {/* Arrow + change */}
        <div className="flex flex-col items-center justify-center gap-1 px-2">
          <svg
            className={`w-6 h-6 ${up ? 'text-emerald-400' : 'text-rose-400'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d={up ? 'M17 8l4 4m0 0l-4 4m4-4H3' : 'M17 16l4-4m0 0l-4-4m4 4H3'} />
          </svg>
          <MomBadge pct={change} />
        </div>

        {/* Current month */}
        <div className={`flex-1 rounded-xl p-4
          ${up ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900'
               : change !== null ? 'bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900'
               : 'bg-teal-50 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-800'}`}>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{current.month_label}</p>
          <p className={`text-2xl font-bold tabular-nums
            ${up ? 'text-emerald-700 dark:text-emerald-400' : change !== null ? 'text-rose-600 dark:text-rose-400' : 'text-teal-700 dark:text-teal-300'}`}>
            {current.avg_daily_customers.toFixed(1)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t('avgCustomersPerDay')}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            {current.total_customers.toLocaleString()} total · {current.logged_days} days logged
          </p>
        </div>

      </div>
    </div>
  )
}

// ── add-to-home / remove-from-home button ─────────────────────────────────────

function HomeToggleButton() {
  const { t } = useLanguage()
  const [onHome, setOnHome] = useState(() => isCardOnHome('trends'))
  const [flash, setFlash]   = useState(false)

  function toggle() {
    if (onHome) {
      removeCardFromHome('trends')
      setOnHome(false)
    } else {
      addCardToHome('trends')
      setOnHome(true)
      setFlash(true)
      setTimeout(() => setFlash(false), 1800)
    }
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700
                 text-xs text-slate-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400
                 hover:border-teal-200 dark:hover:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
    >
      {flash ? (
        <><svg className="w-3.5 h-3.5 shrink-0 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>{t('addedToHomeConfirm')}</>
      ) : onHome ? (
        <><svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>{t('removeFromHome')}</>
      ) : (
        <><svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>{t('addToHome')}</>
      )}
    </button>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function TrendsView() {
  const { t } = useLanguage()
  const { isDark } = useTheme()
  const [data, setData] = useState<MonthlyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    analytics.monthlySummary()
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const tickFill    = isDark ? '#94a3b8' : '#64748b'
  const gridStroke  = isDark ? '#334155' : '#e2e8f0'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-teal-400">
        <span className="text-sm animate-pulse">{t('trendsLoading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-300">
        {t('trendsLoadingError')}
        <span className="block mt-1 text-xs text-red-400 dark:text-red-500">{error}</span>
      </div>
    )
  }

  if (!data || data.status !== 'ok' || data.months.length === 0) {
    return <NotEnoughData message={data?.message} />
  }

  const months = data.months
  const lastMonth = months[months.length - 1]
  const prevMonth = months.length >= 2 ? months[months.length - 2] : null

  const firstDate = data.history_points[0]?.date ?? ''
  const lastDate = data.history_points[data.history_points.length - 1]?.date ?? ''
  const dateRange = firstDate && lastDate
    ? `${fmtDateShort(firstDate)} – ${fmtDateShort(lastDate)}`
    : ''

  const barData = months.map(m => ({
    name: m.month_label,
    avg: m.avg_daily_customers,
    total: m.total_customers,
    days: m.logged_days,
  }))

  const lineData = data.history_points.map(p => ({
    date: p.date,
    label: fmtDateShort(p.date),
    customers: p.customers,
  }))

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <HomeToggleButton />
      </div>

      {/* ── Summary strip ── */}
      <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 px-6 py-4 shadow-sm
                      flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('totalDaysLogged')}</p>
          <p className="text-xl font-bold text-teal-700 dark:text-teal-300 tabular-nums">{data.n_total_days}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('monthsOfHistory')}</p>
          <p className="text-xl font-bold text-teal-700 dark:text-teal-300 tabular-nums">{months.length}</p>
        </div>
        {dateRange && (
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">{t('dateRangeLabel')}</p>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{dateRange}</p>
          </div>
        )}
        {months.length === 1 && (
          <p className="text-xs text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30 px-3 py-1.5 rounded-lg">
            {t('logMoreMonths')}
          </p>
        )}
      </div>

      {/* ── Month-over-month comparison ── */}
      {prevMonth && (
        <MomCard current={lastMonth} prev={prevMonth} />
      )}

      {/* ── Monthly bar chart ── */}
      <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
          {t('customersByMonth')}
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-5 leading-relaxed">
          {t('avgCustomersMonthDesc')}
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: tickFill }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: tickFill }}
              width={40}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12, borderRadius: 8,
                border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#e2e8f0' : '#334155',
              }}
              labelStyle={{ color: isDark ? '#e2e8f0' : '#334155', fontWeight: 600 }}
              formatter={(value, name) => {
                if (name === 'avg') return [
                  typeof value === 'number' ? `${value.toFixed(1)}${t('perDaySuffix')}` : value,
                  t('avgCustomersTooltipLabel'),
                ]
                return [value, name]
              }}
            />
            <Bar dataKey="avg" fill="#4e8b87" radius={[4, 4, 0, 0]} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* ── Full history line chart ── */}
      {lineData.length >= 2 && (
        <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
            {t('fullCustomerHistory')}
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-5 leading-relaxed">
            {t('fullHistoryDesc')}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={lineData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4e8b87" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4e8b87" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: tickFill }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(1, Math.floor(lineData.length / 8) - 1)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: tickFill }}
                width={40}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12, borderRadius: 8,
                  border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                  background: isDark ? '#1e293b' : '#fff',
                  color: isDark ? '#e2e8f0' : '#334155',
                }}
                labelStyle={{ color: isDark ? '#e2e8f0' : '#334155', fontWeight: 600 }}
                formatter={(v) => [
                  typeof v === 'number' ? Math.round(v) : v,
                  t('customersTooltip'),
                ]}
              />
              <Area
                type="monotone"
                dataKey="customers"
                stroke="#3a7470"
                strokeWidth={1.5}
                fill="url(#histGrad)"
                dot={lineData.length <= 60}
                activeDot={{ r: 4, fill: '#3a7470' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Monthly breakdown table ── */}
      <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-teal-50 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('monthByMonthTable')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 dark:text-slate-500
                               uppercase tracking-wide">{t('monthColLabel')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 dark:text-slate-500
                               uppercase tracking-wide">{t('avgPerDayCol')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 dark:text-slate-500
                               uppercase tracking-wide">{t('totalCol')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 dark:text-slate-500
                               uppercase tracking-wide">{t('daysLoggedCol')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 dark:text-slate-500
                               uppercase tracking-wide">{t('vsPrevMonth')}</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m, i) => {
                const isLatest = i === 0
                return (
                  <tr key={`${m.year}-${m.month}`}
                      className={`border-b border-slate-50 dark:border-slate-700/50 last:border-0
                        ${isLatest ? 'bg-teal-50/40 dark:bg-teal-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
                    <td className="px-5 py-3 font-medium text-slate-700 dark:text-slate-200">
                      {m.month_label}
                      {isLatest && (
                        <span className="ml-2 text-xs bg-teal-100 dark:bg-teal-800 text-teal-600 dark:text-teal-300
                                         font-medium px-1.5 py-0.5 rounded-full">
                          {t('latestLabel')}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                      {m.avg_daily_customers.toFixed(1)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-500 dark:text-slate-400 tabular-nums">
                      {m.total_customers.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-400 dark:text-slate-500 tabular-nums">
                      {m.logged_days}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <MomBadge pct={m.mom_pct_change} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}
