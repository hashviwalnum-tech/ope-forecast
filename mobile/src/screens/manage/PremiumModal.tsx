import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { BusinessRead, SubscriptionRead } from '../../api/types'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'

// Google's own subscription page for this app. Allowed in the Play build: it is
// Google Play itself, not somewhere else to pay.
const PLAY_MANAGE_URL =
  'https://play.google.com/store/account/subscriptions?sku=ope_premium&package=com.opeforecast.app'

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
  'premiumPaidItem4',
] as const

export default function PremiumModal({ business, onClose }: Props) {
  const c = useTheme()
  const { t, lang } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

  const [sub, setSub] = useState<SubscriptionRead | null>(null)
  const [subLoading, setSubLoading] = useState(true)

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
  const status = sub?.subscription_status ?? 'none'
  const onPlay = sub?.subscription_provider === 'google_play'
  // Paying through Google Play and still entitled — renewing, in grace, or
  // cancelled but paid up to a date.
  const isActive = onPlay && isPremium && ['active', 'grace', 'cancelled'].includes(status)
  const isTrial = sub?.tier === 'trial' && isPremium && !isActive
  const isGranted = !!sub?.manual_grant && isPremium && !isActive && !isTrial
  const daysLeft = sub?.trial_days_remaining
  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(lang) : null
  const paidThrough = fmtDate(sub?.renewal_at)
  const grantEnds = fmtDate(sub?.manual_grant_ends_at)
  const paymentProblem = onPlay && ['grace', 'on_hold'].includes(status)

  function statusBadge() {
    if (isActive || isGranted) return { label: t('premiumStatusPremium'), color: '#d97706' }
    if (isTrial) return { label: t('premiumStatusTrial'), color: '#0d9488' }
    return { label: t('premiumStatusFree'), color: c.textMuted }
  }

  function statusLine(): string {
    if (isActive && status === 'cancelled' && paidThrough) return t('premiumCancelledUntil', { date: paidThrough })
    if (isActive) return t('premiumActiveMsg')
    if (isTrial && daysLeft !== null && daysLeft !== undefined && daysLeft > 0)
      return t('premiumTrialDays', { n: daysLeft, s: daysLeft === 1 ? '' : 's' })
    if (isGranted) return grantEnds ? t('premiumGrantedUntil', { date: grantEnds }) : t('premiumGranted')
    if (sub?.tier === 'trial') return t('premiumTrialEnded')
    return t('premiumFreeMsg')
  }

  const badge = statusBadge()

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
              <Text style={styles.statusSub}>{statusLine()}</Text>
            )}
            {paymentProblem && (
              <Text style={[styles.statusSub, { color: '#b45309' }]}>{t('premiumPaymentProblem')}</Text>
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

          {/* Buying Premium from the app arrives with Google Play Billing.
              Until then this says only that — Play forbids pointing an app's
              users anywhere else to pay, so there is no link, price or
              mention of the website here. */}
          {!isPremium && (
            <View style={styles.noteBox}>
              <Ionicons name="information-circle-outline" size={16} color={c.textMuted} />
              <Text style={styles.noteText}>{t('premiumComingSoon')}</Text>
            </View>
          )}

          {/* Google's own page for managing or cancelling a Play subscription. */}
          {onPlay && (isActive || paymentProblem) && (
            <TouchableOpacity
              style={styles.manageBtn}
              onPress={() => Linking.openURL(PLAY_MANAGE_URL)}
              accessibilityRole="link"
              activeOpacity={0.8}
            >
              <Text style={styles.manageBtnText}>{t('premiumManageOnPlay')}</Text>
            </TouchableOpacity>
          )}

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

    noteBox: {
      marginTop: 28, flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      backgroundColor: c.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: c.border,
    },
    noteText: { flex: 1, fontSize: 13, color: c.textSub, lineHeight: 18 },

    manageBtn: {
      marginTop: 28, alignItems: 'center', justifyContent: 'center', minHeight: 48,
      borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card,
    },
    manageBtnText: { fontSize: 14, fontWeight: '600', color: c.primary },
  })
}
