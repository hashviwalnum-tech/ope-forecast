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
import { useTheme, type Theme } from '../../lib/theme'

interface Props {
  business: BusinessRead
  onClose: () => void
  onSaved: (updated: BusinessRead) => void
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function parseSetting<T>(v: unknown, fallback: T): T {
  return v !== undefined && v !== null ? (v as T) : fallback
}

export default function SettingsModal({ business, onClose, onSaved }: Props) {
  const c = useTheme()
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
      setError('Service time must be greater than 0 minutes.')
      return
    }
    if (openHour >= closeHour) {
      setError('Opening hour must be earlier than closing hour.')
      return
    }
    if (openingDays.length === 0) {
      setError('Select at least one opening day.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const updated = await api.businesses.updateSettings({
        opening_days: openingDays,
        opening_hour: openHour,
        closing_hour: closeHour,
        avg_service_time_minutes: stMin,
        staffing_max_wait_minutes: maxWait ? parseFloat(maxWait) : null,
        stock_management_enabled: stockEnabled,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>Manage</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Business Settings</Text>
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
                <Text style={styles.successText}>Settings saved!</Text>
              </View>
            )}
            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            )}

            {/* Opening days */}
            <Text style={styles.sectionLabel}>Opening Days</Text>
            <View style={styles.daysRow}>
              {DAY_LABELS.map((label, idx) => {
                const active = openingDays.includes(idx)
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.dayBtn, active && styles.dayBtnActive]}
                    onPress={() => toggleDay(idx)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.dayBtnText, active && styles.dayBtnTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* Hours */}
            <Text style={styles.sectionLabel}>Opening Hours</Text>
            <View style={styles.hoursRow}>
              <HourStepper
                label="Opens"
                value={openHour}
                onDecrement={() => stepHour(setOpenHour, -1, 0, 23)}
                onIncrement={() => stepHour(setOpenHour, 1, 0, 23)}
                c={c}
              />
              <Text style={styles.hoursDash}>–</Text>
              <HourStepper
                label="Closes"
                value={closeHour}
                onDecrement={() => stepHour(setCloseHour, -1, 0, 23)}
                onIncrement={() => stepHour(setCloseHour, 1, 0, 23)}
                c={c}
              />
            </View>

            {/* Service time */}
            <Text style={styles.sectionLabel}>Avg Service Time (minutes)</Text>
            <TextInput
              style={styles.input}
              value={serviceTime}
              onChangeText={setServiceTime}
              keyboardType="decimal-pad"
              placeholder="e.g. 5"
              placeholderTextColor={c.textMuted}
            />
            <Text style={styles.fieldHint}>
              How long it takes to serve one customer on average. Used for staffing recommendations.
            </Text>

            {/* Max wait */}
            <Text style={styles.sectionLabel}>Max Acceptable Wait Time (minutes, optional)</Text>
            <TextInput
              style={styles.input}
              value={maxWait}
              onChangeText={setMaxWait}
              keyboardType="decimal-pad"
              placeholder="e.g. 5 (leave blank to skip)"
              placeholderTextColor={c.textMuted}
            />
            <Text style={styles.fieldHint}>
              The longest queue you're comfortable with. Used to compute how many staff are needed.
            </Text>

            {/* Stock tracking */}
            <Text style={styles.sectionLabel}>Stock & Reorder Tracking</Text>
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Show stock & reorder advice</Text>
                <Text style={styles.fieldHint}>
                  Turn off if you don't want ordering recommendations on the Forecast screen.
                </Text>
              </View>
              <Switch
                value={stockEnabled}
                onValueChange={setStockEnabled}
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
            width: 36, height: 36, backgroundColor: c.card,
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
            width: 36, height: 36, backgroundColor: c.card,
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
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      backgroundColor: c.headerBg, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 10,
      flexDirection: 'row', alignItems: 'center',
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 8 },
    backLabel: { fontSize: 14, color: c.onPrimary },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: c.onPrimary, textAlign: 'center' },
    saveBtn: { paddingHorizontal: 4 },
    saveBtnText: { fontSize: 15, fontWeight: '700', color: c.onPrimary },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40 },

    successBanner: {
      backgroundColor: '#f0fdf4', borderRadius: 10, padding: 12, marginBottom: 14,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderWidth: 1, borderColor: '#86efac',
    },
    successText: { fontSize: 13, color: '#16a34a', fontWeight: '600' },
    errorBanner: {
      backgroundColor: c.dangerBg, borderRadius: 10, padding: 12, marginBottom: 14,
    },
    errorBannerText: { color: c.danger, fontSize: 13 },

    sectionLabel: {
      fontSize: 13, fontWeight: '700', color: c.text, marginTop: 20, marginBottom: 10,
    },

    daysRow: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    },
    dayBtn: {
      backgroundColor: c.card, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
      borderWidth: 1, borderColor: c.border, minWidth: 46, alignItems: 'center',
    },
    dayBtnActive: {
      backgroundColor: c.primary, borderColor: c.primary,
    },
    dayBtnText: { fontSize: 13, fontWeight: '600', color: c.textSub },
    dayBtnTextActive: { color: c.onPrimary },

    hoursRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.card, borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: c.border,
    },
    hoursDash: { fontSize: 20, color: c.textMuted, fontWeight: '300' },

    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: c.text,
    },
    fieldHint: { fontSize: 11, color: c.textMuted, marginTop: 6, lineHeight: 16 },

    toggleRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.card, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: c.border,
    },
    toggleText: { flex: 1 },
    toggleLabel: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 2 },
  })
}
