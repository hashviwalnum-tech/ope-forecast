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
import type { ProductRead, ServiceConsumableRead } from '../../api/types'
import { useCurrency } from '../../contexts/CurrencyContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'

interface Props {
  onClose: () => void
}

const EMPTY_FORM = {
  // A service (a massage, a haircut) is performed, not held: no stock, no
  // deliveries, never "reorder". It may use up stocked supplies, linked below.
  productType: 'stocked' as 'stocked' | 'service',
  name: '', unit: '', unitMode: 'whole' as 'whole' | 'decimal', leadTime: '1',
  price: '', stock: '', serviceTime: '', capacity: '', shelfLife: '',
}

export default function ProductsModal({ onClose }: Props) {
  const { symbol, parseNumber, money } = useCurrency()
  const c = useTheme()
  const { t } = useLanguage()
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

  // Supplies for the service being edited
  const [supplies, setSupplies] = useState<ServiceConsumableRead[]>([])
  const [supplyPick, setSupplyPick] = useState<number | null>(null)
  const [supplyQty, setSupplyQty] = useState('')
  const [supplyBusy, setSupplyBusy] = useState(false)
  const [supplyError, setSupplyError] = useState<string | null>(null)
  const isService = form.productType === 'service'
  const supplyChoices = products.filter(p =>
    p.product_type !== 'service' && p.id !== editId &&
    !supplies.some(sp => sp.consumable_product_id === p.id))

  const loadProducts = async () => {
    setLoading(true)
    try {
      const data = await api.products.list()
      setProducts(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailedBody'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadProducts() }, [])

  const resetSupplies = () => {
    setSupplies([]); setSupplyPick(null); setSupplyQty(''); setSupplyError(null)
  }

  const loadSupplies = async (id: number) => {
    try {
      setSupplies(await api.products.listConsumables(id))
    } catch {
      setSupplies([])
    }
  }

  const openAdd = () => {
    setEditId(null)
    setForm(EMPTY_FORM)
    resetSupplies()
    setShowOptional(false)
    setSaveError(null)
    setShowForm(true)
  }

  const openEdit = (p: ProductRead) => {
    setEditId(p.id)
    const hasOptional = p.price != null || p.current_stock != null ||
      p.service_time_minutes != null || p.storage_capacity != null || p.shelf_life_days != null
    resetSupplies()
    if (p.product_type === 'service') void loadSupplies(p.id)
    setForm({
      productType: p.product_type === 'service' ? 'service' : 'stocked',
      name: p.name,
      unit: p.unit,
      unitMode: p.unit_mode,
      // A service has no delivery time; keep a sensible default in case the
      // owner switches it to a stocked product.
      leadTime: p.lead_time_days != null ? String(p.lead_time_days) : '1',
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
    if (!form.name.trim()) { setSaveError(t('prNameRequired')); return }
    if (!form.unit.trim()) { setSaveError(t('prUnitRequired')); return }
    const lt = parseInt(form.leadTime, 10)
    // The server requires at least one day for a stocked product; checking 0
    // here only let the save fail later with a less helpful message.
    if (!isService && (isNaN(lt) || lt < 1)) { setSaveError(t('prLeadTimeMin')); return }

    setSaving(true)
    setSaveError(null)
    try {
      const body = {
        product_type: form.productType,
        name: form.name.trim(),
        unit: form.unit.trim(),
        unit_mode: form.unitMode,
        lead_time_days: isService ? null : lt,
        // Read in the owner's language: parseFloat only understands a dot,
        // so "3,50" typed on a comma-decimal keyboard became 350.
        ...(form.price ? { price: parseNumber(form.price) ?? undefined } : {}),
        ...(form.serviceTime ? { service_time_minutes: parseNumber(form.serviceTime) ?? undefined } : {}),
        // Stock, storage and shelf life belong to things that are held.
        ...(!isService && form.stock ? { current_stock: parseNumber(form.stock) ?? undefined } : {}),
        ...(!isService && form.capacity ? { storage_capacity: parseNumber(form.capacity) ?? undefined } : {}),
        ...(!isService && form.shelfLife ? { shelf_life_days: parseInt(form.shelfLife, 10) } : {}),
      }
      if (editId !== null) {
        const updated = await api.products.update(editId, body)
        setProducts(ps => ps.map(p => p.id === editId ? updated : p))
        closeForm()
      } else {
        const created = await api.products.create(body)
        setProducts(ps => [...ps, created])
        if (created.product_type === 'service') {
          // Stay open on the saved service, so the owner is asked about the
          // supplies it uses straight away rather than having to come back.
          setEditId(created.id)
        } else {
          closeForm()
        }
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  const addSupply = async () => {
    if (editId === null) return
    if (supplyPick === null) { setSupplyError(t('consumableChoosePrompt')); return }
    const qty = parseNumber(supplyQty)
    if (qty === null || qty <= 0) { setSupplyError(t('consumableQtyPositive')); return }
    setSupplyBusy(true)
    setSupplyError(null)
    try {
      const link = await api.products.addConsumable(editId, { consumable_product_id: supplyPick, qty_per_performance: qty })
      setSupplies(ss => [...ss, link])
      setSupplyPick(null)
      setSupplyQty('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setSupplyError(/already linked/i.test(msg) ? t('consumableAlreadyLinked') : t('consumableAddFailed'))
    } finally {
      setSupplyBusy(false)
    }
  }

  const removeSupply = async (linkId: number) => {
    if (editId === null) return
    try {
      await api.products.deleteConsumable(editId, linkId)
      setSupplies(ss => ss.filter(x => x.id !== linkId))
    } catch (e) {
      setSupplyError(e instanceof Error ? e.message : t('failedToDelete'))
    }
  }

  const deleteProduct = (id: number, name: string) => {
    Alert.alert(
      t('deleteProductTitle'),
      t('deleteProductBody', { name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'), style: 'destructive',
          onPress: async () => {
            try {
              await api.products.delete(id)
              setProducts(ps => ps.filter(p => p.id !== id))
            } catch (e) {
              Alert.alert(t('errorTitle'), e instanceof Error ? e.message : t('failedToDelete'))
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
            <Text style={styles.backLabel}>{showForm ? t('cancel') : t('manage')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {showForm ? (editId ? t('prEditProduct') : t('addProductBtn')) : t('products')}
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
                : <Text style={styles.saveBtnText}>{t('save')}</Text>}
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

              <Text style={styles.fieldLabel}>{t('productTypeLabel')}</Text>
              <View style={styles.typeRow} accessibilityRole="radiogroup">
                {(['stocked', 'service'] as const).map(tp => {
                  const on = form.productType === tp
                  return (
                    <TouchableOpacity
                      key={tp}
                      style={[styles.typeChip, on && styles.typeChipOn]}
                      onPress={() => setForm(f => ({ ...f, productType: tp }))}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={tp === 'service' ? 'hand-left-outline' : 'cube-outline'}
                        size={18}
                        color={on ? c.onPrimary : c.textSub}
                      />
                      <Text style={[styles.typeChipText, on && styles.typeChipTextOn]}>
                        {tp === 'service' ? t('serviceProductLabel') : t('stockedGoodLabel')}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              <Text style={styles.fieldLabel}>{t('productNameLabel')} *</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={v => setForm(f => ({ ...f, name: v }))}
                placeholder={t('prNamePh')}
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>{t('prUnit')} *</Text>
              <TextInput
                style={styles.input}
                value={form.unit}
                onChangeText={v => setForm(f => ({ ...f, unit: v }))}
                placeholder={t('prUnitPh')}
                placeholderTextColor={c.textMuted}
              />

              {!isService && (
                <>
                  <Text style={styles.fieldLabel}>{t('prLeadTime')} *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.leadTime}
                    onChangeText={v => setForm(f => ({ ...f, leadTime: v }))}
                    keyboardType="number-pad"
                    placeholder="1"
                    placeholderTextColor={c.textMuted}
                  />
                </>
              )}

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('prDecimals')}</Text>
                  <Text style={styles.fieldHint}>{t('unitModeDesc')}</Text>
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
                  {showOptional ? t('prHideOptional') : t('prShowOptional')}
                </Text>
                <Ionicons
                  name={showOptional ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={c.primary}
                />
              </TouchableOpacity>

              {showOptional && (
                <>
                  <Text style={styles.fieldLabel}>{t('prPrice', { symbol })}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.price}
                    onChangeText={v => setForm(f => ({ ...f, price: v }))}
                    keyboardType="decimal-pad"
                  />

                  {!isService && (
                    <>
                      <Text style={styles.fieldLabel}>{t('prCurrentStock')}</Text>
                      <TextInput
                        style={styles.input}
                        value={form.stock}
                        onChangeText={v => setForm(f => ({ ...f, stock: v }))}
                        keyboardType="decimal-pad"
                        placeholder={t('prStockPh')}
                        placeholderTextColor={c.textMuted}
                      />
                    </>
                  )}

                  <Text style={styles.fieldLabel}>
                    {t('prServiceTime')}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={form.serviceTime}
                    onChangeText={v => setForm(f => ({ ...f, serviceTime: v }))}
                    keyboardType="decimal-pad"
                    placeholder={t('prServiceTimePh')}
                    placeholderTextColor={c.textMuted}
                  />

                  {!isService && (
                    <>
                      <Text style={styles.fieldLabel}>{t('prCapacity')}</Text>
                      <TextInput
                        style={styles.input}
                        value={form.capacity}
                        onChangeText={v => setForm(f => ({ ...f, capacity: v }))}
                        keyboardType="decimal-pad"
                        placeholder={t('prCapacityPh')}
                        placeholderTextColor={c.textMuted}
                      />

                      <Text style={styles.fieldLabel}>{t('prShelfLife')}</Text>
                      <TextInput
                        style={styles.input}
                        value={form.shelfLife}
                        onChangeText={v => setForm(f => ({ ...f, shelfLife: v }))}
                        keyboardType="number-pad"
                        placeholder={t('prShelfLifePh')}
                        placeholderTextColor={c.textMuted}
                      />
                    </>
                  )}
                </>
              )}

              {/* Supplies a service uses up. Optional: with none linked, Ope
                  says nothing about supplies for this service. */}
              {isService && (
                <View style={styles.suppliesBox}>
                  <Text style={styles.suppliesTitle}>{t('consumablesTitle')}</Text>
                  <Text style={styles.fieldHint}>{t('consumablesDesc')}</Text>
                  {editId === null ? (
                    <Text style={[styles.fieldHint, { marginTop: 8 }]}>{t('consumableSavedNote')}</Text>
                  ) : (
                    <>
                      {supplies.length === 0 && (
                        <Text style={[styles.fieldHint, { marginTop: 8 }]}>{t('noConsumables')}</Text>
                      )}
                      {supplies.map(sp => (
                        <View key={sp.id} style={styles.supplyRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.productName}>{sp.consumable_name}</Text>
                            <Text style={styles.productMeta}>
                              {t('consumableUsagePerService', { qty: sp.qty_per_performance, unit: sp.consumable_unit })}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => void removeSupply(sp.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('removeSupplyBtn')}: ${sp.consumable_name}`}
                            hitSlop={8}
                          >
                            <Ionicons name="close-circle-outline" size={20} color={c.danger} />
                          </TouchableOpacity>
                        </View>
                      ))}

                      {supplyChoices.length > 0 && (
                        <>
                          <Text style={styles.fieldLabel}>{t('consumableProductLabel')}</Text>
                          <View style={styles.chipWrap}>
                            {supplyChoices.map(sp => {
                              const on = supplyPick === sp.id
                              return (
                                <TouchableOpacity
                                  key={sp.id}
                                  style={[styles.supplyChip, on && styles.typeChipOn]}
                                  onPress={() => setSupplyPick(sp.id)}
                                  accessibilityRole="radio"
                                  accessibilityState={{ checked: on }}
                                >
                                  <Text style={[styles.typeChipText, on && styles.typeChipTextOn]}>{sp.name}</Text>
                                </TouchableOpacity>
                              )
                            })}
                          </View>
                          <Text style={styles.fieldLabel}>{t('qtyPerServiceLabel')}</Text>
                          <TextInput
                            style={styles.input}
                            value={supplyQty}
                            onChangeText={setSupplyQty}
                            keyboardType="decimal-pad"
                            accessibilityLabel={t('qtyPerServiceLabel')}
                          />
                          {supplyError && <Text style={styles.supplyError}>{supplyError}</Text>}
                          <TouchableOpacity
                            style={[styles.addSupplyBtn, supplyBusy && { opacity: 0.6 }]}
                            onPress={() => void addSupply()}
                            disabled={supplyBusy}
                            accessibilityRole="button"
                          >
                            <Ionicons name="add" size={18} color={c.primary} />
                            <Text style={styles.addSupplyText}>{t('addSupplyBtn')}</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </>
                  )}
                </View>
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
                  <Text style={styles.retryText}>{t('retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : products.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="cube-outline" size={36} color={c.textMuted} />
                <Text style={styles.emptyTitle}>{t('prNoProductsTitle')}</Text>
                <Text style={styles.emptyText}>
                  {t('prNoProductsDesc')}
                </Text>
                <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
                  <Text style={styles.emptyAddBtnText}>{t('addProductBtn')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              products.map(p => (
                <View key={p.id} style={styles.productRow}>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{p.name}</Text>
                    <Text style={styles.productMeta}>
                      {[
                        p.unit,
                        p.product_type === 'service' ? t('serviceTypeBadge') : null,
                        p.price != null ? money(p.price) : null,
                        p.product_type !== 'service' && p.current_stock != null
                          ? t('inStockSuffix', { qty: p.current_stock }) : null,
                      ].filter(Boolean).join(' · ')}
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
    typeRow: { gap: 8 },
    typeChip: {
      flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48,
      borderWidth: 1.5, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14,
      backgroundColor: c.card,
    },
    typeChipOn: { backgroundColor: c.primary, borderColor: c.primary },
    typeChipText: { fontSize: 14, color: c.text, flexShrink: 1 },
    typeChipTextOn: { color: c.onPrimary, fontWeight: '600' },
    suppliesBox: {
      marginTop: 20, borderWidth: 1, borderColor: c.border, borderRadius: 14,
      padding: 14, backgroundColor: c.card,
    },
    suppliesTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 2 },
    supplyRow: {
      flexDirection: 'row', alignItems: 'center', minHeight: 48,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    supplyChip: {
      minHeight: 44, justifyContent: 'center', borderWidth: 1.5, borderColor: c.border,
      borderRadius: 22, paddingHorizontal: 14, backgroundColor: c.bg,
    },
    supplyError: { color: c.danger, fontSize: 13, marginTop: 8 },
    addSupplyBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      minHeight: 48, marginTop: 12, borderRadius: 12, borderWidth: 1.5, borderColor: c.primary,
    },
    addSupplyText: { fontSize: 14, fontWeight: '700', color: c.primary },
  })
}

