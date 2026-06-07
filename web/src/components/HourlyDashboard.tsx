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
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import type { WeekdayHourlyEntry, WeekdayHourlyResponse, WeekdayHourlySlot } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtHour(h: number, lang?: string): string {
  const h24 = ((h % 24) + 24) % 24
  // Hebrew uses 24h format; English uses 12h with am/pm
  if (lang === 'he') return `${h24}:00`
  if (h24 === 0)   return '12 am'
  if (h24 < 12)   return `${h24} am`
  if (h24 === 12) return '12 pm'
  return `${h24 - 12} pm`
}

const WEEKDAY_FULL_TRANSLATIONS: Record<string, Record<string, string>> = {
  he: {
    Monday: 'שני', Tuesday: 'שלישי', Wednesday: 'רביעי', Thursday: 'חמישי',
    Friday: 'שישי', Saturday: 'שבת', Sunday: 'ראשון',
  },
}

function translateWeekdayFull(weekday: string, lang: string): string {
  return WEEKDAY_FULL_TRANSLATIONS[lang]?.[weekday] ?? weekday
}

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

const MIN_DAYS = 7

// ── not-enough-data state ─────────────────────────────────────────────────────

function NotEnoughHourlyData({ message, nDays }: { message?: string; nDays: number }) {
  const { t } = useLanguage()
  return (
    <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
      <div className="w-14 h-14 mb-4 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
        <svg className="w-7 h-7 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">{t('notEnoughTapData')}</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
        {message ?? t('useRecordSaleHourly', { n: String(MIN_DAYS) })}
      </p>
      {nDays > 0 && (
        <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-teal-50 dark:bg-teal-900/20 rounded-full">
          <div className="flex gap-0.5">
            {Array.from({ length: MIN_DAYS }, (_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full ${i < nDays ? 'bg-teal-500' : 'bg-teal-100 dark:bg-teal-800'}`} />
            ))}
          </div>
          <span className="text-xs text-teal-600 dark:text-teal-400 font-medium">
            {t('daysCollected', { n: String(nDays), min: String(MIN_DAYS) })}
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
  const { t, lang } = useLanguage()
  const { isDark } = useTheme()
  const busiest = [...slots].sort((a, b) => b.avg_taps - a.avg_taps)[0]
  const chartData = slots.map(h => ({
    name: fmtHour(h.hour, lang),
    avg: h.avg_taps,
    staff: h.recommended_staff,
  }))

  const staffWord = busiest.recommended_staff === 1 ? t('personLabel') : t('peopleLabel')
  const timeRange = `${fmtHour(busiest.hour, lang)}–${fmtHour(busiest.hour + 1, lang)}`

  return (
    <div className="space-y-4">
      {/* Headline callout */}
      <div className="bg-teal-600 rounded-2xl px-6 py-5 text-white shadow-sm">
        <p className="text-xs font-medium text-teal-200 uppercase tracking-wide mb-2">
          {isFallback ? t('tomorrowTypical') : t('tomorrowDay', { dayName })}
        </p>
        <p className="text-2xl font-bold leading-tight">
          {t('busiestAtTime', { timeRange })}{': '}
          <span className="text-teal-200">
            {busiest.recommended_staff} {staffWord}
          </span>
        </p>
        <p className="text-sm text-teal-200 mt-1">
          {t('peakCustomersHr', { n: String(Math.round(busiest.avg_taps)) })}
        </p>
        {isFallback && (
          <p className="text-xs text-teal-300 mt-2">
            {t('notEnoughForWeekday', { dayName })}
          </p>
        )}
      </div>

      {/* Hourly chart */}
      <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
          {t('busyHoursTomorrow')}
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
          {t('avgCustomersHourOn', { dayType: isFallback ? t('tomorrowTypical').toLowerCase() : dayName })}
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e2e8f0'} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }} width={36} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                fontSize: 12, borderRadius: 8,
                border: `1px solid ${isDark ? '#334155' : '#ccece9'}`,
                background: isDark ? '#1e293b' : '#fff',
                color: isDark ? '#e2e8f0' : '#334155',
              }}
              labelStyle={{ color: isDark ? '#e2e8f0' : '#334155', fontWeight: 600 }}
              formatter={(v, name) => [
                name === 'avg' ? Math.round(v as number) : v,
                name === 'staff' ? t('staffNeededTooltip') : t('avgCustomersTooltip'),
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
              ? t('noQueue')
              : t('minWait', { n: h.expected_wait_minutes.toFixed(0) })
            const hStaffWord = h.recommended_staff === 1 ? t('personLabel') : t('peopleLabel')
            return (
              <div
                key={h.hour}
                className={`flex flex-col gap-1 px-4 py-2.5 rounded-xl
                  ${isBusiest ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700' : 'bg-slate-50/60 dark:bg-slate-700/40'}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    {isBusiest && (
                      <span className="shrink-0 text-xs bg-teal-100 dark:bg-teal-800 text-teal-700 dark:text-teal-300 font-semibold px-2 py-0.5 rounded-full">
                        {t('busiestLabel')}
                      </span>
                    )}
                    <div>
                      <p className={`text-sm font-medium leading-tight ${isBusiest ? 'text-teal-800 dark:text-teal-200' : 'text-slate-700 dark:text-slate-200'}`}>
                        {h.label}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        ~{Math.round(h.avg_taps)} {t('avgCustomersTooltip')}/hr ·{' '}
                        <span className={h.expected_wait_minutes < 0.5 ? 'text-teal-500' : 'text-amber-500'}>
                          {waitLabel}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`text-2xl font-bold tabular-nums ${isBusiest ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>
                      {h.recommended_staff}
                    </span>
                    <span className="block text-xs text-slate-400 dark:text-slate-500">
                      {hStaffWord}
                    </span>
                  </div>
                </div>
                {h.marginal_note && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic pt-0.5 border-t border-slate-100 dark:border-slate-600 mt-0.5">
                    <span className="font-medium not-italic">{t('marginalNoteLabel')}</span>{' '}
                    {h.marginal_note}
                  </p>
                )}
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
  const { t, lang } = useLanguage()
  const [open, setOpen] = useState<number | null>(null)
  const tomorrowIdx = tomorrowPyWeekday()

  if (weekdays.length === 0) return null

  return (
    <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-teal-100/60 dark:border-slate-700">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('peakHoursByDay')}</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t('busiestHourEachDay')}</p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {weekdays.map(wd => {
          const isOpen = open === wd.weekday_idx
          const isTomorrow = wd.weekday_idx === tomorrowIdx
          const busiest = wd.hours.reduce(
            (best, h) => (h.avg_taps > best.avg_taps ? h : best),
            wd.hours[0],
          )
          const bStaffWord = busiest.recommended_staff === 1 ? t('personLabel') : t('peopleLabel')

          return (
            <div key={wd.weekday_idx}>
              <button
                className="w-full flex items-center justify-between gap-4 px-6 py-3.5
                           hover:bg-teal-50/40 dark:hover:bg-teal-900/10 transition-colors text-left"
                onClick={() => setOpen(isOpen ? null : wd.weekday_idx)}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{translateWeekdayFull(wd.weekday, lang)}</span>
                  {isTomorrow && (
                    <span className="text-xs bg-teal-100 dark:bg-teal-800 text-teal-700 dark:text-teal-300 font-semibold px-2 py-0.5 rounded-full">
                      {t('tomorrowBadge')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {fmtHour(busiest.hour, lang)} · {busiest.recommended_staff} {bStaffWord}
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
                    const hStaffWord = h.recommended_staff === 1 ? t('personLabel') : t('peopleLabel')
                    return (
                      <div
                        key={h.hour}
                        className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg
                          ${isBest ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-700' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={`text-xs font-medium ${isBest ? 'text-teal-700 dark:text-teal-300' : 'text-slate-600 dark:text-slate-300'}`}>
                            {h.label}
                          </span>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            ~{Math.round(h.avg_taps)}/hr · {h.recommended_staff} {hStaffWord}
                          </span>
                        </div>
                        {h.marginal_note && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                            {h.marginal_note}
                          </p>
                        )}
                      </div>
                    )
                  })}
                  <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">
                    {t('basedOnNDays', {
                      n: String(wd.n_days_data),
                      weekday: translateWeekdayFull(wd.weekday, lang),
                      s: wd.n_days_data !== 1 ? 's' : '',
                    })}
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
  const { t } = useLanguage()
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
        <span className="text-sm animate-pulse">{t('loadingHourlyData')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-300">
        {t('couldntLoadHourly')}
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
        message={t('notEnoughTapData')}
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
