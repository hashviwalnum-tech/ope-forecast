import { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../api/client'
import type { ProductRead, TodaySummaryResponse } from '../api/types'
import { useBusiness } from '../contexts/BusinessContext'
import { useTheme, type Theme } from '../lib/theme'

const KEY_CUSTOMER = 'customer'
const tapKey = (productId: number | null) =>
  productId === null ? KEY_CUSTOMER : String(productId)

export default function LogScreen() {
  const { business, loading: bizLoading, error: bizError } = useBusiness()
  const c = useTheme()
  const { width: screenWidth } = useWindowDimensions()
  const productBtnWidth = Math.floor((screenWidth - 32 - 10) / 2)
  const styles = useMemo(() => makeStyles(c), [c])

  const [products, setProducts] = useState<ProductRead[]>([])
  const [summary, setSummary] = useState<TodaySummaryResponse | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [pending, setPending] = useState<Record<string, number>>({})
  const [lastTapId, setLastTapId] = useState<number | null>(null)
  const [lastTapLabel, setLastTapLabel] = useState('')
  const [tappingKey, setTappingKey] = useState<string | null>(null)
  const [tapError, setTapError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!business) return
    try {
      const [prods, tod] = await Promise.all([
        api.products.list(),
        api.saleEvents.today(),
      ])
      setProducts(prods)
      setSummary(tod)
      setDataError(null)
    } catch (e: unknown) {
      setDataError(e instanceof Error ? e.message : 'Failed to load.')
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
    try {
      const tod = await api.saleEvents.today()
      setSummary(tod)
    } catch {
      // silent — optimistic count is still correct
    }
  }, [])

  const tap = async (productId: number | null) => {
    const key = tapKey(productId)
    setTappingKey(key)
    setPending(p => ({ ...p, [key]: (p[key] ?? 0) + 1 }))
    setTapError(null)
    try {
      const event = await api.saleEvents.create({ product_id: productId })
      setLastTapId(event.id)
      setLastTapLabel(
        productId === null
          ? 'customer'
          : products.find(p => p.id === productId)?.name ?? 'tap'
      )
      setPending(p => ({ ...p, [key]: Math.max(0, (p[key] ?? 0) - 1) }))
      void refreshSummary()
    } catch (e: unknown) {
      setPending(p => ({ ...p, [key]: Math.max(0, (p[key] ?? 0) - 1) }))
      setTapError(e instanceof Error ? e.message : 'Tap failed — please try again.')
    } finally {
      setTappingKey(null)
    }
  }

  const undoLast = async () => {
    if (!lastTapId) return
    const id = lastTapId
    setLastTapId(null)
    setLastTapLabel('')
    try {
      await api.saleEvents.delete(id)
      void refreshSummary()
    } catch (e: unknown) {
      setTapError(e instanceof Error ? e.message : 'Undo failed.')
    }
  }

  const displayCount = (productId: number | null): number => {
    const key = tapKey(productId)
    const serverEntry = summary?.product_totals.find(t => t.product_id === productId)
    const serverCount = serverEntry ? Math.round(serverEntry.units) : 0
    return serverCount + (pending[key] ?? 0)
  }

  const headerTotal =
    (summary?.total_taps ?? 0) + Object.values(pending).reduce((s, v) => s + v, 0)

  const today = new Date()
  const dateLabel = today.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  if (bizLoading || (initialLoading && !summary)) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Log</Text>
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
          <Text style={styles.headerTitle}>Log</Text>
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

  const customerCount = displayCount(null)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Log</Text>
          <Text style={styles.headerSub}>{dateLabel}</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.headerTotalNum}>{headerTotal}</Text>
          <Text style={styles.headerTotalLabel}>taps today</Text>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Tap error banner ── */}
        {tapError !== null && (
          <TouchableOpacity
            style={styles.errorBanner}
            onPress={() => setTapError(null)}
            activeOpacity={0.8}
          >
            <Text style={styles.errorBannerText}>{tapError}</Text>
            <Ionicons name="close-circle" size={18} color={c.danger} />
          </TouchableOpacity>
        )}

        {/* ── Customer button ── */}
        <Text style={styles.sectionLabel}>Tap once for each customer</Text>

        <TouchableOpacity
          style={[
            styles.customerBtn,
            tappingKey === KEY_CUSTOMER && styles.customerBtnPressed,
          ]}
          onPress={() => void tap(null)}
          activeOpacity={0.75}
        >
          <View style={styles.customerBtnLeft}>
            <Ionicons name="person-add" size={30} color={c.onPrimary} />
            <Text style={styles.customerBtnLabel}>Customer</Text>
          </View>
          <View style={styles.customerBtnRight}>
            <Text style={styles.customerBtnCount}>{customerCount}</Text>
            <Text style={styles.customerBtnCountSub}>today</Text>
          </View>
        </TouchableOpacity>

        {/* ── Undo ── */}
        {lastTapId !== null && (
          <TouchableOpacity style={styles.undoRow} onPress={() => void undoLast()}>
            <Ionicons name="arrow-undo-circle-outline" size={18} color={c.textSub} />
            <Text style={styles.undoText}>Undo: {lastTapLabel}</Text>
          </TouchableOpacity>
        )}

        {/* ── Products ── */}
        {products.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
              What did they buy?
            </Text>
            <View style={styles.productGrid}>
              {products.map(product => {
                const key = tapKey(product.id)
                const count = displayCount(product.id)
                return (
                  <TouchableOpacity
                    key={product.id}
                    style={[
                      styles.productBtn,
                      { width: productBtnWidth },
                      tappingKey === key && styles.productBtnPressed,
                    ]}
                    onPress={() => void tap(product.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.productBtnName} numberOfLines={2}>
                      {product.name}
                    </Text>
                    <Text style={styles.productBtnCount}>{count}</Text>
                    <Text style={styles.productBtnUnit}>{product.unit}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </>
        )}

        {products.length === 0 && !initialLoading && (
          <View style={styles.noProductsBox}>
            <Ionicons name="cube-outline" size={32} color={c.textMuted} />
            <Text style={styles.noProductsText}>
              No products yet.{'\n'}Add them in the{' '}
              <Text style={styles.noProductsLink}>Manage</Text> tab to track what you sell.
            </Text>
          </View>
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
    headerRight: { alignItems: 'flex-end' },
    headerTotalNum: { fontSize: 30, fontWeight: '700', color: c.onPrimary, lineHeight: 34 },
    headerTotalLabel: { fontSize: 11, color: c.onPrimarySub },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 36 },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    loadingText: {
      marginTop: 14,
      color: c.textSub,
      textAlign: 'center',
      fontSize: 13,
      maxWidth: 260,
    },
    errorText: {
      color: c.danger,
      fontSize: 14,
      textAlign: 'center',
      marginBottom: 16,
    },
    retryBtn: {
      backgroundColor: c.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 20,
    },
    retryText: { color: c.onPrimary, fontWeight: '600', fontSize: 14 },

    errorBanner: {
      backgroundColor: c.dangerBg,
      borderRadius: 10,
      padding: 12,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    errorBannerText: { color: c.danger, fontSize: 13, flex: 1, marginRight: 8 },

    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 10,
    },
    sectionLabelSpaced: { marginTop: 26 },

    customerBtn: {
      backgroundColor: c.primary,
      borderRadius: 18,
      paddingVertical: 22,
      paddingHorizontal: 24,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 96,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 5,
    },
    customerBtnPressed: { opacity: 0.82 },
    customerBtnLeft: { alignItems: 'flex-start', gap: 6 },
    customerBtnLabel: { fontSize: 22, fontWeight: '700', color: c.onPrimary },
    customerBtnRight: { alignItems: 'flex-end' },
    customerBtnCount: {
      fontSize: 48,
      fontWeight: '700',
      color: c.onPrimary,
      lineHeight: 52,
    },
    customerBtnCountSub: { fontSize: 11, color: c.onPrimarySub },

    undoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      marginTop: 10,
      gap: 5,
    },
    undoText: { fontSize: 13, color: c.textSub },

    productGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    productBtn: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 16,
      minHeight: 104,
      justifyContent: 'space-between',
      borderWidth: 1.5,
      borderColor: c.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 2,
    },
    productBtnPressed: {
      borderColor: c.primary,
      opacity: 0.82,
    },
    productBtnName: {
      fontSize: 15,
      fontWeight: '600',
      color: c.text,
    },
    productBtnCount: {
      fontSize: 34,
      fontWeight: '700',
      color: c.primaryDark,
    },
    productBtnUnit: {
      fontSize: 11,
      color: c.textMuted,
      marginTop: 2,
    },

    noProductsBox: {
      marginTop: 24,
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 24,
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    noProductsText: {
      color: c.textSub,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 22,
    },
    noProductsLink: {
      fontWeight: '700',
      color: c.primaryDark,
    },
  })
}
