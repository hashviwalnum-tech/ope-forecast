import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { analytics } from '../api/client'
import type { HourlyAnalyticsResponse } from '../api/types'

function fmtHour(h: number): string {
  const h24 = ((h % 24) + 24) % 24
  if (h24 === 0)   return '12 am'
  if (h24 < 12)   return `${h24} am`
  if (h24 === 12) return '12 pm'
  return `${h24 - 12} pm`
}

// ── not-enough-data state ─────────────────────────────────────────────────────

function NotEnoughHourlyData({
  message, nDays, minDays,
}: {
  message?: string
  nDays: number
  minDays: number
}) {
  return (
    <div className="bg-white rounded-2xl border border-teal-100 p-10 text-center shadow-sm">
      <div className="w-14 h-14 mb-4 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
        <svg className="w-7 h-7 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-600 mb-2">Not enough tap data yet</p>
      <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
        {message ?? `Use "Record a Sale" each time you serve a customer. Hourly patterns and staffing advice appear after ${minDays} days of data.`}
      </p>
      {nDays > 0 && (
        <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-teal-50 rounded-full">
          <div className="flex gap-0.5">
            {Array.from({ length: minDays }, (_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full ${i < nDays ? 'bg-teal-500' : 'bg-teal-100'}`}
              />
            ))}
          </div>
          <span className="text-xs text-teal-600 font-medium">
            {nDays} of {minDays} days collected
          </span>
        </div>
      )}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

const MIN_DAYS = 7

export default function HourlyDashboard() {
  const [data, setData] = useState<HourlyAnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    analytics.hourlyAnalytics()
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-teal-400">
        <span className="text-sm animate-pulse">Loading hourly data…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
        Couldn't load hourly data — is the backend running?
        <span className="block mt-1 text-xs text-red-400">{error}</span>
      </div>
    )
  }

  if (!data || data.status !== 'ok' || data.hours.length === 0) {
    return (
      <NotEnoughHourlyData
        message={data?.message}
        nDays={data?.n_days_data ?? 0}
        minDays={MIN_DAYS}
      />
    )
  }

  const busiestHour = [...data.hours].sort((a, b) => b.avg_taps - a.avg_taps)[0]

  const chartData = data.hours.map(h => ({
    name: fmtHour(h.hour),
    avg: h.avg_taps,
  }))

  return (
    <div className="space-y-6">

      {/* ── Summary strip ── */}
      <div className="bg-white rounded-2xl border border-teal-100 px-6 py-5 shadow-sm">
        <p className="text-xs text-slate-400 mb-1">
          Based on {data.n_days_data} days of tap data
          · {data.avg_service_time_minutes} min per customer
          · change in <strong>Settings</strong>
        </p>
        <p className="text-base text-slate-700 leading-snug">
          Your busiest hour is typically{' '}
          <strong className="text-teal-700">
            {fmtHour(busiestHour.hour)}–{fmtHour(busiestHour.hour + 1)}
          </strong>{' '}
          with about{' '}
          <strong className="text-teal-700">
            {busiestHour.avg_taps.toFixed(1)}
          </strong>{' '}
          customers on average.
        </p>
      </div>

      {/* ── Hourly traffic chart ── */}
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">
          Average customers per hour
        </h2>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          Each bar is the average number of customer taps in that hour, across all your recorded days.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0fdfa" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              width={36}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              labelStyle={{ color: '#334155', fontWeight: 600 }}
              formatter={(v) => [
                typeof v === 'number' ? v.toFixed(1) : v,
                'avg customers',
              ]}
            />
            <Bar dataKey="avg" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* ── Staffing recommendations ── */}
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">
          Staffing recommendations
        </h2>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          Based on your traffic and how long it takes to serve one customer.
          Keeps everyone below 85% busy so queues stay short.
        </p>
        <div className="space-y-2">
          {data.hours.map(h => {
            const isBusiest = h.hour === busiestHour.hour
            return (
              <div
                key={h.hour}
                className={`flex items-center justify-between px-4 py-3 rounded-xl transition-colors
                  ${isBusiest
                    ? 'bg-teal-50 border border-teal-100'
                    : 'bg-slate-50 hover:bg-teal-50/40'}`}
              >
                <div className="flex items-center gap-3">
                  {isBusiest && (
                    <span className="text-xs bg-teal-100 text-teal-700 font-medium px-2 py-0.5 rounded-full shrink-0">
                      Busiest
                    </span>
                  )}
                  <div>
                    <span className="text-sm font-medium text-slate-700">
                      {fmtHour(h.hour)}–{fmtHour(h.hour + 1)}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">
                      ~{h.avg_taps.toFixed(1)} customers/hr
                    </span>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${isBusiest ? 'text-teal-700' : 'text-slate-700'}`}>
                  {h.recommended_staff} {h.recommended_staff === 1 ? 'person' : 'people'}
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-xs text-slate-400 leading-relaxed">
          To adjust these numbers, change the "minutes per customer" setting in{' '}
          <strong>Settings</strong>. A quick-service counter might be 2–3 min;
          a sit-down appointment might be 20–30 min.
        </p>
      </section>

    </div>
  )
}
