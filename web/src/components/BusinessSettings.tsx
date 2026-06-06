import { useEffect, useState } from 'react'
import { businesses } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import TelegramConnectPanel from './TelegramConnectPanel'

interface Props {
  onTierChanged?: () => void
}

function dayKey(i: number): string {
  return ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'][i]
}

export default function BusinessSettings({ onTierChanged }: Props) {
  const { t } = useLanguage()
  const [openDays,       setOpenDays]       = useState<number[]>([0,1,2,3,4,5,6])
  const [openingHour,    setOpeningHour]    = useState<number>(9)
  const [closingHour,    setClosingHour]    = useState<number>(22)
  const [avgServiceTime, setAvgServiceTime] = useState<number>(5)
  const [saving,         setSaving]         = useState(false)
  const [feedback,       setFeedback]       = useState<{ ok: boolean; msg: string } | null>(null)

  const [currentTier,   setCurrentTier]   = useState<string>('free')
  const [tierSaving,    setTierSaving]    = useState(false)
  const [tierFeedback,  setTierFeedback]  = useState<{ ok: boolean; msg: string } | null>(null)
  const { isDark, toggleTheme } = useTheme()

  function hourLabel(h: number): string {
    if (h === 0)  return '12:00 midnight'
    if (h === 12) return '12:00 noon'
    return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
  }

  useEffect(() => {
    businesses.me().then(biz => {
      const s = biz.settings as Record<string, unknown>
      if (Array.isArray(s.opening_days))             setOpenDays(s.opening_days as number[])
      if (typeof s.opening_hour === 'number')        setOpeningHour(s.opening_hour)
      if (typeof s.closing_hour === 'number')        setClosingHour(s.closing_hour)
      if (typeof s.avg_service_time_minutes === 'number') setAvgServiceTime(s.avg_service_time_minutes)
      setCurrentTier(biz.tier ?? 'free')
    }).catch(() => {})
  }, [])

  async function handleSetTier(tier: 'free' | 'premium') {
    setTierSaving(true)
    setTierFeedback(null)
    try {
      const biz = await businesses.setTier(tier)
      setCurrentTier(biz.tier)
      setTierFeedback({ ok: true, msg: t('switchedToPlan', { tier: biz.tier }) })
      onTierChanged?.()
    } catch {
      setTierFeedback({ ok: false, msg: t('planChangeError') })
    } finally {
      setTierSaving(false)
    }
  }

  function toggleDay(d: number) {
    setOpenDays(prev =>
      prev.includes(d)
        ? prev.length > 1 ? prev.filter(x => x !== d) : prev
        : [...prev, d].sort((a, b) => a - b)
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (closingHour <= openingHour) {
      setFeedback({ ok: false, msg: t('closingAfterOpening') })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      await businesses.updateSettings({
        opening_days: openDays,
        opening_hour: openingHour,
        closing_hour: closingHour,
        avg_service_time_minutes: avgServiceTime,
      })
      setFeedback({ ok: true, msg: t('settingsSavedOk') })
    } catch {
      setFeedback({ ok: false, msg: t('settingsSaveError') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-8 max-w-sm">

      <div className="bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800 rounded-xl px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
        {t('settingsHelpText')}
      </div>

      {/* Opening days */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
          {t('openDaysLabel')}
        </label>
        <div className="flex gap-2 flex-wrap">
          {[0,1,2,3,4,5,6].map(i => (
            <button
              key={i}
              type="button"
              onClick={() => toggleDay(i)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                openDays.includes(i)
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-300'
              }`}
            >
              {t(dayKey(i) as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
        {openDays.length === 1 && (
          <p className="text-xs text-amber-600 mt-2">{t('atLeastOneDay')}</p>
        )}
      </div>

      {/* Opening hours */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('openingHoursLabel')}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400 w-16">{t('opensLabel')}</span>
          <select
            value={openingHour}
            onChange={e => setOpeningHour(Number(e.target.value))}
            className="border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-100
                       bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400 w-16">{t('closesLabel')}</span>
          <select
            value={closingHour}
            onChange={e => setClosingHour(Number(e.target.value))}
            className="border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-100
                       bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Average service time */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
          {t('avgServiceTimeLabel')}
        </label>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 leading-relaxed">
          {t('avgServiceTimeDesc')}
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={120}
            value={avgServiceTime}
            onChange={e => setAvgServiceTime(Math.max(1, Number(e.target.value)))}
            className="w-24 px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100
                       bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 tabular-nums"
          />
          <span className="text-sm text-slate-500 dark:text-slate-400">{t('minPerCustomer')}</span>
        </div>
      </div>

      {/* Dark mode toggle */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('appearanceLabel')}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">{t('appearanceDesc')}</p>
        <button
          type="button"
          onClick={toggleTheme}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full
            ${isDark
              ? 'bg-slate-700 border-slate-600 text-slate-100'
              : 'bg-white border-slate-200 text-slate-700 hover:border-teal-300'}`}
        >
          {isDark ? (
            <svg className="w-5 h-5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.7.7M6.34 17.66l-.7.7M17.66 17.66l-.7-.7M6.34 6.34l-.7-.7M12 5a7 7 0 100 14A7 7 0 0012 5z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
          <span className="text-sm font-medium">{isDark ? t('darkModeLabel') : t('lightModeLabel')}</span>
        </button>
      </div>

      {feedback && (
        <p className={`text-sm rounded-xl px-3 py-2.5 ${feedback.ok
          ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20'
          : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20'}`}>
          {feedback.msg}
        </p>
      )}

      <button
        type="submit" disabled={saving}
        className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300
                   text-white font-medium py-3 rounded-xl transition-colors text-base"
      >
        {saving ? t('savingLabel') : t('saveSettings')}
      </button>

      {/* ── Plan / tier ─────────────────────────────────────────────── */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('planLabel')}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 leading-relaxed">
          {currentTier === 'premium' ? t('planDescPremium') : t('planDescFree')}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={tierSaving || currentTier === 'free'}
            onClick={() => handleSetTier('free')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors
              ${currentTier === 'free'
                ? 'bg-teal-600 text-white border-teal-600'
                : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-300'}`}
          >
            {t('planFree')}
          </button>
          <button
            type="button"
            disabled={tierSaving || currentTier === 'premium'}
            onClick={() => handleSetTier('premium')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors
              ${currentTier === 'premium'
                ? 'bg-teal-600 text-white border-teal-600'
                : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-300'}`}
          >
            {t('planPremium')}
          </button>
        </div>

        {tierFeedback && (
          <p className={`mt-3 text-sm rounded-xl px-3 py-2.5 ${tierFeedback.ok
            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20'
            : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20'}`}>
            {tierFeedback.msg}
          </p>
        )}
      </div>

      {/* ── Telegram integration ─────────────────────────────────────── */}
      <TelegramConnectPanel />
    </form>
  )
}
