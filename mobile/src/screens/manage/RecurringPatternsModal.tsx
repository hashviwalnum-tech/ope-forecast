import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { RecurringPatternRead, RecurringPatternCreate } from '../../api/types'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'

const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WD_SHORT_HE = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון']

const EFFECTS: Array<{ value: string; labelKey: 'effectHigher' | 'effectLower' | 'effectExpected' }> = [
  { value: 'higher', labelKey: 'effectHigher' },
  { value: 'lower',  labelKey: 'effectLower'  },
  { value: 'expected', labelKey: 'effectExpected' },
]

interface Props {
  onClose: () => void
}

export default function RecurringPatternsModal({ onClose }: Props) {
  const c = useTheme()
  const { t, lang } = useLanguage()
  const styles = makeStyles(c)

  const [rows, setRows]       = useState<RecurringPatternRead[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  const [form, setForm] = useState<RecurringPatternCreate>({
    label: '', weekdays: [], effect: 'higher',
  })

  const wdShort = lang === 'he' ? WD_SHORT_HE : WD_SHORT

  function fmtWeekdays(wds: number[]): string {
    if (wds.length === 7) return t('everyDayLabel')
    return wds.map(w => wdShort[w]).join(', ')
  }

  function fmt12h(h: number): string {
    if (h === 0) return '12am'
    if (h < 12) return `${h}am`
    if (h === 12) return '12pm'
    return `${h - 12}pm`
  }

  function fmtHours(start: number | null, end: number | null): string {
    if (start === null && end === null) return t('allHoursLabel')
    if (start !== null && end !== null) return `${fmt12h(start)}–${fmt12h(end)}`
    if (start !== null) return t('fromHourLabel', { hour: fmt12h(start) })
    return `–${fmt12h(end!)}`
  }

  function effectLabel(effect: string): string {
    if (effect === 'higher') return t('effectBusierLabel')
    if (effect === 'lower')  return t('effectQuieterLabel')
    return t('effectNormalLabel')
  }

  async function load() {
    setLoading(true)
    try { setRows(await api.recurringPatterns.list()) } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function toggleWd(wd: number) {
    setForm(f => ({
      ...f,
      weekdays: f.weekdays.includes(wd)
        ? f.weekdays.filter(w => w !== wd)
        : [...f.weekdays, wd].sort((a, b) => a - b),
    }))
  }

  function resetForm() {
    setForm({ label: '', weekdays: [], effect: 'higher' })
    setErr(null)
    setAdding(false)
  }

  async function save() {
    if (!form.label.trim() || form.weekdays.length === 0) {
      setErr(t('patternFillError'))
      return
    }
    setSaving(true); setErr(null)
    try {
      await api.recurringPatterns.create(form)
      resetForm()
      void load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally { setSaving(false) }
  }

  async function del(id: number) {
    Alert.alert(t('removePattern'), t('confirmRemovePattern'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('removePattern'), style: 'destructive',
        onPress: async () => {
          try { await api.recurringPatterns.delete(id); void load() } catch { /* ignore */ }
        },
      },
    ])
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: c.primary }]}>
          <Text style={[styles.headerTitle, { color: c.onPrimary }]}>{t('patterns')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color={c.onPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          {/* Explainer */}
          <View style={[styles.infoBox, { backgroundColor: c.primaryXBg, borderColor: c.primary }]}>
            <Text style={[styles.infoBoxTitle, { color: c.primaryDark }]}>{t('teachOpeTitle')}</Text>
            <Text style={[styles.infoBoxDesc, { color: c.primaryDark }]}>{t('teachOpeDesc')}</Text>
          </View>

          {/* Add button */}
          {!adding && (
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: c.primary }]}
              onPress={() => setAdding(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={20} color={c.onPrimary} />
              <Text style={[styles.addBtnText, { color: c.onPrimary }]}>{t('addPattern')}</Text>
            </TouchableOpacity>
          )}

          {/* Add form */}
          {adding && (
            <View style={[styles.formCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.formTitle, { color: c.text }]}>{t('newPatternTitle')}</Text>

              {/* Name */}
              <TextInput
                style={[styles.input, { backgroundColor: c.bg, borderColor: c.border, color: c.text }]}
                placeholder={t('patternNamePlaceholder')}
                placeholderTextColor={c.textMuted}
                value={form.label}
                onChangeText={label => setForm(f => ({ ...f, label }))}
              />

              {/* Weekdays */}
              <Text style={[styles.fieldLabel, { color: c.textSub }]}>{t('whichDaysLabel')}</Text>
              <View style={styles.dayRow}>
                {WD_SHORT.map((_, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.dayChip,
                      { borderColor: c.border, backgroundColor: c.bg },
                      form.weekdays.includes(idx) && { backgroundColor: c.primary, borderColor: c.primary },
                    ]}
                    onPress={() => toggleWd(idx)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.dayChipText,
                      { color: c.textSub },
                      form.weekdays.includes(idx) && { color: c.onPrimary },
                    ]}>
                      {wdShort[idx]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Effect */}
              <Text style={[styles.fieldLabel, { color: c.textSub }]}>{t('patternEffect')}</Text>
              <View style={styles.effectRow}>
                {EFFECTS.map(e => (
                  <TouchableOpacity
                    key={e.value}
                    style={[
                      styles.effectChip,
                      { borderColor: c.border, backgroundColor: c.bg },
                      form.effect === e.value && { backgroundColor: c.primary, borderColor: c.primary },
                    ]}
                    onPress={() => setForm(f => ({ ...f, effect: e.value }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.effectChipText,
                      { color: c.textSub },
                      form.effect === e.value && { color: c.onPrimary },
                    ]}>
                      {t(e.labelKey)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Optional hours */}
              <Text style={[styles.fieldLabel, { color: c.textSub }]}>{t('startHourLabel')}</Text>
              <TextInput
                style={[styles.inputShort, { backgroundColor: c.bg, borderColor: c.border, color: c.text }]}
                keyboardType="number-pad"
                placeholder="e.g. 9"
                placeholderTextColor={c.textMuted}
                value={form.hour_start != null ? String(form.hour_start) : ''}
                onChangeText={v => setForm(f => ({ ...f, hour_start: v ? parseInt(v) : undefined }))}
              />
              <Text style={[styles.fieldLabel, { color: c.textSub }]}>{t('endHourLabel')}</Text>
              <TextInput
                style={[styles.inputShort, { backgroundColor: c.bg, borderColor: c.border, color: c.text }]}
                keyboardType="number-pad"
                placeholder="e.g. 11"
                placeholderTextColor={c.textMuted}
                value={form.hour_end != null ? String(form.hour_end) : ''}
                onChangeText={v => setForm(f => ({ ...f, hour_end: v ? parseInt(v) : undefined }))}
              />

              {err && <Text style={[styles.errText, { color: c.danger }]}>{err}</Text>}

              <View style={styles.formBtns}>
                <TouchableOpacity
                  style={[styles.saveBtnPrimary, saving && { opacity: 0.6 }]}
                  onPress={() => void save()}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={c.onPrimary} />
                    : <Text style={styles.saveBtnText}>{t('savePattern')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cancelBtn, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={resetForm}
                >
                  <Text style={[styles.cancelBtnText, { color: c.textSub }]}>{t('cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* List */}
          {loading ? (
            <ActivityIndicator size="large" color={c.primary} style={{ marginTop: 32 }} />
          ) : rows.length === 0 ? (
            <View style={[styles.emptyBox, { borderColor: c.border }]}>
              <Ionicons name="repeat-outline" size={32} color={c.textMuted} />
              <Text style={[styles.emptyTitle, { color: c.textSub }]}>{t('noRecurringPatterns')}</Text>
              <Text style={[styles.emptyDesc, { color: c.textMuted }]}>{t('noRecurringDesc')}</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {rows.map(rp => (
                <View key={rp.id} style={[styles.patternCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <View style={styles.patternCardLeft}>
                    <Text style={[styles.patternLabel, { color: c.text }]}>{rp.label}</Text>
                    <Text style={[styles.patternMeta, { color: c.textSub }]}>
                      {fmtWeekdays(rp.weekdays)}
                      {(rp.hour_start !== null || rp.hour_end !== null) && (
                        ` · ${fmtHours(rp.hour_start, rp.hour_end)}`
                      )}
                    </Text>
                    <View style={[
                      styles.effectBadge,
                      rp.effect === 'higher'
                        ? { backgroundColor: c.primaryXBg }
                        : rp.effect === 'lower'
                          ? { backgroundColor: '#fef3c7' }
                          : { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
                    ]}>
                      <Text style={[
                        styles.effectBadgeText,
                        { color: rp.effect === 'higher' ? c.primaryDark : rp.effect === 'lower' ? '#92400e' : c.textSub },
                      ]}>
                        {effectLabel(rp.effect)}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.removeBtn, { borderColor: c.danger }]}
                    onPress={() => void del(rp.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.removeBtnText, { color: c.danger }]}>{t('removePattern')}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 14,
    },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    closeBtn: { padding: 4 },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40, gap: 14 },

    infoBox: {
      borderRadius: 12, padding: 14, borderWidth: 1, gap: 4,
    },
    infoBoxTitle: { fontSize: 14, fontWeight: '700' },
    infoBoxDesc: { fontSize: 13, lineHeight: 20 },

    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, borderRadius: 12, paddingVertical: 14,
    },
    addBtnText: { fontSize: 15, fontWeight: '700' },

    formCard: {
      borderRadius: 14, padding: 16, borderWidth: 1, gap: 10,
    },
    formTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
    fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

    input: {
      borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 15,
    },
    inputShort: {
      borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 15, width: 100,
    },

    dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dayChip: {
      borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10,
    },
    dayChipText: { fontSize: 12, fontWeight: '600' },

    effectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    effectChip: {
      borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12,
    },
    effectChipText: { fontSize: 12, fontWeight: '600' },

    errText: { fontSize: 13 },

    formBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
    saveBtnPrimary: {
      flex: 2, backgroundColor: '#3a7470', borderRadius: 10,
      paddingVertical: 12, alignItems: 'center',
    },
    saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
    cancelBtn: {
      flex: 1, borderRadius: 10, borderWidth: 1,
      paddingVertical: 12, alignItems: 'center',
    },
    cancelBtnText: { fontSize: 15, fontWeight: '600' },

    emptyBox: {
      borderRadius: 14, borderWidth: 1, borderStyle: 'dashed',
      padding: 32, alignItems: 'center', gap: 10, marginTop: 8,
    },
    emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
    emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 20 },

    list: { gap: 10 },
    patternCard: {
      borderRadius: 14, padding: 14, borderWidth: 1,
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    },
    patternCardLeft: { flex: 1, gap: 4 },
    patternLabel: { fontSize: 15, fontWeight: '700' },
    patternMeta: { fontSize: 13, lineHeight: 18 },
    effectBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8, marginTop: 2 },
    effectBadgeText: { fontSize: 11, fontWeight: '600' },

    removeBtn: {
      borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10,
      alignSelf: 'flex-start',
    },
    removeBtnText: { fontSize: 12, fontWeight: '600' },
  })
}
