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
import type { RegularProfitabilityRead, RegularRead } from '../../api/types'
import { useCurrency } from '../../contexts/CurrencyContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'
import type { TranslationKey } from '../../lib/i18n'

interface Props { onClose: () => void }

const EMPTY_FORM = {
  name: '', visitFreq: '1', avgSpend: '', lifespan: '3', notes: '',
}

const MONTH_KEYS: TranslationKey[] = [
  'monthJan', 'monthFeb', 'monthMar', 'monthApr', 'monthMay', 'monthJun',
  'monthJul', 'monthAug', 'monthSep', 'monthOct', 'monthNov', 'monthDec',
]

export default function RegularsModal({ onClose }: Props) {
  const c = useTheme()
  const { t } = useLanguage()
  // Bound to the business's currency: this screen used to hardcode a dollar
  // sign and two decimal places in six places.
  const { money } = useCurrency()
  const styles = useMemo(() => makeStyles(c), [c])

  const [regulars, setRegulars] = useState<RegularRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Visit recording
  const [visitRegularId, setVisitRegularId] = useState<number | null>(null)
  const [visitAmount, setVisitAmount] = useState('')
  const [recordingVisit, setRecordingVisit] = useState(false)

  // Profitability
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [profMap, setProfMap] = useState<Record<number, RegularProfitabilityRead>>({})
  const [loadingProfId, setLoadingProfId] = useState<number | null>(null)

  const loadRegulars = async () => {
    setLoading(true)
    try {
      const data = await api.regulars.list()
      setRegulars(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailedBody'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadRegulars() }, [])

  const openAdd = () => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setSaveError(null)
    setShowForm(true)
  }

  const openEdit = (r: RegularRead) => {
    setEditId(r.id)
    setForm({
      name: r.name,
      visitFreq: String(r.visit_frequency_per_week),
      avgSpend: String(r.avg_spend),
      lifespan: String(r.expected_lifespan_years),
      notes: r.notes ?? '',
    })
    setSaveError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditId(null)
    setSaveError(null)
  }

  const save = async () => {
    if (!form.name.trim()) { setSaveError(t('rgNameRequired')); return }
    const freq = parseFloat(form.visitFreq)
    if (isNaN(freq) || freq <= 0) { setSaveError(t('rgFreqPositive')); return }
    const spend = parseFloat(form.avgSpend)
    if (isNaN(spend) || spend < 0) { setSaveError(t('rgSpendMin')); return }
    const lifespan = parseFloat(form.lifespan)
    if (isNaN(lifespan) || lifespan <= 0) { setSaveError(t('rgLifespanPositive')); return }

    setSaving(true)
    setSaveError(null)
    try {
      const body = {
        name: form.name.trim(),
        visit_frequency_per_week: freq,
        avg_spend: spend,
        expected_lifespan_years: lifespan,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      }
      if (editId !== null) {
        const updated = await api.regulars.update(editId, body)
        setRegulars(rs => rs.map(r => r.id === editId ? updated : r))
      } else {
        const created = await api.regulars.create(body)
        setRegulars(rs => [...rs, created])
      }
      closeForm()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  const deleteRegular = (id: number, name: string) => {
    Alert.alert(
      t('deleteRegular'),
      t('deleteRegularConfirm', { name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'), style: 'destructive',
          onPress: async () => {
            try {
              await api.regulars.delete(id)
              setRegulars(rs => rs.filter(r => r.id !== id))
            } catch (e) {
              Alert.alert(t('errorTitle'), e instanceof Error ? e.message : t('failedToDelete'))
            }
          },
        },
      ]
    )
  }

  const startVisit = (id: number) => {
    const reg = regulars.find(r => r.id === id)
    setVisitAmount(reg?.today_amount != null ? String(reg.today_amount) : '')
    setVisitRegularId(id)
  }

  const recordVisit = async () => {
    if (!visitRegularId) return
    const amount = visitAmount ? parseFloat(visitAmount) : undefined
    setRecordingVisit(true)
    try {
      const updated = await api.regulars.recordVisit(
        visitRegularId,
        amount != null ? { amount_paid: amount } : {}
      )
      setRegulars(rs => rs.map(r => r.id === visitRegularId ? updated : r))
      setVisitRegularId(null)
      setVisitAmount('')
    } catch (e) {
      Alert.alert(t('errorTitle'), e instanceof Error ? e.message : t('failedToRecordVisit'))
    } finally {
      setRecordingVisit(false)
    }
  }

  const toggleProfitability = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (profMap[id]) return
    setLoadingProfId(id)
    try {
      const data = await api.regulars.profitability(id)
      setProfMap(m => ({ ...m, [id]: data }))
    } catch {
      // silent
    } finally {
      setLoadingProfId(null)
    }
  }

  const handleBack = () => {
    if (showForm) { closeForm() }
    else if (visitRegularId !== null) { setVisitRegularId(null) }
    else { onClose() }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={handleBack}>
      <SafeAreaView style={styles.root} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>
              {showForm ? t('cancel') : visitRegularId !== null ? t('cancel') : t('manage')}
            </Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {showForm
              ? (editId ? t('editRegular') : t('addRegular'))
              : visitRegularId !== null
                ? t('recordVisit')
                : t('regulars')}
          </Text>
          {!showForm && visitRegularId === null && (
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

        {/* Visit recording sheet */}
        {visitRegularId !== null && !showForm && (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.bodyContent}>
              <Text style={styles.visitHint}>
                {t('rgSpendQuestion', { name: regulars.find(r => r.id === visitRegularId)?.name ?? '' })}
              </Text>
              <Text style={styles.visitSub}>
                {t('rgVisitHint')}
              </Text>
              <TextInput
                style={styles.input}
                value={visitAmount}
                onChangeText={setVisitAmount}
                keyboardType="decimal-pad"
                placeholder={t('amountOptional')}
                placeholderTextColor={c.textMuted}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.primaryBtn, recordingVisit && { opacity: 0.6 }]}
                onPress={() => void recordVisit()}
                disabled={recordingVisit}
                activeOpacity={0.8}
              >
                {recordingVisit
                  ? <ActivityIndicator size="small" color={c.onPrimary} />
                  : <Text style={styles.primaryBtnText}>{t('recordVisit')}</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* Add / Edit form */}
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
              <Text style={styles.fieldLabel}>{t('nameLabel')}</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={v => setForm(f => ({ ...f, name: v }))}
                placeholder={t('rgNamePh')}
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>{t('visitsPerWeekLabel')}</Text>
              <TextInput
                style={styles.input}
                value={form.visitFreq}
                onChangeText={v => setForm(f => ({ ...f, visitFreq: v }))}
                keyboardType="decimal-pad"
                placeholder={t('rgFreqPh')}
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>{t('avgSpendLabel')}</Text>
              <TextInput
                style={styles.input}
                value={form.avgSpend}
                onChangeText={v => setForm(f => ({ ...f, avgSpend: v }))}
                keyboardType="decimal-pad"
                placeholder="e.g. 12.50"
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>{t('expectedLifespan')}</Text>
              <TextInput
                style={styles.input}
                value={form.lifespan}
                onChangeText={v => setForm(f => ({ ...f, lifespan: v }))}
                keyboardType="decimal-pad"
                placeholder="3"
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>{t('notesOptional')}</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={form.notes}
                onChangeText={v => setForm(f => ({ ...f, notes: v }))}
                placeholder={t('rgNotesPh')}
                placeholderTextColor={c.textMuted}
                multiline
                numberOfLines={3}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {/* List */}
        {!showForm && visitRegularId === null && (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={c.primary} />
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => void loadRegulars()}>
                  <Text style={styles.retryText}>{t('retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : regulars.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="heart-outline" size={36} color={c.textMuted} />
                <Text style={styles.emptyTitle}>{t('noRegularsYetTitle')}</Text>
                <Text style={styles.emptyText}>
                  {t('noRegularsYetDesc')}
                </Text>
                <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
                  <Text style={styles.emptyAddBtnText}>{t('addRegular')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              regulars.map(reg => {
                const isExpanded = expandedId === reg.id
                const prof = profMap[reg.id]
                return (
                  <View key={reg.id} style={styles.regularCard}>
                    <View style={styles.regularMain}>
                      <View style={styles.regularInfo}>
                        <Text style={styles.regularName}>{reg.name}</Text>
                        <Text style={styles.regularMeta}>
                          {t('rgWorth', { amount: money(reg.clv) })} · {t('rgVisits', { n: reg.visit_count })} · {t('rgPerVisit', { amount: money(reg.avg_spend) })}
                        </Text>
                        <Text style={styles.regularMeta}>
                          {t('rgFreqLine', { n: reg.visit_frequency_per_week })}
                          {reg.first_visit_date ? ` · ${t('rgSince', { date: reg.first_visit_date })}` : ''}
                          {reg.last_visit_date ? ` · ${t('rgLastVisit', { date: reg.last_visit_date })}` : ''}
                        </Text>
                        {reg.today_amount != null && (
                          <Text style={styles.todayBadge}>
                            {t('rgToday', { amount: money(reg.today_amount) })}
                          </Text>
                        )}
                      </View>
                      <View style={styles.regularActions}>
                        <TouchableOpacity
                          style={styles.visitBtn}
                          onPress={() => startVisit(reg.id)}
                          hitSlop={6}
                        >
                          <Ionicons name="add-circle-outline" size={20} color={c.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => openEdit(reg)}
                          hitSlop={6}
                        >
                          <Ionicons name="pencil-outline" size={18} color={c.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => deleteRegular(reg.id, reg.name)}
                          hitSlop={6}
                        >
                          <Ionicons name="trash-outline" size={18} color={c.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.profitabilityToggle}
                      onPress={() => void toggleProfitability(reg.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.profitabilityToggleText}>
                        {isExpanded ? t('hideProfitability') : t('seeProfitability')}
                      </Text>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={c.primary}
                      />
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.profExpand}>
                        {loadingProfId === reg.id ? (
                          <ActivityIndicator size="small" color={c.primary} />
                        ) : prof ? (
                          <>
                            <View style={styles.profGrid}>
                              <View style={styles.profTile}>
                                <Text style={styles.profTileVal}>
                                  {money(prof.this_month)}
                                </Text>
                                <Text style={styles.profTileLabel}>{t('thisMonth')}</Text>
                              </View>
                              <View style={styles.profTile}>
                                <Text style={styles.profTileVal}>
                                  {money(prof.this_year)}
                                </Text>
                                <Text style={styles.profTileLabel}>{t('thisYear')}</Text>
                              </View>
                              <View style={styles.profTile}>
                                <Text style={styles.profTileVal}>
                                  {money(prof.all_time)}
                                </Text>
                                <Text style={styles.profTileLabel}>{t('allTime')}</Text>
                              </View>
                            </View>
                            {prof.monthly_visits.length > 0 && (
                              <>
                                <Text style={styles.profSubLabel}>{t('recentMonths')}</Text>
                                {prof.monthly_visits.slice(-4).map(mv => (
                                  <View
                                    key={`${mv.year}-${mv.month}`}
                                    style={styles.mvRow}
                                  >
                                    <Text style={styles.mvLabel}>
                                      {t(MONTH_KEYS[mv.month - 1])} {mv.year}
                                    </Text>
                                    <Text style={styles.mvVisits}>
                                      {mv.visits} visit{mv.visits !== 1 ? 's' : ''}
                                    </Text>
                                    <Text style={styles.mvSpend}>
                                      {money(mv.total_spend)}
                                    </Text>
                                  </View>
                                ))}
                              </>
                            )}
                          </>
                        ) : (
                          <Text style={styles.profEmpty}>{t('noProfData')}</Text>
                        )}
                      </View>
                    )}
                  </View>
                )
              })
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

    regularCard: {
      backgroundColor: c.card, borderRadius: 14, marginBottom: 10,
      borderWidth: 1, borderColor: c.border, overflow: 'hidden',
    },
    regularMain: {
      flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 10,
    },
    regularInfo: { flex: 1, gap: 3 },
    regularName: { fontSize: 15, fontWeight: '700', color: c.text },
    regularMeta: { fontSize: 12, color: c.textSub },
    todayBadge: {
      fontSize: 11, color: c.primaryDark, fontWeight: '600',
      backgroundColor: c.primaryBg, alignSelf: 'flex-start',
      borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2,
    },
    regularActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    visitBtn: { padding: 6 },
    iconBtn: { padding: 6 },

    profitabilityToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14,
      paddingBottom: 10, paddingTop: 2,
    },
    profitabilityToggleText: { fontSize: 12, color: c.primary, fontWeight: '600' },

    profExpand: {
      borderTopWidth: 1, borderTopColor: c.border, padding: 14,
    },
    profGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    profTile: { flex: 1, alignItems: 'center', gap: 2 },
    profTileVal: { fontSize: 15, fontWeight: '700', color: c.primaryDark },
    profTileLabel: { fontSize: 10, color: c.textMuted, textAlign: 'center' },
    profSubLabel: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
    },
    mvRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    mvLabel: { flex: 1, fontSize: 12, color: c.text },
    mvVisits: { fontSize: 11, color: c.textSub, marginRight: 12 },
    mvSpend: { fontSize: 12, fontWeight: '600', color: c.primaryDark },
    profEmpty: { fontSize: 13, color: c.textMuted, textAlign: 'center' },

    // Visit modal styles
    visitHint: { fontSize: 16, color: c.text, fontWeight: '600', marginBottom: 6, lineHeight: 24 },
    visitSub: { fontSize: 13, color: c.textSub, lineHeight: 20, marginBottom: 16 },

    fieldLabel: {
      fontSize: 13, fontWeight: '600', color: c.text, marginTop: 14, marginBottom: 6,
    },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: c.text,
    },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },

    primaryBtn: {
      backgroundColor: c.primary, borderRadius: 14,
      paddingVertical: 16, alignItems: 'center', marginTop: 24,
    },
    primaryBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 16 },
  })
}
