import { useEffect, useState } from 'react'
import { analytics } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { InsightsResponse } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center bg-teal-50 dark:bg-teal-900/20 rounded-xl px-5 py-4 min-w-[96px]">
      <span className="text-2xl font-bold text-teal-700 dark:text-teal-300 tabular-nums">{value}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 text-center">{label}</span>
    </div>
  )
}

function InsightCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700
                    shadow-sm p-6 space-y-4">
      <h2 className="text-sm font-semibold text-teal-700 dark:text-teal-400 uppercase tracking-wide">
        {title}
      </h2>
      {children}
    </div>
  )
}

function DimNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed italic">{children}</p>
  )
}

// ── component ─────────────────────────────────────────────────────────────────

export default function InsightsView() {
  const { t } = useLanguage()
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    analytics.insights()
      .then(res => { setData(res); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-slate-400 dark:text-slate-500 text-sm">{t('insightsLoading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-800 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{t('insightsLoadError')}</p>
      </div>
    )
  }

  if (!data || data.status === 'not_enough_data') {
    return (
      <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
        <div className="w-16 h-16 mb-5 rounded-full bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-teal-300 dark:text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <p className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-2">
          {t('tabInsights')}
        </p>
        <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
          {data?.message ?? t('insightsKeepLogging')}
        </p>
      </div>
    )
  }

  const hasDayPatterns = !!(data.busiest_day && data.slowest_day)
  const hasHourlyPatterns = !!(data.peak_hour)
  const hasYoY = data.yoy_growth_pct !== undefined && data.yoy_growth_pct !== null
  const hasAccuracy = data.forecast_accuracy_mape !== undefined && data.forecast_accuracy_mape !== null

  return (
    <div className="space-y-6">

      {/* Subtitle */}
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('insightsSubtitle')}</p>

      {/* ── Data volume ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        {data.n_days_logged != null && (
          <StatChip label={t('insightsDaysLogged')} value={String(data.n_days_logged)} />
        )}
        {data.n_months_logged != null && (
          <StatChip label={t('insightsMonthsData')} value={String(data.n_months_logged)} />
        )}
        {data.first_date && data.last_date && (
          <div className="flex items-center text-xs text-slate-400 dark:text-slate-500 self-center px-2">
            {t('insightsDateRange', { first: data.first_date, last: data.last_date })}
          </div>
        )}
      </div>

      {/* ── Day-of-week patterns ─────────────────────────────────────── */}
      <InsightCard title={t('insightsSectionDays')}>
        {hasDayPatterns ? (
          <div className="space-y-4">
            {/* Busiest */}
            <div className="flex items-start gap-4">
              <div className="w-2.5 h-2.5 rounded-full bg-teal-500 mt-1.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  {t('insightsBusiestDay')}:{' '}
                  <span className="text-teal-700 dark:text-teal-300">{data.busiest_day!.weekday}</span>
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('insightsAvgCustomersDay', { n: String(Math.round(data.busiest_day!.avg_customers)) })}
                </p>
                {data.busiest_day!.pct_vs_mean > 0 && (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {t('insightsPctAbove', { pct: String(Math.abs(data.busiest_day!.pct_vs_mean).toFixed(0)) })}
                  </p>
                )}
              </div>
            </div>

            {/* Slowest */}
            <div className="flex items-start gap-4">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-1.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  {t('insightsSlowestDay')}:{' '}
                  <span className="text-slate-600 dark:text-slate-300">{data.slowest_day!.weekday}</span>
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('insightsAvgCustomersDay', { n: String(Math.round(data.slowest_day!.avg_customers)) })}
                </p>
                {data.slowest_day!.pct_vs_mean < 0 && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {t('insightsPctBelow', { pct: String(Math.abs(data.slowest_day!.pct_vs_mean).toFixed(0)) })}
                  </p>
                )}
              </div>
            </div>

            {/* Comparison headline */}
            {data.pct_diff_busiest_slowest != null && (
              <div className="bg-teal-50 dark:bg-teal-900/20 rounded-xl px-4 py-3">
                <p className="text-sm font-medium text-teal-800 dark:text-teal-200">
                  {t('insightsBusiestVsSlowest', {
                    busiest: data.busiest_day!.weekday,
                    pct: String(Math.round(data.pct_diff_busiest_slowest)),
                    slowest: data.slowest_day!.weekday,
                  })}
                </p>
              </div>
            )}
          </div>
        ) : (
          <DimNote>{t('insightsNotEnoughDays')}</DimNote>
        )}
      </InsightCard>

      {/* ── Hourly patterns ──────────────────────────────────────────── */}
      <InsightCard title={t('insightsSectionHours')}>
        {hasHourlyPatterns ? (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-2.5 h-2.5 rounded-full bg-orange-400 mt-1.5 shrink-0" />
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  {t('insightsPeakHour')}:{' '}
                  <span className="text-orange-600 dark:text-orange-400">{data.peak_hour!.label}</span>
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('insightsAvgCustomersHour', { n: String(Math.round(data.peak_hour!.avg_taps)) })}
                </p>
              </div>
            </div>
            {data.quietest_hour && (
              <div className="flex items-start gap-4">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-1.5 shrink-0" />
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    {t('insightsQuietestHour')}:{' '}
                    <span className="text-slate-600 dark:text-slate-300">{data.quietest_hour.label}</span>
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {t('insightsAvgCustomersHour', { n: String(Math.round(data.quietest_hour.avg_taps)) })}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <DimNote>{t('insightsNoHourlyData')}</DimNote>
        )}
      </InsightCard>

      {/* ── Year-over-year ────────────────────────────────────────────── */}
      <InsightCard title={t('insightsSectionYoY')}>
        {hasYoY ? (
          <div className="space-y-2">
            <p className={`text-lg font-bold ${data.yoy_growth_pct! >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-500 dark:text-rose-400'}`}>
              {data.yoy_growth_pct! >= 0
                ? t('insightsYoYGrowth', { pct: String(Math.abs(data.yoy_growth_pct!).toFixed(1)) })
                : t('insightsYoYDecline', { pct: String(Math.abs(data.yoy_growth_pct!).toFixed(1)) })}
            </p>
            {data.yoy_curr_period_label && data.yoy_prev_period_label && (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {t('insightsYoYCompare', {
                  curr: data.yoy_curr_period_label,
                  prev: data.yoy_prev_period_label,
                })}
              </p>
            )}
          </div>
        ) : (
          <DimNote>{t('insightsNoYoY')}</DimNote>
        )}
      </InsightCard>

      {/* ── Forecast accuracy ─────────────────────────────────────────── */}
      <InsightCard title={t('insightsSectionAccuracy')}>
        {hasAccuracy ? (
          <div className="space-y-3">
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {t('insightsAccuracyWithin', { pct: String(data.forecast_accuracy_mape!.toFixed(1)) })}
            </p>

            {data.accuracy_early_mape != null && data.accuracy_recent_mape != null && (
              <div className="bg-teal-50 dark:bg-teal-900/20 rounded-xl px-4 py-3">
                <p className={`text-sm font-medium ${data.accuracy_improved
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-600 dark:text-slate-300'}`}>
                  {data.accuracy_improved
                    ? t('insightsAccuracyImproving', {
                        early: String(data.accuracy_early_mape.toFixed(1)),
                        recent: String(data.accuracy_recent_mape.toFixed(1)),
                      })
                    : t('insightsAccuracyStable', {
                        recent: String(data.accuracy_recent_mape.toFixed(1)),
                      })}
                </p>
              </div>
            )}
          </div>
        ) : (
          <DimNote>{t('insightsNoAccuracy')}</DimNote>
        )}
      </InsightCard>

    </div>
  )
}
