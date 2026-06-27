import { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../api/client'
import type {
  AccuracyResponse,
  HourlyAnalyticsResponse,
  InsightsResponse,
  LiftResponse,
  RegularProfitabilityRead,
  RegularRead,
} from '../api/types'
import { useBusiness } from '../contexts/BusinessContext'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../lib/i18n'
import type { Theme } from '../lib/theme'
import AppHeader from '../components/AppHeader'

// ── staffing marginal-note i18n helper ───────────────────────────────────────

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string

function fmtMarginalWait(w: number, t: TFn): string {
  if (w >= 999) return t('marginalWaitLong')
  if (w < 0.5)  return t('marginalWaitLt1')
  return t('marginalWaitMin', { n: Math.round(w) })
}

function fmtOrdinal(n: number, lang: string): string {
  if (lang === 'he') return String(n)
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  const rem = n % 10
  return `${n}${rem === 1 ? 'st' : rem === 2 ? 'nd' : rem === 3 ? 'rd' : 'th'}`
}

function formatMarginalNote(
  slot: { recommended_staff: number; expected_wait_minutes: number; wait_if_add?: number | null; wait_if_remove?: number | null },
  t: TFn,
  lang: string,
): string | null {
  const { recommended_staff: c, expected_wait_minutes: waitC, wait_if_add: wAdd, wait_if_remove: wRemove } = slot
  if (wAdd === undefined || wAdd === null) return null
  const nth = fmtOrdinal(c + 1, lang)
  const parts: string[] = []
  if (waitC < 0.5) {
    parts.push(t('marginalShortQueue', { nth }))
  } else {
    parts.push(t('marginalAddCutsWait', { nth, from: fmtMarginalWait(waitC, t), to: fmtMarginalWait(wAdd, t) }))
  }
  if (c > 1) {
    if (wRemove === null || wRemove === undefined) {
      parts.push(t('marginalRemoveOverload', { servers: c }))
    } else if (wRemove >= waitC * 2 || wRemove > 5) {
      parts.push(t('marginalRemovePushes', { to: fmtMarginalWait(wRemove, t) }))
    } else {
      parts.push(t('marginalRemoveOk', { fewer: c - 1, to: fmtMarginalWait(wRemove, t) }))
    }
  }
  return parts.join(' ') || null
}

function fmt12(hour: number): string {
  if (hour === 0) return '12am'
  if (hour < 12) return `${hour}am`
  if (hour === 12) return '12pm'
  return `${hour - 12}pm`
}

function fmtCurrency(n: number): string {
  return `$${n.toFixed(2)}`
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export default function AnalyticsScreen() {
  const { business, loading: bizLoading, error: bizError } = useBusiness()
  const c = useTheme()
  const { t, lang } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

  const [insights, setInsights] = useState<InsightsResponse | null>(null)
  const [accuracy, setAccuracy] = useState<AccuracyResponse | null>(null)
  const [staffing, setStaffing] = useState<HourlyAnalyticsResponse | null>(null)
  const [lift, setLift] = useState<LiftResponse | null>(null)
  const [regulars, setRegulars] = useState<RegularRead[]>([])
  const [expandedRegularId, setExpandedRegularId] = useState<number | null>(null)
  const [profitabilityMap, setProfitabilityMap] = useState<
    Record<number, RegularProfitabilityRead>
  >({})
  const [loadingProfitId, setLoadingProfitId] = useState<number | null>(null)

  const [initialLoading, setInitialLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!business) return
    try {
      const [insRes, accRes, staffRes, liftRes, regsRes] = await Promise.allSettled([
        api.analytics.insights(),
        api.analytics.accuracy(),
        api.analytics.hourlyAnalytics(),
        api.analytics.lift(),
        api.regulars.list(),
      ])
      if (insRes.status === 'fulfilled') setInsights(insRes.value)
      if (accRes.status === 'fulfilled') setAccuracy(accRes.value)
      if (staffRes.status === 'fulfilled') setStaffing(staffRes.value)
      if (liftRes.status === 'fulfilled') setLift(liftRes.value)
      if (regsRes.status === 'fulfilled') setRegulars(regsRes.value)
      setDataError(null)
    } catch (e: unknown) {
      setDataError(e instanceof Error ? e.message : 'Failed to load analytics.')
    } finally {
      setInitialLoading(false)
    }
  }, [business])

  useFocusEffect(
    useCallback(() => {
      if (business) void loadData()
    }, [loadData, business])
  )

  const toggleRegularProfitability = async (reg: RegularRead) => {
    if (expandedRegularId === reg.id) {
      setExpandedRegularId(null)
      return
    }
    setExpandedRegularId(reg.id)
    if (profitabilityMap[reg.id]) return
    setLoadingProfitId(reg.id)
    try {
      const data = await api.regulars.profitability(reg.id)
      setProfitabilityMap(m => ({ ...m, [reg.id]: data }))
    } catch {
      // show nothing on error
    } finally {
      setLoadingProfitId(null)
    }
  }

  if (bizLoading || initialLoading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
        <AppHeader title={t('analytics')} subtitle={business?.name} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={[styles.loadingText, { color: c.textSub }]}>{t('serverWakeup')}</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (bizError || dataError) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
        <AppHeader title={t('analytics')} subtitle={business?.name} />
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: c.danger }]}>{bizError ?? dataError}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: c.primary }]} onPress={() => void loadData()}>
            <Text style={[styles.retryText, { color: c.onPrimary }]}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const activeHours = (staffing?.hours ?? []).filter(h => h.avg_taps > 0)
  const maxTaps = Math.max(...activeHours.map(h => h.avg_taps), 1)
  const liftPeriods = lift?.periods ?? []

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
      <AppHeader
        title={t('analytics')}
        subtitle={business?.name}
        rightExtra={
          <TouchableOpacity onPress={() => void loadData()} style={styles.reloadBtn}>
            <Ionicons name="refresh-outline" size={20} color={c.onPrimary} />
          </TouchableOpacity>
        }
      />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/* ── What Ope has learned about you ── */}
        <Text style={styles.sectionTitle}>{t('insightsSectionTitle')}</Text>
        <InsightsSection insights={insights} c={c} styles={styles} />

        {/* ── Forecast Accuracy ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>{t('forecastAccuracy')}</Text>

        {accuracy == null || accuracy.status !== 'ok' ? (
          <View style={styles.emptyBox}>
            <Ionicons name="stats-chart-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              {accuracy?.message ?? t('noAccuracyYet')}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {accuracy.bias_warning != null && (
              <View style={styles.warningBanner}>
                <Ionicons name="warning-outline" size={16} color="#a16207" />
                <Text style={styles.warningText}>{accuracy.bias_warning}</Text>
              </View>
            )}
            <View style={styles.metricsGrid}>
              <MetricTile
                label={t('metricMape')}
                value={accuracy.mape != null ? `${accuracy.mape.toFixed(1)}%` : '—'}
                sub={t('avgPctOff')}
                c={c}
              />
              <MetricTile
                label={t('metricMad')}
                value={accuracy.mad != null ? accuracy.mad.toFixed(1) : '—'}
                sub={t('avgCustomersOff')}
                c={c}
              />
              <MetricTile
                label={t('metricTracking')}
                value={accuracy.tracking_signal != null
                  ? accuracy.tracking_signal.toFixed(2)
                  : '—'}
                sub={t('biasSignal')}
                c={c}
              />
              <MetricTile
                label={t('metricDays')}
                value={String(accuracy.n_observations)}
                sub={t('daysOfData')}
                c={c}
              />
            </View>
          </View>
        )}

        {/* ── Staffing ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>{t('staffingSection')}</Text>

        {activeHours.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              {staffing?.message ?? t('noStaffingYet')}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardNote}>
              {t('staffingDataNote', {
                n: String(staffing?.n_days_data ?? 0),
                t: String(staffing?.avg_service_time_minutes ?? '?'),
              })}
            </Text>
            {activeHours.map(h => (
              <View key={h.hour} style={styles.staffRow}>
                <Text style={styles.staffHour}>{fmt12(h.hour)}</Text>
                <View style={styles.staffBarWrap}>
                  <View style={styles.barBg}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.round((h.avg_taps / maxTaps) * 100)}%` as `${number}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.staffMeta}>
                    ~{Math.round(h.avg_taps)} {t('staffingCust')} · {h.recommended_staff} {t('staffingStaff')}
                    {h.expected_wait_minutes > 0 &&
                      h.expected_wait_minutes < 60 &&
                      ` · ${Math.round(h.expected_wait_minutes)}${t('staffingWait')}`}
                  </Text>
                </View>
                {(formatMarginalNote(h, t, lang) ?? h.marginal_note) ? (
                  <Text style={styles.marginalNote}>{formatMarginalNote(h, t, lang) ?? h.marginal_note}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* ── Ad & Event Lift ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>{t('adEventLift')}</Text>

        {liftPeriods.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="megaphone-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              {lift?.message ?? t('noAdEventYet')}
            </Text>
          </View>
        ) : (
          liftPeriods.map(period => {
            const pct = period.pct_lift
            const isPositive = pct >= 0
            return (
              <View key={period.period_id} style={styles.liftCard}>
                <View style={styles.liftHeader}>
                  <View style={styles.liftBadge}>
                    <Text style={styles.liftBadgeText}>
                      {period.type === 'ad' ? t('ad') : t('event')}
                    </Text>
                  </View>
                  <Text style={styles.liftLabel}>{period.label}</Text>
                </View>
                <Text style={styles.liftDates}>
                  {period.start_date} – {period.end_date}
                </Text>
                <View style={styles.liftNumbers}>
                  <View style={styles.liftStat}>
                    <Text style={[
                      styles.liftPct,
                      { color: isPositive ? '#16a34a' : c.danger },
                    ]}>
                      {isPositive ? '+' : ''}{pct.toFixed(1)}%
                    </Text>
                    <Text style={styles.liftStatLabel}>{t('liftVsBaseline')}</Text>
                  </View>
                  <View style={styles.liftStat}>
                    <Text style={styles.liftValue}>
                      {Math.round(period.total_lift_customers)}
                    </Text>
                    <Text style={styles.liftStatLabel}>{t('extraCustomers')}</Text>
                  </View>
                  {period.lift_per_cost != null && (
                    <View style={styles.liftStat}>
                      <Text style={styles.liftValue}>
                        {period.lift_per_cost.toFixed(1)}
                      </Text>
                      <Text style={styles.liftStatLabel}>{t('custPerCostUnit')}</Text>
                    </View>
                  )}
                </View>
              </View>
            )
          })
        )}

        {/* ── Regulars ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>{t('regularsSection')}</Text>

        {regulars.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="heart-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>{t('noRegularsAnalytics')}</Text>
          </View>
        ) : (
          regulars.map(reg => {
            const isExpanded = expandedRegularId === reg.id
            const prof = profitabilityMap[reg.id]
            return (
              <View key={reg.id} style={styles.regularCard}>
                <TouchableOpacity
                  style={styles.regularRow}
                  onPress={() => void toggleRegularProfitability(reg)}
                  activeOpacity={0.7}
                >
                  <View style={styles.regularLeft}>
                    <Text style={styles.regularName}>{reg.name}</Text>
                    <Text style={styles.regularMeta}>
                      CLV: {fmtCurrency(reg.clv)} ·{' '}
                      {reg.last_visit_date
                        ? `${reg.last_visit_date}`
                        : t('noVisitsYet')}
                    </Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={c.textMuted}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.profitabilityExpand}>
                    {loadingProfitId === reg.id ? (
                      <ActivityIndicator size="small" color={c.primary} />
                    ) : prof ? (
                      <>
                        <View style={styles.profitGrid}>
                          <ProfitTile
                            label={t('thisMonth')}
                            value={fmtCurrency(prof.this_month)}
                            c={c}
                          />
                          <ProfitTile
                            label={t('thisYear')}
                            value={fmtCurrency(prof.this_year)}
                            c={c}
                          />
                          <ProfitTile
                            label={t('allTime')}
                            value={fmtCurrency(prof.all_time)}
                            c={c}
                          />
                        </View>
                        {prof.monthly_visits.length > 0 && (
                          <View style={styles.monthlyVisits}>
                            <Text style={styles.cardSubLabel}>{t('monthlyVisitsLabel')}</Text>
                            {prof.monthly_visits.slice(-6).map(mv => (
                              <View key={`${mv.year}-${mv.month}`} style={styles.mvRow}>
                                <Text style={styles.mvLabel}>
                                  {MONTH_NAMES[mv.month - 1]} {mv.year}
                                </Text>
                                <Text style={styles.mvVisits}>
                                  {mv.visits} visit{mv.visits !== 1 ? 's' : ''}
                                </Text>
                                <Text style={styles.mvSpend}>
                                  {fmtCurrency(mv.total_spend)}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </>
                    ) : (
                      <Text style={styles.profitEmpty}>
                        {t('noProfitabilityYet')}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )
          })
        )}

      </ScrollView>
    </SafeAreaView>
  )
}

// ── Insights section ────────────────────────────────────────────────────────

function InsightsSection({
  insights, c, styles,
}: {
  insights: InsightsResponse | null
  c: Theme
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  styles: any
}) {
  const { t } = useLanguage()
  if (insights === null) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={c.primary} />
      </View>
    )
  }

  if (insights.status === 'not_enough_data') {
    return (
      <View style={styles.emptyBox}>
        <Ionicons name="bulb-outline" size={28} color={c.textMuted} />
        <Text style={styles.emptyText}>
          {insights.message ?? t('insightsKeepLogging')}
        </Text>
      </View>
    )
  }

  const hasDays = !!(insights.busiest_day && insights.slowest_day)
  const hasHours = !!(insights.peak_hour)
  const hasYoY = insights.yoy_growth_pct !== undefined && insights.yoy_growth_pct !== null
  const hasAcc = insights.forecast_accuracy_mape !== undefined && insights.forecast_accuracy_mape !== null

  return (
    <View style={{ gap: 12 }}>
      {/* Subtitle */}
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 4 }}>
        {t('insightsSubtitle')}
      </Text>

      {/* Data volume chips */}
      {(insights.n_days_logged != null || insights.n_months_logged != null) && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {insights.n_days_logged != null && (
            <View style={styles.insightChip}>
              <Text style={styles.insightChipValue}>{insights.n_days_logged}</Text>
              <Text style={styles.insightChipLabel}>{t('insightsDaysLogged')}</Text>
            </View>
          )}
          {insights.n_months_logged != null && (
            <View style={styles.insightChip}>
              <Text style={styles.insightChipValue}>{insights.n_months_logged}</Text>
              <Text style={styles.insightChipLabel}>{t('insightsMonthsData')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Day-of-week patterns */}
      <View style={styles.insightBlock}>
        <Text style={styles.insightBlockTitle}>{t('insightsSectionDays')}</Text>
        {hasDays ? (
          <View style={{ gap: 10 }}>
            <View style={styles.insightRow}>
              <View style={[styles.insightDot, { backgroundColor: c.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.insightRowLabel}>
                  {t('insightsBusiestDay')}:{' '}
                  <Text style={{ color: c.primaryDark, fontWeight: '700' }}>
                    {insights.busiest_day!.weekday}
                  </Text>
                </Text>
                <Text style={styles.insightRowSub}>
                  {t('insightsAvgCustomersDay', { n: Math.round(insights.busiest_day!.avg_customers) })}
                </Text>
                {insights.busiest_day!.pct_vs_mean > 0 && (
                  <Text style={[styles.insightRowSub, { color: '#16a34a' }]}>
                    {t('insightsPctAbove', { pct: Math.abs(insights.busiest_day!.pct_vs_mean).toFixed(0) })}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.insightRow}>
              <View style={[styles.insightDot, { backgroundColor: c.border }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.insightRowLabel}>
                  {t('insightsSlowestDay')}:{' '}
                  <Text style={{ color: c.textSub, fontWeight: '700' }}>
                    {insights.slowest_day!.weekday}
                  </Text>
                </Text>
                <Text style={styles.insightRowSub}>
                  {t('insightsAvgCustomersDay', { n: Math.round(insights.slowest_day!.avg_customers) })}
                </Text>
                {insights.slowest_day!.pct_vs_mean < 0 && (
                  <Text style={[styles.insightRowSub, { color: c.textMuted }]}>
                    {t('insightsPctBelow', { pct: Math.abs(insights.slowest_day!.pct_vs_mean).toFixed(0) })}
                  </Text>
                )}
              </View>
            </View>
            {insights.pct_diff_busiest_slowest != null && (
              <View style={styles.insightHighlight}>
                <Text style={styles.insightHighlightText}>
                  {t('insightsBusiestVsSlowest', {
                    busiest: insights.busiest_day!.weekday,
                    pct: Math.round(insights.pct_diff_busiest_slowest),
                    slowest: insights.slowest_day!.weekday,
                  })}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.insightDimNote}>{t('insightsNoHourlyData')}</Text>
        )}
      </View>

      {/* Hourly patterns */}
      <View style={styles.insightBlock}>
        <Text style={styles.insightBlockTitle}>{t('insightsSectionHours')}</Text>
        {hasHours ? (
          <View style={{ gap: 8 }}>
            <View style={styles.insightRow}>
              <View style={[styles.insightDot, { backgroundColor: '#f97316' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.insightRowLabel}>
                  {t('insightsPeakHour')}:{' '}
                  <Text style={{ color: '#ea580c', fontWeight: '700' }}>
                    {insights.peak_hour!.label}
                  </Text>
                </Text>
                <Text style={styles.insightRowSub}>
                  {t('insightsAvgCustomersHour', { n: Math.round(insights.peak_hour!.avg_taps) })}
                </Text>
              </View>
            </View>
            {insights.quietest_hour && (
              <View style={styles.insightRow}>
                <View style={[styles.insightDot, { backgroundColor: c.border }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.insightRowLabel}>
                    {t('insightsQuietestHour')}:{' '}
                    <Text style={{ color: c.textSub, fontWeight: '700' }}>
                      {insights.quietest_hour.label}
                    </Text>
                  </Text>
                  <Text style={styles.insightRowSub}>
                    {t('insightsAvgCustomersHour', { n: Math.round(insights.quietest_hour.avg_taps) })}
                  </Text>
                </View>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.insightDimNote}>{t('insightsNoHourlyData')}</Text>
        )}
      </View>

      {/* Year-over-year */}
      <View style={styles.insightBlock}>
        <Text style={styles.insightBlockTitle}>{t('insightsSectionYoY')}</Text>
        {hasYoY ? (
          <View style={{ gap: 4 }}>
            <Text style={[styles.insightBigStat, {
              color: insights.yoy_growth_pct! >= 0 ? '#16a34a' : c.danger,
            }]}>
              {insights.yoy_growth_pct! >= 0
                ? t('insightsYoYGrowth', { pct: Math.abs(insights.yoy_growth_pct!).toFixed(1) })
                : t('insightsYoYDecline', { pct: Math.abs(insights.yoy_growth_pct!).toFixed(1) })}
            </Text>
            {insights.yoy_curr_period_label && insights.yoy_prev_period_label && (
              <Text style={styles.insightRowSub}>
                {t('insightsYoYCompare', {
                  curr: insights.yoy_curr_period_label,
                  prev: insights.yoy_prev_period_label,
                })}
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.insightDimNote}>{t('insightsNoYoY')}</Text>
        )}
      </View>

      {/* Forecast accuracy */}
      <View style={styles.insightBlock}>
        <Text style={styles.insightBlockTitle}>{t('insightsSectionAccuracy')}</Text>
        {hasAcc ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.insightAccStat}>
              {t('insightsAccuracyWithin', { pct: insights.forecast_accuracy_mape!.toFixed(1) })}
            </Text>
            {insights.accuracy_early_mape != null && insights.accuracy_recent_mape != null && (
              <View style={styles.insightHighlight}>
                <Text style={[styles.insightHighlightText, {
                  color: insights.accuracy_improved ? '#16a34a' : c.textSub,
                }]}>
                  {insights.accuracy_improved
                    ? t('insightsAccuracyImproving', {
                        early: insights.accuracy_early_mape.toFixed(1),
                        recent: insights.accuracy_recent_mape.toFixed(1),
                      })
                    : t('insightsAccuracyStable', {
                        recent: insights.accuracy_recent_mape.toFixed(1),
                      })}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.insightDimNote}>{t('insightsNoAccuracy')}</Text>
        )}
      </View>
    </View>
  )
}

// ── Small reusable tiles ────────────────────────────────────────────────────

function MetricTile({
  label, value, sub, c,
}: {
  label: string; value: string; sub: string; c: Theme
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 11, color: c.textMuted, fontWeight: '700',
        textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 22, fontWeight: '700', color: c.primaryDark }}>{value}</Text>
      <Text style={{ fontSize: 10, color: c.textMuted, textAlign: 'center' }}>{sub}</Text>
    </View>
  )
}

function ProfitTile({ label, value, c }: { label: string; value: string; c: Theme }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 11, color: c.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: '700', color: c.primaryDark }}>{value}</Text>
    </View>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1 },
    reloadBtn: {
      backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: 8,
    },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    loadingText: {
      marginTop: 14, color: c.textSub, textAlign: 'center', fontSize: 13, maxWidth: 260,
    },
    errorText: { color: c.danger, fontSize: 14, textAlign: 'center', marginBottom: 16 },
    retryBtn: {
      backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20,
    },
    retryText: { color: c.onPrimary, fontWeight: '600', fontSize: 14 },

    sectionTitle: {
      fontSize: 17, fontWeight: '700', color: c.primaryDark, marginBottom: 12, marginTop: 4,
    },
    sectionGap: { marginTop: 28 },

    emptyBox: {
      backgroundColor: c.card, borderRadius: 16, padding: 24,
      alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.border,
    },
    emptyText: { color: c.textSub, fontSize: 14, textAlign: 'center', lineHeight: 22 },

    card: {
      backgroundColor: c.card, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: c.border, marginBottom: 8,
    },
    cardNote: { fontSize: 12, color: c.textMuted, marginBottom: 12 },
    cardSubLabel: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
    },

    warningBanner: {
      backgroundColor: '#fefce8', borderRadius: 8, padding: 10, marginBottom: 12,
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      borderWidth: 1, borderColor: '#fde047',
    },
    warningText: { flex: 1, fontSize: 12, color: '#713f12', lineHeight: 18 },

    metricsGrid: {
      flexDirection: 'row', gap: 4, paddingTop: 4,
    },

    // Staffing
    staffRow: {
      marginBottom: 12,
    },
    staffHour: { fontSize: 12, fontWeight: '700', color: c.primaryDark, marginBottom: 4 },
    staffBarWrap: { gap: 4 },
    barBg: {
      height: 8, backgroundColor: c.border, borderRadius: 4, overflow: 'hidden', marginBottom: 3,
    },
    barFill: { height: 8, backgroundColor: c.primary, borderRadius: 4 },
    staffMeta: { fontSize: 11, color: c.textSub },
    marginalNote: {
      fontSize: 11, color: '#a16207', fontStyle: 'italic', marginTop: 2,
    },

    // Lift
    liftCard: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 10,
      borderWidth: 1, borderColor: c.border,
    },
    liftHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    liftBadge: {
      backgroundColor: c.primaryBg, borderRadius: 6,
      paddingVertical: 2, paddingHorizontal: 7,
    },
    liftBadgeText: { fontSize: 10, fontWeight: '700', color: c.primaryDark },
    liftLabel: { fontSize: 15, fontWeight: '700', color: c.text, flex: 1 },
    liftDates: { fontSize: 11, color: c.textMuted, marginBottom: 10 },
    liftNumbers: { flexDirection: 'row', gap: 16 },
    liftStat: { alignItems: 'center', gap: 2 },
    liftPct: { fontSize: 22, fontWeight: '700' },
    liftValue: { fontSize: 18, fontWeight: '700', color: c.text },
    liftStatLabel: { fontSize: 10, color: c.textMuted, textAlign: 'center' },

    // Regulars
    regularCard: {
      backgroundColor: c.card, borderRadius: 14, marginBottom: 8,
      borderWidth: 1, borderColor: c.border, overflow: 'hidden',
    },
    regularRow: {
      flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10,
    },
    regularLeft: { flex: 1, gap: 3 },
    regularName: { fontSize: 15, fontWeight: '700', color: c.text },
    regularMeta: { fontSize: 12, color: c.textSub },

    profitabilityExpand: {
      borderTopWidth: 1, borderTopColor: c.border, padding: 14,
    },
    profitGrid: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    monthlyVisits: {},
    mvRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    mvLabel: { flex: 1, fontSize: 13, color: c.text },
    mvVisits: { fontSize: 12, color: c.textSub, marginRight: 12 },
    mvSpend: { fontSize: 13, fontWeight: '600', color: c.primaryDark },
    profitEmpty: { fontSize: 13, color: c.textMuted, textAlign: 'center' },

    // Insights
    insightChip: {
      alignItems: 'center',
      backgroundColor: `${c.primary}18`,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 16,
      minWidth: 90,
    },
    insightChipValue: {
      fontSize: 24, fontWeight: '700', color: c.primaryDark,
    },
    insightChipLabel: {
      fontSize: 10, color: c.textMuted, textAlign: 'center', marginTop: 2,
    },
    insightBlock: {
      backgroundColor: c.card, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: c.border, gap: 10,
    },
    insightBlockTitle: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.6,
    },
    insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    insightDot: {
      width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0,
    },
    insightRowLabel: { fontSize: 14, color: c.text, fontWeight: '500' },
    insightRowSub: { fontSize: 12, color: c.textSub, marginTop: 2 },
    insightHighlight: {
      backgroundColor: `${c.primary}12`, borderRadius: 10, padding: 10,
    },
    insightHighlightText: { fontSize: 13, color: c.primaryDark, fontWeight: '500' },
    insightDimNote: { fontSize: 13, color: c.textMuted, lineHeight: 20 },
    insightBigStat: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
    insightAccStat: { fontSize: 14, fontWeight: '600', color: c.text },
  })
}
