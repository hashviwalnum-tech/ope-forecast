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
  Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { ProductRead } from '../../api/types'
import { useTheme } from '../../contexts/ThemeContext'
import type { Theme } from '../../lib/theme'

interface Props {
  onClose: () => void
}

const EMPTY_FORM = {
  name: '', unit: '', unitMode: 'whole' as 'whole' | 'decimal', leadTime: '1',
  price: '', stock: '', serviceTime: '', capacity: '', shelfLife: '',
}

export default function ProductsModal({ onClose }: Props) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const [products, setProducts] = useState<ProductRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showOptional, setShowOptional] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadProducts = async () => {
    setLoading(true)
    try {
      const data = await api.products.list()
      setProducts(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load products.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadProducts() }, [])

  const openAdd = () => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowOptional(false)
    setSaveError(null)
    setShowForm(true)
  }

  const openEdit = (p: ProductRead) => {
    setEditId(p.id)
    const hasOptional = p.price != null || p.current_stock != null ||
      p.service_time_minutes != null || p.storage_capacity != null || p.shelf_life_days != null
    setForm({
      name: p.name,
      unit: p.unit,
      unitMode: p.unit_mode,
      leadTime: String(p.lead_time_days),
      price: p.price != null ? String(p.price) : '',
      stock: p.current_stock != null ? String(p.current_stock) : '',
      serviceTime: p.service_time_minutes != null ? String(p.service_time_minutes) : '',
      capacity: p.storage_capacity != null ? String(p.storage_capacity) : '',
      shelfLife: p.shelf_life_days != null ? String(p.shelf_life_days) : '',
    })
    setShowOptional(hasOptional)
    setSaveError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditId(null)
    setSaveError(null)
  }

  const save = async () => {
    if (!form.name.trim()) { setSaveError('Product name is required.'); return }
    if (!form.unit.trim()) { setSaveError('Unit is required (e.g. "kg", "cups", "items").'); return }
    const lt = parseInt(form.leadTime, 10)
    if (isNaN(lt) || lt < 0) { setSaveError('Lead time must be 0 or more days.'); return }

    setSaving(true)
    setSaveError(null)
    try {
      const body = {
        name: form.name.trim(),
        unit: form.unit.trim(),
        unit_mode: form.unitMode,
        lead_time_days: lt,
        ...(form.price ? { price: parseFloat(form.price) } : {}),
        ...(form.stock ? { current_stock: parseFloat(form.stock) } : {}),
        ...(form.serviceTime ? { service_time_minutes: parseFloat(form.serviceTime) } : {}),
        ...(form.capacity ? { storage_capacity: parseFloat(form.capacity) } : {}),
        ...(form.shelfLife ? { shelf_life_days: parseInt(form.shelfLife, 10) } : {}),
      }
      if (editId !== null) {
        const updated = await api.products.update(editId, body)
        setProducts(ps => ps.map(p => p.id === editId ? updated : p))
      } else {
        const created = await api.products.create(body)
        setProducts(ps => [...ps, created])
      }
      closeForm()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const deleteProduct = (id: number, name: string) => {
    Alert.alert(
      'Delete Product',
      `Delete "${name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await api.products.delete(id)
              setProducts(ps => ps.filter(p => p.id !== id))
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete.')
            }
          },
        },
      ]
    )
  }

  const handleBack = () => {
    if (showForm) { closeForm() } else { onClose() }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={handleBack}>
      <SafeAreaView style={styles.root} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>{showForm ? 'Cancel' : 'Manage'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {showForm ? (editId ? 'Edit Product' : 'Add Product') : 'Products'}
          </Text>
          {!showForm && (
            <TouchableOpacity onPress={openAdd} style={styles.addBtn} hitSlop={8}>
              <Ionicons name="add" size={24} color={c.onPrimary} />
            </TouchableOpacity>
          )}
          {showForm && (
            <TouchableOpacity
              onPress={() => void save()}
              style={styles.saveBtn}
              disabled={saving}
              hitSlop={8}
            >
              {saving
                ? <ActivityIndicator size="small" color={c.onPrimary} />
                : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          )}
        </View>

        {/* Body */}
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

              <Text style={styles.fieldLabel}>Product Name *</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={v => setForm(f => ({ ...f, name: v }))}
                placeholder="e.g. Croissant, Coffee, Roses"
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>Unit *</Text>
              <TextInput
                style={styles.input}
                value={form.unit}
                onChangeText={v => setForm(f => ({ ...f, unit: v }))}
                placeholder="e.g. items, kg, cups, bunch"
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>Lead Time (days) *</Text>
              <TextInput
                style={styles.input}
                value={form.leadTime}
                onChangeText={v => setForm(f => ({ ...f, leadTime: v }))}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={c.textMuted}
              />

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Count in decimals</Text>
                  <Text style={styles.fieldHint}>
                    Off = whole numbers only (items, cups). On = allow fractions (kg, L).
                  </Text>
                </View>
                <Switch
                  value={form.unitMode === 'decimal'}
                  onValueChange={v =>
                    setForm(f => ({ ...f, unitMode: v ? 'decimal' : 'whole' }))
                  }
                  trackColor={{ false: c.border, true: c.primary }}
                  thumbColor={c.card}
                />
              </View>

              <TouchableOpacity
                style={styles.optionalToggle}
                onPress={() => setShowOptional(v => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionalToggleText}>
                  {showOptional ? 'Hide optional details' : 'Show optional details'}
                </Text>
                <Ionicons
                  name={showOptional ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={c.primary}
                />
              </TouchableOpacity>

              {showOptional && (
                <>
                  <Text style={styles.fieldLabel}>Price (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={form.price}
                    onChangeText={v => setForm(f => ({ ...f, price: v }))}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 3.50"
                    placeholderTextColor={c.textMuted}
                  />

                  <Text style={styles.fieldLabel}>Current stock (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={form.stock}
                    onChangeText={v => setForm(f => ({ ...f, stock: v }))}
                    keyboardType="decimal-pad"
                    placeholder="How many you have right now"
                    placeholderTextColor={c.textMuted}
                  />

                  <Text style={styles.fieldLabel}>
                    Service time per customer (minutes, optional)
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={form.serviceTime}
                    onChangeText={v => setForm(f => ({ ...f, serviceTime: v }))}
                    keyboardType="decimal-pad"
                    placeholder="Overrides business default"
                    placeholderTextColor={c.textMuted}
                  />

                  <Text style={styles.fieldLabel}>Storage capacity (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={form.capacity}
                    onChangeText={v => setForm(f => ({ ...f, capacity: v }))}
                    keyboardType="decimal-pad"
                    placeholder="Max units that physically fit"
                    placeholderTextColor={c.textMuted}
                  />

                  <Text style={styles.fieldLabel}>Shelf life (days, optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={form.shelfLife}
                    onChangeText={v => setForm(f => ({ ...f, shelfLife: v }))}
                    keyboardType="number-pad"
                    placeholder="e.g. 3 (spoils after 3 days)"
                    placeholderTextColor={c.textMuted}
                  />
                </>
              )}
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
                <TouchableOpacity style={styles.retryBtn} onPress={() => void loadProducts()}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : products.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="cube-outline" size={36} color={c.textMuted} />
                <Text style={styles.emptyTitle}>No products yet</Text>
                <Text style={styles.emptyText}>
                  Tap + to add your first product.
                </Text>
                <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
                  <Text style={styles.emptyAddBtnText}>Add Product</Text>
                </TouchableOpacity>
              </View>
            ) : (
              products.map(p => (
                <View key={p.id} style={styles.productRow}>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{p.name}</Text>
                    <Text style={styles.productMeta}>
                      {p.unit} ֲ· {p.unit_mode === 'decimal' ? 'decimal' : 'whole'} ֲ·{' '}
                      lead {p.lead_time_days}d
                      {p.price != null ? ` ֲ· $${p.price}` : ''}
                      {p.current_stock != null ? ` ֲ· stock: ${p.current_stock}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => openEdit(p)}
                    hitSlop={8}
                  >
                    <Ionicons name="pencil-outline" size={18} color={c.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => deleteProduct(p.id, p.name)}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={c.danger} />
                  </TouchableOpacity>
                </View>
              ))
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
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
    errorText: { color: c.danger, fontSize: 14, textAlign: 'center', marginBottom: 12 },
    retryBtn: {
      backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20,
    },
    retryText: { color: c.onPrimary, fontWeight: '600', fontSize: 14 },

    errorBanner: {
      backgroundColor: c.dangerBg, borderRadius: 10, padding: 12, marginBottom: 14,
    },
    errorBannerText: { color: c.danger, fontSize: 13 },

    emptyBox: {
      alignItems: 'center', gap: 10, paddingVertical: 48,
    },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    emptyText: { fontSize: 14, color: c.textSub, textAlign: 'center' },
    emptyAddBtn: {
      backgroundColor: c.primary, borderRadius: 12,
      paddingVertical: 12, paddingHorizontal: 28, marginTop: 8,
    },
    emptyAddBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },

    productRow: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 8,
      flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border,
    },
    productInfo: { flex: 1, gap: 3 },
    productName: { fontSize: 15, fontWeight: '700', color: c.text },
    productMeta: { fontSize: 12, color: c.textSub },
    iconBtn: { padding: 8 },

    fieldLabel: {
      fontSize: 13, fontWeight: '600', color: c.text, marginTop: 14, marginBottom: 6,
    },
    fieldHint: { fontSize: 11, color: c.textMuted, marginTop: -4, marginBottom: 2 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: c.text,
    },
    switchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      marginTop: 14, paddingVertical: 8,
    },
    optionalToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginTop: 20, marginBottom: 4, alignSelf: 'flex-start',
    },
    optionalToggleText: { fontSize: 14, fontWeight: '600', color: c.primary },
  })
}

