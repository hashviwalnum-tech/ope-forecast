import { useState, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { BusinessRead } from '../../api/types'
import { useTheme, useAppTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'

interface Props {
  business: BusinessRead
  onClose: () => void
  onSaved: (updated: BusinessRead) => Promise<void> | void
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function parseSetting<T>(v: unknown, fallback: T): T {
  return v !== undefined && v !== null ? (v as T) : fallback
}

export default function SettingsModal({ business, onClose, onSaved }: Props) {
  const c = useTheme()
  const { preference, setPreference } = useAppTheme()
  const { lang, setLang, t } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

  const s = business.settings

  const [openingDays, setOpeningDays] = useState<number[]>(
    parseSetting<number[]>(s.opening_days, [0, 1, 2, 3, 4, 5, 6])
  )
  const [openHour, setOpenHour] = useState(parseSetting<number>(s.opening_hour, 8))
  const [closeHour, setCloseHour] = useState(parseSetting<number>(s.closing_hour, 22))
  const [serviceTime, setServiceTime] = useState(
    String(parseSetting<number>(s.avg_service_time_minutes, 5))
  )
  const [maxWait, setMaxWait] = useState(
    s.staffing_max_wait_minutes != null ? String(s.staffing_max_wait_minutes) : ''
  )
  const [stockEnabled, setStockEnabled] = useState(
    s.stock_management_enabled !== false
  )
  const [assumeOnTime, setAssumeOnTime] = useState(
    s.assume_orders_arrive_on_time === true
  )
  const [timezone, setTimezone] = useState(
    typeof s.timezone === 'string' ? s.timezone : ''
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const fresh = business.settings
    setOpeningDays(parseSetting<number[]>(fresh.opening_days, [0, 1, 2, 3, 4, 5, 6]))
    setOpenHour(parseSetting<number>(fresh.opening_hour, 8))
    setCloseHour(parseSetting<number>(fresh.closing_hour, 22))
    setServiceTime(String(parseSetting<number>(fresh.avg_service_time_minutes, 5)))
    setMaxWait(fresh.staffing_max_wait_minutes != null
      ? String(fresh.staffing_max_wait_minutes) : '')
    setStockEnabled(fresh.stock_management_enabled !== false)
    setAssumeOnTime(fresh.assume_orders_arrive_on_time === true)
    setTimezone(typeof fresh.timezone === 'string' ? fresh.timezone : '')
  }, [business])

  const toggleDay = (idx: number) => {
    setOpeningDays(days =>
      days.includes(idx) ? days.filter(d => d !== idx) : [...days, idx].sort()
    )
  }

  const stepHour = (
    setter: (v: number | ((prev: number) => number)) => void,
    delta: number,
    min: number,
    max: number
  ) => {
    setter(prev => Math.min(max, Math.max(min, prev + delta)))
  }

  const save = async () => {
    const stMin = parseFloat(serviceTime)
    if (isNaN(stMin) || stMin <= 0) {
      setError(t('serviceTimeError'))
      return
    }
    if (openHour >= closeHour) {
      setError(t('openHourError'))
      return
    }
    if (openingDays.length === 0) {
      setError(t('openDayError'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const updated = await api.businesses.updateSettings({
        opening_days: openingDays,
        opening_hour: openHour,
        closing_hour: closeHour,
        timezone: timezone.trim() || undefined,
        avg_service_time_minutes: stMin,
        staffing_max_wait_minutes: maxWait ? parseFloat(maxWait) : null,
        stock_management_enabled: stockEnabled,
        assume_orders_arrive_on_time: assumeOnTime,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
        <View style={[styles.header, { backgroundColor: c.headerBg }]}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={[styles.backLabel, { color: c.onPrimary }]}>{t('manage')}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: c.onPrimary }]}>{t('settings')}</Text>
          <TouchableOpacity
            onPress={() => void save()}
            style={styles.saveBtn}
            disabled={saving}
            hitSlop={8}
          >
            {saving
              ? <ActivityIndicator size="small" color={c.onPrimary} />
              : <Text style={[styles.saveBtnText, { color: c.onPrimary }]}>{t('save')}</Text>}
          </TouchableOpacity>
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
            {saved && (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                <Text style={styles.successText}>{t('settingsSaved')}</Text>
              </View>
            )}
            {error && (
              <View style={[styles.errorBanner, { backgroundColor: c.dangerBg }]}>
                <Text style={[styles.errorBannerText, { color: c.danger }]}>{error}</Text>
              </View>
            )}

            {/* ── Language ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>{t('language')}</Text>
            <Text style={[styles.fieldHint, { color: c.textMuted }]}>{t('languageHint')}</Text>
            <View style={styles.segmentRow}>
              {(['en', 'he'] as const).map(l => (
                <TouchableOpacity
                  key={l}
                  style={[
                    styles.segmentBtn,
                    { backgroundColor: c.card, borderColor: c.border },
                    lang === l && { backgroundColor: c.primary, borderColor: c.primary },
                  ]}
                  onPress={() => setLang(l)}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.segmentBtnText,
                    { color: c.textSub },
                    lang === l && { color: c.onPrimary },
                  ]}>
                    {l === 'en' ? 'English' : 'עברית'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Appearance / Dark mode ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>{t('appearance')}</Text>
            <Text style={[styles.fieldHint, { color: c.textMuted }]}>{t('appearanceHint')}</Text>
            <View style={styles.segmentRow}>
              {(['system', 'light', 'dark'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.segmentBtn,
                    { backgroundColor: c.card, borderColor: c.border },
                    preference === p && { backgroundColor: c.primary, borderColor: c.primary },
                  ]}
                  onPress={() => setPreference(p)}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.segmentBtnText,
                    { color: c.textSub },
                    preference === p && { color: c.onPrimary },
                  ]}>
                    {p === 'system' ? t('followSystem') : p === 'light' ? t('lightMode') : t('darkMode')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Opening days ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>{t('openingDays')}</Text>
            <View style={styles.daysRow}>
              {DAY_KEYS.map((key, idx) => {
                const active = openingDays.includes(idx)
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.dayBtn,
                      { backgroundColor: c.card, borderColor: c.border },
                      active && { backgroundColor: c.primary, borderColor: c.primary },
                    ]}
                    onPress={() => toggleDay(idx)}
                    activeOpacity={0.75}
                  >
                    <Text style={[
                      styles.dayBtnText,
                      { color: c.textSub },
                      active && { color: c.onPrimary },
                    ]}>
                      {t(key)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* ── Hours ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>{t('openingHours')}</Text>
            <View style={[styles.hoursRow, { backgroundColor: c.card, borderColor: c.border }]}>
              <HourStepper
                label={t('opens')}
                value={openHour}
                onDecrement={() => stepHour(setOpenHour, -1, 0, 23)}
                onIncrement={() => stepHour(setOpenHour, 1, 0, 23)}
                c={c}
              />
              <Text style={[styles.hoursDash, { color: c.textMuted }]}>–</Text>
              <HourStepper
                label={t('closes')}
                value={closeHour}
                onDecrement={() => stepHour(setCloseHour, -1, 0, 23)}
                onIncrement={() => stepHour(setCloseHour, 1, 0, 23)}
                c={c}
              />
            </View>

            {/* ── Timezone ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>Timezone</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
              value={timezone}
              onChangeText={setTimezone}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. Asia/Jerusalem"
              placeholderTextColor={c.textMuted}
            />
            <Text style={[styles.fieldHint, { color: c.textMuted }]}>
              IANA timezone name used to match your tap timestamps to opening hours. Leave blank to use UTC.
            </Text>

            {/* ── Service time ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>{t('avgServiceTime')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
              value={serviceTime}
              onChangeText={setServiceTime}
              keyboardType="decimal-pad"
              placeholder="e.g. 5"
              placeholderTextColor={c.textMuted}
            />
            <Text style={[styles.fieldHint, { color: c.textMuted }]}>{t('avgServiceTimeHint')}</Text>

            {/* ── Max wait ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>{t('maxWaitTime')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
              value={maxWait}
              onChangeText={setMaxWait}
              keyboardType="decimal-pad"
              placeholder="e.g. 5 (leave blank to skip)"
              placeholderTextColor={c.textMuted}
            />
            <Text style={[styles.fieldHint, { color: c.textMuted }]}>{t('maxWaitHint')}</Text>

            {/* ── Stock tracking ── */}
            <Text style={[styles.sectionLabel, { color: c.text }]}>{t('stockReorderTracking')}</Text>
            <View style={[styles.toggleRow, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.toggleText}>
                <Text style={[styles.toggleLabel, { color: c.text }]}>{t('showStockReorderAdvice')}</Text>
                <Text style={[styles.fieldHint, { color: c.textMuted }]}>{t('stockToggleHint')}</Text>
              </View>
              <Switch
                value={stockEnabled}
                onValueChange={setStockEnabled}
                trackColor={{ false: c.border, true: c.primary }}
                thumbColor={c.onPrimary}
              />
            </View>
            <View style={[styles.toggleRow, { backgroundColor: c.card, borderColor: c.border, marginTop: 8 }]}>
              <View style={styles.toggleText}>
                <Text style={[styles.toggleLabel, { color: c.text }]}>{t('assumeOrdersOnTime')}</Text>
                <Text style={[styles.fieldHint, { color: c.textMuted }]}>{t('assumeOrdersOnTimeHint')}</Text>
              </View>
              <Switch
                value={assumeOnTime}
                onValueChange={setAssumeOnTime}
                trackColor={{ false: c.border, true: c.primary }}
                thumbColor={c.onPrimary}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function HourStepper({
  label, value, onDecrement, onIncrement, c,
}: {
  label: string
  value: number
  onDecrement: () => void
  onIncrement: () => void
  c: Theme
}) {
  const fmt = (h: number) => {
    if (h === 0) return '12am'
    if (h < 12) return `${h}am`
    if (h === 12) return '12pm'
    return `${h - 12}pm`
  }
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity
          onPress={onDecrement}
          style={{
            width: 36, height: 36, backgroundColor: c.primaryXBg,
            borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: c.border,
          }}
        >
          <Text style={{ fontSize: 20, color: c.text, lineHeight: 22 }}>−</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, minWidth: 42, textAlign: 'center' }}>
          {fmt(value)}
        </Text>
        <TouchableOpacity
          onPress={onIncrement}
          style={{
            width: 36, height: 36, backgroundColor: c.primaryXBg,
            borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: c.border,
          }}
        >
          <Text style={{ fontSize: 20, color: c.text, lineHeight: 22 }}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      paddingHorizontal: 16, paddingBottom: 14, paddingTop: 10,
      flexDirection: 'row', alignItems: 'center',
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 8 },
    backLabel: { fontSize: 14 },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', textAlign: 'center' },
    saveBtn: { paddingHorizontal: 4 },
    saveBtnText: { fontSize: 15, fontWeight: '700' },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40 },

    successBanner: {
      backgroundColor: '#f0fdf4', borderRadius: 10, padding: 12, marginBottom: 14,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderWidth: 1, borderColor: '#86efac',
    },
    successText: { fontSize: 13, color: '#16a34a', fontWeight: '600' },
    errorBanner: { borderRadius: 10, padding: 12, marginBottom: 14 },
    errorBannerText: { fontSize: 13 },

    sectionLabel: { fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 6 },

    segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    segmentBtn: {
      flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 6,
      borderWidth: 1, alignItems: 'center',
    },
    segmentBtnText: { fontSize: 13, fontWeight: '600' },

    daysRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dayBtn: {
      borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
      borderWidth: 1, minWidth: 46, alignItems: 'center',
    },
    dayBtnText: { fontSize: 13, fontWeight: '600' },

    hoursRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderRadius: 14, padding: 16, borderWidth: 1,
    },
    hoursDash: { fontSize: 20, fontWeight: '300' },

    input: {
      borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    },
    fieldHint: { fontSize: 11, marginTop: 6, lineHeight: 16 },

    toggleRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderRadius: 14, padding: 14, borderWidth: 1,
    },
    toggleText: { flex: 1 },
    toggleLabel: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  })
}
