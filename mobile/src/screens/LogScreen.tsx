import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../api/client'
import type { OutlierFlag, ProductRead, RegularRead, TodaySummaryResponse } from '../api/types'
import { useBusiness } from '../contexts/BusinessContext'
import { useTheme } from '../contexts/ThemeContext'
import { useCurrency } from '../contexts/CurrencyContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useBusinessTime } from '../contexts/BusinessTimeContext'
import { useTapQueue } from '../contexts/TapQueueContext'
import { isoDateIn } from '../lib/businessTime'
import type { Theme } from '../lib/theme'
import { outlierText } from '../lib/serverText'
import AppHeader from '../components/AppHeader'
import PastDaysModal from './manage/PastDaysModal'

/** One more tap of `productId` in today's summary, before the server's own count catches up. */
function withOneMore(s: TodaySummaryResponse | null, productId: number | null): TodaySummaryResponse | null {
  if (!s) return s
  const has = s.product_totals.some(p => p.product_id === productId)
  return {
    ...s,
    total_taps: s.total_taps + 1,
    product_totals: has
      ? s.product_totals.map(p => p.product_id === productId ? { ...p, units: p.units + 1 } : p)
      : [...s.product_totals, { product_id: productId, product_name: null, units: 1 }],
  }
}

export default function LogScreen() {
  const { business, loading: bizLoading, error: bizError } = useBusiness()
  const c = useTheme()
  const { t, lang, simpleMode, setSimpleMode, simpleModeNeverSet } = useLanguage()
  // The business's today, not the device's — see BusinessTimeContext.
  const { today: businessToday, timeZone } = useBusinessTime()
  const queue = useTapQueue()
  const { symbol, amount } = useCurrency()
  const navigation = useNavigation()
  const { width: screenWidth } = useWindowDimensions()
  const productBtnWidth = Math.floor((screenWidth - 32 - 10) / 2)
  const styles = useMemo(() => makeStyles(c), [c])

  const [products, setProducts] = useState<ProductRead[]>([])
  const [regulars, setRegulars] = useState<RegularRead[]>([])
  const [summary, setSummary] = useState<TodaySummaryResponse | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // The last tap, for Undo: `eventId` is filled in once the server has it.
  const [lastTap, setLastTap] = useState<{ key: string; eventId: number | null; label: string } | null>(null)
  const [tapError, setTapError] = useState<string | null>(null)
  // A summary fetched before a tap was confirmed would undo that tap's count
  // on screen; such a reply is ignored. See onSent below.
  const lastSentAt = useRef(0)

  // Outlier / fluke prompt
  const [outlierFlags, setOutlierFlags] = useState<OutlierFlag[]>([])
  const [outlierExpanded, setOutlierExpanded] = useState(false)
  const [resolvingOutlierId, setResolvingOutlierId] = useState<number | null>(null)

  // Record-a-regular inline state
  const [regularsExpanded, setRegularsExpanded] = useState(false)
  const [loggingTotals, setLoggingTotals] = useState(false)
  const [visitRegId, setVisitRegId] = useState<number | null>(null)
  const [visitAmount, setVisitAmount] = useState('')
  const [recordingVisit, setRecordingVisit] = useState(false)

  const loadData = useCallback(async () => {
    if (!business) return
    const started = Date.now()
    try {
      const [prods, tod, regs, outlierRes] = await Promise.allSettled([
        api.products.list(),
        api.saleEvents.today(),
        api.regulars.list(),
        api.outliers.list(),
      ])
      if (prods.status === 'fulfilled') setProducts(prods.value)
      if (tod.status === 'fulfilled' && started >= lastSentAt.current) setSummary(tod.value)
      if (regs.status === 'fulfilled') setRegulars(regs.value)
      if (outlierRes.status === 'fulfilled') setOutlierFlags(outlierRes.value.flags)
      if (
        prods.status === 'rejected' &&
        tod.status === 'rejected'
      ) {
        const err = prods.reason as Error
        setDataError(err instanceof Error ? err.message : t('loadFailedBody'))
      } else {
        setDataError(null)
      }
    } finally {
      setInitialLoading(false)
    }
  }, [business])

  useFocusEffect(
    useCallback(() => {
      if (business) {
        void loadData()
      }
    }, [loadData, business])
  )

  const refreshSummary = useCallback(async () => {
    const started = Date.now()
    try {
      const tod = await api.saleEvents.today()
      if (started >= lastSentAt.current) setSummary(tod)
    } catch {
      // silent — optimistic count is still correct
    }
  }, [])

  // A tap confirmed by the server moves from "waiting" into today's count.
  const { onSent } = queue
  useEffect(() => onSent((sent, eventId) => {
    if (sent.businessId !== business?.id) return
    lastSentAt.current = Date.now()
    if (isoDateIn(new Date(sent.tappedAt), timeZone) === businessToday) {
      setSummary(s => withOneMore(s, sent.productId))
    }
    setLastTap(l => (l && l.key === sent.key ? { ...l, eventId } : l))
    void refreshSummary()
  }), [onSent, business?.id, timeZone, businessToday, refreshSummary])

  // Saved on the phone at once, then sent, so a tap is never lost to a
  // dropped connection. The count goes up straight away either way.
  const tap = (productId: number | null) => {
    setTapError(null)
    const saved = queue.add(productId)
    if (!saved) return
    setLastTap({
      key: saved.key,
      eventId: null,
      label: productId === null
        ? t('customer')
        : products.find(p => p.id === productId)?.name ?? t('customer'),
    })
  }

  const undoLast = async () => {
    if (!lastTap) return
    const { key, eventId } = lastTap
    setLastTap(null)
    if (queue.takeBack(key)) return      // never left the phone
    if (eventId === null) return
    try {
      await api.saleEvents.delete(eventId)
      void refreshSummary()
    } catch (e: unknown) {
      setTapError(e instanceof Error ? e.message : t('failedToSave'))
    }
  }

  const recordRegularVisit = async () => {
    if (!visitRegId) return
    const amount = visitAmount ? parseFloat(visitAmount) : undefined
    setRecordingVisit(true)
    try {
      const updated = await api.regulars.recordVisit(
        visitRegId,
        amount != null ? { amount_paid: amount } : {}
      )
      setRegulars(rs => rs.map(r => r.id === visitRegId ? updated : r))
      setVisitRegId(null)
      setVisitAmount('')
    } catch (e: unknown) {
      setTapError(e instanceof Error ? e.message : t('failedToRecordVisit'))
    } finally {
      setRecordingVisit(false)
    }
  }

  const resolveOutlier = async (
    id: number,
    action: 'keep' | 'excluded' | 'event' | 'ad' | 'recurring',
  ) => {
    setResolvingOutlierId(id)
    try {
      await api.dayRecords.resolveOutlier(id, action)
      setOutlierFlags(fs => fs.filter(f => f.day_record_id !== id))
      if (outlierFlags.length <= 1) setOutlierExpanded(false)
    } catch {
      // silent — flag stays visible
    } finally {
      setResolvingOutlierId(null)
    }
  }

  const displayCount = (productId: number | null): number => {
    const serverEntry = summary?.product_totals.find(t => t.product_id === productId)
    const serverCount = serverEntry ? Math.round(serverEntry.units) : 0
    return serverCount + (queue.waiting.get(productId) ?? 0)
  }

  const headerTotal = (summary?.total_taps ?? 0) + queue.waitingTotal

  // The business's own today, built at midday so no timezone offset can shift
  // the date when the label is formatted.
  const today = new Date(`${businessToday}T12:00:00`)
  // Follow the app language, not a hardcoded en-US — otherwise a Hebrew screen
  // shows an English date in the header. Bare language subtags are valid BCP-47.
  const dateLabel = (() => {
    try {
      return today.toLocaleDateString(lang, {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    } catch {
      return today.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    }
  })()

  if (bizLoading || (initialLoading && !summary)) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
        <AppHeader title={t('log')} />
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
        <AppHeader title={t('log')} />
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: c.danger }]}>{bizError ?? dataError}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: c.primary }]} onPress={() => void loadData()}>
            <Text style={[styles.retryText, { color: c.onPrimary }]}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const customerCount = displayCount(null)
  const visitingReg = visitRegId !== null ? regulars.find(r => r.id === visitRegId) : null

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
      <AppHeader
        title={t('log')}
        subtitle={dateLabel}
        rightExtra={
          <View style={styles.headerRight}>
            <Text style={[styles.headerTotalNum, { color: c.onPrimary }]}>{headerTotal}</Text>
            <Text style={[styles.headerTotalLabel, { color: c.onPrimarySub }]}>{t('tapsToday')}</Text>
          </View>
        }
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Simple language suggestion (shown once, non-blocking) ── */}
        {simpleModeNeverSet && !simpleMode && (
          <View style={[simpleBannerStyles.wrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={simpleBannerStyles.text}>
              <Text style={[simpleBannerStyles.title, { color: c.text }]}>{t('simpleModePromptTitle')}</Text>
              <Text style={[simpleBannerStyles.desc, { color: c.textMuted }]}>{t('simpleModePromptDesc')}</Text>
            </View>
            <View style={simpleBannerStyles.btns}>
              <TouchableOpacity
                onPress={() => setSimpleMode(true)}
                style={[simpleBannerStyles.onBtn, { backgroundColor: c.primary }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[simpleBannerStyles.onBtnText, { color: c.onPrimary }]}>{t('simpleModePromptOn')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSimpleMode(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[simpleBannerStyles.dismiss, { color: c.textMuted }]}>{t('simpleModePromptDismiss')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Tap error banner ── */}
        {tapError !== null && (
          <TouchableOpacity
            style={[styles.errorBanner, { backgroundColor: c.dangerBg }]}
            onPress={() => setTapError(null)}
            activeOpacity={0.8}
          >
            <Text style={[styles.errorBannerText, { color: c.danger }]}>{tapError}</Text>
            <Ionicons name="close-circle" size={18} color={c.danger} />
          </TouchableOpacity>
        )}

        {/* ── Taps waiting for a connection: calm, because nothing is lost ── */}
        {queue.waitingTotal > 0 && (
          <View
            style={[styles.waitingBanner, { backgroundColor: c.card, borderColor: c.border }]}
            accessibilityLiveRegion="polite"
          >
            <Ionicons name="cloud-upload-outline" size={18} color={c.textSub} />
            <Text style={[styles.waitingText, { color: c.textSub }]}>
              {t('tapsWaiting', { n: queue.waitingTotal })}
            </Text>
          </View>
        )}

        {/* ── Saved taps the server would not take, with its reason ── */}
        {queue.refused.length > 0 && (
          <TouchableOpacity
            style={[styles.errorBanner, { backgroundColor: c.dangerBg }]}
            onPress={queue.clearRefused}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={[styles.errorBannerText, { color: c.danger }]}>
              {t('tapsRefused', { n: queue.refused.length }) + ' ' +
                Array.from(new Set(queue.refused.map(r => r.message))).join(' ')}
            </Text>
            <Ionicons name="close-circle" size={18} color={c.danger} />
          </TouchableOpacity>
        )}

        {/* ── Outlier / fluke prompt ── */}
        {outlierFlags.length > 0 && (
          <View style={styles.outlierSection}>
            <TouchableOpacity
              style={styles.outlierToggle}
              onPress={() => setOutlierExpanded(e => !e)}
              activeOpacity={0.8}
            >
              <Ionicons name="warning-outline" size={18} color="#92400e" />
              <Text style={styles.outlierToggleText}>
                {outlierFlags.length === 1
                  ? t('unusualDaySingular')
                  : t('unusualDayPlural', { n: outlierFlags.length })}
              </Text>
              <Ionicons
                name={outlierExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#92400e"
              />
            </TouchableOpacity>

            {outlierExpanded && outlierFlags.map(flag => (
              <View key={flag.day_record_id} style={styles.outlierCard}>
                <Text style={styles.outlierMessage}>{outlierText(flag, t, lang)}</Text>
                <View style={styles.outlierBtns}>
                  {(
                    [
                      { action: 'event' as const, label: t('outlierResolveEvent') },
                      { action: 'ad' as const, label: t('outlierResolveAd') },
                      { action: 'recurring' as const, label: t('outlierResolveRecurring', { weekday: flag.weekday }) },
                      { action: 'excluded' as const, label: t('outlierResolveExclude') },
                      { action: 'keep' as const, label: t('outlierResolveKeep') },
                    ] as const
                  ).map(({ action, label }) => (
                    <TouchableOpacity
                      key={action}
                      style={[
                        styles.outlierActionBtn,
                        resolvingOutlierId === flag.day_record_id && { opacity: 0.5 },
                      ]}
                      onPress={() => void resolveOutlier(flag.day_record_id, action)}
                      disabled={resolvingOutlierId === flag.day_record_id}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.outlierActionText}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}

            {outlierExpanded && (
              <Text style={styles.outlierNote}>{t('outlierDownweightNote')}</Text>
            )}
          </View>
        )}

        {/* ── Customer button ── */}
        <Text style={[styles.sectionLabel, { color: c.textMuted }]}>{t('tapOncePerCustomer')}</Text>

        <TouchableOpacity
          style={[
            styles.customerBtn,
            { backgroundColor: c.primary },
          ]}
          onPress={() => tap(null)}
          activeOpacity={0.75}
        >
          <View style={styles.customerBtnLeft}>
            <Ionicons name="person-add" size={30} color={c.onPrimary} />
            <Text style={[styles.customerBtnLabel, { color: c.onPrimary }]}>{t('customer')}</Text>
          </View>
          <View style={styles.customerBtnRight}>
            <Text style={[styles.customerBtnCount, { color: c.onPrimary }]}>{customerCount}</Text>
            <Text style={[styles.customerBtnCountSub, { color: c.onPrimarySub }]}>{t('todayLabel')}</Text>
          </View>
        </TouchableOpacity>

        {/* ── Undo ── */}
        {lastTap !== null && (
          <TouchableOpacity style={styles.undoRow} onPress={() => void undoLast()}>
            <Ionicons name="arrow-undo-circle-outline" size={18} color={c.textSub} />
            <Text style={[styles.undoText, { color: c.textSub }]}>{t('undoLabel')}: {lastTap.label}</Text>
          </TouchableOpacity>
        )}

        {/* ── Products ── */}
        {products.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced, { color: c.textMuted }]}>
              {t('whatDidTheyBuy')}
            </Text>
            <View style={styles.productGrid}>
              {products.map(product => {
                const count = displayCount(product.id)
                return (
                  <TouchableOpacity
                    key={product.id}
                    style={[
                      styles.productBtn,
                      { width: productBtnWidth, backgroundColor: c.card, borderColor: c.border },
                    ]}
                    onPress={() => tap(product.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.productBtnName, { color: c.text }]} numberOfLines={2}>
                      {product.name}
                    </Text>
                    <Text style={[styles.productBtnCount, { color: c.primaryDark }]}>{count}</Text>
                    <Text style={[styles.productBtnUnit, { color: c.textMuted }]}>{product.unit}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </>
        )}

        {products.length === 0 && !initialLoading && (
          <View style={[styles.noProductsBox, { backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="cube-outline" size={32} color={c.textMuted} />
            <Text style={[styles.noProductsText, { color: c.textSub }]}>
              {t('noProductsYet')}
            </Text>
            <TouchableOpacity
              style={[styles.goToProductsBtn, { backgroundColor: c.primary }]}
              onPress={() => navigation.navigate('Manage' as never)}
              activeOpacity={0.8}
            >
              <Text style={[styles.goToProductsBtnText, { color: c.onPrimary }]}>
                {t('goToProducts')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── End-of-day totals ── the other way to log, for owners who count at
            closing rather than tapping. It used to live only under Manage → Past
            days, a history screen, five taps from here. */}
        <TouchableOpacity style={[styles.undoRow, { minHeight: 44 }]} onPress={() => setLoggingTotals(true)} accessibilityRole="button">
          <Ionicons name="create-outline" size={16} color={c.primary} />
          <Text style={[styles.undoText, { color: c.primary }]}>{t('logToday')}</Text>
        </TouchableOpacity>

        {/* ── Record a Regular ── */}
        <TouchableOpacity
          style={[styles.regularsToggle, { backgroundColor: c.primaryBg, borderColor: c.primary }]}
          onPress={() => setRegularsExpanded(e => !e)}
          activeOpacity={0.8}
        >
          <Ionicons
            name={regularsExpanded ? 'heart' : 'heart-outline'}
            size={18}
            color={c.primaryDark}
          />
          <Text style={[styles.regularsToggleText, { color: c.primaryDark }]}>
            {t('recordARegular')}
          </Text>
          <Ionicons
            name={regularsExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={c.primaryDark}
          />
        </TouchableOpacity>

        {regularsExpanded && (
          <View style={[styles.regularsPanel, { backgroundColor: c.card, borderColor: c.border }]}>
            {/* Inline visit form */}
            {visitRegId !== null && visitingReg != null ? (
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <View style={styles.visitForm}>
                  <Text style={[styles.visitHint, { color: c.text }]}>
                    {t('howMuchDidSpend', { name: visitingReg.name })}
                  </Text>
                  <Text style={[styles.visitSub, { color: c.textSub }]}>
                    {t('leaveBlankForVisit')}
                  </Text>
                  <TextInput
                    style={[styles.visitInput, { backgroundColor: c.bg, borderColor: c.border, color: c.text }]}
                    value={visitAmount}
                    onChangeText={setVisitAmount}
                    keyboardType="decimal-pad"
                    placeholder={t('amountOptional')}
                    placeholderTextColor={c.textMuted}
                    autoFocus
                  />
                  <View style={styles.visitBtns}>
                    <TouchableOpacity
                      style={[styles.visitCancelBtn, { backgroundColor: c.bg, borderColor: c.border }]}
                      onPress={() => { setVisitRegId(null); setVisitAmount('') }}
                    >
                      <Text style={[styles.visitCancelText, { color: c.textSub }]}>{t('cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.visitConfirmBtn, { backgroundColor: c.primary }, recordingVisit && { opacity: 0.6 }]}
                      onPress={() => void recordRegularVisit()}
                      disabled={recordingVisit}
                    >
                      {recordingVisit
                        ? <ActivityIndicator size="small" color={c.onPrimary} />
                        : <Text style={[styles.visitConfirmText, { color: c.onPrimary }]}>{t('recordVisit')}</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            ) : regulars.length === 0 ? (
              <View style={styles.noRegularsBox}>
                <Ionicons name="heart-outline" size={24} color={c.textMuted} />
                <Text style={[styles.noRegularsText, { color: c.textSub }]}>{t('noRegularsHint')}</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.regularsPanelHint, { color: c.textMuted }]}>{t('recordRegularHint')}</Text>
                {regulars.map(reg => (
                  <TouchableOpacity
                    key={reg.id}
                    style={[styles.regularRow, { borderBottomColor: c.border }]}
                    onPress={() => {
                      setVisitRegId(reg.id)
                      setVisitAmount(reg.today_amount != null ? String(reg.today_amount) : '')
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.regularRowLeft}>
                      <Text style={[styles.regularRowName, { color: c.text }]}>{reg.name}</Text>
                      {reg.today_amount != null && (
                        <Text style={[styles.regularRowToday, { color: c.primaryDark }]}>
                          {t('todayAmount', { currency: symbol, amount: amount(reg.today_amount) })}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.regularRowBtn, { backgroundColor: c.primaryBg }]}>
                      <Ionicons name="add-circle-outline" size={20} color={c.primary} />
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
      {loggingTotals && (
        <PastDaysModal startAdding onClose={() => { setLoggingTotals(false); void loadData() }} />
      )}
    </SafeAreaView>
  )
}

const simpleBannerStyles = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12, gap: 10 },
  text: { gap: 3 },
  title: { fontSize: 13, fontWeight: '700' },
  desc: { fontSize: 12, lineHeight: 17 },
  btns: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  onBtnText: { fontSize: 12, fontWeight: '700' },
  dismiss: { fontSize: 12 },
})

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1 },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 36 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    loadingText: { marginTop: 14, textAlign: 'center', fontSize: 13, maxWidth: 260 },
    errorText: { fontSize: 14, textAlign: 'center', marginBottom: 16 },
    retryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
    retryText: { fontWeight: '600', fontSize: 14 },

    errorBanner: {
      borderRadius: 10, padding: 12, flexDirection: 'row',
      justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
    },
    errorBannerText: { fontSize: 13, flex: 1, marginRight: 8 },
    waitingBanner: {
      borderRadius: 10, borderWidth: 1, padding: 12, flexDirection: 'row',
      alignItems: 'center', gap: 8, marginBottom: 14,
    },
    waitingText: { fontSize: 13, flex: 1, lineHeight: 19 },

    headerRight: { alignItems: 'flex-end' },
    headerTotalNum: { fontSize: 30, fontWeight: '700', lineHeight: 34 },
    headerTotalLabel: { fontSize: 11 },

    sectionLabel: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: 0.8, marginBottom: 10,
    },
    sectionLabelSpaced: { marginTop: 26 },

    customerBtn: {
      borderRadius: 18, paddingVertical: 22, paddingHorizontal: 24,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      minHeight: 96, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.18, shadowRadius: 8, elevation: 5,
    },
    customerBtnLeft: { alignItems: 'flex-start', gap: 6 },
    customerBtnLabel: { fontSize: 22, fontWeight: '700' },
    customerBtnRight: { alignItems: 'flex-end' },
    customerBtnCount: { fontSize: 48, fontWeight: '700', lineHeight: 52 },
    customerBtnCountSub: { fontSize: 11 },

    undoRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 10, gap: 5 },
    undoText: { fontSize: 13 },

    productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    productBtn: {
      borderRadius: 16, padding: 16, minHeight: 104, justifyContent: 'space-between',
      borderWidth: 1.5, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    },
    productBtnName: { fontSize: 15, fontWeight: '600' },
    productBtnCount: { fontSize: 34, fontWeight: '700' },
    productBtnUnit: { fontSize: 11, marginTop: 2 },

    noProductsBox: {
      marginTop: 24, borderRadius: 16, padding: 24,
      alignItems: 'center', gap: 12, borderWidth: 1,
    },
    noProductsText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
    goToProductsBtn: {
      borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 4,
    },
    goToProductsBtnText: { fontSize: 14, fontWeight: '700' },

    // Outlier prompt
    outlierSection: {
      backgroundColor: '#fffbeb', borderRadius: 14, marginBottom: 16,
      borderWidth: 1, borderColor: '#fcd34d', overflow: 'hidden',
    },
    outlierToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 12, paddingHorizontal: 14,
    },
    outlierToggleText: {
      flex: 1, fontSize: 14, fontWeight: '700', color: '#92400e',
    },
    outlierCard: {
      borderTopWidth: 1, borderTopColor: '#fde68a',
      paddingHorizontal: 14, paddingVertical: 12,
    },
    outlierMessage: {
      fontSize: 13, color: '#78350f', lineHeight: 20, marginBottom: 10,
    },
    outlierBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    outlierActionBtn: {
      backgroundColor: '#fef3c7', borderRadius: 8, borderWidth: 1, borderColor: '#fcd34d',
      paddingVertical: 7, paddingHorizontal: 10,
    },
    outlierActionText: { fontSize: 12, fontWeight: '600', color: '#92400e' },
    outlierNote: {
      fontSize: 11, color: '#a16207', paddingHorizontal: 14, paddingBottom: 10,
      lineHeight: 16,
    },

    // Record-a-regular section
    regularsToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16,
      borderWidth: 1, marginTop: 24,
    },
    regularsToggleText: { flex: 1, fontSize: 15, fontWeight: '700' },

    regularsPanel: {
      borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginTop: 6,
    },
    regularsPanelHint: {
      fontSize: 11, fontWeight: '600', textTransform: 'uppercase',
      letterSpacing: 0.7, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4,
    },
    regularRow: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
      paddingVertical: 12, borderBottomWidth: 1, gap: 12,
    },
    regularRowLeft: { flex: 1, gap: 2 },
    regularRowName: { fontSize: 15, fontWeight: '600' },
    regularRowToday: { fontSize: 11, fontWeight: '600' },
    regularRowBtn: { borderRadius: 8, padding: 6 },

    noRegularsBox: { padding: 20, alignItems: 'center', gap: 8 },
    noRegularsText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },

    // Inline visit form
    visitForm: { padding: 16, gap: 10 },
    visitHint: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
    visitSub: { fontSize: 12, lineHeight: 18 },
    visitInput: {
      borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 16, fontWeight: '600',
    },
    visitBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
    visitCancelBtn: {
      flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center',
      borderWidth: 1,
    },
    visitCancelText: { fontSize: 14, fontWeight: '600' },
    visitConfirmBtn: {
      flex: 2, borderRadius: 10, paddingVertical: 13, alignItems: 'center',
    },
    visitConfirmText: { fontSize: 14, fontWeight: '700' },
  })
}
