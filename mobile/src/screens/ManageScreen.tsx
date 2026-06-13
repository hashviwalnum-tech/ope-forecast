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
import { useTheme, type Theme } from '../lib/theme'
import { useBusiness } from '../contexts/BusinessContext'
import type { BusinessRead } from '../api/types'

import ProductsModal from './manage/ProductsModal'
import RegularsModal from './manage/RegularsModal'
import PastDaysModal from './manage/PastDaysModal'
import SettingsModal from './manage/SettingsModal'
import TelegramModal from './manage/TelegramModal'
import PremiumModal from './manage/PremiumModal'
import OrdersModal from './manage/OrdersModal'

type ModalKey =
  | 'products'
  | 'regulars'
  | 'pastdays'
  | 'settings'
  | 'telegram'
  | 'premium'
  | 'orders'
  | null

interface MenuItem {
  key: ModalKey
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  sub: string
  requiresBusiness?: boolean
}

const MENU_ITEMS: MenuItem[] = [
  {
    key: 'settings',
    icon: 'settings-outline',
    label: 'Business Settings',
    sub: 'Opening hours, days, service time & stock tracking',
    requiresBusiness: true,
  },
  {
    key: 'products',
    icon: 'cube-outline',
    label: 'Products',
    sub: 'Add, edit, or remove products you sell',
  },
  {
    key: 'regulars',
    icon: 'heart-outline',
    label: 'Regulars',
    sub: 'Track loyal customers & their value',
  },
  {
    key: 'pastdays',
    icon: 'calendar-outline',
    label: 'Past Days',
    sub: 'Backfill or correct historical data',
  },
  {
    key: 'orders',
    icon: 'cart-outline',
    label: 'Orders',
    sub: 'Log "I ordered this" & track arrivals',
  },
  {
    key: 'telegram',
    icon: 'paper-plane-outline',
    label: 'Telegram',
    sub: 'Connect the Ope bot for voice-style logging',
  },
  {
    key: 'premium',
    icon: 'star-outline',
    label: 'Premium',
    sub: 'Manage your subscription tier',
    requiresBusiness: true,
  },
]

export default function ManageScreen() {
  const c = useTheme()
  const { business, reload } = useBusiness()
  const styles = useMemo(() => makeStyles(c), [c])

  const [activeModal, setActiveModal] = useState<ModalKey>(null)

  const handleBusinessUpdated = async (updated: BusinessRead) => {
    // BusinessContext doesn't hold the full updated object, so reload it
    await reload()
    void updated // ts unused
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Manage</Text>
          {business !== null && (
            <Text style={styles.headerSub}>{business.name}</Text>
          )}
        </View>
        {business !== null && (
          <View style={styles.tierBadge}>
            <Ionicons
              name={business.tier === 'premium' ? 'star' : 'star-outline'}
              size={12}
              color={business.tier === 'premium' ? '#d97706' : c.onPrimarySub}
            />
            <Text style={[
              styles.tierText,
              business.tier === 'premium' && styles.tierTextPremium,
            ]}>
              {business.tier === 'premium' ? 'Premium' : 'Free'}
            </Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {MENU_ITEMS.map(item => {
          const disabled = item.requiresBusiness && !business
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.menuItem, disabled && styles.menuItemDisabled]}
              onPress={() => { if (!disabled) setActiveModal(item.key) }}
              activeOpacity={0.7}
              disabled={disabled}
            >
              <View style={styles.menuIcon}>
                <Ionicons name={item.icon} size={22} color={disabled ? c.textMuted : c.primary} />
              </View>
              <View style={styles.menuText}>
                <Text style={[styles.menuLabel, disabled && { color: c.textMuted }]}>
                  {item.label}
                </Text>
                <Text style={styles.menuSub}>{item.sub}</Text>
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
          style={styles.signOutBtn}
          onPress={() => void supabase.auth.signOut()}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={20} color={c.danger} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Modals ── only mount when active (avoids premature data loading) */}
      {activeModal === 'products' && (
        <ProductsModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'regulars' && (
        <RegularsModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'pastdays' && (
        <PastDaysModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'settings' && business !== null && (
        <SettingsModal
          business={business}
          onClose={() => setActiveModal(null)}
          onSaved={b => void handleBusinessUpdated(b)}
        />
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
    </SafeAreaView>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },

    header: {
      backgroundColor: c.headerBg,
      paddingHorizontal: 20,
      paddingBottom: 16,
      paddingTop: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    headerTitle: { fontSize: 26, fontWeight: '700', color: c.onPrimary },
    headerSub: { fontSize: 12, color: c.onPrimarySub, marginTop: 2 },
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
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 72,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 3,
      elevation: 1,
    },
    menuItemDisabled: { opacity: 0.5 },
    menuIcon: {
      width: 40, height: 40, borderRadius: 10,
      backgroundColor: c.primaryXBg, alignItems: 'center', justifyContent: 'center',
    },
    menuText: { flex: 1, gap: 3 },
    menuLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    menuSub: { fontSize: 12, color: c.textSub, lineHeight: 18 },

    spacer: { flex: 1, minHeight: 24 },

    signOutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.dangerBg,
      borderRadius: 14,
      paddingVertical: 16,
    },
    signOutText: { fontSize: 16, fontWeight: '600', color: c.danger },
  })
}
