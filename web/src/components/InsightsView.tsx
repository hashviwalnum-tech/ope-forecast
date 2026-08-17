import { useEffect, useState } from 'react'
import { analytics } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type {
  InsightsResponse,
  InsightsWeekdayTrend,
  InsightsSeasonalAlert,
  InsightsDecliningRegular,
} from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center bg-teal-50 dark:bg-teal-900/20 rounded-xl px-5 py-4 min-w-[96px]">
      <span className="text-2xl font-bold text-teal-700 dark:text-teal-300 tabular-nums">{value}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 text-center">{label}</span>
    </div>
  )
}

function InsightCard({ title, children, accent }: {
  title: string
  children: React.ReactNode
  accent?: 'default' | 'warning'
}) {
  const border = accent === 'warning'
    ? 'border-amber-200 dark:border-amber-700/60'
    : 'border-teal-100 dark:border-slate-700'
  const bg = accent === 'warning'
    ? 'bg-amber-50/60 dark:bg-amber-900/10'
    : 'bg-white dark:bg-slate-800'
  const titleColor = accent === 'warning'
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-teal-700 dark:text-teal-400'
  return (
    <div className={`${bg} rounded-2xl border ${border} shadow-sm p-6 space-y-4`}>
      <h2 className={`text-sm font-semibold ${titleColor} uppercase tracking-wide`}>{title}</h2>
      {children}
    </div>
  )
}

function DimNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed italic">{children}</p>
  )
}

function TrendRow({ trend }: { trend: InsightsWeekdayTrend }) {
  const { t } = useLanguage()
  const growing = trend.direction === 'growing'
  const pct = Math.abs(trend.pct_change).toFixed(0)
  return (
    <div className="flex items-start gap-4">
      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${growing ? 'bg-emerald-500' : 'bg-rose-400'}`} />
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          {growing
            ? t('insightsTrendGrowing', { weekday: trend.weekday, pct })
            : t('insightsTrendDeclining', { weekday: trend.weekday, pct })}
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('insightsTrendDetail', {
            recent: String(Math.round(trend.recent_avg)),
            prior:  String(Math.round(trend.prior_avg)),
          })}
        </p>
      </div>
    </div>
  )
}

function SeasonalRow({ alert }: { alert: InsightsSeasonalAlert }) {
  const { t } = useLanguage()
  const busier = alert.direction === 'busier'
  const key = busier ? 'insightsSeasonalBusier' : 'insightsSeasonalQuieter'
  const weeksNote = alert.weeks_away <= 2
    ? t('insightsSeasonalNextMonth')
    : t('insightsSeasonalWeeksAway', { n: String(alert.weeks_away) })
  return (
    <div className="flex items-start gap-4">
      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${busier ? 'bg-orange-400' : 'bg-slate-400'}`} />
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-100 leading-snug">
          {t(key, {
            month:   alert.month_name,
            last_yr: String(Math.round(alert.last_year_avg)),
            pct:     alert.pct_difference.toFixed(0),
            pace:    String(Math.round(alert.current_pace)),
            expected: String(Math.round(alert.expected_pace ?? alert.current_pace)),
          })}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{weeksNote}</p>
      </div>
    </div>
  )
}

function DecliningRow({ reg }: { reg: InsightsDecliningRegular }) {
  const { t } = useLanguage()
  return (
    <div className="flex items-start gap-4">
      <div className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
      <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
        {t('insightsDecliningRegular', {
          name: reg.name,
          days: String(reg.days_since_visit),
          gap:  String(Math.round(reg.usual_gap_days)),
        })}
      </p>
    </div>
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
        <p className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-2">{t('tabInsights')}</p>
        <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
          {data?.message ?? t('insightsKeepLogging')}
        </p>
      </div>
    )
  }

  const hasAccuracy = data.forecast_accuracy_mape != null
  const hasTrends   = (data.weekday_trends ?? []).length > 0
  const hasSeasonal = (data.seasonal_alerts ?? []).length > 0
  const hasWarnings = (data.declining_regulars ?? []).length > 0

  // Quick-context chips: busiest day + peak hour if available (demoted from cards)
  const contextChips: string[] = []
  if (data.busiest_day) {
    contextChips.push(`${data.busiest_day.weekday} busiest (~${Math.round(data.busiest_day.avg_customers)})`)
  }
  if (data.peak_hour) {
    contextChips.push(`Peak: ${data.peak_hour.label}`)
  }

  return (
    <div className="space-y-6">

      <p className="text-sm text-slate-500 dark:text-slate-400">{t('insightsSubtitle')}</p>

      {/* ── Data volume stats ──────────────────────────────────────── */}
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

      {/* ── Forecast accuracy ─────────────────────────────────────── */}
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
                    : t('insightsAccuracyStable', { recent: String(data.accuracy_recent_mape.toFixed(1)) })}
                </p>
              </div>
            )}
          </div>
        ) : (
          <DimNote>{t('insightsNoAccuracy')}</DimNote>
        )}
      </InsightCard>

      {/* ── Weekday trends ────────────────────────────────────────── */}
      {hasTrends && (
        <InsightCard title={t('insightsSectionTrends')}>
          <div className="space-y-4">
            {(data.weekday_trends ?? []).map(trend => (
              <TrendRow key={trend.weekday} trend={trend} />
            ))}
          </div>
        </InsightCard>
      )}

      {/* ── Seasonal / coming-up alerts ───────────────────────────── */}
      {hasSeasonal && (
        <InsightCard title={t('insightsSectionSeasonal')}>
          <div className="space-y-4">
            {(data.seasonal_alerts ?? []).map(alert => (
              <SeasonalRow key={alert.month_name} alert={alert} />
            ))}
          </div>
        </InsightCard>
      )}

      {/* ── Warnings (most prominent — last card, amber accent) ───── */}
      <InsightCard title={t('insightsSectionWarnings')} accent="warning">
        {hasWarnings ? (
          <div className="space-y-3">
            {(data.declining_regulars ?? []).map(reg => (
              <DecliningRow key={reg.name} reg={reg} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('insightsAllRegularsActive')}
          </p>
        )}
      </InsightCard>

      {/* ── Demoted context: quick-stats line ─────────────────────── */}
      {contextChips.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
          {contextChips.join(' · ')}
        </p>
      )}

    </div>
  )
}
