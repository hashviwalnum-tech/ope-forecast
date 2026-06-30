import { useState, useMemo, useEffect, useCallback } from 'react'
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
import type { BusinessRead, SubscriptionRead } from '../../api/types'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'

interface Props {
  business: BusinessRead
  onClose: () => void
  onUpdated: (b: BusinessRead) => void
}

const FREE_FEATURE_KEYS = [
  'premiumFreeItem1',
  'premiumFreeItem2',
  'premiumFreeItem3',
  'premiumFreeItem4',
  'premiumFreeItem5',
  'premiumFreeItem6',
] as const

const PREMIUM_FEATURE_KEYS = [
  'premiumPaidItem1',
  'premiumPaidItem2',
  'premiumPaidItem3',
  'premiumPaidItem4',
  'premiumPaidItem5',
  'premiumPaidItem6',
] as const

export default function PremiumModal({ business, onClose, onUpdated }: Props) {
  const c = useTheme()
  const { t } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

  const [sub, setSub] = useState<SubscriptionRead | null>(null)
  const [subLoading, setSubLoading] = useState(true)
  const [upgrading, setUpgrading] = useState(false)

  const loadSub = useCallback(async () => {
    setSubLoading(true)
    try {
      const data = await api.subscription.get()
      setSub(data)
    } catch {
      // Silently fail — show info based on business.tier
    } finally {
      setSubLoading(false)
    }
  }, [])

  useEffect(() => { loadSub() }, [loadSub])

  const isPremium = sub ? sub.effective_tier === 'premium' : business.tier === 'premium'
  const isActive = sub?.subscription_status === 'active'
  const isTrial = sub?.tier === 'trial' && isPremium
  const daysLeft = sub?.trial_days_remaining

  function statusBadge() {
    if (isActive) return { label: t('premiumStatusPremium'), color: '#d97706' }
    if (isTrial) return { label: t('premiumStatusTrial'), color: '#0d9488' }
    return { label: t('premiumStatusFree'), color: c.textMuted }
  }

  const badge = statusBadge()

  const setTier = (tier: 'free' | 'premium') => {
    Alert.alert(
      tier === 'premium' ? t('premiumUpgradeToPremium') : t('premiumDowngradeToFree'),
      tier === 'premium' ? 'Set this account to premium tier?' : 'Downgrade to the free tier?',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: tier === 'premium' ? t('premiumUpgradeToPremium') : t('premiumDowngradeToFree'),
          style: tier === 'free' ? 'destructive' : 'default',
          onPress: async () => {
            setUpgrading(true)
            try {
              const updated = await api.businesses.setTier(tier)
              onUpdated(updated)
              await loadSub()
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
            <Text style={styles.backLabel}>{t('manage')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('premiumTitle')}</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

          {/* Status card */}
          <View style={[styles.statusCard, isPremium && styles.statusCardPremium]}>
            <View style={styles.statusRow}>
              <Ionicons
                name={isPremium ? 'star' : 'star-outline'}
                size={28}
                color={badge.color}
              />
              <View style={[styles.badgePill, { backgroundColor: badge.color + '22' }]}>
                <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            </View>

            {subLoading ? (
              <ActivityIndicator size="small" color={c.primary} style={{ marginTop: 8 }} />
            ) : (
              <Text style={styles.statusSub}>
                {isActive
                  ? t('premiumActiveMsg')
                  : isTrial && daysLeft !== null && daysLeft !== undefined && daysLeft > 0
                    ? t('premiumTrialDays', { n: daysLeft, s: daysLeft === 1 ? '' : 's' })
                    : isTrial
                      ? t('premiumTrialEnded')
                      : t('premiumFreeMsg')
                }
              </Text>
            )}
            {isTrial && (
              <Text style={[styles.statusSub, { fontSize: 12, marginTop: 4, color: c.textMuted }]}>
                {t('premiumTrialActive')}
              </Text>
            )}
          </View>

          {/* Free features */}
          <Text style={styles.sectionLabel}>{t('premiumFreeFeatures')}</Text>
          {FREE_FEATURE_KEYS.map(key => (
            <View key={key} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={18} color={c.primary} />
              <Text style={styles.featureText}>{t(key)}</Text>
            </View>
          ))}

          {/* Premium features */}
          <Text style={[styles.sectionLabel, { marginTop: 20, color: '#d97706' }]}>
            {t('premiumPaidFeatures')}
          </Text>
          {PREMIUM_FEATURE_KEYS.map(key => (
            <View key={key} style={styles.featureRow}>
              <Ionicons
                name={isPremium ? 'checkmark-circle' : 'lock-closed-outline'}
                size={18}
                color={isPremium ? '#d97706' : c.textMuted}
              />
              <Text style={[styles.featureText, !isPremium && styles.featureTextLocked]}>
                {t(key)}
              </Text>
            </View>
          ))}

          {/* Upgrade section — only when not active paying subscriber */}
          {!isActive && (
            <View style={styles.upgradeSection}>
              <Text style={styles.upgradeSectionTitle}>{t('premiumUpgradeTitle')}</Text>

              {/* Pricing display */}
              <View style={styles.pricingRow}>
                <View style={styles.pricingCard}>
                  <Text style={styles.pricingAmount}>{t('premiumMonthly')}</Text>
                </View>
                <View style={[styles.pricingCard, styles.pricingCardAnnual]}>
                  <Text style={[styles.pricingAmount, { color: '#d97706' }]}>{t('premiumAnnual')}</Text>
                  <Text style={styles.pricingSave}>{t('premiumAnnualSave')}</Text>
                </View>
              </View>

              {/* Web payment note */}
              <View style={styles.webNoteBox}>
                <Ionicons name="information-circle-outline" size={16} color={c.textMuted} />
                <Text style={styles.webNoteText}>{t('premiumWebNote')}</Text>
              </View>
            </View>
          )}

          {/* Test mode section */}
          <View style={styles.testSection}>
            <Text style={styles.testSectionTitle}>{t('premiumTestModeTitle')}</Text>
            <Text style={styles.testSectionDesc}>{t('premiumTestModeDesc')}</Text>

            {!isPremium ? (
              <TouchableOpacity
                style={styles.upgradeBtn}
                onPress={() => setTier('premium')}
                disabled={upgrading}
                activeOpacity={0.85}
              >
                {upgrading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                    <Ionicons name="star" size={16} color="#fff" />
                    <Text style={styles.upgradeBtnText}>{t('premiumUpgradeToPremium')}</Text>
                  </>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.downgradeBtn}
                onPress={() => setTier('free')}
                disabled={upgrading}
                activeOpacity={0.8}
              >
                {upgrading
                  ? <ActivityIndicator size="small" color={c.textSub} />
                  : <Text style={styles.downgradeBtnText}>{t('premiumDowngradeToFree')}</Text>}
              </TouchableOpacity>
            )}
          </View>

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
    bodyContent: { padding: 20, paddingBottom: 48 },

    statusCard: {
      backgroundColor: c.card, borderRadius: 16, padding: 20, marginBottom: 24,
      borderWidth: 1, borderColor: c.border, gap: 8,
    },
    statusCardPremium: {
      backgroundColor: '#fffbeb', borderColor: '#fde68a',
    },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    badgePill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
    badgeText: { fontSize: 12, fontWeight: '700' },
    statusSub: { fontSize: 13, color: c.textSub },

    sectionLabel: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
    },
    featureRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.border,
    },
    featureText: { flex: 1, fontSize: 14, color: c.text },
    featureTextLocked: { color: c.textSub },

    upgradeSection: {
      marginTop: 28, backgroundColor: c.card,
      borderRadius: 16, padding: 20, borderWidth: 1, borderColor: c.border,
    },
    upgradeSectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 14 },
    pricingRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    pricingCard: {
      flex: 1, borderRadius: 12, padding: 14, borderWidth: 1.5,
      borderColor: c.primary, backgroundColor: c.bg,
      alignItems: 'center',
    },
    pricingCardAnnual: { borderColor: '#d97706' },
    pricingAmount: { fontSize: 15, fontWeight: '700', color: c.primary },
    pricingSave: { fontSize: 11, color: '#d97706', marginTop: 2 },

    webNoteBox: {
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      backgroundColor: c.bg, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: c.border,
    },
    webNoteText: { flex: 1, fontSize: 12, color: c.textSub, lineHeight: 17 },

    testSection: {
      marginTop: 28, backgroundColor: c.card, borderRadius: 16, padding: 16,
      borderWidth: 1, borderColor: c.border, borderStyle: 'dashed',
    },
    testSectionTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted, marginBottom: 2 },
    testSectionDesc: { fontSize: 12, color: c.textMuted, marginBottom: 12 },

    upgradeBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: '#d97706', borderRadius: 12, paddingVertical: 13,
    },
    upgradeBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

    downgradeBtn: {
      alignItems: 'center', borderRadius: 12, paddingVertical: 12,
      borderWidth: 1, borderColor: c.border,
    },
    downgradeBtnText: { fontSize: 13, color: c.textSub },
  })
}
