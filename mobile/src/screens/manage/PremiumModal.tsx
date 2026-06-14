import { useState, useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { BusinessRead } from '../../api/types'
import { useTheme } from '../../contexts/ThemeContext'
import type { Theme } from '../../lib/theme'

interface Props {
  business: BusinessRead
  onClose: () => void
  onUpdated: (b: BusinessRead) => void
}

const PREMIUM_FEATURES = [
  { icon: 'location-outline' as const, text: 'Multiple locations' },
  { icon: 'time-outline' as const, text: 'Extended history beyond 1 year' },
  { icon: 'megaphone-outline' as const, text: 'More ad campaigns (unlimited)' },
  { icon: 'bar-chart-outline' as const, text: 'Advanced analytics & charts' },
  { icon: 'flash-outline' as const, text: 'Priority server response' },
]

const FREE_FEATURES = [
  { icon: 'analytics-outline' as const, text: 'Full forecasting & ordering advice' },
  { icon: 'people-outline' as const, text: 'Staffing recommendations' },
  { icon: 'heart-outline' as const, text: 'Regulars & CLV tracking' },
  { icon: 'repeat-outline' as const, text: 'Recurring patterns (unlimited)' },
  { icon: 'calendar-outline' as const, text: '1 year of history' },
  { icon: 'megaphone-outline' as const, text: '10 one-off events' },
]

export default function PremiumModal({ business, onClose, onUpdated }: Props) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const isPremium = business.tier === 'premium'
  const [upgrading, setUpgrading] = useState(false)

  const upgrade = () => {
    Alert.alert(
      'Upgrade to Premium',
      'Set this account to premium tier?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Upgrade',
          onPress: async () => {
            setUpgrading(true)
            try {
              const updated = await api.businesses.setTier('premium')
              onUpdated(updated)
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to upgrade.')
            } finally {
              setUpgrading(false)
            }
          },
        },
      ]
    )
  }

  const downgrade = () => {
    Alert.alert(
      'Switch to Free',
      'Downgrade this account to the free tier?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Downgrade', style: 'destructive',
          onPress: async () => {
            setUpgrading(true)
            try {
              const updated = await api.businesses.setTier('free')
              onUpdated(updated)
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to change tier.')
            } finally {
              setUpgrading(false)
            }
          },
        },
      ]
    )
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>Manage</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Premium</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {/* Status badge */}
          <View style={[styles.statusCard, isPremium && styles.statusCardPremium]}>
            <Ionicons
              name={isPremium ? 'star' : 'star-outline'}
              size={32}
              color={isPremium ? '#d97706' : c.textMuted}
            />
            <Text style={[styles.statusTitle, isPremium && styles.statusTitlePremium]}>
              {isPremium ? 'Premium Account' : 'Free Account'}
            </Text>
            <Text style={styles.statusSub}>
              {isPremium
                ? 'You have access to all features.'
                : 'Core features are free forever.'}
            </Text>
          </View>

          {/* Free tier features */}
          <Text style={styles.sectionLabel}>Always free</Text>
          {FREE_FEATURES.map(f => (
            <View key={f.text} style={styles.featureRow}>
              <Ionicons name={f.icon} size={18} color={c.primary} />
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}

          {/* Premium features */}
          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Premium unlocks</Text>
          {PREMIUM_FEATURES.map(f => (
            <View key={f.text} style={styles.featureRow}>
              <Ionicons
                name={f.icon}
                size={18}
                color={isPremium ? '#d97706' : c.textMuted}
              />
              <Text style={[styles.featureText, !isPremium && styles.featureTextLocked]}>
                {f.text}
              </Text>
              {!isPremium && (
                <Ionicons name="lock-closed" size={12} color={c.textMuted} />
              )}
            </View>
          ))}

          {/* Action button */}
          {!isPremium ? (
            <TouchableOpacity
              style={styles.upgradeBtn}
              onPress={upgrade}
              disabled={upgrading}
              activeOpacity={0.85}
            >
              {upgrading
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                  <Ionicons name="star" size={18} color="#fff" />
                  <Text style={styles.upgradeBtnText}>Upgrade to Premium</Text>
                </>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.downgradeBtn}
              onPress={downgrade}
              disabled={upgrading}
              activeOpacity={0.8}
            >
              {upgrading
                ? <ActivityIndicator size="small" color={c.textSub} />
                : <Text style={styles.downgradeBtnText}>Switch to Free Tier</Text>}
            </TouchableOpacity>
          )}

          <Text style={styles.legalNote}>
            Billing is managed through the web app. Upgrading here sets your account tier
            for testing purposes.
          </Text>
        </ScrollView>
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
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 80 },
    backLabel: { fontSize: 14, color: c.onPrimary },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: c.onPrimary, textAlign: 'center' },

    body: { flex: 1 },
    bodyContent: { padding: 20, paddingBottom: 40 },

    statusCard: {
      alignItems: 'center', gap: 8, backgroundColor: c.card,
      borderRadius: 16, padding: 24, marginBottom: 24,
      borderWidth: 1, borderColor: c.border,
    },
    statusCardPremium: {
      backgroundColor: '#fffbeb', borderColor: '#fde68a',
    },
    statusTitle: { fontSize: 20, fontWeight: '700', color: c.text },
    statusTitlePremium: { color: '#92400e' },
    statusSub: { fontSize: 13, color: c.textSub, textAlign: 'center' },

    sectionLabel: {
      fontSize: 12, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
    },
    featureRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border,
    },
    featureText: { flex: 1, fontSize: 14, color: c.text },
    featureTextLocked: { color: c.textSub },

    upgradeBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: '#d97706', borderRadius: 14, paddingVertical: 16, marginTop: 28,
    },
    upgradeBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

    downgradeBtn: {
      alignItems: 'center', borderRadius: 14, paddingVertical: 14,
      marginTop: 28, borderWidth: 1, borderColor: c.border,
    },
    downgradeBtnText: { fontSize: 14, color: c.textSub },

    legalNote: {
      fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: 16, lineHeight: 16,
    },
  })
}

