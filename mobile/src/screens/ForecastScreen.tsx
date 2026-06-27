import { useState, useCallback, useMemo, useEffect } from 'react'
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
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../lib/i18n'

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
import type { Theme } from '../lib/theme'
import AppHeader from '../components/AppHeader'
import { subscribeOrderChange, emitOrderChange } from '../lib/orderEvents'

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
  const { t, lang } = useLanguage()
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

  // Refresh stock/ordering when any order changes (arrived, cancelled, logged)
  useEffect(() => {
    return subscribeOrderChange(() => { if (business) void loadData() })
  }, [loadData, business])

  const handleLogOrder = async () => {
    if (!logOrderProduct) return
    let qty = parseFloat(logOrderQty)
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid quantity', 'Enter a number greater than 0.')
      return
    }
    if ((logOrderProduct.unit_mode ?? 'whole') === 'whole') qty = Math.round(qty)
    setLogOrderSaving(true)
    try {
      await api.orders.create({
        product_id: logOrderProduct.product_id,
        ordered_date: todayStr(),
        quantity: qty,
      })
      setLogOrderProduct(null)
      setLogOrderQty('')
      emitOrderChange()
      void loadData()
      Alert.alert('Order logged!', `${qty} ${logOrderProduct.unit} of ${logOrderProduct.name} recorded.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to log order.'
      if (msg.includes('already have an order')) {
        Alert.alert(
          'Already ordered today',
          'You placed an order for this product today. Go to Orders to edit the quantity.',
        )
      } else {
        Alert.alert('Error', msg)
      }
    } finally {
      setLogOrderSaving(false)
    }
  }

  if (bizLoading || (initialLoading && forecast.length === 0)) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
        <AppHeader title={t('forecast')} subtitle={business?.name} />
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
        <AppHeader title={t('forecast')} subtitle={business?.name} />
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: c.danger }]}>{bizError ?? dataError}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: c.primary }]} onPress={() => void loadData()}>
            <Text style={[styles.retryText, { color: c.onPrimary }]}>{t('retry')}</Text>
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
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
      <AppHeader
        title={t('forecast')}
        subtitle={business?.name}
        rightExtra={
          <TouchableOpacity onPress={() => void loadData()} style={styles.reloadBtn}>
            <Ionicons name="refresh-outline" size={20} color={c.onPrimary} />
          </TouchableOpacity>
        }
      />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/* ── Forecast ── */}
        <Text style={[styles.sectionTitle, { color: c.primaryDark }]}>{t('thisWeekForecast')}</Text>

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
            <View style={[styles.emptyBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <Ionicons name="calendar-outline" size={28} color={c.textMuted} />
              <Text style={[styles.emptyText, { color: c.textSub }]}>{t('notEnoughDataYet')}</Text>
            </View>
          ) : (
            forecast.map(day => (
              <View key={day.date} style={[styles.forecastRow, { backgroundColor: c.card }]}>
                <View style={styles.dayCol}>
                  <Text style={[styles.dayName, { color: c.primaryDark }]}>
                    {WEEKDAY_SHORT[day.weekday] ?? day.weekday}
                  </Text>
                  <Text style={[styles.dayDate, { color: c.textMuted }]}>{day.date.slice(5)}</Text>
                </View>
                <View style={styles.predCol}>
                  <Text style={[styles.predNumber, { color: c.text }]}>
                    {Math.round(day.predicted_customers)}
                  </Text>
                  <Text style={[styles.predLabel, { color: c.textMuted }]}>{t('customers')}</Text>
                </View>
                <View style={styles.rangeCol}>
                  <Text style={[styles.rangeText, { color: c.textSub }]}>
                    {Math.round(day.interval_low)}–{Math.round(day.interval_high)}
                  </Text>
                  <Text style={[styles.rangeLabel, { color: c.textMuted }]}>{t('range')}</Text>
                </View>
              </View>
            ))
          )
        )}

        {/* Product view */}
        {typeof viewMode === 'number' && (
          selectedProduct == null || selectedProduct.status !== 'ok' || selectedProduct.days.length === 0 ? (
            <View style={[styles.emptyBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <Ionicons name="cube-outline" size={28} color={c.textMuted} />
              <Text style={[styles.emptyText, { color: c.textSub }]}>
                {selectedProduct?.message ?? t('noProductDataYet')}
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
        <Text style={[styles.sectionTitle, styles.sectionGap, { color: c.primaryDark }]}>{t('busyHoursStaffing')}</Text>

        {busyHours.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="time-outline" size={28} color={c.textMuted} />
            <Text style={[styles.emptyText, { color: c.textSub }]}>{t('tapSalesWeeks')}</Text>
          </View>
        ) : (
          <>
            {/* Tomorrow's peak */}
            <View style={[styles.peakCard, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
              <View style={styles.peakCardLeft}>
                <Text style={[styles.peakCardLabel, { color: c.primaryDark }]}>
                  {t('tomorrowLabel', { day: tomorrowEntry?.weekday ?? '' })}
                </Text>
                {peakHour && (
                  <Text style={[styles.peakCardTime, { color: c.text }]}>
                    {t('peakLabel', { time: fmt12(peakHour.hour) })}
                  </Text>
                )}
              </View>
              {peakHour && (
                <View style={styles.peakCardRight}>
                  <Text style={[styles.peakCardCount, { color: c.primaryDark }]}>
                    ~{Math.round(peakHour.avg_taps)}
                  </Text>
                  <Text style={[styles.peakCardUnit, { color: c.textMuted }]}>{t('avgPerHour')}</Text>
                  {peakHour.recommended_staff > 0 && (
                    <Text style={[styles.peakStaffNote, { color: c.primaryDark }]}>
                      {t('staffLabel', { n: peakHour.recommended_staff })}
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* Hourly rows for tomorrow with staffing */}
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.cardSubLabel, { color: c.textMuted }]}>{t('tomorrowHourByHour')}</Text>
              {busyHours.map(h => (
                <View key={h.hour} style={styles.hourBlock}>
                  <View style={styles.hourRow}>
                    <Text style={[styles.hourLabel, { color: c.textSub }]}>{fmt12(h.hour)}</Text>
                    <View style={[styles.barBg, { backgroundColor: c.border }]}>
                      <View
                        style={[
                          styles.barFill,
                          { backgroundColor: c.primary },
                          { width: `${Math.round((h.avg_taps / maxTaps) * 100)}%` as `${number}%` },
                        ]}
                      />
                    </View>
                    <Text style={[styles.hourCount, { color: c.text }]}>
                      {h.avg_taps < 1 ? '<1' : Math.round(h.avg_taps)}
                    </Text>
                  </View>
                  {(h.recommended_staff > 0 || h.expected_wait_minutes > 0) && (
                    <Text style={[styles.staffLine, { color: c.textSub }]}>
                      {h.recommended_staff > 0 ? t('staffLabel', { n: h.recommended_staff }) : ''}
                      {h.recommended_staff > 0 && h.expected_wait_minutes > 0 && h.expected_wait_minutes < 60 ? ' · ' : ''}
                      {h.expected_wait_minutes > 0 && h.expected_wait_minutes < 60
                        ? t('waitLabel', { n: Math.round(h.expected_wait_minutes) })
                        : h.expected_wait_minutes >= 60
                          ? t('severelyUnderstaffed')
                          : ''}
                    </Text>
                  )}
                  {(formatMarginalNote(h, t, lang) ?? h.marginal_note) ? (
                    <Text style={styles.marginalNote}>{formatMarginalNote(h, t, lang) ?? h.marginal_note}</Text>
                  ) : null}
                </View>
              ))}
            </View>

            {/* Peak by weekday */}
            {(hourly?.weekdays.length ?? 0) > 1 && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.cardSubLabel, { color: c.textMuted }]}>{t('peakHourByWeekday')}</Text>
                {(hourly?.weekdays ?? []).map(entry => (
                  <View key={entry.weekday_idx} style={[styles.weekdayPeakRow, { borderBottomColor: c.border }]}>
                    <Text style={[styles.weekdayPeakDay, { color: c.primaryDark }]}>
                      {WEEKDAY_SHORT[entry.weekday] ?? entry.weekday}
                    </Text>
                    <Text style={[styles.weekdayPeakTime, { color: c.text }]}>
                      {fmt12(entry.peak_hour)}
                    </Text>
                    <Text style={[styles.weekdayPeakCount, { color: c.textSub }]}>
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
            <Text style={[styles.sectionTitle, styles.sectionGap, { color: c.primaryDark }]}>{t('whatToOrder')}</Text>

            {orderProducts.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: c.card, borderColor: c.border }]}>
                <Ionicons name="cube-outline" size={28} color={c.textMuted} />
                <Text style={[styles.emptyText, { color: c.textSub }]}>
                  {ordering?.message ?? t('addProductsLog')}
                </Text>
              </View>
            ) : (
              <>
                {urgentOrders.length > 0 && (
                  <>
                    <Text style={[styles.orderSubLabel, { color: c.textMuted }]}>{t('orderNow')}</Text>
                    {urgentOrders.map(p => (
                      <View key={p.product_id} style={[styles.orderCard, styles.orderCardUrgent, { borderColor: '#e06b2e', backgroundColor: c.bg }]}>
                        <View style={styles.orderCardLeft}>
                          <View style={styles.urgentBadge}>
                            <Text style={styles.urgentBadgeText}>{t('orderNow')}</Text>
                          </View>
                          <Text style={[styles.orderName, { color: c.text }]}>{p.name}</Text>
                          <Text style={[styles.orderMeta, { color: c.textSub }]}>
                            {t('avgDemand', {
                              qty: p.avg_daily_demand < 1 ? p.avg_daily_demand.toFixed(1) : Math.round(p.avg_daily_demand),
                              unit: p.unit,
                              lt: p.lead_time_days,
                            })}
                          </Text>
                          {p.stock_untracked ? (
                            <View style={[styles.stockUntracked, { backgroundColor: c.primaryXBg, borderColor: c.border }]}>
                              <Ionicons name="information-circle-outline" size={14} color={c.primaryDark} />
                              <Text style={[styles.stockUntrackedText, { color: c.primaryDark }]}>
                                {t('enterStockForTracking')}
                              </Text>
                            </View>
                          ) : p.current_stock != null ? (
                            <Text style={[styles.orderStock, { color: c.textMuted }]}>
                              {t('stock', { qty: p.current_stock, unit: p.unit })}
                            </Text>
                          ) : null}
                          {hasRunoutWarning(p.product_id) && (
                            <Text style={[styles.runoutWarning, { color: '#b45309' }]}>
                              {t('mayRunOut')}
                            </Text>
                          )}
                          {(p as OrderingRow & { older_stock_warning?: string }).older_stock_warning && (
                            <Text style={[styles.fifoWarning, { color: '#b45309' }]}>
                              {(p as OrderingRow & { older_stock_warning?: string }).older_stock_warning}
                            </Text>
                          )}
                          {(p as OrderingRow & { spoilage_alert?: string }).spoilage_alert && (
                            <Text style={[styles.spoilageAlert, { color: c.danger }]}>
                              {(p as OrderingRow & { spoilage_alert?: string }).spoilage_alert}
                            </Text>
                          )}
                          {(p as OrderingRow & { fifo_note?: string }).fifo_note && (
                            <Text style={[styles.fifoNote, { color: c.textMuted }]}>
                              {t('fifoAssumptionNote')}
                            </Text>
                          )}
                          <TouchableOpacity
                            style={styles.reorderBtn}
                            onPress={() => {
                              setLogOrderProduct(p)
                              setLogOrderQty(
                                p.suggested_order_qty != null
                                  ? (p.unit_mode ?? 'whole') === 'whole'
                                    ? String(Math.round(p.suggested_order_qty))
                                    : String(p.suggested_order_qty)
                                  : ''
                              )
                            }}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="checkmark-circle-outline" size={16} color={c.onPrimary} />
                            <Text style={styles.reorderBtnText}>{t('iReorderedThis')}</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.orderQtyBox}>
                          <Text style={[styles.orderQty, { color: c.primaryDark }]}>
                            {p.suggested_order_qty != null
                              ? (p.unit_mode ?? 'whole') === 'whole'
                                ? Math.round(p.suggested_order_qty)
                                : p.suggested_order_qty.toFixed(2)
                              : '—'}
                          </Text>
                          <Text style={[styles.orderQtyUnit, { color: c.textMuted }]}>{p.unit}</Text>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {nonUrgentOrders.length > 0 && (
                  <>
                    <Text style={[styles.orderSubLabel, { color: c.textMuted, marginTop: urgentOrders.length > 0 ? 14 : 0 }]}>
                      {t('stockOk')}
                    </Text>
                    {nonUrgentOrders.map(p => (
                      <View key={p.product_id} style={[styles.orderCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <View style={styles.orderCardLeft}>
                          <Text style={[styles.orderName, { color: c.text }]}>{p.name}</Text>
                          <Text style={[styles.orderMeta, { color: c.textSub }]}>
                            {t('avgDemand', {
                              qty: p.avg_daily_demand < 1 ? p.avg_daily_demand.toFixed(1) : Math.round(p.avg_daily_demand),
                              unit: p.unit,
                              lt: p.lead_time_days,
                            })}
                          </Text>
                          {p.stock_untracked ? (
                            <Text style={[styles.stockUntrackedText, { color: c.primaryDark }]}>
                              {t('enterStockForTracking')}
                            </Text>
                          ) : p.current_stock != null ? (
                            <Text style={[styles.orderStock, { color: c.textMuted }]}>
                              {t('stock', { qty: p.current_stock, unit: p.unit })}
                            </Text>
                          ) : null}
                          {(p as OrderingRow & { fifo_note?: string }).fifo_note && (
                            <Text style={[styles.fifoNote, { color: c.textMuted }]}>
                              {t('fifoAssumptionNote')}
                            </Text>
                          )}
                          <TouchableOpacity
                            style={[styles.reorderBtn, styles.reorderBtnOutline, { borderColor: c.primary }]}
                            onPress={() => {
                              setLogOrderProduct(p)
                              setLogOrderQty(
                                p.suggested_order_qty != null
                                  ? (p.unit_mode ?? 'whole') === 'whole'
                                    ? String(Math.round(p.suggested_order_qty))
                                    : String(p.suggested_order_qty)
                                  : ''
                              )
                            }}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="checkmark-circle-outline" size={16} color={c.primary} />
                            <Text style={[styles.reorderBtnText, { color: c.primary }]}>{t('iReorderedThis')}</Text>
                          </TouchableOpacity>
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
          <View style={[styles.emptyBox, { marginTop: 28, backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="cube-outline" size={24} color={c.textMuted} />
            <Text style={[styles.emptyText, { color: c.textSub }]}>{t('stockReorderOff')}</Text>
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
            <View style={[styles.logOrderModal, { backgroundColor: c.bg }]}>
              <Text style={[styles.logOrderTitle, { color: c.text }]}>
                {t('iReorderedThis')} — {logOrderProduct?.name}
              </Text>
              <Text style={[styles.logOrderSub, { color: c.textSub }]}>
                How many {logOrderProduct?.unit} did you order?
              </Text>
              <TextInput
                style={[styles.logOrderInput, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
                value={logOrderQty}
                onChangeText={setLogOrderQty}
                keyboardType={(logOrderProduct?.unit_mode ?? 'whole') === 'whole' ? 'number-pad' : 'decimal-pad'}
                placeholder={logOrderProduct?.suggested_order_qty != null
                  ? (logOrderProduct.unit_mode ?? 'whole') === 'whole'
                    ? String(Math.round(logOrderProduct.suggested_order_qty))
                    : String(logOrderProduct.suggested_order_qty)
                  : 'e.g. 50'}
                placeholderTextColor={c.textMuted}
                autoFocus
              />
              <View style={styles.logOrderBtns}>
                <TouchableOpacity
                  style={[styles.logOrderCancel, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() => { setLogOrderProduct(null); setLogOrderQty('') }}
                >
                  <Text style={[styles.logOrderCancelText, { color: c.textSub }]}>{t('cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logOrderConfirm, logOrderSaving && { opacity: 0.6 }]}
                  onPress={() => void handleLogOrder()}
                  disabled={logOrderSaving}
                >
                  {logOrderSaving
                    ? <ActivityIndicator size="small" color={c.onPrimary} />
                    : <Text style={styles.logOrderConfirmText}>{t('save')}</Text>}
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
    root: { flex: 1 },
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
    orderCardUrgent: { borderColor: '#e06b2e' },
    orderCardLeft: { flex: 1, gap: 3 },
    urgentBadge: {
      alignSelf: 'flex-start', backgroundColor: '#e06b2e',
      borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7, marginBottom: 4,
    },
    urgentBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
    orderName: { fontSize: 15, fontWeight: '700' },
    orderMeta: { fontSize: 12 },
    orderStock: { fontSize: 12 },
    runoutWarning: { fontSize: 11, fontWeight: '600', marginTop: 2 },
    fifoWarning: { fontSize: 11, fontWeight: '600', marginTop: 2 },
    spoilageAlert: { fontSize: 11, fontWeight: '700', marginTop: 2 },
    fifoNote: { fontSize: 10, fontStyle: 'italic', marginTop: 2 },
    stockUntracked: {
      flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4,
      borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1,
      alignSelf: 'flex-start',
    },
    stockUntrackedText: { fontSize: 11, fontWeight: '600', flex: 1 },
    reorderBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: '#e06b2e', borderRadius: 8,
      paddingVertical: 7, paddingHorizontal: 12, alignSelf: 'flex-start',
      marginTop: 8,
    },
    reorderBtnOutline: {
      backgroundColor: 'transparent', borderWidth: 1,
    },
    reorderBtnText: { fontSize: 13, color: '#fff', fontWeight: '700' },
    orderQtyBox: { alignItems: 'center', marginLeft: 12 },
    orderQty: { fontSize: 26, fontWeight: '700' },
    orderQtyUnit: { fontSize: 11 },

    // Log order modal
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
    },
    logOrderModal: {
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 24, paddingBottom: Platform.OS === 'ios' ? 36 : 24, gap: 12,
    },
    logOrderTitle: { fontSize: 18, fontWeight: '700' },
    logOrderSub: { fontSize: 14 },
    logOrderInput: {
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
      fontSize: 18, fontWeight: '600',
    },
    logOrderBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
    logOrderCancel: {
      flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1,
    },
    logOrderCancelText: { fontSize: 15, fontWeight: '600' },
    logOrderConfirm: {
      flex: 2, backgroundColor: '#e06b2e', borderRadius: 12,
      paddingVertical: 14, alignItems: 'center',
    },
    logOrderConfirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  })
}
