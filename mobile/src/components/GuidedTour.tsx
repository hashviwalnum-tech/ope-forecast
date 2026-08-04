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
import { useAppTheme, useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../lib/i18n'
import type { Theme } from '../lib/theme'

// ── Persistence ─────────────────────────────────────────────────────────────

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

// ── Step / section definitions ───────────────────────────────────────────────

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

interface MobileTourStep {
  titleKey:       TranslationKey
  bodyKey:        TranslationKey
  icon:           IoniconName
  // Highlight the bottom-tab bar at this index (0=Log 1=Forecast 2=Analytics 3=Manage)
  tabIndex?:      0 | 1 | 2 | 3
  // Show an inline interactive toggle inside the tour card
  preferenceType?: 'darkMode' | 'simpleMode'
}

interface MobileTourSection {
  // null = Welcome / Done — no "Skip [section]" button
  nameKey: TranslationKey | null
  steps:   MobileTourStep[]
}

const SECTIONS: MobileTourSection[] = [
  {
    nameKey: null,
    steps: [
      { titleKey: 'tourWelcomeTitle', bodyKey: 'tourWelcomeBody', icon: 'hand-right-outline' },
    ],
  },
  {
    nameKey: 'tourSectionPreferences',
    steps: [
      { titleKey: 'tourDarkModeTitle',     bodyKey: 'tourDarkModeBody',     icon: 'contrast-outline',  preferenceType: 'darkMode' },
      { titleKey: 'tourFriendlyModeTitle', bodyKey: 'tourFriendlyModeBody', icon: 'text-outline',       preferenceType: 'simpleMode' },
    ],
  },
  {
    nameKey: 'log',
    steps: [
      { titleKey: 'tourLogTitle',      bodyKey: 'tourLogBody',      icon: 'add-circle-outline',   tabIndex: 0 },
      { titleKey: 'tourSaleTitle',     bodyKey: 'tourSaleBody',     icon: 'cart-outline' },
      { titleKey: 'tourLogRegularTitle', bodyKey: 'tourLogRegularBody', icon: 'people-outline' },
    ],
  },
  {
    nameKey: 'forecast',
    steps: [
      { titleKey: 'tourForecastTitle',   bodyKey: 'tourForecastBody',   icon: 'calendar-outline',  tabIndex: 1 },
      { titleKey: 'tourForecastBusyTitle', bodyKey: 'tourForecastBusyBody', icon: 'time-outline' },
      { titleKey: 'tourOrderTitle',      bodyKey: 'tourOrderBody',      icon: 'cube-outline' },
    ],
  },
  {
    nameKey: 'analytics',
    steps: [
      { titleKey: 'tourAnalyticsTitle',     bodyKey: 'tourAnalyticsBody',     icon: 'bar-chart-outline', tabIndex: 2 },
      { titleKey: 'tourAnalyticsAccTitle',  bodyKey: 'tourAnalyticsAccBody',  icon: 'checkmark-circle-outline' },
      { titleKey: 'tourAnalyticsStaffTitle', bodyKey: 'tourAnalyticsStaffBody', icon: 'people-circle-outline' },
      { titleKey: 'tourAnalyticsAdsTitle',  bodyKey: 'tourAnalyticsAdsBody',  icon: 'megaphone-outline' },
      { titleKey: 'tourAnalyticsRegTitle',  bodyKey: 'tourAnalyticsRegBody',  icon: 'heart-outline' },
    ],
  },
  {
    nameKey: 'manage',
    steps: [
      { titleKey: 'tourManageTitle',          bodyKey: 'tourManageBody',          icon: 'grid-outline',         tabIndex: 3 },
      { titleKey: 'tourManageProdTitle',       bodyKey: 'tourManageProdBody',       icon: 'storefront-outline' },
      { titleKey: 'tourManagePastTitle',       bodyKey: 'tourManagePastBody',       icon: 'calendar-number-outline' },
      { titleKey: 'tourManagePatTitle',        bodyKey: 'tourManagePatBody',        icon: 'repeat-outline' },
      { titleKey: 'tourManageSimpleLangTitle', bodyKey: 'tourManageSimpleLangBody', icon: 'text-outline' },
    ],
  },
  {
    nameKey: null,
    steps: [
      { titleKey: 'tourDoneTitle', bodyKey: 'tourDoneBody', icon: 'checkmark-circle-outline' },
    ],
  },
]

const TAB_LABELS: IoniconName[] = [
  'add-circle-outline', 'calendar-outline', 'bar-chart-outline', 'grid-outline',
]

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  bizId:  number
  onDone: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GuidedTour({ bizId, onDone }: Props) {
  const c      = useTheme()
  const { isDark, setPreference } = useAppTheme()
  const { t, dir, simpleMode, setSimpleMode } = useLanguage()
  const insets = useSafeAreaInsets()
  const { width: SW, height: SH } = Dimensions.get('window')

  const [sectionIdx, setSectionIdx] = useState(0)
  const [stepIdx, setStepIdx]       = useState(0)

  const section    = SECTIONS[sectionIdx]
  const step       = section.steps[stepIdx]
  const isLastSec  = sectionIdx === SECTIONS.length - 1
  const isLastStep = isLastSec && stepIdx === section.steps.length - 1
  const showSkipSec = section.nameKey !== null && !isLastSec

  // Section-based progress dots
  const totalSections = SECTIONS.length

  const hasTab  = step.tabIndex !== undefined
  const tabIdx  = step.tabIndex ?? 0

  const styles = useMemo(() => makeStyles(c), [c])
  const isRtl  = dir === 'rtl'

  function finish() {
    void markDone(bizId)
    onDone()
  }

  function next() {
    if (isLastStep) { finish(); return }
    if (stepIdx < section.steps.length - 1) {
      setStepIdx(s => s + 1)
    } else {
      setSectionIdx(s => s + 1)
      setStepIdx(0)
    }
  }

  function back() {
    if (stepIdx > 0) {
      setStepIdx(s => s - 1)
    } else if (sectionIdx > 0) {
      const prev = SECTIONS[sectionIdx - 1]
      setSectionIdx(s => s - 1)
      setStepIdx(prev.steps.length - 1)
    }
  }

  function skipSection() {
    if (sectionIdx < SECTIONS.length - 1) {
      setSectionIdx(s => s + 1)
      setStepIdx(0)
    } else {
      finish()
    }
  }

  const isFirstStep = sectionIdx === 0 && stepIdx === 0

  // Tab bar geometry
  const TAB_INNER = Platform.OS === 'ios' ? 49 : 56
  const TAB_H     = TAB_INNER + insets.bottom
  const tabX      = (i: number) => SW * (2 * i + 1) / 8

  // Card position — upper portion so tab bar is visible on tab steps
  const contentH = SH - (hasTab ? TAB_H : insets.bottom)
  const CARD_TOP = hasTab ? contentH * 0.10 : SH * 0.20

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent>

      {/* ── Dark backdrop ─────────────────────────────────────────────────── */}
      <View
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          bottom: hasTab ? TAB_H : 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
        }}
        pointerEvents="box-only"
      />
      {!hasTab && (
        <View
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: insets.bottom,
            backgroundColor: 'rgba(0,0,0,0.65)',
          }}
          pointerEvents="none"
        />
      )}

      {/* ── Tab bar highlight ring (tab-intro steps only) ─────────────────── */}
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

      {/* ── Arrow connecting card to tab highlight ────────────────────────── */}
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

      {/* ── Tour card ─────────────────────────────────────────────────────── */}
      <View style={[styles.card, { top: CARD_TOP }]}>

        {/* Top row: section progress */}
        <View style={[styles.topRow, isRtl && { flexDirection: 'row-reverse' }]}>
          {/* Section progress dots */}
          <View style={[styles.dotsRow, isRtl && { flexDirection: 'row-reverse' }]}>
            {Array.from({ length: totalSections }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i === sectionIdx ? c.primary
                      : i < sectionIdx ? c.primaryBg
                      : c.border,
                    width: i === sectionIdx ? 20 : 7,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {/* Section label */}
        {section.nameKey && (
          <Text style={[styles.sectionLabel, { color: c.primary }]}>
            {t(section.nameKey as TranslationKey).toUpperCase()}
          </Text>
        )}

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: c.primaryBg }]}>
          <Ionicons name={step.icon} size={36} color={c.primary} />
        </View>

        {/* Inline preference toggle (darkMode / simpleMode steps) */}
        {step.preferenceType === 'darkMode' && (
          <TouchableOpacity
            style={[
              styles.prefToggle,
              { backgroundColor: isDark ? c.primary : c.card, borderColor: isDark ? c.primary : c.border },
            ]}
            onPress={() => setPreference(isDark ? 'light' : 'dark')}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isDark ? 'moon' : 'sunny-outline'}
              size={20}
              color={isDark ? '#fff' : c.textSub}
            />
            <Text style={[styles.prefToggleText, { color: isDark ? '#fff' : c.textSub }]}>
              {isDark ? t('darkMode') : t('lightMode')}
            </Text>
          </TouchableOpacity>
        )}
        {step.preferenceType === 'simpleMode' && (
          <TouchableOpacity
            style={[
              styles.prefToggle,
              { backgroundColor: simpleMode ? c.primary : c.card, borderColor: simpleMode ? c.primary : c.border },
            ]}
            onPress={() => setSimpleMode(!simpleMode)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={simpleMode ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={simpleMode ? '#fff' : c.textSub}
            />
            <Text style={[styles.prefToggleText, { color: simpleMode ? '#fff' : c.textSub }]}>
              {simpleMode ? t('simpleModeOn') : t('simpleModeOff')}
            </Text>
          </TouchableOpacity>
        )}

        {/* Mini tab indicator (tab-intro steps only) */}
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
                <Ionicons name={icon} size={20} color={i === tabIdx ? c.primary : c.textMuted} />
              </View>
            ))}
          </View>
        )}

        {/* Title */}
        <Text style={[styles.title, { color: c.text }]}>{t(step.titleKey)}</Text>

        {/* Body */}
        <Text style={[styles.body, { color: c.textSub }]}>{t(step.bodyKey)}</Text>

        {/* Buttons */}
        <View style={[styles.btnRow, isRtl && { flexDirection: 'row-reverse' }]}>
          {/* Skip all */}
          <TouchableOpacity onPress={finish} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.skipAll, { color: c.textMuted }]}>{t('tourSkipAll')}</Text>
          </TouchableOpacity>

          {/* Right group: Back + Skip section + Next */}
          <View style={[styles.rightBtns, isRtl && { flexDirection: 'row-reverse' }]}>
            {!isFirstStep && (
              <TouchableOpacity
                onPress={back}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.skipSec, { color: c.textMuted }]}>
                  {t('tourBack')}
                </Text>
              </TouchableOpacity>
            )}
            {showSkipSec && (
              <TouchableOpacity
                onPress={skipSection}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.skipSec, { color: c.textMuted }]}>
                  {t('tourSkipSection', { section: t(section.nameKey as TranslationKey) })}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: c.primary }]}
              onPress={next}
              activeOpacity={0.8}
            >
              <Text style={[styles.nextBtnText, { color: c.onPrimary }]}>
                {isLastStep ? t('tourFinish') : t('tourNext')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(c: Theme) {
  const { width: SW } = Dimensions.get('window')
  return StyleSheet.create({
    card: {
      position: 'absolute',
      left: 16, right: 16,
      backgroundColor: c.card,
      borderRadius: 22,
      padding: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 16,
      gap: 12,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    dotsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      flex: 1,
    },
    dot: {
      height: 5,
      borderRadius: 3,
      opacity: 0.85,
    },
    sectionLabel: {
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1.2,
    },
    iconWrap: {
      width: 64, height: 64,
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
      width: SW - 72,
    },
    tabItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 7,
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
    },
    body: {
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    btnRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    skipAll: { fontSize: 12 },
    rightBtns: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    skipSec: { fontSize: 12 },
    nextBtn: {
      paddingHorizontal: 20,
      paddingVertical: 11,
      borderRadius: 13,
    },
    nextBtnText: { fontSize: 14, fontWeight: '700' },
    prefToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    prefToggleText: { fontSize: 14, fontWeight: '600' },
  })
}
