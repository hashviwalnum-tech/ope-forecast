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
import type { PeriodCreate, PeriodRead, ProductRead } from '../../api/types'
import { useCurrency } from '../../contexts/CurrencyContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'

interface Props { onClose: () => void }

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return !isNaN(new Date(s).getTime())
}

export default function PeriodsModal({ onClose }: Props) {
  const { symbol, parseNumber } = useCurrency()
  const c = useTheme()
  const { t } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

  const [periods, setPeriods] = useState<PeriodRead[]>([])
  const [products, setProducts] = useState<ProductRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<'event' | 'ad'>('event')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [cost, setCost] = useState('')
  const [targetProductId, setTargetProductId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [p, prods] = await Promise.all([api.periods.list(), api.products.list()])
      setPeriods([...p].sort((a, b) => b.start_date.localeCompare(a.start_date)))
      setProducts(prods)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoad'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData() }, [])

  const openAdd = () => {
    setLabel('')
    setType('event')
    setStartDate(todayStr())
    setEndDate(todayStr())
    setCost('')
    setTargetProductId(null)
    setSaveError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setSaveError(null)
  }

  const save = async () => {
    if (!label.trim()) { setSaveError(t('periodName') + ' is required.'); return }
    if (!isValidDate(startDate)) { setSaveError('Enter a valid start date (YYYY-MM-DD).'); return }
    if (!isValidDate(endDate)) { setSaveError('Enter a valid end date (YYYY-MM-DD).'); return }
    if (endDate < startDate) { setSaveError('End date must be on or after start date.'); return }

    const costNum = cost.trim() ? (parseNumber(cost) ?? NaN) : undefined
    if (costNum !== undefined && (isNaN(costNum) || costNum < 0)) {
      setSaveError('Cost must be a positive number.'); return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const body: PeriodCreate = {
        label: label.trim(),
        type,
        start_date: startDate,
        end_date: endDate,
        ...(costNum !== undefined ? { cost: costNum } : {}),
        ...(targetProductId !== null ? { target_product_id: targetProductId } : {}),
      }
      const created = await api.periods.create(body)
      setPeriods(ps => [created, ...ps].sort((a, b) => b.start_date.localeCompare(a.start_date)))
      closeForm()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  const deletePeriod = (id: number, lbl: string) => {
    Alert.alert(
      t('delete'),
      `Delete "${lbl}"?`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'), style: 'destructive',
          onPress: async () => {
            try {
              await api.periods.delete(id)
              setPeriods(ps => ps.filter(p => p.id !== id))
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : t('failedToDelete'))
            }
          },
        },
      ]
    )
  }

  const productName = (id: number) =>
    products.find(p => p.id === id)?.name ?? `Product #${id}`

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
            {showForm ? t('addPeriod') : t('adsEvents')}
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
                : <Text style={styles.saveBtnText}>{t('save')}</Text>}
            </TouchableOpacity>
          )}
        </View>

        {/* ── Create form ── */}
        {showForm && (
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

              <Text style={styles.fieldLabel}>{t('periodName')} *</Text>
              <TextInput
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder={t('periodNamePlaceholder')}
                placeholderTextColor={c.textMuted}
                autoCapitalize="sentences"
                autoFocus
              />

              <Text style={styles.fieldLabel}>{t('periodType')}</Text>
              <View style={styles.typeRow}>
                {(['event', 'ad'] as const).map(tp => (
                  <TouchableOpacity
                    key={tp}
                    style={[styles.typeChip, type === tp && styles.typeChipActive]}
                    onPress={() => setType(tp)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.typeChipText, type === tp && styles.typeChipTextActive]}>
                      {tp === 'event' ? t('event') : t('ad')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t('startDate')} (YYYY-MM-DD) *</Text>
              <TextInput
                style={styles.input}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="2026-01-15"
                placeholderTextColor={c.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.fieldLabel}>{t('endDate')} (YYYY-MM-DD) *</Text>
              <TextInput
                style={styles.input}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="2026-01-15"
                placeholderTextColor={c.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.fieldLabel}>{t('costOptional')} ({symbol})</Text>
              <TextInput
                style={styles.input}
                value={cost}
                onChangeText={setCost}
                placeholder="e.g. 200"
                placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={styles.fieldLabel}>{t('targetProduct')}</Text>
              <Text style={styles.fieldHint}>{t('targetProductHint')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.productPicker}
              >
                <TouchableOpacity
                  style={[styles.productChip, targetProductId === null && styles.productChipActive]}
                  onPress={() => setTargetProductId(null)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.productChipText, targetProductId === null && styles.productChipTextActive]}>
                    {t('allCustomers')}
                  </Text>
                </TouchableOpacity>
                {products.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.productChip, targetProductId === p.id && styles.productChipActive]}
                    onPress={() => setTargetProductId(p.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.productChipText, targetProductId === p.id && styles.productChipTextActive]}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {/* ── Period list ── */}
        {!showForm && (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={c.primary} />
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => void loadData()}>
                  <Text style={styles.retryText}>{t('retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : periods.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="megaphone-outline" size={36} color={c.textMuted} />
                <Text style={styles.emptyTitle}>{t('noPeriodsYet')}</Text>
                <Text style={styles.emptyText}>{t('noPeriodsDesc')}</Text>
                <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
                  <Text style={styles.emptyAddBtnText}>{t('addPeriod')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              periods.map(period => (
                <View key={period.id} style={styles.periodCard}>
                  <View style={styles.periodTop}>
                    <View style={[
                      styles.typeBadge,
                      period.type === 'event' ? styles.typeBadgeEvent : styles.typeBadgeAd,
                    ]}>
                      <Text style={[
                        styles.typeBadgeText,
                        period.type === 'event' ? styles.typeBadgeTextEvent : styles.typeBadgeTextAd,
                      ]}>
                        {period.type === 'event' ? t('event') : t('ad')}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => deletePeriod(period.id, period.label)}
                      hitSlop={8}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={18} color={c.danger} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.periodLabel}>{period.label}</Text>
                  <Text style={styles.periodDates}>
                    {period.start_date}
                    {period.start_date !== period.end_date ? ` – ${period.end_date}` : ''}
                  </Text>
                  {period.cost != null && (
                    <Text style={styles.periodMeta}>Cost: ${period.cost}</Text>
                  )}
                  {period.target_product_id != null && (
                    <Text style={styles.periodMeta}>
                      {t('targetProduct')}: {productName(period.target_product_id)}
                    </Text>
                  )}
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

    periodCard: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 8,
      borderWidth: 1, borderColor: c.border,
    },
    periodTop: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: 6,
    },
    typeBadge: {
      borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8,
    },
    typeBadgeEvent: { backgroundColor: '#f3e8ff' },
    typeBadgeAd: { backgroundColor: '#e0f2fe' },
    typeBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
    typeBadgeTextEvent: { color: '#7c3aed' },
    typeBadgeTextAd: { color: '#0369a1' },
    deleteBtn: { padding: 4 },
    periodLabel: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 2 },
    periodDates: { fontSize: 12, color: c.textMuted, marginBottom: 2 },
    periodMeta: { fontSize: 12, color: c.textSub },

    // Form styles
    fieldLabel: {
      fontSize: 13, fontWeight: '600', color: c.text, marginTop: 16, marginBottom: 6,
    },
    fieldHint: { fontSize: 11, color: c.textMuted, marginTop: -3, marginBottom: 6, lineHeight: 16 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: c.text,
    },
    typeRow: { flexDirection: 'row', gap: 10 },
    typeChip: {
      flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
      borderWidth: 1, borderColor: c.border, backgroundColor: c.card,
    },
    typeChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    typeChipText: { fontSize: 14, fontWeight: '600', color: c.textSub },
    typeChipTextActive: { color: c.onPrimary },
    productPicker: { marginBottom: 4 },
    productChip: {
      backgroundColor: c.card, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
      borderWidth: 1, borderColor: c.border, marginRight: 8,
    },
    productChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    productChipText: { fontSize: 13, color: c.text, fontWeight: '600' },
    productChipTextActive: { color: c.onPrimary },
  })
}
