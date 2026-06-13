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
  ForecastDay,
  OrderingResponse,
  WeekdayHourlyResponse,
  WeekdayHourlyEntry,
} from '../api/types'
import { useBusiness } from '../contexts/BusinessContext'
import { useTheme, type Theme } from '../lib/theme'

const WEEKDAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
}

function fmt12(hour: number): string {
  if (hour === 0) return '12am'
  if (hour < 12) return `${hour}am`
  if (hour === 12) return '12pm'
  return `${hour - 12}pm`
}

function tomorrowWeekdayIdx(): number {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const js = d.getDay() // 0=Sun
  return js === 0 ? 6 : js - 1 // 0=Mon..6=Sun
}

export default function ForecastScreen() {
  const { business, loading: bizLoading, error: bizError } = useBusiness()
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const [forecast, setForecast] = useState<ForecastDay[]>([])
  const [ordering, setOrdering] = useState<OrderingResponse | null>(null)
  const [hourly, setHourly] = useState<WeekdayHourlyResponse | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!business) return
    try {
      const [forecastRes, orderingRes, hourlyRes] = await Promise.allSettled([
        api.analytics.forecast(),
        api.analytics.ordering(),
        api.analytics.hourlyByWeekday(),
      ])
      if (forecastRes.status === 'fulfilled') {
        setForecast(forecastRes.value.status === 'ok' ? forecastRes.value.days : [])
      }
      if (orderingRes.status === 'fulfilled') {
        setOrdering(orderingRes.value)
      }
      if (hourlyRes.status === 'fulfilled') {
        setHourly(hourlyRes.value)
      }
      if (
        forecastRes.status === 'rejected' &&
        orderingRes.status === 'rejected' &&
        hourlyRes.status === 'rejected'
      ) {
        const err = forecastRes.reason as Error
        setDataError(err instanceof Error ? err.message : 'Failed to load forecast.')
      } else {
        setDataError(null)
      }
    } finally {
      setInitialLoading(false)
    }
  }, [business])

  useFocusEffect(
    useCallback(() => {
      if (business) void loadData()
    }, [loadData, business])
  )

  if (bizLoading || (initialLoading && forecast.length === 0)) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Forecast</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={styles.loadingText}>
            Loading… first load may take ~45 s if the server is waking up
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (bizError || dataError) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Forecast</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{bizError ?? dataError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void loadData()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const tomorrowIdx = tomorrowWeekdayIdx()
  const tomorrowEntry: WeekdayHourlyEntry | undefined =
    hourly?.weekdays.find(w => w.weekday_idx === tomorrowIdx)
  const busyHours = tomorrowEntry?.hours.filter(h => h.avg_taps > 0) ?? []
  const maxTaps = Math.max(...busyHours.map(h => h.avg_taps), 1)
  const peakHour = tomorrowEntry
    ? busyHours.reduce(
        (best, h) => (h.avg_taps > (best?.avg_taps ?? -1) ? h : best),
        busyHours[0]
      )
    : undefined

  const orderProducts = ordering?.products ?? []
  const urgentOrders = orderProducts.filter(p => p.order_now)
  const nonUrgentOrders = orderProducts.filter(p => !p.order_now)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Forecast</Text>
          {business !== null && (
            <Text style={styles.headerSub}>{business.name}</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => void loadData()} style={styles.reloadBtn}>
          <Ionicons name="refresh-outline" size={20} color={c.onPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/* ── Week Forecast ── */}
        <Text style={styles.sectionTitle}>This Week's Forecast</Text>
        {forecast.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              Not enough data yet — log a few days first to see predictions.
            </Text>
          </View>
        ) : (
          forecast.map(day => (
            <View key={day.date} style={styles.forecastRow}>
              <View style={styles.dayCol}>
                <Text style={styles.dayName}>
                  {WEEKDAY_SHORT[day.weekday] ?? day.weekday}
                </Text>
                <Text style={styles.dayDate}>{day.date.slice(5)}</Text>
              </View>
              <View style={styles.predCol}>
                <Text style={styles.predNumber}>
                  {Math.round(day.predicted_customers)}
                </Text>
                <Text style={styles.predLabel}>customers</Text>
              </View>
              <View style={styles.rangeCol}>
                <Text style={styles.rangeText}>
                  {Math.round(day.interval_low)}–{Math.round(day.interval_high)}
                </Text>
                <Text style={styles.rangeLabel}>range</Text>
              </View>
            </View>
          ))
        )}

        {/* ── Busy Hours ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>Busy Hours</Text>

        {busyHours.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="time-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              Record live sales for a few weeks to see busy-hour patterns.
            </Text>
          </View>
        ) : (
          <>
            {/* Tomorrow's peak */}
            <View style={styles.peakCard}>
              <View style={styles.peakCardLeft}>
                <Text style={styles.peakCardLabel}>
                  Tomorrow ({tomorrowEntry?.weekday ?? ''})
                </Text>
                {peakHour && (
                  <Text style={styles.peakCardTime}>
                    Peak: {fmt12(peakHour.hour)}
                  </Text>
                )}
              </View>
              {peakHour && (
                <View style={styles.peakCardRight}>
                  <Text style={styles.peakCardCount}>
                    ~{Math.round(peakHour.avg_taps)}
                  </Text>
                  <Text style={styles.peakCardUnit}>avg/hr</Text>
                </View>
              )}
            </View>

            {/* Hourly bars for tomorrow */}
            <View style={styles.card}>
              <Text style={styles.cardSubLabel}>Tomorrow hour by hour</Text>
              {busyHours.map(h => (
                <View key={h.hour} style={styles.hourRow}>
                  <Text style={styles.hourLabel}>{fmt12(h.hour)}</Text>
                  <View style={styles.barBg}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.round((h.avg_taps / maxTaps) * 100)}%` as `${number}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.hourCount}>
                    {h.avg_taps < 1 ? '<1' : Math.round(h.avg_taps)}
                  </Text>
                </View>
              ))}
            </View>

            {/* Peak by weekday */}
            {(hourly?.weekdays.length ?? 0) > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardSubLabel}>Peak hour by weekday</Text>
                {(hourly?.weekdays ?? []).map(entry => (
                  <View key={entry.weekday_idx} style={styles.weekdayPeakRow}>
                    <Text style={styles.weekdayPeakDay}>
                      {WEEKDAY_SHORT[entry.weekday] ?? entry.weekday}
                    </Text>
                    <Text style={styles.weekdayPeakTime}>
                      {fmt12(entry.peak_hour)}
                    </Text>
                    <Text style={styles.weekdayPeakCount}>
                      ~{Math.round(entry.peak_avg_taps)}/hr
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── What to Order ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>What to Order</Text>

        {orderProducts.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="cube-outline" size={28} color={c.textMuted} />
            <Text style={styles.emptyText}>
              {ordering?.message ??
                'Add products and log sales for a few weeks to get ordering advice.'}
            </Text>
          </View>
        ) : (
          <>
            {urgentOrders.length > 0 && (
              <>
                <Text style={styles.orderSubLabel}>Order now</Text>
                {urgentOrders.map(p => (
                  <View key={p.product_id} style={[styles.orderCard, styles.orderCardUrgent]}>
                    <View style={styles.orderCardLeft}>
                      <View style={styles.urgentBadge}>
                        <Text style={styles.urgentBadgeText}>Order now</Text>
                      </View>
                      <Text style={styles.orderName}>{p.name}</Text>
                      <Text style={styles.orderMeta}>
                        Avg demand: {
                          p.avg_daily_demand < 1
                            ? p.avg_daily_demand.toFixed(1)
                            : Math.round(p.avg_daily_demand)
                        } {p.unit}/day · lead time {p.lead_time_days}d
                      </Text>
                      {p.current_stock != null && (
                        <Text style={styles.orderStock}>
                          Stock: {p.current_stock} {p.unit}
                        </Text>
                      )}
                    </View>
                    <View style={styles.orderQtyBox}>
                      <Text style={styles.orderQty}>
                        {p.suggested_order_qty != null
                          ? Math.ceil(p.suggested_order_qty)
                          : '—'}
                      </Text>
                      <Text style={styles.orderQtyUnit}>{p.unit}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {nonUrgentOrders.length > 0 && (
              <>
                <Text style={[styles.orderSubLabel, { marginTop: urgentOrders.length > 0 ? 14 : 0 }]}>
                  Stock OK
                </Text>
                {nonUrgentOrders.map(p => (
                  <View key={p.product_id} style={styles.orderCard}>
                    <View style={styles.orderCardLeft}>
                      <Text style={styles.orderName}>{p.name}</Text>
                      <Text style={styles.orderMeta}>
                        Avg demand: {
                          p.avg_daily_demand < 1
                            ? p.avg_daily_demand.toFixed(1)
                            : Math.round(p.avg_daily_demand)
                        } {p.unit}/day
                      </Text>
                      {p.current_stock != null && (
                        <Text style={styles.orderStock}>
                          Stock: {p.current_stock} {p.unit}
                        </Text>
                      )}
                    </View>
                    <View style={styles.orderQtyBox}>
                      <Ionicons name="checkmark-circle" size={22} color={c.primary} />
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },

    header: {
      backgroundColor: c.headerBg,
      paddingHorizontal: 20,
      paddingBottom: 16,
      paddingTop: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    headerTitle: { fontSize: 26, fontWeight: '700', color: c.onPrimary },
    headerSub: { fontSize: 12, color: c.onPrimarySub, marginTop: 2 },
    reloadBtn: {
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: 20,
      padding: 8,
    },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 36 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    loadingText: {
      marginTop: 14, color: c.textSub, textAlign: 'center', fontSize: 13, maxWidth: 260,
    },
    errorText: { color: c.danger, fontSize: 14, textAlign: 'center', marginBottom: 16 },
    retryBtn: {
      backgroundColor: c.primary, borderRadius: 10,
      paddingVertical: 10, paddingHorizontal: 20,
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

    // Week forecast rows
    forecastRow: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 8,
      flexDirection: 'row', alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    dayCol: { width: 52 },
    dayName: { fontSize: 14, fontWeight: '700', color: c.primaryDark },
    dayDate: { fontSize: 11, color: c.textMuted, marginTop: 2 },
    predCol: { flex: 1, alignItems: 'center' },
    predNumber: { fontSize: 26, fontWeight: '700', color: c.text },
    predLabel: { fontSize: 11, color: c.textMuted },
    rangeCol: { alignItems: 'flex-end' },
    rangeText: { fontSize: 13, color: c.textSub, fontWeight: '600' },
    rangeLabel: { fontSize: 11, color: c.textMuted },

    // Busy hours
    peakCard: {
      backgroundColor: c.primaryBg, borderRadius: 14, padding: 16, marginBottom: 10,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderWidth: 1, borderColor: c.primary,
    },
    peakCardLeft: { gap: 4 },
    peakCardLabel: { fontSize: 12, color: c.primaryDark, fontWeight: '600' },
    peakCardTime: { fontSize: 20, fontWeight: '700', color: c.text },
    peakCardRight: { alignItems: 'flex-end' },
    peakCardCount: { fontSize: 28, fontWeight: '700', color: c.primaryDark },
    peakCardUnit: { fontSize: 11, color: c.textMuted },

    card: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 10,
      borderWidth: 1, borderColor: c.border,
    },
    cardSubLabel: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
    },
    hourRow: {
      flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8,
    },
    hourLabel: { width: 36, fontSize: 12, color: c.textSub, textAlign: 'right' },
    barBg: {
      flex: 1, height: 8, backgroundColor: c.border, borderRadius: 4, overflow: 'hidden',
    },
    barFill: { height: 8, backgroundColor: c.primary, borderRadius: 4 },
    hourCount: { width: 24, fontSize: 12, color: c.text, fontWeight: '600', textAlign: 'right' },

    weekdayPeakRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    weekdayPeakDay: { width: 36, fontSize: 13, fontWeight: '700', color: c.primaryDark },
    weekdayPeakTime: { flex: 1, fontSize: 13, color: c.text },
    weekdayPeakCount: { fontSize: 12, color: c.textSub },

    // Ordering
    orderSubLabel: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
    },
    orderCard: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 8,
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1, borderColor: c.border,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
    },
    orderCardUrgent: {
      borderColor: '#e06b2e', backgroundColor: '#fff8f4',
    },
    orderCardLeft: { flex: 1, gap: 3 },
    urgentBadge: {
      alignSelf: 'flex-start', backgroundColor: '#e06b2e',
      borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7, marginBottom: 4,
    },
    urgentBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
    orderName: { fontSize: 15, fontWeight: '700', color: c.text },
    orderMeta: { fontSize: 12, color: c.textSub },
    orderStock: { fontSize: 12, color: c.textMuted },
    orderQtyBox: { alignItems: 'center', marginLeft: 12 },
    orderQty: { fontSize: 26, fontWeight: '700', color: c.primaryDark },
    orderQtyUnit: { fontSize: 11, color: c.textMuted },
  })
}
