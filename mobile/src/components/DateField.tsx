/**
 * A date the owner picks from a calendar, never types.
 *
 * Past days, Ads & Events and Bookings used to take "2026-01-15" typed into a
 * text box: easy to get wrong on a phone keyboard, impossible to read for an
 * owner who writes dates the other way round, and against the spec's "never a
 * free-text date field". The value stays the same ISO string the screens
 * already validate and send, so nothing downstream changes.
 *
 * Android opens the system calendar dialog; iOS shows the inline calendar
 * under the field. Both follow the phone's own language for month names.
 */
import { useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { Lang } from '../lib/i18n'
import { dateToIso, isoToDate } from '../lib/isoDate'

/** "Thursday, 15 January 2026" in the owner's language. */
export function sayFullDate(iso: string, lang: Lang): string {
  const d = isoToDate(iso)
  if (!d) return iso
  try {
    return new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  } catch {
    return iso
  }
}

interface Props {
  value: string                    // ISO date, or '' for none yet
  onChange: (iso: string) => void
  label: string                    // read by screen readers
  placeholder?: string
  minimum?: string                 // ISO
  maximum?: string                 // ISO
}

export default function DateField({ value, onChange, label, placeholder, minimum, maximum }: Props) {
  const c = useTheme()
  const { lang, t } = useLanguage()
  const [iosOpen, setIosOpen] = useState(false)
  const current = isoToDate(value) ?? isoToDate(maximum ?? '') ?? new Date()
  const min = minimum ? isoToDate(minimum) ?? undefined : undefined
  const max = maximum ? isoToDate(maximum) ?? undefined : undefined

  const picked = (e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS === 'ios') setIosOpen(false)
    if (e.type === 'set' && d) onChange(dateToIso(d))
  }

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: current, mode: 'date', onChange: picked, minimumDate: min, maximumDate: max })
    } else {
      setIosOpen(o => !o)
    }
  }

  const shown = value ? sayFullDate(value, lang) : (placeholder ?? t('pickADate'))
  return (
    <View>
      <TouchableOpacity
        style={[styles.field, { backgroundColor: c.card, borderColor: c.border }]}
        onPress={open}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityHint={t('pickADate')}
      >
        <Ionicons name="calendar-outline" size={20} color={c.primary} />
        <Text style={[styles.text, { color: value ? c.text : c.textMuted }]}>{shown}</Text>
        <Ionicons name="chevron-down" size={16} color={c.textMuted} />
      </TouchableOpacity>
      {Platform.OS === 'ios' && iosOpen && (
        <DateTimePicker value={current} mode="date" display="inline" onChange={picked}
          minimumDate={min} maximumDate={max} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, minHeight: 48,
  },
  text: { flex: 1, fontSize: 15 },
})
