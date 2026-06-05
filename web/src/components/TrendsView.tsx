import { useEffect, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart,
  CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { analytics } from '../api/client'
import type { MonthlyResponse, MonthSummary } from '../api/types'
import { addCardToHome } from '../lib/homeLayout'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDateShort(s: string): string {
  // "2024-03-15"  →  "15 Mar"
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [, m, d] = s.split('-')
  return `${parseInt(d)} ${months[parseInt(m)]}`
}

function MomBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-300 text-sm">first month</span>
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold
      ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
      <span>{up ? '▲' : '▼'}</span>
      <span>{Math.abs(pct).toFixed(1)}%</span>
    </span>
  )
}

// ── not-enough-data state ─────────────────────────────────────────────────────

function NotEnoughData({ message }: { message?: string }) {
  return (
    <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
      <div className="w-14 h-14 mb-4 rounded-full bg-teal-50 flex items-center
                      justify-center mx-auto">
        <svg className="w-7 h-7 text-teal-300" fill="none" viewBox="0 0 24 24"
             stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0
               002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2
               2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2
               2 0 01-2-2z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-600 mb-2">No history yet</p>
      <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
        {message ?? 'Add daily customer counts in "Add Today" or "Add Past Day" and your monthly trends will appear here.'}
      </p>
    </div>
  )
}

// ── month-over-month comparison card ─────────────────────────────────────────

function MomCard({ current, prev }: { current: MonthSummary; prev: MonthSummary }) {
  const change = current.mom_pct_change
  const up = change !== null && change >= 0

  return (
    <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 mb-4">
        Month-over-month
      </h2>
      <div className="flex items-stretch gap-4">

        {/* Previous month */}
        <div className="flex-1 bg-slate-50 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">{prev.month_label}</p>
          <p className="text-2xl font-bold text-slate-600 tabular-nums">
            {prev.avg_daily_customers.toFixed(1)}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">avg customers/day</p>
          <p className="text-xs text-slate-300 mt-1">
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
          ${up ? 'bg-emerald-50 border border-emerald-100'
               : change !== null ? 'bg-rose-50 border border-rose-100'
               : 'bg-teal-50 border border-teal-100'}`}>
          <p className="text-xs text-slate-500 mb-1">{current.month_label}</p>
          <p className={`text-2xl font-bold tabular-nums
            ${up ? 'text-emerald-700' : change !== null ? 'text-rose-600' : 'text-teal-700'}`}>
            {current.avg_daily_customers.toFixed(1)}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">avg customers/day</p>
          <p className="text-xs text-slate-400 mt-1">
            {current.total_customers.toLocaleString()} total · {current.logged_days} days logged
          </p>
        </div>

      </div>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function TrendsView() {
  const [data, setData] = useState<MonthlyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addedToHome, setAddedToHome] = useState(false)

  function handleAddToHome() {
    addCardToHome('trends')
    setAddedToHome(true)
    setTimeout(() => setAddedToHome(false), 2500)
  }

  useEffect(() => {
    setLoading(true)
    analytics.monthlySummary()
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-teal-400">
        <span className="text-sm animate-pulse">Loading trends…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
        Couldn't load trends — is the backend running?
        <span className="block mt-1 text-xs text-red-400">{error}</span>
      </div>
    )
  }

  if (!data || data.status !== 'ok' || data.months.length === 0) {
    return <NotEnoughData message={data?.message} />
  }

  const months = data.months
  const lastMonth = months[months.length - 1]
  const prevMonth = months.length >= 2 ? months[months.length - 2] : null

  // Date range label
  const firstDate = data.history_points[0]?.date ?? ''
  const lastDate = data.history_points[data.history_points.length - 1]?.date ?? ''
  const dateRange = firstDate && lastDate
    ? `${fmtDateShort(firstDate)} – ${fmtDateShort(lastDate)}`
    : ''

  // Chart data
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
        <button
          onClick={handleAddToHome}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700
                     text-xs text-slate-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400
                     hover:border-teal-200 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
        >
          {addedToHome ? (
            <><svg className="w-3.5 h-3.5 shrink-0 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>Added to home</>
          ) : (
            <><svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>Add to home</>
          )}
        </button>
      </div>

      {/* ── Summary strip ── */}
      <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 px-6 py-4 shadow-sm
                      flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <p className="text-xs text-slate-400">Total days logged</p>
          <p className="text-xl font-bold text-teal-700 tabular-nums">{data.n_total_days}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Months of history</p>
          <p className="text-xl font-bold text-teal-700 tabular-nums">{months.length}</p>
        </div>
        {dateRange && (
          <div>
            <p className="text-xs text-slate-400">Date range</p>
            <p className="text-sm font-medium text-slate-600">{dateRange}</p>
          </div>
        )}
        {months.length === 1 && (
          <p className="text-xs text-teal-600 bg-teal-50 px-3 py-1.5 rounded-lg">
            Log data from another month to see comparisons
          </p>
        )}
      </div>

      {/* ── Month-over-month comparison ── */}
      {prevMonth && (
        <MomCard current={lastMonth} prev={prevMonth} />
      )}

      {/* ── Monthly bar chart ── */}
      <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">
          Customers by month
        </h2>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          Average customers per logged day each month.
          Using the daily average (not totals) makes months with different numbers
          of logged days fairly comparable.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f2f8f7" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              width={40}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              labelStyle={{ color: '#334155', fontWeight: 600 }}
              formatter={(value, name) => {
                if (name === 'avg') return [
                  typeof value === 'number' ? `${value.toFixed(1)}/day` : value,
                  'Avg customers',
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
          <h2 className="text-base font-semibold text-slate-800 mb-1">
            Full customer history
          </h2>
          <p className="text-xs text-slate-400 mb-5 leading-relaxed">
            Every day you've logged, in order. Gaps are days with no entry — treated
            as missing data, not zero.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={lineData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4e8b87" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4e8b87" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f2f8f7" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(1, Math.floor(lineData.length / 8) - 1)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                width={40}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                labelStyle={{ color: '#334155', fontWeight: 600 }}
                formatter={(v) => [
                  typeof v === 'number' ? Math.round(v) : v,
                  'Customers',
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
        <div className="px-6 py-4 border-b border-teal-50">
          <h2 className="text-base font-semibold text-slate-800">Month-by-month breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400
                               uppercase tracking-wide">Month</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400
                               uppercase tracking-wide">Avg/day</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400
                               uppercase tracking-wide">Total</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400
                               uppercase tracking-wide">Days logged</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400
                               uppercase tracking-wide">vs prev month</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m, i) => {
                const isLatest = i === 0
                return (
                  <tr key={`${m.year}-${m.month}`}
                      className={`border-b border-slate-50 last:border-0
                        ${isLatest ? 'bg-teal-50/40' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-3 font-medium text-slate-700">
                      {m.month_label}
                      {isLatest && (
                        <span className="ml-2 text-xs bg-teal-100 text-teal-600
                                         font-medium px-1.5 py-0.5 rounded-full">
                          latest
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-700 tabular-nums">
                      {m.avg_daily_customers.toFixed(1)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-500 tabular-nums">
                      {m.total_customers.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
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
