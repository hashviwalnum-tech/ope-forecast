import AsyncStorage from '@react-native-async-storage/async-storage'
import { useMemo, useState } from 'react'
import {
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../lib/i18n'
import type { Theme } from '../lib/theme'

// ── Persistence ────────────────────────────────────────────────────────────────

const KEY = (bizId: number) => `ope_tour_done_${bizId}`

export async function isTourDone(bizId: number): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY(bizId))) === '1' } catch { return false }
}
export async function clearTourDone(bizId: number): Promise<void> {
  try { await AsyncStorage.removeItem(KEY(bizId)) } catch { /* ignore */ }
}
async function markDone(bizId: number) {
  try { await AsyncStorage.setItem(KEY(bizId), '1') } catch { /* ignore */ }
}

// ── Step definitions ───────────────────────────────────────────────────────────

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

interface Step {
  titleKey: TranslationKey
  bodyKey:  TranslationKey
  icon:     IoniconName
  // If set, this step highlights that bottom-tab index (0=Log 1=Forecast 2=Analytics 3=Manage)
  tabIndex?: 0 | 1 | 2 | 3
}

const STEPS: Step[] = [
  { titleKey: 'tourWelcomeTitle',  bodyKey: 'tourWelcomeBody',  icon: 'hand-right-outline' },
  { titleKey: 'tourLogTitle',      bodyKey: 'tourLogBody',      icon: 'add-circle-outline',  tabIndex: 0 },
  { titleKey: 'tourSaleTitle',     bodyKey: 'tourSaleBody',     icon: 'cart-outline' },
  { titleKey: 'tourForecastTitle', bodyKey: 'tourForecastBody', icon: 'calendar-outline',    tabIndex: 1 },
  { titleKey: 'tourOrderTitle',    bodyKey: 'tourOrderBody',    icon: 'cube-outline' },
  { titleKey: 'tourAnalyticsTitle',bodyKey: 'tourAnalyticsBody',icon: 'bar-chart-outline',   tabIndex: 2 },
  { titleKey: 'tourManageTitle',   bodyKey: 'tourManageBody',   icon: 'grid-outline',        tabIndex: 3 },
  { titleKey: 'tourDoneTitle',     bodyKey: 'tourDoneBody',     icon: 'checkmark-circle-outline' },
]

const TAB_LABELS: IoniconName[] = [
  'add-circle-outline', 'calendar-outline', 'bar-chart-outline', 'grid-outline',
]

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  bizId:  number
  onDone: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function GuidedTour({ bizId, onDone }: Props) {
  const c      = useTheme()
  const { t }  = useLanguage()
  const insets = useSafeAreaInsets()
  const { width: SW, height: SH } = Dimensions.get('window')

  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  // Tab bar geometry
  const TAB_INNER  = Platform.OS === 'ios' ? 49 : 56
  const TAB_H      = TAB_INNER + insets.bottom

  // Evenly spaced tab centers across screen width (4 tabs)
  const tabX = (i: number) => SW * (2 * i + 1) / 8

  const hasTab  = current.tabIndex !== undefined
  const tabIdx  = current.tabIndex ?? 0

  const styles = useMemo(() => makeStyles(c), [c])

  function finish() {
    void markDone(bizId)
    onDone()
  }
  function next() { isLast ? finish() : setStep(s => s + 1) }

  // Card sits in the upper ~60% of the content area so tab bar is visible on tab steps
  const contentH  = SH - (hasTab ? TAB_H : insets.bottom)
  const CARD_TOP  = hasTab ? contentH * 0.12 : SH * 0.22

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent>

      {/* ── Dark backdrop (leaves tab bar exposed for tab steps) ─────────── */}
      <View
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          bottom: hasTab ? TAB_H : 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
        }}
        pointerEvents="box-only"
      />
      {/* Bottom strip (covers status bar / safe area below tab on non-tab steps) */}
      {!hasTab && (
        <View
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: insets.bottom,
            backgroundColor: 'rgba(0,0,0,0.65)',
          }}
          pointerEvents="none"
        />
      )}

      {/* ── Tab bar highlight ring (tab steps only) ─────────────────────── */}
      {hasTab && (
        <View style={{
          position: 'absolute',
          bottom: insets.bottom + 4,
          left: tabX(tabIdx) - 30,
          width: 60, height: 42,
          borderRadius: 14,
          borderWidth: 2.5,
          borderColor: c.primary,
          backgroundColor: 'rgba(13,148,136,0.18)',
        }} pointerEvents="none" />
      )}

      {/* ── Arrow connector: card → tab highlight ───────────────────────── */}
      {hasTab && (() => {
        const arrowX = tabX(tabIdx) - 10
        return (
          <View
            style={{
              position: 'absolute',
              bottom: insets.bottom + TAB_INNER + 6,
              left: arrowX,
              width: 0, height: 0,
              borderLeftWidth: 10, borderLeftColor: 'transparent',
              borderRightWidth: 10, borderRightColor: 'transparent',
              borderTopWidth: 14, borderTopColor: c.primary,
            }}
            pointerEvents="none"
          />
        )
      })()}

      {/* ── Tour card ────────────────────────────────────────────────────── */}
      <View style={[styles.card, { top: CARD_TOP }]}>

        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === step ? c.primary : i < step ? c.primaryBg : c.border,
                  width: i === step ? 20 : 7,
                },
              ]}
            />
          ))}
        </View>

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: c.primaryBg }]}>
          <Ionicons name={current.icon} size={36} color={c.primary} />
        </View>

        {/* Mini tab indicator (tab steps) */}
        {hasTab && (
          <View style={[styles.tabStrip, { backgroundColor: c.card, borderColor: c.border }]}>
            {TAB_LABELS.map((icon, i) => (
              <View
                key={i}
                style={[
                  styles.tabItem,
                  i === tabIdx && { backgroundColor: c.primaryBg, borderRadius: 10 },
                ]}
              >
                <Ionicons
                  name={icon}
                  size={20}
                  color={i === tabIdx ? c.primary : c.textMuted}
                />
              </View>
            ))}
          </View>
        )}

        {/* Title */}
        <Text style={[styles.title, { color: c.text }]}>{t(current.titleKey)}</Text>

        {/* Body */}
        <Text style={[styles.body, { color: c.textSub }]}>{t(current.bodyKey)}</Text>

        {/* Buttons */}
        <View style={styles.btnRow}>
          <TouchableOpacity onPress={finish} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.skipAll, { color: c.textMuted }]}>{t('tourSkipAll')}</Text>
          </TouchableOpacity>
          <View style={styles.rightBtns}>
            {!isLast && (
              <TouchableOpacity onPress={next} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.skipStep, { color: c.textMuted }]}>{t('tourSkipStep')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: c.primary }]}
              onPress={next}
              activeOpacity={0.8}
            >
              <Text style={[styles.nextBtnText, { color: c.onPrimary }]}>
                {isLast ? t('tourFinish') : t('tourNext')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

function makeStyles(c: Theme) {
  const { width: SW } = Dimensions.get('window')
  return StyleSheet.create({
    card: {
      position: 'absolute',
      left: 20, right: 20,
      backgroundColor: c.card,
      borderRadius: 22,
      padding: 22,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 16,
      gap: 14,
    },
    dotsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    dot: {
      height: 5,
      borderRadius: 3,
      opacity: 0.85,
    },
    iconWrap: {
      width: 68, height: 68,
      borderRadius: 18,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabStrip: {
      flexDirection: 'row',
      borderRadius: 14,
      borderWidth: 1,
      overflow: 'hidden',
      alignSelf: 'center',
      width: SW - 84,
    },
    tabItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
    },
    body: {
      fontSize: 14,
      lineHeight: 21,
      textAlign: 'center',
    },
    btnRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    skipAll: { fontSize: 13 },
    rightBtns: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    skipStep: { fontSize: 13 },
    nextBtn: {
      paddingHorizontal: 22,
      paddingVertical: 12,
      borderRadius: 14,
    },
    nextBtnText: { fontSize: 15, fontWeight: '700' },
  })
}
