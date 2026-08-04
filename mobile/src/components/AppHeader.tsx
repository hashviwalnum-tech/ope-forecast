import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../contexts/ThemeContext'
import { useSettingsSheet } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { LANG_LABELS, type Lang } from '../lib/i18n'

interface AppHeaderProps {
  title: string
  subtitle?: string
  /** Optional extra element rendered on the right, alongside the gear icon */
  rightExtra?: React.ReactNode
}

export default function AppHeader({ title, subtitle, rightExtra }: AppHeaderProps) {
  const c = useTheme()
  const { openSettings } = useSettingsSheet()
  const { lang, setLang, t } = useLanguage()
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <View style={[styles.header, { backgroundColor: c.headerBg }]}>
      <View style={styles.left}>
        <Text style={[styles.title, { color: c.onPrimary }]}>{title}</Text>
        {subtitle !== undefined && (
          <Text style={[styles.subtitle, { color: c.onPrimarySub }]}>{subtitle}</Text>
        )}
      </View>
      <View style={styles.right}>
        {rightExtra}
        <TouchableOpacity
          onPress={() => setPickerOpen(true)}
          style={styles.langBtn}
          hitSlop={10}
          accessibilityLabel={t('language')}
        >
          <Ionicons name="language-outline" size={20} color={c.onPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={openSettings}
          style={styles.gearBtn}
          hitSlop={10}
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={22} color={c.onPrimary} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.pickerSheet, { backgroundColor: c.bg }]}>
            <Text style={[styles.pickerTitle, { color: c.text }]}>{t('language')}</Text>
            <ScrollView style={styles.pickerList}>
              {(Object.entries(LANG_LABELS) as [Lang, string][]).map(([code, label]) => (
                <TouchableOpacity
                  key={code}
                  style={[
                    styles.pickerRow,
                    { borderColor: c.border },
                    lang === code && { backgroundColor: c.primaryBg },
                  ]}
                  onPress={() => { setLang(code); setPickerOpen(false) }}
                >
                  <Text style={[styles.pickerRowText, { color: c.text }, lang === code && { color: c.primary, fontWeight: '700' }]}>
                    {label}
                  </Text>
                  {lang === code && <Ionicons name="checkmark" size={18} color={c.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  left: { flex: 1 },
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gearBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    padding: 7,
  },
  langBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    padding: 7,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  pickerList: {},
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerRowText: {
    fontSize: 15,
  },
})
