import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { analytics } from '../api/client'
import type { WeekdayHourlyEntry, WeekdayHourlyResponse, WeekdayHourlySlot } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtHour(h: number): string {
  const h24 = ((h % 24) + 24) % 24
  if (h24 === 0)   return '12 am'
  if (h24 < 12)   return `${h24} am`
  if (h24 === 12) return '12 pm'
  return `${h24 - 12} pm`
}

// JS getDay(): 0=Sun … 6=Sat → Python weekday_idx: 0=Mon … 6=Sun
function jsDayToPython(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1
}

function tomorrowPyWeekday(): number {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return jsDayToPython(d.getDay())
}

function tomorrowName(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-GB', { weekday: 'long' })
}

// ── not-enough-data state ─────────────────────────────────────────────────────

function NotEnoughHourlyData({ message, nDays }: { message?: string; nDays: number }) {
  const MIN_DAYS = 7
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
        {message ?? `Use "Record a Sale" each time you serve a customer. Hourly patterns appear after ${MIN_DAYS} days of data.`}
      </p>
      {nDays > 0 && (
        <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-teal-50 rounded-full">
          <div className="flex gap-0.5">
            {Array.from({ length: MIN_DAYS }, (_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full ${i < nDays ? 'bg-teal-500' : 'bg-teal-100'}`} />
            ))}
          </div>
          <span className="text-xs text-teal-600 font-medium">
            {nDays} of {MIN_DAYS} days collected
          </span>
        </div>
      )}
    </div>
  )
}

// ── tomorrow busy-hours panel ─────────────────────────────────────────────────

function TomorrowPanel({
  slots, dayName, isFallback,
}: {
  slots: WeekdayHourlySlot[]
  dayName: string
  isFallback: boolean
}) {
  const busiest = [...slots].sort((a, b) => b.avg_taps - a.avg_taps)[0]
  const chartData = slots.map(h => ({
    name: fmtHour(h.hour),
    avg: h.avg_taps,
    staff: h.recommended_staff,
  }))

  return (
    <div className="space-y-4">
      {/* Headline callout */}
      <div className="bg-teal-600 rounded-2xl px-6 py-5 text-white shadow-sm">
        <p className="text-xs font-medium text-teal-200 uppercase tracking-wide mb-2">
          {isFallback ? 'Tomorrow (typical day)' : `Tomorrow — ${dayName}`}
        </p>
        <p className="text-2xl font-bold leading-tight">
          Busiest at {fmtHour(busiest.hour)}–{fmtHour(busiest.hour + 1)}
          {': '}
          <span className="text-teal-200">
            {busiest.recommended_staff} {busiest.recommended_staff === 1 ? 'person' : 'people'}
          </span>
        </p>
        <p className="text-sm text-teal-200 mt-1">
          ~{busiest.avg_taps.toFixed(1)} customers/hr at peak
        </p>
        {isFallback && (
          <p className="text-xs text-teal-300 mt-2">
            Not enough data for {dayName} yet — showing the all-days average instead.
          </p>
        )}
      </div>

      {/* Hourly chart */}
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">
          Busy hours tomorrow
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Average customers per hour on a {isFallback ? 'typical' : dayName}.
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f2f8f7" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} width={36} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #ccece9' }}
              labelStyle={{ color: '#334155', fontWeight: 600 }}
              formatter={(v, name) => [
                typeof v === 'number' ? v.toFixed(1) : v,
                name === 'staff' ? 'staff needed' : 'avg customers',
              ]}
            />
            <Bar dataKey="avg" fill="#4e8b87" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>

        {/* Staffing rows */}
        <div className="mt-4 space-y-2">
          {slots.map(h => {
            const isBusiest = h.hour === busiest.hour
            const waitLabel = h.expected_wait_minutes < 0.5
              ? 'No queue'
              : `~${h.expected_wait_minutes.toFixed(0)} min wait`
            return (
              <div
                key={h.hour}
                className={`flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl
                  ${isBusiest ? 'bg-teal-50 border border-teal-200' : 'bg-slate-50/60'}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isBusiest && (
                    <span className="shrink-0 text-xs bg-teal-100 text-teal-700 font-semibold px-2 py-0.5 rounded-full">
                      Busiest
                    </span>
                  )}
                  <div>
                    <p className={`text-sm font-medium leading-tight ${isBusiest ? 'text-teal-800' : 'text-slate-700'}`}>
                      {h.label}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ~{h.avg_taps.toFixed(1)} customers/hr ·{' '}
                      <span className={h.expected_wait_minutes < 0.5 ? 'text-teal-500' : 'text-amber-500'}>
                        {waitLabel}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`text-2xl font-bold tabular-nums ${isBusiest ? 'text-teal-600' : 'text-slate-500'}`}>
                    {h.recommended_staff}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {h.recommended_staff === 1 ? 'person' : 'people'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ── peak hours by weekday accordion ──────────────────────────────────────────

function WeekdayAccordion({ weekdays }: { weekdays: WeekdayHourlyEntry[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const tomorrowIdx = tomorrowPyWeekday()

  if (weekdays.length === 0) return null

  return (
    <section className="bg-white rounded-2xl border border-teal-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-teal-100/60">
        <h2 className="text-base font-semibold text-slate-800">Peak hours by day</h2>
        <p className="text-xs text-slate-400 mt-0.5">Your busiest hour for each day of the week.</p>
      </div>
      <div className="divide-y divide-slate-100">
        {weekdays.map(wd => {
          const isOpen = open === wd.weekday_idx
          const isTomorrow = wd.weekday_idx === tomorrowIdx
          const busiest = wd.hours.reduce(
            (best, h) => (h.avg_taps > best.avg_taps ? h : best),
            wd.hours[0],
          )

          return (
            <div key={wd.weekday_idx}>
              <button
                className="w-full flex items-center justify-between gap-4 px-6 py-3.5
                           hover:bg-teal-50/40 transition-colors text-left"
                onClick={() => setOpen(isOpen ? null : wd.weekday_idx)}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium text-slate-700">{wd.weekday}</span>
                  {isTomorrow && (
                    <span className="text-xs bg-teal-100 text-teal-700 font-semibold px-2 py-0.5 rounded-full">
                      tomorrow
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-500">
                    Peak {fmtHour(busiest.hour)} · {busiest.recommended_staff}{' '}
                    {busiest.recommended_staff === 1 ? 'person' : 'people'}
                  </span>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isOpen && (
                <div className="px-6 pb-4 space-y-1.5">
                  {wd.hours.map(h => {
                    const isBest = h.hour === busiest.hour
                    return (
                      <div
                        key={h.hour}
                        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg
                          ${isBest ? 'bg-teal-50 border border-teal-100' : ''}`}
                      >
                        <span className={`text-xs font-medium ${isBest ? 'text-teal-700' : 'text-slate-600'}`}>
                          {h.label}
                        </span>
                        <span className="text-xs text-slate-400">
                          ~{h.avg_taps.toFixed(1)}/hr · {h.recommended_staff}{' '}
                          {h.recommended_staff === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                    )
                  })}
                  <p className="text-xs text-slate-400 pt-1">
                    Based on {wd.n_days_data} {wd.weekday} recording{wd.n_days_data !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function HourlyDashboard() {
  const [data, setData]     = useState<WeekdayHourlyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    analytics.hourlyByWeekday()
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

  if (!data || data.status !== 'ok') {
    return (
      <NotEnoughHourlyData
        message={data?.message}
        nDays={data?.n_days_total ?? 0}
      />
    )
  }

  const pyWd = tomorrowPyWeekday()
  const dayName = tomorrowName()
  const tomorrowEntry = data.weekdays.find(w => w.weekday_idx === pyWd) ?? null
  const isFallback = tomorrowEntry === null || tomorrowEntry.hours.length === 0
  const slots: WeekdayHourlySlot[] = isFallback
    ? data.overall_fallback
    : tomorrowEntry.hours

  if (slots.length === 0) {
    return (
      <NotEnoughHourlyData
        message="Not enough tap data yet to show hourly patterns."
        nDays={data.n_days_total ?? 0}
      />
    )
  }

  return (
    <div className="space-y-6">
      <TomorrowPanel slots={slots} dayName={dayName} isFallback={isFallback} />
      <WeekdayAccordion weekdays={data.weekdays} />
    </div>
  )
}
