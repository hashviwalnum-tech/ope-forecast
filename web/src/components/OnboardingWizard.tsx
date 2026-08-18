import { useState, useEffect } from 'react'
import { businesses } from '../api/client'
import CurrencyPicker from './CurrencyPicker'
import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../i18n'

const DAYS = [0, 1, 2, 3, 4, 5, 6]
const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'] as const
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function hourLabel(h: number, amLabel: string, pmLabel: string): string {
  if (h === 0) return '12:00 midnight'
  if (h === 12) return '12:00 noon'
  if (!amLabel && !pmLabel) return `${String(h).padStart(2, '0')}:00`
  return h < 12 ? `${h}:00 ${amLabel}` : `${h - 12}:00 ${pmLabel}`
}

export function isOnboardingDone(bizId: number): boolean {
  return localStorage.getItem(`ope_onboarding_done_${bizId}`) === '1'
}

export function markOnboardingDone(bizId: number): void {
  localStorage.setItem(`ope_onboarding_done_${bizId}`, '1')
}

interface Props {
  bizId: number
  onGoToProducts: () => void
  onDone: () => void
}

export default function OnboardingWizard({ bizId, onGoToProducts, onDone }: Props) {
  const { t } = useLanguage()
  // If the user previously clicked "Add Products" and returned, jump straight to step 3
  const [step, setStep] = useState<1 | 2 | 3>(() =>
    localStorage.getItem(`ope_onboarding_products_visited_${bizId}`) === '1' ? 3 : 1
  )

  // No days pre-selected — owners must explicitly choose their open days
  const [openDays, setOpenDays] = useState<number[]>([])
  const [openHour, setOpenHour] = useState(9)
  const [closeHour, setCloseHour] = useState(22)
  const [currency, setCurrency] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const amLabel = t('amLabel')
  const pmLabel = t('pmLabel')

  useEffect(() => {
    businesses.me().then(biz => {
      const s = biz.settings as Record<string, unknown>
      if (Array.isArray(s.opening_days)) setOpenDays(s.opening_days as number[])
      if (typeof s.opening_hour === 'number') setOpenHour(s.opening_hour)
      if (typeof s.closing_hour === 'number') setCloseHour(s.closing_hour)
      if (typeof s.currency === 'string') setCurrency(s.currency)
    }).catch(() => {})
  }, [])

  function toggleDay(d: number) {
    setOpenDays(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b)
    )
  }

  async function saveHours() {
    if (openDays.length === 0) return
    if (closeHour <= openHour) { setSaveError(t('closingAfterOpening')); return }
    setSaving(true)
    setSaveError(null)
    try {
      await businesses.updateSettings({
        opening_days: openDays,
        opening_hour: openHour,
        closing_hour: closeHour,
        // Only sent once the owner has confirmed one. Left unset, the app
        // falls back for display but never records a currency they did not pick.
        ...(currency ? { currency } : {}),
      })
      setStep(2)
    } catch {
      setSaveError(t('settingsSaveError'))
    } finally {
      setSaving(false)
    }
  }

  function dismiss() {
    localStorage.removeItem(`ope_onboarding_products_visited_${bizId}`)
    markOnboardingDone(bizId)
    onDone()
  }

  function goToProducts() {
    // Remember that the user visited Products so we return to step 3 when they come back
    localStorage.setItem(`ope_onboarding_products_visited_${bizId}`, '1')
    onGoToProducts()
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {([1, 2, 3] as const).map((n) => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                n === step
                  ? 'bg-teal-600 text-white'
                  : n < step
                  ? 'bg-teal-200 dark:bg-teal-800 text-teal-700 dark:text-teal-300'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
              }`}
            >
              {n < step ? '✓' : n}
            </div>
            {n < 3 && (
              <div className={`h-0.5 w-8 rounded-full ${n < step ? 'bg-teal-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
            )}
          </div>
        ))}
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">
          {t('onboardingStep', { n: String(step), total: '3' })}
        </span>
      </div>

      {/* ── Step 1: Opening hours ── */}
      {step === 1 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-teal-800 p-8 shadow-sm">
          <div className="text-3xl mb-3">🕐</div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            {t('onboardingStepHoursTitle')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
            {t('onboardingStepHoursDesc')}
          </p>

          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            {t('openDaysLabel')}
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {DAYS.map(d => (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border ${
                  openDays.includes(d)
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-teal-300 dark:hover:border-teal-600'
                }`}
              >
                {t(DAY_KEYS[d] as TranslationKey)}
              </button>
            ))}
          </div>

          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            {t('openingHoursLabel')}
          </p>
          <div className="flex flex-wrap items-end gap-6 mb-6">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('opensLabel')}</label>
              <select
                value={openHour}
                onChange={e => setOpenHour(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm"
              >
                {HOURS.map(h => <option key={h} value={h}>{hourLabel(h, amLabel, pmLabel)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('closesLabel')}</label>
              <select
                value={closeHour}
                onChange={e => setCloseHour(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm"
              >
                {HOURS.map(h => <option key={h} value={h}>{hourLabel(h, amLabel, pmLabel)}</option>)}
              </select>
            </div>
          </div>

          {/* Currency sits with the other basics rather than becoming a fourth
              step: it is pre-filled from the browser's region, so for most
              owners it is a glance rather than a decision. */}
          <div className="mt-6 mb-6">
            <label
              htmlFor="onboarding-currency"
              className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2"
            >
              {t('currencyLabel')}
            </label>
            <CurrencyPicker
              id="onboarding-currency"
              value={currency}
              onChange={setCurrency}
              suggestOnLoad
            />
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 leading-relaxed">
              {t('currencyOnboardingHelp')}
            </p>
          </div>

          {saveError && <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">{saveError}</p>}

          <div className="flex items-center justify-between">
            <button
              onClick={dismiss}
              className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              {t('onboardingSkipAll')}
            </button>
            <button
              onClick={() => void saveHours()}
              disabled={saving || openDays.length === 0}
              className="px-6 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? t('onboardingSaving') : t('onboardingContinue')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Products ── */}
      {step === 2 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-teal-800 p-8 shadow-sm">
          <div className="text-3xl mb-3">📦</div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            {t('onboardingStepProductsTitle')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
            {t('onboardingStepProductsDesc')}
          </p>

          <button
            onClick={goToProducts}
            className="w-full py-3 rounded-xl bg-teal-600 text-white text-sm font-bold hover:bg-teal-700 transition-colors mb-4"
          >
            {t('onboardingStepProductsBtn')}
          </button>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(1)}
              className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              {t('onboardingProductsLater')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: How to log ── */}
      {step === 3 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-teal-800 p-8 shadow-sm">
          <div className="text-3xl mb-3">✅</div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            {t('onboardingStepLogTitle')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
            {t('onboardingStepLogDesc')}
          </p>

          <div className="bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800 rounded-xl p-4 mb-3">
            <p className="text-sm text-teal-700 dark:text-teal-300 leading-relaxed">
              💡 {t('onboardingForecastNote')}
            </p>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed mb-6">
            {t('simpleModeHint')}
          </p>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(2)}
              className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={dismiss}
              className="px-6 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
            >
              {t('onboardingDone')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
