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
  LiftResponse,
  RegularProfitabilityRead,
  RegularRead,
} from '../api/types'
import { useBusiness } from '../contexts/BusinessContext'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { Theme } from '../lib/theme'
import AppHeader from '../components/AppHeader'

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
  const { t } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

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
      const [accRes, staffRes, liftRes, regsRes] = await Promise.allSettled([
        api.analytics.accuracy(),
        api.analytics.hourlyAnalytics(),
        api.analytics.lift(),
        api.regulars.list(),
      ])
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

        {/* ── Forecast Accuracy ── */}
        <Text style={styles.sectionTitle}>Forecast Accuracy</Text>

        {accuracy == null || accuracy.status !== 'ok' ? (
          <View style={styles.emptyBox}>
            <Ionicons name="stats-chart-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              {accuracy?.message ?? 'Log at least a few weeks of data to measure accuracy.'}
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
                label="MAPE"
                value={accuracy.mape != null ? `${accuracy.mape.toFixed(1)}%` : '—'}
                sub="avg % off"
                c={c}
              />
              <MetricTile
                label="MAD"
                value={accuracy.mad != null ? accuracy.mad.toFixed(1) : '—'}
                sub="avg customers off"
                c={c}
              />
              <MetricTile
                label="Tracking"
                value={accuracy.tracking_signal != null
                  ? accuracy.tracking_signal.toFixed(2)
                  : '—'}
                sub="bias signal (±4 = biased)"
                c={c}
              />
              <MetricTile
                label="Days"
                value={String(accuracy.n_observations)}
                sub="days of data"
                c={c}
              />
            </View>
          </View>
        )}

        {/* ── Staffing ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>Staffing</Text>

        {activeHours.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              {staffing?.message ??
                'Record live sales for a few weeks to see staffing recommendations.'}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardNote}>
              Based on {staffing?.n_days_data ?? 0} days of data ·{' '}
              avg service {staffing?.avg_service_time_minutes ?? '?'} min/customer
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
                    ~{Math.round(h.avg_taps)} cust · {h.recommended_staff} staff
                    {h.expected_wait_minutes > 0 &&
                      h.expected_wait_minutes < 60 &&
                      ` · ${Math.round(h.expected_wait_minutes)}m wait`}
                  </Text>
                </View>
                {h.marginal_note ? (
                  <Text style={styles.marginalNote}>{h.marginal_note}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* ── Ad & Event Lift ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>Ad & Event Lift</Text>

        {liftPeriods.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="megaphone-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              {lift?.message ??
                'No ads or events recorded yet. Add them in Manage → Ads & Events.'}
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
                      {period.type === 'ad' ? 'Ad' : 'Event'}
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
                    <Text style={styles.liftStatLabel}>lift vs baseline</Text>
                  </View>
                  <View style={styles.liftStat}>
                    <Text style={styles.liftValue}>
                      {Math.round(period.total_lift_customers)}
                    </Text>
                    <Text style={styles.liftStatLabel}>extra customers</Text>
                  </View>
                  {period.lift_per_cost != null && (
                    <View style={styles.liftStat}>
                      <Text style={styles.liftValue}>
                        {period.lift_per_cost.toFixed(1)}
                      </Text>
                      <Text style={styles.liftStatLabel}>cust/$ cost</Text>
                    </View>
                  )}
                </View>
              </View>
            )
          })
        )}

        {/* ── Regulars ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>Regulars</Text>

        {regulars.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="heart-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              No regulars yet. Add them in the Manage tab.
            </Text>
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
                        ? `Last: ${reg.last_visit_date}`
                        : 'No visits yet'}
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
                            label="This month"
                            value={fmtCurrency(prof.this_month)}
                            c={c}
                          />
                          <ProfitTile
                            label="This year"
                            value={fmtCurrency(prof.this_year)}
                            c={c}
                          />
                          <ProfitTile
                            label="All time"
                            value={fmtCurrency(prof.all_time)}
                            c={c}
                          />
                        </View>
                        {prof.monthly_visits.length > 0 && (
                          <View style={styles.monthlyVisits}>
                            <Text style={styles.cardSubLabel}>Monthly visits</Text>
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
                        No profitability data available yet.
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
  })
}
