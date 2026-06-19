import { useState, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useBusiness } from '../contexts/BusinessContext'
import type { BusinessRead } from '../api/types'
import type { Theme } from '../lib/theme'
import AppHeader from '../components/AppHeader'

import ProductsModal from './manage/ProductsModal'
import RegularsModal from './manage/RegularsModal'
import PastDaysModal from './manage/PastDaysModal'
import TelegramModal from './manage/TelegramModal'
import PremiumModal from './manage/PremiumModal'
import OrdersModal from './manage/OrdersModal'
import PeriodsModal from './manage/PeriodsModal'
import RecurringPatternsModal from './manage/RecurringPatternsModal'
import FeedbackModal from './manage/FeedbackModal'

type ModalKey =
  | 'products'
  | 'regulars'
  | 'pastdays'
  | 'telegram'
  | 'premium'
  | 'orders'
  | 'periods'
  | 'patterns'
  | 'feedback'
  | null

interface MenuItem {
  key: ModalKey
  icon: React.ComponentProps<typeof Ionicons>['name']
  labelKey: 'products' | 'regulars' | 'pastDays' | 'orders' | 'telegram' | 'premium' | 'adsEvents' | 'patterns' | 'feedback'
  subKey: 'productsDesc' | 'regularsDesc' | 'pastDaysDesc' | 'ordersDesc' | 'telegramDesc' | 'premiumDesc' | 'adsEventsDesc' | 'patternsDesc' | 'feedbackDesc'
  requiresBusiness?: boolean
}

const MENU_ITEMS: MenuItem[] = [
  { key: 'products', icon: 'cube-outline', labelKey: 'products', subKey: 'productsDesc' },
  { key: 'regulars', icon: 'heart-outline', labelKey: 'regulars', subKey: 'regularsDesc' },
  { key: 'pastdays', icon: 'calendar-outline', labelKey: 'pastDays', subKey: 'pastDaysDesc' },
  { key: 'periods', icon: 'megaphone-outline', labelKey: 'adsEvents', subKey: 'adsEventsDesc' },
  { key: 'patterns', icon: 'repeat-outline', labelKey: 'patterns', subKey: 'patternsDesc' },
  { key: 'orders', icon: 'cart-outline', labelKey: 'orders', subKey: 'ordersDesc' },
  { key: 'telegram', icon: 'paper-plane-outline', labelKey: 'telegram', subKey: 'telegramDesc' },
  { key: 'premium', icon: 'star-outline', labelKey: 'premium', subKey: 'premiumDesc', requiresBusiness: true },
  { key: 'feedback', icon: 'chatbubble-ellipses-outline', labelKey: 'feedback', subKey: 'feedbackDesc' },
]

export default function ManageScreen() {
  const c = useTheme()
  const { t } = useLanguage()
  const { business, reload } = useBusiness()
  const styles = useMemo(() => makeStyles(c), [c])

  const [activeModal, setActiveModal] = useState<ModalKey>(null)

  const handleBusinessUpdated = async (updated: BusinessRead) => {
    await reload()
    void updated
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
      <AppHeader
        title={t('manage')}
        subtitle={business?.name}
        rightExtra={
          business !== null ? (
            <View style={[styles.tierBadge]}>
              <Ionicons
                name={business.tier === 'premium' ? 'star' : 'star-outline'}
                size={12}
                color={business.tier === 'premium' ? '#d97706' : c.onPrimarySub}
              />
              <Text style={[
                styles.tierText,
                business.tier === 'premium' && styles.tierTextPremium,
              ]}>
                {business.tier === 'premium' ? t('premiumTier') : t('free')}
              </Text>
            </View>
          ) : undefined
        }
      />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {MENU_ITEMS.map(item => {
          const disabled = item.requiresBusiness && !business
          return (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.menuItem,
                { backgroundColor: c.card, borderColor: c.border },
                disabled && styles.menuItemDisabled,
              ]}
              onPress={() => { if (!disabled) setActiveModal(item.key) }}
              activeOpacity={0.7}
              disabled={disabled}
            >
              <View style={[styles.menuIcon, { backgroundColor: c.primaryXBg }]}>
                <Ionicons name={item.icon} size={22} color={disabled ? c.textMuted : c.primary} />
              </View>
              <View style={styles.menuText}>
                <Text style={[styles.menuLabel, { color: disabled ? c.textMuted : c.text }]}>
                  {t(item.labelKey)}
                </Text>
                <Text style={[styles.menuSub, { color: c.textSub }]}>{t(item.subKey)}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={disabled ? c.border : c.textMuted}
              />
            </TouchableOpacity>
          )
        })}

        <View style={styles.spacer} />

        <TouchableOpacity
          style={[styles.signOutBtn, { backgroundColor: c.dangerBg }]}
          onPress={() => void supabase.auth.signOut()}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={20} color={c.danger} />
          <Text style={[styles.signOutText, { color: c.danger }]}>{t('signOut')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {activeModal === 'products' && (
        <ProductsModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'regulars' && (
        <RegularsModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'pastdays' && (
        <PastDaysModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'telegram' && (
        <TelegramModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'premium' && business !== null && (
        <PremiumModal
          business={business}
          onClose={() => setActiveModal(null)}
          onUpdated={b => void handleBusinessUpdated(b)}
        />
      )}
      {activeModal === 'orders' && (
        <OrdersModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'periods' && (
        <PeriodsModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'patterns' && (
        <RecurringPatternsModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'feedback' && (
        <FeedbackModal onClose={() => setActiveModal(null)} />
      )}
    </SafeAreaView>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1 },
    tierBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    tierText: { fontSize: 12, fontWeight: '600', color: c.onPrimarySub },
    tierTextPremium: { color: '#fcd34d' },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40 },

    menuItem: {
      borderRadius: 14, padding: 16, marginBottom: 8,
      flexDirection: 'row', alignItems: 'center', gap: 14,
      borderWidth: 1, minHeight: 72,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
    },
    menuItemDisabled: { opacity: 0.5 },
    menuIcon: {
      width: 40, height: 40, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
    },
    menuText: { flex: 1, gap: 3 },
    menuLabel: { fontSize: 15, fontWeight: '700' },
    menuSub: { fontSize: 12, lineHeight: 18 },

    spacer: { flex: 1, minHeight: 24 },

    signOutBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, borderRadius: 14, paddingVertical: 16,
    },
    signOutText: { fontSize: 16, fontWeight: '600' },
  })
}
