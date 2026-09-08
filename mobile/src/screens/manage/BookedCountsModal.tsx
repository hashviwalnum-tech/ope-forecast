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
import type { BookedCountRead, BookingModelRead, ProductRead } from '../../api/types'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useBusinessTime } from '../../contexts/BusinessTimeContext'
import type { Theme } from '../../lib/theme'

interface Props { onClose: () => void }

/** null = the whole business; a number = one particular service. */
type Target = number | null

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return !isNaN(new Date(s).getTime())
}

/**
 * What Ope has worked out about this business's diary, in words.
 *
 * Nothing is claimed before the fit exists: under the model's minimum this
 * shows a plain "still learning" line, the same way the forecast's first
 * fortnight does, rather than a confident percentage built on three days.
 */
function LearnedCard({ styles, c }: { styles: ReturnType<typeof makeStyles>; c: Theme }) {
  const { t } = useLanguage()
  const [model, setModel] = useState<BookingModelRead | null>(null)

  useEffect(() => {
    api.bookedCounts.model().then(setModel).catch(() => {})
  }, [])

  if (!model || model.status === 'off') return null

  if (model.status === 'learning') {
    return (
      <View style={styles.learningCard}>
        <Text style={styles.learningTitle}>{t('bookingLearnedTitle')}</Text>
        <Text style={styles.learningText}>
          {t('bookingLearnedLearning', { n: String(model.pairs), needed: String(model.pairs_needed) })}
        </Text>
      </View>
    )
  }

  const noShow = model.no_show_rate ?? 0
  const walkIns = model.walk_ins_per_day ?? 0

  // "1 in 7" reads better than "14%" for an owner who is not counting in
  // percentages. Below ~3% there is no honest denominator to quote, so the
  // sentence changes shape instead of rounding to a meaningless "1 in 40".
  const noShowLine = noShow < 0.03
    ? t('bookingNoShowNone')
    : t('bookingNoShowLine', { k: String(Math.round(1 / noShow)) })

  const walkInLine = walkIns < 0.5
    ? t('bookingWalkInsNone')
    : t('bookingWalkInsLine', { n: String(Math.round(walkIns)) })

  return (
    <View style={styles.learnedCard}>
      <Text style={styles.learnedTitle}>{t('bookingLearnedTitle')}</Text>
      <Text style={styles.learnedText}>{noShowLine} {walkInLine}</Text>
      {model.partial_service_dates.length > 0 && (
        <Text style={styles.learnedNote}>
          {t('bookingPartialNote', { n: String(model.partial_service_dates.length) })}
        </Text>
      )}
    </View>
  )
}

export default function BookedCountsModal({ onClose }: Props) {
  const c = useTheme()
  const { t } = useLanguage()
  // The business's today, not the device's — see BusinessTimeContext.
  const { today: todayStr } = useBusinessTime()
  const styles = useMemo(() => makeStyles(c), [c])

  const [services, setServices] = useState<ProductRead[]>([])
  const [target, setTarget] = useState<Target>(null)
  const [rows, setRows] = useState<BookedCountRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState(todayStr)
  const [count, setCount] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    api.products.list()
      .then(all => setServices(all.filter(p => p.product_type === 'service')))
      .catch(() => {})
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      setRows(await api.bookedCounts.list(target ?? undefined))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoad'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData() }, [target])

  const save = async () => {
    const n = parseInt(count, 10)
    if (!isValidDate(date) || isNaN(n) || n < 0) {
      setSaveError(t('bookingsFillFields'))
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await api.bookedCounts.upsert(date, n, target ?? undefined)
      setCount('')
      await loadData()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  const remove = (d: string) => {
    Alert.alert(
      t('delete'),
      `${d}?`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'), style: 'destructive',
          onPress: async () => {
            try {
              await api.bookedCounts.delete(d, target ?? undefined)
              setRows(rs => rs.filter(r => r.date !== d))
            } catch (e) {
              Alert.alert(t('errorTitle'), e instanceof Error ? e.message : t('failedToDelete'))
            }
          },
        },
      ]
    )
  }

  // Upcoming days are the ones still worth acting on, so they come first.
  const upcoming = rows.filter(r => r.date >= todayStr)
  const past = rows.filter(r => r.date < todayStr)

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>{t('manage')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('bookedAppointments')}</Text>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.introBox}>
              <Text style={styles.introTitle}>{t('bookingsIntroTitle')}</Text>
              <Text style={styles.introText}>{t('bookingsIntroDesc')}</Text>
            </View>

            <LearnedCard styles={styles} c={c} />

            {services.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>{t('bookingsForLabel')}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.targetPicker}
                >
                  <TouchableOpacity
                    style={[styles.targetChip, target === null && styles.targetChipActive]}
                    onPress={() => setTarget(null)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.targetChipText, target === null && styles.targetChipTextActive]}>
                      {t('wholeBusinessOption')}
                    </Text>
                  </TouchableOpacity>
                  {services.map(s => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.targetChip, target === s.id && styles.targetChipActive]}
                      onPress={() => setTarget(s.id)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.targetChipText, target === s.id && styles.targetChipTextActive]}>
                        {s.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <View style={styles.formCard}>
              <Text style={styles.formTitle}>{t('addBookedCountTitle')}</Text>

              {saveError && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{saveError}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>{t('dateLabel')} (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={date}
                onChangeText={setDate}
                placeholder="2026-01-15"
                placeholderTextColor={c.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.fieldLabel}>{t('bookedCountLabel')}</Text>
              <TextInput
                style={styles.input}
                value={count}
                onChangeText={setCount}
                placeholder="14"
                placeholderTextColor={c.textMuted}
                keyboardType="number-pad"
              />

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={() => void save()}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving
                  ? <ActivityIndicator size="small" color={c.onPrimary} />
                  : <Text style={styles.saveButtonText}>{t('saveBookedCount')}</Text>}
              </TouchableOpacity>
            </View>

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
            ) : rows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="calendar-outline" size={36} color={c.textMuted} />
                <Text style={styles.emptyTitle}>{t('noBookedCounts')}</Text>
                <Text style={styles.emptyText}>{t('noBookedCountsDesc')}</Text>
              </View>
            ) : (
              [...upcoming, ...past].map(r => (
                <View key={r.date} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowDate}>{r.date}</Text>
                    <Text style={styles.rowCount}>
                      {t('bookedCountRow', { n: String(r.booked_count) })}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => remove(r.date)} hitSlop={8} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={18} color={c.danger} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
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

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40 },
    center: { justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
    errorText: { color: c.danger, fontSize: 14, textAlign: 'center', marginBottom: 12 },
    retryBtn: {
      backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20,
    },
    retryText: { color: c.onPrimary, fontWeight: '600', fontSize: 14 },

    introBox: {
      backgroundColor: c.primaryXBg, borderRadius: 14, borderWidth: 1, borderColor: c.border,
      padding: 14, marginBottom: 12, gap: 4,
    },
    introTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    introText: { fontSize: 13, color: c.textSub, lineHeight: 19 },

    // #b45309 is the amber ForecastScreen already uses for a caution line;
    // the theme has no warning token and one card does not justify adding one.
    learningCard: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: '#b45309',
      padding: 14, marginBottom: 12, gap: 4,
    },
    learningTitle: { fontSize: 14, fontWeight: '700', color: '#b45309' },
    learningText: { fontSize: 13, color: c.textSub, lineHeight: 19 },

    learnedCard: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border,
      padding: 14, marginBottom: 12, gap: 4,
    },
    learnedTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    learnedText: { fontSize: 13, color: c.textSub, lineHeight: 19 },
    learnedNote: { fontSize: 12, color: '#b45309', lineHeight: 18, marginTop: 4 },

    formCard: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border,
      padding: 14, marginTop: 4, marginBottom: 16,
    },
    formTitle: { fontSize: 15, fontWeight: '700', color: c.text },
    errorBanner: { backgroundColor: c.dangerBg, borderRadius: 10, padding: 12, marginTop: 12 },
    errorBannerText: { color: c.danger, fontSize: 13 },

    fieldLabel: {
      fontSize: 13, fontWeight: '600', color: c.text, marginTop: 14, marginBottom: 6,
    },
    input: {
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: c.text,
    },
    saveButton: {
      backgroundColor: c.primary, borderRadius: 12, paddingVertical: 14,
      alignItems: 'center', marginTop: 16, minHeight: 48, justifyContent: 'center',
    },
    saveButtonDisabled: { opacity: 0.6 },
    saveButtonText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },

    targetPicker: { marginBottom: 4 },
    targetChip: {
      backgroundColor: c.card, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
      borderWidth: 1, borderColor: c.border, marginRight: 8,
    },
    targetChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    targetChipText: { fontSize: 13, color: c.text, fontWeight: '600' },
    targetChipTextActive: { color: c.onPrimary },

    emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 40 },
    emptyTitle: { fontSize: 17, fontWeight: '700', color: c.text },
    emptyText: {
      fontSize: 14, color: c.textSub, textAlign: 'center', maxWidth: 280, lineHeight: 20,
    },

    row: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 8,
      borderWidth: 1, borderColor: c.border,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    },
    rowText: { flex: 1, gap: 2 },
    rowDate: { fontSize: 15, fontWeight: '700', color: c.text },
    rowCount: { fontSize: 13, color: c.textSub },
    deleteBtn: { padding: 4 },
  })
}
