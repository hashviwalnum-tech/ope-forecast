import { useState, useMemo } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../api/client'
import type { BusinessRead } from '../api/types'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { Theme } from '../lib/theme'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function fmt12(h: number): string {
  if (h === 0) return '12:00 am'
  if (h < 12) return `${h}:00 am`
  if (h === 12) return '12:00 pm'
  return `${h - 12}:00 pm`
}

interface Props {
  onComplete: (biz: BusinessRead) => void
}

export default function OnboardingScreen({ onComplete }: Props) {
  const c = useTheme()
  const { t } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Step 1: business name
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdBiz, setCreatedBiz] = useState<BusinessRead | null>(null)

  // Step 2: opening hours — no days pre-selected; owner must explicitly choose
  const [openDays, setOpenDays] = useState<number[]>([])
  const [openHour, setOpenHour] = useState(9)
  const [closeHour, setCloseHour] = useState(22)
  const [savingHours, setSavingHours] = useState(false)
  const [hoursError, setHoursError] = useState<string | null>(null)

  const toggleDay = (d: number) => {
    setOpenDays(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b)
    )
  }

  const stepHour = (
    setter: React.Dispatch<React.SetStateAction<number>>,
    delta: number
  ) => {
    setter(prev => Math.min(23, Math.max(0, prev + delta)))
  }

  const createBusiness = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setNameError(t('mobileOnboardingBizRequired')); return }
    setNameError(null)
    setCreating(true)
    setCreateError(null)
    try {
      const biz = await api.businesses.create(trimmed)
      setCreatedBiz(biz)
      api.setActiveBusinessId(biz.id)
      setStep(2)
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : t('failedToSave'))
    } finally {
      setCreating(false)
    }
  }

  const saveHoursAndContinue = async () => {
    if (!createdBiz) { setStep(3); return }
    if (openDays.length === 0) { setHoursError(t('openDayError')); return }
    if (closeHour <= openHour) { setHoursError(t('openHourError')); return }
    setSavingHours(true)
    setHoursError(null)
    try {
      await api.businesses.updateSettings({
        opening_days: openDays,
        opening_hour: openHour,
        closing_hour: closeHour,
      })
    } catch {
      // Hours save failed — continue anyway, user can fix in Settings
    } finally {
      setSavingHours(false)
    }
    setStep(3)
  }

  const skipHours = () => {
    setStep(3)
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.welcome, { color: c.primaryDark }]}>
            {t('mobileOnboardingWelcome')}
          </Text>
          <Text style={[styles.subtitle, { color: c.textSub }]}>
            {t('mobileOnboardingSubtitle')}
          </Text>
        </View>

        {/* Step indicator */}
        <View style={styles.stepRow}>
          {([1, 2, 3] as const).map(n => (
            <View key={n} style={styles.stepItem}>
              <View style={[
                styles.stepDot,
                { backgroundColor: n <= step ? c.primary : c.border },
              ]}>
                {n < step ? (
                  <Ionicons name="checkmark" size={12} color={c.onPrimary} />
                ) : (
                  <Text style={[styles.stepNum, { color: n === step ? c.onPrimary : c.textMuted }]}>
                    {n}
                  </Text>
                )}
              </View>
              {n < 3 && (
                <View style={[styles.stepLine, { backgroundColor: n < step ? c.primary : c.border }]} />
              )}
            </View>
          ))}
          <Text style={[styles.stepLabel, { color: c.textMuted }]}>
            {t('stepOf', { n: String(step), total: '3' })}
          </Text>
        </View>

        {/* ── Step 1: Business name ── */}
        {step === 1 && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>
              {t('mobileOnboardingBizLabel')}
            </Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: c.bg, borderColor: nameError ? c.danger : c.border,
                color: c.text,
              }]}
              value={name}
              onChangeText={v => { setName(v); setNameError(null) }}
              placeholder={t('mobileOnboardingBizPlaceholder')}
              placeholderTextColor={c.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void createBusiness()}
            />
            {nameError && (
              <Text style={[styles.errorText, { color: c.danger }]}>{nameError}</Text>
            )}
            {createError && (
              <Text style={[styles.errorText, { color: c.danger }]}>{createError}</Text>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.primary }, creating && { opacity: 0.6 }]}
              onPress={() => void createBusiness()}
              disabled={creating}
              activeOpacity={0.8}
            >
              {creating
                ? <ActivityIndicator size="small" color={c.onPrimary} />
                : <Text style={[styles.primaryBtnText, { color: c.onPrimary }]}>
                    {t('mobileOnboardingNext')}
                  </Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 2: Opening hours ── */}
        {step === 2 && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>
              {t('mobileOnboardingHoursTitle')}
            </Text>
            <Text style={[styles.cardDesc, { color: c.textSub }]}>
              {t('mobileOnboardingHoursDesc')}
            </Text>

            {/* Days */}
            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{t('openDays')}</Text>
            <View style={styles.daysRow}>
              {DAY_KEYS.map((key, idx) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.dayBtn,
                    openDays.includes(idx)
                      ? { backgroundColor: c.primary }
                      : { backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 },
                  ]}
                  onPress={() => toggleDay(idx)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.dayBtnText,
                    { color: openDays.includes(idx) ? c.onPrimary : c.textSub },
                  ]}>
                    {t(key)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Hours */}
            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{t('openingHours')}</Text>
            <View style={styles.hoursRow}>
              <View style={styles.hourBlock}>
                <Text style={[styles.hourBlockLabel, { color: c.textSub }]}>{t('opens')}</Text>
                <View style={styles.hourStepper}>
                  <TouchableOpacity
                    style={[styles.hourBtn, { borderColor: c.border }]}
                    onPress={() => stepHour(setOpenHour, -1)}
                  >
                    <Ionicons name="remove" size={16} color={c.primary} />
                  </TouchableOpacity>
                  <Text style={[styles.hourVal, { color: c.text }]}>{fmt12(openHour)}</Text>
                  <TouchableOpacity
                    style={[styles.hourBtn, { borderColor: c.border }]}
                    onPress={() => stepHour(setOpenHour, 1)}
                  >
                    <Ionicons name="add" size={16} color={c.primary} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.hourBlock}>
                <Text style={[styles.hourBlockLabel, { color: c.textSub }]}>{t('closes')}</Text>
                <View style={styles.hourStepper}>
                  <TouchableOpacity
                    style={[styles.hourBtn, { borderColor: c.border }]}
                    onPress={() => stepHour(setCloseHour, -1)}
                  >
                    <Ionicons name="remove" size={16} color={c.primary} />
                  </TouchableOpacity>
                  <Text style={[styles.hourVal, { color: c.text }]}>{fmt12(closeHour)}</Text>
                  <TouchableOpacity
                    style={[styles.hourBtn, { borderColor: c.border }]}
                    onPress={() => stepHour(setCloseHour, 1)}
                  >
                    <Ionicons name="add" size={16} color={c.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {hoursError && (
              <Text style={[styles.errorText, { color: c.danger }]}>{hoursError}</Text>
            )}

            {/* Forecast note */}
            <View style={[styles.noteBanner, { backgroundColor: c.primaryBg }]}>
              <Ionicons name="bulb-outline" size={16} color={c.primaryDark} />
              <Text style={[styles.noteText, { color: c.primaryDark }]}>
                {t('mobileOnboardingForecastNote')}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.primary }, savingHours && { opacity: 0.6 }]}
              onPress={() => void saveHoursAndContinue()}
              disabled={savingHours}
              activeOpacity={0.8}
            >
              {savingHours
                ? <ActivityIndicator size="small" color={c.onPrimary} />
                : <Text style={[styles.primaryBtnText, { color: c.onPrimary }]}>
                    {t('mobileOnboardingNext')}
                  </Text>}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={skipHours}
              style={styles.skipBtn}
              activeOpacity={0.7}
            >
              <Text style={[styles.skipText, { color: c.textMuted }]}>
                {t('mobileOnboardingSkip')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 3: What's next ── */}
        {step === 3 && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>
              {t('mobileOnboardingWhatNextTitle')}
            </Text>
            <Text style={[styles.cardDesc, { color: c.textSub }]}>
              {t('mobileOnboardingWhatNextDesc')}
            </Text>

            <View style={[styles.noteBanner, { backgroundColor: c.primaryBg }]}>
              <Ionicons name="bulb-outline" size={16} color={c.primaryDark} />
              <Text style={[styles.noteText, { color: c.primaryDark }]}>
                {t('mobileOnboardingForecastNote')}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.primary }]}
              onPress={() => createdBiz && onComplete(createdBiz)}
              activeOpacity={0.8}
            >
              <Text style={[styles.primaryBtnText, { color: c.onPrimary }]}>
                {t('mobileOnboardingGetStarted')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1 },
    content: { padding: 24, paddingBottom: 40 },

    header: { alignItems: 'center', marginBottom: 28 },
    welcome: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
    subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 300 },

    stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
    stepItem: { flexDirection: 'row', alignItems: 'center' },
    stepDot: {
      width: 28, height: 28, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
    },
    stepNum: { fontSize: 12, fontWeight: '700' },
    stepLine: { height: 2, width: 32, marginHorizontal: 4 },
    stepLabel: { fontSize: 12, marginLeft: 10 },

    card: {
      borderRadius: 20, padding: 20, borderWidth: 1, gap: 14,
    },
    cardTitle: { fontSize: 18, fontWeight: '700' },
    cardDesc: { fontSize: 13, lineHeight: 20 },

    input: {
      borderWidth: 1, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 13,
      fontSize: 16,
    },
    errorText: { fontSize: 13 },

    fieldLabel: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6,
    },

    daysRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    dayBtn: { borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
    dayBtnText: { fontSize: 12, fontWeight: '700' },

    hoursRow: { flexDirection: 'row', gap: 20 },
    hourBlock: { flex: 1 },
    hourBlockLabel: { fontSize: 12, marginBottom: 8 },
    hourStepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    hourBtn: {
      width: 30, height: 30, borderRadius: 8, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    hourVal: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600' },

    noteBanner: {
      borderRadius: 12, padding: 12,
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    },
    noteText: { flex: 1, fontSize: 13, lineHeight: 19 },

    primaryBtn: {
      borderRadius: 14, paddingVertical: 15,
      alignItems: 'center', justifyContent: 'center',
    },
    primaryBtnText: { fontSize: 15, fontWeight: '700' },

    skipBtn: { alignItems: 'center', paddingVertical: 6 },
    skipText: { fontSize: 13 },
  })
}
