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
    staff: h.recommended_staff,
  }))

  return (
    <div className="space-y-6">

      {/* ── Busiest-hour staffing callout ── */}
      <div className="bg-teal-600 rounded-2xl px-6 py-5 text-white shadow-sm">
        <p className="text-xs font-medium text-teal-200 uppercase tracking-wide mb-2">
          At your busiest
        </p>
        <p className="text-2xl font-bold leading-tight">
          {fmtHour(busiestHour.hour)}–{fmtHour(busiestHour.hour + 1)}
          {': schedule '}
          <span className="text-teal-200">
            {busiestHour.recommended_staff}{' '}
            {busiestHour.recommended_staff === 1 ? 'person' : 'people'}
          </span>
        </p>
        <p className="text-sm text-teal-200 mt-1">
          ~{busiestHour.avg_taps.toFixed(1)} customers arriving · {data.avg_service_time_minutes} min avg to serve each one
        </p>
        <p className="text-xs text-teal-300 mt-3">
          Based on {data.n_days_data} days of data · adjust "minutes per customer" in{' '}
          <strong className="text-teal-100">Settings</strong>
        </p>
      </div>

      {/* ── Staffing by hour ── */}
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">
          Staffing schedule
        </h2>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          How many people you need each hour to keep queues short.
          Keeps everyone below 85% capacity so service stays smooth.
        </p>
        <div className="space-y-3">
          {data.hours.map(h => {
            const isBusiest = h.hour === busiestHour.hour
            const waitLabel = h.expected_wait_minutes < 0.5
              ? 'No queue'
              : `~${h.expected_wait_minutes.toFixed(0)} min wait`
            const queueLabel = h.queue_length < 0.5
              ? ''
              : ` · ~${h.queue_length.toFixed(1)} in line`
            return (
              <div
                key={h.hour}
                className={`rounded-xl overflow-hidden
                  ${isBusiest ? 'border border-teal-200' : 'border border-slate-100'}`}
              >
                {/* Top row: recommendation + staff count */}
                <div
                  className={`flex items-center justify-between gap-4 px-4 py-3
                    ${isBusiest ? 'bg-teal-50' : 'bg-slate-50'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isBusiest && (
                      <span className="shrink-0 text-xs bg-teal-100 text-teal-700 font-semibold
                                       px-2 py-0.5 rounded-full">
                        Busiest
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold leading-tight
                        ${isBusiest ? 'text-teal-800' : 'text-slate-700'}`}>
                        {h.label}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        ~{h.avg_taps.toFixed(1)} customers/hr
                        {' · '}
                        <span className={h.expected_wait_minutes < 0.5 ? 'text-teal-500' : 'text-amber-500'}>
                          {waitLabel}{queueLabel}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`text-3xl font-bold tabular-nums
                      ${isBusiest ? 'text-teal-600' : 'text-slate-500'}`}>
                      {h.recommended_staff}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {h.recommended_staff === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                </div>

                {/* Bottom row: marginal note */}
                <div className={`px-4 py-2 border-t
                  ${isBusiest ? 'border-teal-100 bg-teal-50/40' : 'border-slate-100 bg-white'}`}>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {h.marginal_note}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-xs text-slate-400 leading-relaxed">
          To adjust, set "minutes per customer" in{' '}
          <strong>Settings</strong>. Quick counter service: 2–3 min.
          Sit-down appointments: 20–60 min.
        </p>
      </section>

      {/* ── Hourly traffic chart ── */}
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">
          Average customers per hour
        </h2>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          Each bar is the average number of customers in that hour, across all your recorded days.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f2f8f7" vertical={false} />
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
              formatter={(v, name) => [
                typeof v === 'number' ? v.toFixed(1) : v,
                name === 'staff' ? 'staff needed' : 'avg customers',
              ]}
            />
            <Bar dataKey="avg" fill="#4e8b87" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </section>

    </div>
  )
}
