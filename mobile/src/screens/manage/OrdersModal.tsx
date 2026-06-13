import { useState, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { OrderRecordRead, ProductRead } from '../../api/types'
import { useTheme, type Theme } from '../../lib/theme'

interface Props { onClose: () => void }

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  arrived: 'Arrived',
  cancelled: 'Cancelled',
}

export default function OrdersModal({ onClose }: Props) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const [orderRecords, setOrderRecords] = useState<OrderRecordRead[]>([])
  const [products, setProducts] = useState<ProductRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [ords, prods] = await Promise.all([
        api.orders.list(),
        api.products.list(),
      ])
      setOrderRecords(ords.sort((a, b) => b.ordered_date.localeCompare(a.ordered_date)))
      setProducts(prods)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData() }, [])

  const openAdd = () => {
    setSelectedProductId(products[0]?.id ?? null)
    setQuantity('')
    setSaveError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setSaveError(null)
  }

  const save = async () => {
    if (!selectedProductId) { setSaveError('Select a product.'); return }
    const qty = parseFloat(quantity)
    if (isNaN(qty) || qty <= 0) { setSaveError('Quantity must be greater than 0.'); return }

    setSaving(true)
    setSaveError(null)
    try {
      const created = await api.orders.create({
        product_id: selectedProductId,
        ordered_date: todayStr(),
        quantity: qty,
      })
      setOrderRecords(rs => [created, ...rs])
      closeForm()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to log order.')
    } finally {
      setSaving(false)
    }
  }

  const markArrived = async (id: number) => {
    try {
      const updated = await api.orders.update(id, { status: 'arrived' })
      setOrderRecords(rs => rs.map(r => r.id === id ? updated : r))
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update.')
    }
  }

  const cancelOrder = (id: number) => {
    Alert.alert(
      'Cancel Order',
      'Mark this order as cancelled?',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Order', style: 'destructive',
          onPress: async () => {
            try {
              await api.orders.cancel(id)
              setOrderRecords(rs => rs.filter(r => r.id !== id))
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to cancel.')
            }
          },
        },
      ]
    )
  }

  const productName = (productId: number) =>
    products.find(p => p.id === productId)?.name ?? `Product #${productId}`
  const productUnit = (productId: number) =>
    products.find(p => p.id === productId)?.unit ?? ''

  const pendingOrders = orderRecords.filter(r => r.status === 'pending')
  const otherOrders = orderRecords.filter(r => r.status !== 'pending')

  const handleBack = () => {
    if (showForm) { closeForm() } else { onClose() }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={handleBack}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>{showForm ? 'Cancel' : 'Manage'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {showForm ? 'Log Order' : 'Orders'}
          </Text>
          {!showForm && (
            <TouchableOpacity onPress={openAdd} style={styles.addBtn} hitSlop={8}>
              <Ionicons name="add" size={24} color={c.onPrimary} />
            </TouchableOpacity>
          )}
          {showForm && (
            <TouchableOpacity
              onPress={() => void save()}
              disabled={saving}
              style={styles.saveBtn}
              hitSlop={8}
            >
              {saving
                ? <ActivityIndicator size="small" color={c.onPrimary} />
                : <Text style={styles.saveBtnText}>Log</Text>}
            </TouchableOpacity>
          )}
        </View>

        {showForm ? (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {saveError && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{saveError}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>Product *</Text>
              {products.length === 0 ? (
                <Text style={styles.noProductsHint}>
                  No products yet. Add them first in the Products section.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.productPicker}>
                  {products.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[
                        styles.productChip,
                        selectedProductId === p.id && styles.productChipActive,
                      ]}
                      onPress={() => setSelectedProductId(p.id)}
                      activeOpacity={0.75}
                    >
                      <Text style={[
                        styles.productChipText,
                        selectedProductId === p.id && styles.productChipTextActive,
                      ]}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <Text style={styles.fieldLabel}>
                Quantity *
                {selectedProductId && (
                  <Text style={styles.unitHint}>
                    {' '}({productUnit(selectedProductId)})
                  </Text>
                )}
              </Text>
              <TextInput
                style={styles.input}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
                placeholder="e.g. 50"
                placeholderTextColor={c.textMuted}
              />
              <Text style={styles.fieldHint}>
                Arrival date is auto-set based on the product's lead time.
              </Text>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={c.primary} />
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => void loadData()}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {pendingOrders.length === 0 && otherOrders.length === 0 && (
                  <View style={styles.emptyBox}>
                    <Ionicons name="cube-outline" size={36} color={c.textMuted} />
                    <Text style={styles.emptyTitle}>No orders yet</Text>
                    <Text style={styles.emptyText}>
                      Tap + to log an order. Ope will track when it's due to arrive and adjust
                      your projected stock.
                    </Text>
                    <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
                      <Text style={styles.emptyAddBtnText}>Log Order</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {pendingOrders.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Pending</Text>
                    {pendingOrders.map(order => (
                      <View key={order.id} style={styles.orderCard}>
                        <View style={styles.orderInfo}>
                          <Text style={styles.orderProduct}>
                            {productName(order.product_id)}
                          </Text>
                          <Text style={styles.orderQty}>
                            {order.quantity} {productUnit(order.product_id)}
                          </Text>
                          <Text style={styles.orderDates}>
                            Ordered {order.ordered_date} ·{' '}
                            Expected {order.expected_arrival_date}
                          </Text>
                        </View>
                        <View style={styles.orderBtns}>
                          <TouchableOpacity
                            style={styles.arrivedBtn}
                            onPress={() => void markArrived(order.id)}
                            hitSlop={6}
                          >
                            <Ionicons name="checkmark-circle-outline" size={20} color={c.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.cancelBtn}
                            onPress={() => cancelOrder(order.id)}
                            hitSlop={6}
                          >
                            <Ionicons name="close-circle-outline" size={20} color={c.danger} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {otherOrders.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 20 }]}>History</Text>
                    {otherOrders.slice(0, 20).map(order => (
                      <View key={order.id} style={[styles.orderCard, styles.orderCardDim]}>
                        <View style={styles.orderInfo}>
                          <Text style={styles.orderProduct}>
                            {productName(order.product_id)}
                          </Text>
                          <Text style={styles.orderQty}>
                            {order.quantity} {productUnit(order.product_id)}
                          </Text>
                          <Text style={styles.orderDates}>
                            {order.ordered_date} · {STATUS_LABELS[order.status]}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      backgroundColor: c.headerBg, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 10,
      flexDirection: 'row', alignItems: 'center',
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 8 },
    backLabel: { fontSize: 14, color: c.onPrimary },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: c.onPrimary, textAlign: 'center' },
    addBtn: { padding: 4 },
    saveBtn: { paddingHorizontal: 4 },
    saveBtnText: { fontSize: 15, fontWeight: '700', color: c.onPrimary },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40 },
    center: { justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
    errorText: { color: c.danger, fontSize: 14, textAlign: 'center', marginBottom: 12 },
    retryBtn: {
      backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20,
    },
    retryText: { color: c.onPrimary, fontWeight: '600', fontSize: 14 },
    errorBanner: {
      backgroundColor: c.dangerBg, borderRadius: 10, padding: 12, marginBottom: 14,
    },
    errorBannerText: { color: c.danger, fontSize: 13 },

    emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 48 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    emptyText: {
      fontSize: 14, color: c.textSub, textAlign: 'center', maxWidth: 280, lineHeight: 20,
    },
    emptyAddBtn: {
      backgroundColor: c.primary, borderRadius: 12,
      paddingVertical: 12, paddingHorizontal: 28, marginTop: 8,
    },
    emptyAddBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },

    sectionLabel: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
    },
    orderCard: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 8,
      flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border,
    },
    orderCardDim: { opacity: 0.7 },
    orderInfo: { flex: 1, gap: 3 },
    orderProduct: { fontSize: 15, fontWeight: '700', color: c.text },
    orderQty: { fontSize: 14, color: c.primaryDark, fontWeight: '600' },
    orderDates: { fontSize: 11, color: c.textSub },
    orderBtns: { flexDirection: 'row', gap: 4 },
    arrivedBtn: { padding: 6 },
    cancelBtn: { padding: 6 },

    fieldLabel: {
      fontSize: 13, fontWeight: '600', color: c.text, marginTop: 14, marginBottom: 6,
    },
    unitHint: { fontSize: 12, color: c.textMuted, fontWeight: '400' },
    fieldHint: { fontSize: 11, color: c.textMuted, marginTop: 6 },
    noProductsHint: { fontSize: 13, color: c.textSub, marginBottom: 8 },

    productPicker: { marginBottom: 4 },
    productChip: {
      backgroundColor: c.card, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
      borderWidth: 1, borderColor: c.border, marginRight: 8,
    },
    productChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    productChipText: { fontSize: 13, color: c.text, fontWeight: '600' },
    productChipTextActive: { color: c.onPrimary },

    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: c.text,
    },
  })
}
