import { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../api/client'
import type {
  ForecastDay,
  OrderingResponse,
  OrderingRow,
  WeekdayHourlyResponse,
  WeekdayHourlyEntry,
  ProductForecastItem,
  ProductForecastResponse,
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
  const js = d.getDay()
  return js === 0 ? 6 : js - 1
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ForecastScreen() {
  const { business, loading: bizLoading, error: bizError } = useBusiness()
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const [forecast, setForecast] = useState<ForecastDay[]>([])
  const [ordering, setOrdering] = useState<OrderingResponse | null>(null)
  const [hourly, setHourly] = useState<WeekdayHourlyResponse | null>(null)
  const [productForecasts, setProductForecasts] = useState<ProductForecastItem[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // View switcher: 'customers' or product_id (number)
  const [viewMode, setViewMode] = useState<'customers' | number>('customers')

  // Inline "Log Order" state
  const [logOrderProduct, setLogOrderProduct] = useState<OrderingRow | null>(null)
  const [logOrderQty, setLogOrderQty] = useState('')
  const [logOrderSaving, setLogOrderSaving] = useState(false)

  const stockEnabled = business?.settings?.stock_management_enabled !== false

  const loadData = useCallback(async () => {
    if (!business) return
    try {
      const [forecastRes, orderingRes, hourlyRes, prodFcRes] = await Promise.allSettled([
        api.analytics.forecast(),
        api.analytics.ordering(),
        api.analytics.hourlyByWeekday(),
        api.analytics.productForecast(),
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
      if (prodFcRes.status === 'fulfilled') {
        const pfr = prodFcRes.value as ProductForecastResponse
        setProductForecasts(pfr.products ?? [])
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

  const handleLogOrder = async () => {
    if (!logOrderProduct) return
    const qty = parseFloat(logOrderQty)
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid quantity', 'Enter a number greater than 0.')
      return
    }
    setLogOrderSaving(true)
    try {
      await api.orders.create({
        product_id: logOrderProduct.product_id,
        ordered_date: todayStr(),
        quantity: qty,
      })
      setLogOrderProduct(null)
      setLogOrderQty('')
      Alert.alert('Order logged!', `${qty} ${logOrderProduct.unit} of ${logOrderProduct.name} recorded.`)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to log order.')
    } finally {
      setLogOrderSaving(false)
    }
  }

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

  const hasRunoutWarning = (productId: number): boolean =>
    productForecasts.find(p => p.product_id === productId)?.projected_runout_warning ?? false

  // Selected product forecast (when viewMode is a product_id)
  const selectedProduct = typeof viewMode === 'number'
    ? productForecasts.find(p => p.product_id === viewMode)
    : null

  // Build the switcher items
  const switcherItems: Array<{ key: 'customers' | number; label: string }> = [
    { key: 'customers', label: 'Customers' },
    ...productForecasts.map(p => ({ key: p.product_id as 'customers' | number, label: p.name })),
  ]

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
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

        {/* ── Forecast ── */}
        <Text style={styles.sectionTitle}>This Week's Forecast</Text>

        {/* View switcher */}
        {switcherItems.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.switcherScroll}
            contentContainerStyle={styles.switcherContent}
          >
            {switcherItems.map(item => (
              <TouchableOpacity
                key={String(item.key)}
                style={[
                  styles.switcherChip,
                  viewMode === item.key && styles.switcherChipActive,
                ]}
                onPress={() => setViewMode(item.key)}
                activeOpacity={0.75}
              >
                <Text style={[
                  styles.switcherChipText,
                  viewMode === item.key && styles.switcherChipTextActive,
                ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Customers view */}
        {viewMode === 'customers' && (
          forecast.length === 0 ? (
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
          )
        )}

        {/* Product view */}
        {typeof viewMode === 'number' && (
          selectedProduct == null || selectedProduct.status !== 'ok' || selectedProduct.days.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="cube-outline" size={28} color={c.textMuted} />
              <Text style={styles.emptyText}>
                {selectedProduct?.message ?? 'Not enough sales data yet for this product.'}
              </Text>
            </View>
          ) : (
            selectedProduct.days.map(day => (
              <View key={day.date} style={styles.forecastRow}>
                <View style={styles.dayCol}>
                  <Text style={styles.dayName}>
                    {WEEKDAY_SHORT[day.weekday] ?? day.weekday}
                  </Text>
                  <Text style={styles.dayDate}>{day.date.slice(5)}</Text>
                </View>
                <View style={styles.predCol}>
                  <Text style={styles.predNumber}>
                    {selectedProduct.unit_mode === 'decimal'
                      ? day.predicted_units.toFixed(1)
                      : Math.round(day.predicted_units)}
                  </Text>
                  <Text style={styles.predLabel}>{selectedProduct.unit}</Text>
                </View>
                <View style={styles.rangeCol}>
                  <Text style={styles.rangeText}>
                    {selectedProduct.unit_mode === 'decimal'
                      ? `${day.interval_low.toFixed(1)}–${day.interval_high.toFixed(1)}`
                      : `${Math.round(day.interval_low)}–${Math.round(day.interval_high)}`}
                  </Text>
                  <Text style={styles.rangeLabel}>range</Text>
                </View>
              </View>
            ))
          )
        )}

        {/* ── Busy Hours + Staffing ── */}
        <Text style={[styles.sectionTitle, styles.sectionGap]}>Busy Hours & Staffing</Text>

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
                  {peakHour.recommended_staff > 0 && (
                    <Text style={styles.peakStaffNote}>
                      {peakHour.recommended_staff} staff
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* Hourly rows for tomorrow with staffing */}
            <View style={styles.card}>
              <Text style={styles.cardSubLabel}>Tomorrow hour by hour</Text>
              {busyHours.map(h => (
                <View key={h.hour} style={styles.hourBlock}>
                  <View style={styles.hourRow}>
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
                  {(h.recommended_staff > 0 || h.expected_wait_minutes > 0) && (
                    <Text style={styles.staffLine}>
                      {h.recommended_staff > 0 ? `${h.recommended_staff} staff` : ''}
                      {h.recommended_staff > 0 && h.expected_wait_minutes > 0 && h.expected_wait_minutes < 60 ? ' · ' : ''}
                      {h.expected_wait_minutes > 0 && h.expected_wait_minutes < 60
                        ? `~${Math.round(h.expected_wait_minutes)}m wait`
                        : h.expected_wait_minutes >= 60
                          ? 'severely understaffed'
                          : ''}
                    </Text>
                  )}
                  {h.marginal_note ? (
                    <Text style={styles.marginalNote}>{h.marginal_note}</Text>
                  ) : null}
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
        {stockEnabled ? (
          <>
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
                          {hasRunoutWarning(p.product_id) && (
                            <Text style={styles.runoutWarning}>
                              ⚠ May run out before reorder arrives
                            </Text>
                          )}
                          <TouchableOpacity
                            style={styles.reorderBtn}
                            onPress={() => {
                              setLogOrderProduct(p)
                              setLogOrderQty(
                                p.suggested_order_qty != null
                                  ? String(Math.ceil(p.suggested_order_qty))
                                  : ''
                              )
                            }}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="checkmark-circle-outline" size={16} color={c.onPrimary} />
                            <Text style={styles.reorderBtnText}>I reordered this</Text>
                          </TouchableOpacity>
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
          </>
        ) : (
          <View style={[styles.emptyBox, { marginTop: 28 }]}>
            <Ionicons name="cube-outline" size={24} color={c.textMuted} />
            <Text style={styles.emptyText}>
              Stock & reorder tracking is turned off. Enable it in Business Settings.
            </Text>
          </View>
        )}

      </ScrollView>

      {/* Log Order Modal */}
      <Modal
        visible={logOrderProduct !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLogOrderProduct(null)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.logOrderModal}>
              <Text style={styles.logOrderTitle}>
                I reordered — {logOrderProduct?.name}
              </Text>
              <Text style={styles.logOrderSub}>
                How many {logOrderProduct?.unit} did you order?
              </Text>
              <TextInput
                style={styles.logOrderInput}
                value={logOrderQty}
                onChangeText={setLogOrderQty}
                keyboardType="decimal-pad"
                placeholder={logOrderProduct?.suggested_order_qty != null
                  ? String(Math.ceil(logOrderProduct.suggested_order_qty))
                  : 'e.g. 50'}
                placeholderTextColor={c.textMuted}
                autoFocus
              />
              <View style={styles.logOrderBtns}>
                <TouchableOpacity
                  style={styles.logOrderCancel}
                  onPress={() => { setLogOrderProduct(null); setLogOrderQty('') }}
                >
                  <Text style={styles.logOrderCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logOrderConfirm, logOrderSaving && { opacity: 0.6 }]}
                  onPress={() => void handleLogOrder()}
                  disabled={logOrderSaving}
                >
                  {logOrderSaving
                    ? <ActivityIndicator size="small" color={c.onPrimary} />
                    : <Text style={styles.logOrderConfirmText}>Log</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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

    // View switcher
    switcherScroll: { marginBottom: 12 },
    switcherContent: { gap: 8, paddingRight: 4 },
    switcherChip: {
      backgroundColor: c.card, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
      borderWidth: 1, borderColor: c.border,
    },
    switcherChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    switcherChipText: { fontSize: 13, fontWeight: '600', color: c.textSub },
    switcherChipTextActive: { color: c.onPrimary },

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
    peakStaffNote: { fontSize: 11, color: c.primaryDark, fontWeight: '600', marginTop: 2 },

    card: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 10,
      borderWidth: 1, borderColor: c.border,
    },
    cardSubLabel: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
    },
    hourBlock: { marginBottom: 10 },
    hourRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
    },
    hourLabel: { width: 36, fontSize: 12, color: c.textSub, textAlign: 'right' },
    barBg: {
      flex: 1, height: 8, backgroundColor: c.border, borderRadius: 4, overflow: 'hidden',
    },
    barFill: { height: 8, backgroundColor: c.primary, borderRadius: 4 },
    hourCount: { width: 24, fontSize: 12, color: c.text, fontWeight: '600', textAlign: 'right' },
    staffLine: { fontSize: 11, color: c.textSub, marginTop: 2, marginLeft: 44 },
    marginalNote: { fontSize: 11, color: '#a16207', fontStyle: 'italic', marginTop: 1, marginLeft: 44 },

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
    runoutWarning: { fontSize: 11, color: '#b45309', fontWeight: '600', marginTop: 2 },
    reorderBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: '#e06b2e', borderRadius: 8,
      paddingVertical: 7, paddingHorizontal: 12, alignSelf: 'flex-start',
      marginTop: 8,
    },
    reorderBtnText: { fontSize: 13, color: '#fff', fontWeight: '700' },
    orderQtyBox: { alignItems: 'center', marginLeft: 12 },
    orderQty: { fontSize: 26, fontWeight: '700', color: c.primaryDark },
    orderQtyUnit: { fontSize: 11, color: c.textMuted },

    // Log order modal
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    logOrderModal: {
      backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 24, paddingBottom: Platform.OS === 'ios' ? 36 : 24,
      gap: 12,
    },
    logOrderTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    logOrderSub: { fontSize: 14, color: c.textSub },
    logOrderInput: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
      fontSize: 18, color: c.text, fontWeight: '600',
    },
    logOrderBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
    logOrderCancel: {
      flex: 1, backgroundColor: c.card, borderRadius: 12,
      paddingVertical: 14, alignItems: 'center',
      borderWidth: 1, borderColor: c.border,
    },
    logOrderCancelText: { fontSize: 15, color: c.textSub, fontWeight: '600' },
    logOrderConfirm: {
      flex: 2, backgroundColor: '#e06b2e', borderRadius: 12,
      paddingVertical: 14, alignItems: 'center',
    },
    logOrderConfirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  })
}
