import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../contexts/ThemeContext'
import { useSettingsSheet } from '../contexts/SettingsContext'

interface AppHeaderProps {
  title: string
  subtitle?: string
  /** Optional extra element rendered on the right, alongside the gear icon */
  rightExtra?: React.ReactNode
}

export default function AppHeader({ title, subtitle, rightExtra }: AppHeaderProps) {
  const c = useTheme()
  const { openSettings } = useSettingsSheet()

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
          onPress={openSettings}
          style={styles.gearBtn}
          hitSlop={10}
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={22} color={c.onPrimary} />
        </TouchableOpacity>
      </View>
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
})
