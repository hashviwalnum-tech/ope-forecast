import { useEffect, useState, useId } from 'react'
import CurrencyPicker from './CurrencyPicker'
import { businesses, nudges as nudgesApi } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import { deviceTimeZone, isValidTimeZone } from '../lib/businessTime'
import { useTheme } from '../contexts/ThemeContext'
import TelegramConnectPanel from './TelegramConnectPanel'
import FeedbackPanel from './FeedbackPanel'

interface Props {
  onTierChanged?: () => void
  onReplayTour?: () => void
}

/** Every zone the browser knows, with the device's own always present. */
function allTimeZones(): string[] {
  let zones: string[] = []
  try {
    const supported = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (supported) zones = supported('timeZone')
  } catch { /* older browsers: fall through to the short list below */ }
  if (zones.length === 0) zones = ['UTC']
  const device = deviceTimeZone()
  if (isValidTimeZone(device) && !zones.includes(device)) zones = [device, ...zones]
  return zones
}

const timeZoneOptions = allTimeZones()

function dayKey(i: number): string {
  return ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'][i]
}

export default function BusinessSettings({ onTierChanged, onReplayTour }: Props) {
  const fieldId = useId()
  const { t, simpleMode, setSimpleMode } = useLanguage()
  const [openDays,        setOpenDays]        = useState<number[]>([0,1,2,3,4,5,6])
  const [openingHour,     setOpeningHour]     = useState<number>(9)
  const [closingHour,     setClosingHour]     = useState<number>(22)
  const [avgServiceTime,  setAvgServiceTime]  = useState<number>(5)
  // Staffing threshold — one of: 'wait' (max wait minutes), 'queue' (max queue length), or 'none'
  const [thresholdType,   setThresholdType]   = useState<'wait' | 'queue' | 'none'>('none')
  const [maxWaitMinutes,  setMaxWaitMinutes]  = useState<number>(5)
  const [maxQueueLength,  setMaxQueueLength]  = useState<number>(3)
  const [currency,        setCurrency]        = useState('')
  // The business's own clock. Unset means we have been falling back to the
  // device's zone, which is how the screen and the server came to disagree
  // about which day a sale belonged to.
  const [timeZone,        setTimeZone]        = useState('')
  // Whether the BUSINESS has a zone, as opposed to the device one prefilled
  // into the select below. Without this the field looks answered when it is not.
  const [timeZoneConfigured, setTimeZoneConfigured] = useState(true)
  const [saving,          setSaving]          = useState(false)
  const [feedback,        setFeedback]        = useState<{ ok: boolean; msg: string } | null>(null)

  const [stockMgmtEnabled, setStockMgmtEnabled] = useState(true)
  const [appointmentBased, setAppointmentBased] = useState(false)
  const [nudgesEnabled, setNudgesEnabled] = useState(true)
  const [nudgeFreqHours, setNudgeFreqHours] = useState(24)
  const [nudgeSending, setNudgeSending] = useState(false)
  const [nudgeFeedback, setNudgeFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [currentTier,   setCurrentTier]   = useState<string>('free')
  const [tierSaving,    setTierSaving]    = useState(false)
  const [tierFeedback,  setTierFeedback]  = useState<{ ok: boolean; msg: string } | null>(null)
  const { isDark, toggleTheme } = useTheme()

  function hourLabel(h: number): string {
    if (h === 0)  return t('hourMidnightLabel')
    if (h === 12) return t('hourNoonLabel')
    const am = t('amLabel')
    const pm = t('pmLabel')
    if (!am && !pm) return `${String(h).padStart(2, '0')}:00`  // 24-hour for languages without AM/PM
    return h < 12 ? `${h}:00 ${am}` : `${h - 12}:00 ${pm}`
  }

  useEffect(() => {
    businesses.me().then(biz => {
      const s = biz.settings as Record<string, unknown>
      if (Array.isArray(s.opening_days))             setOpenDays(s.opening_days as number[])
      if (typeof s.opening_hour === 'number')        setOpeningHour(s.opening_hour)
      if (typeof s.closing_hour === 'number')        setClosingHour(s.closing_hour)
      const savedZone = typeof s.timezone === 'string' ? s.timezone.trim() : ''
      setTimeZoneConfigured(savedZone !== '')
      setTimeZone(savedZone || deviceTimeZone())
      if (typeof s.avg_service_time_minutes === 'number') setAvgServiceTime(s.avg_service_time_minutes)
      if (typeof s.staffing_max_wait_minutes === 'number') {
        setThresholdType('wait')
        setMaxWaitMinutes(s.staffing_max_wait_minutes)
      } else if (typeof s.staffing_max_queue_length === 'number') {
        setThresholdType('queue')
        setMaxQueueLength(s.staffing_max_queue_length)
      }
      if (typeof s.stock_management_enabled === 'boolean') {
        setStockMgmtEnabled(s.stock_management_enabled)
      }
      if (typeof s.appointment_based === 'boolean') {
        setAppointmentBased(s.appointment_based)
      }
      if (typeof s.nudges_enabled === 'boolean') {
        setNudgesEnabled(s.nudges_enabled)
      }
      if (typeof s.nudge_frequency_hours === 'number') {
        setNudgeFreqHours(s.nudge_frequency_hours)
      }
      if (typeof s.currency === 'string') setCurrency(s.currency)
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
    // Allow wrap-around (close < open = midnight-crossing, e.g. 22:00–02:00).
    // Only block close === open (would make range empty).
    if (closingHour === openingHour) {
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
        ...(timeZone ? { timezone: timeZone } : {}),
        avg_service_time_minutes: avgServiceTime,
        staffing_max_wait_minutes:  thresholdType === 'wait'  ? maxWaitMinutes  : null,
        staffing_max_queue_length: thresholdType === 'queue' ? maxQueueLength  : null,
        stock_management_enabled: stockMgmtEnabled,
        nudges_enabled: nudgesEnabled,
        nudge_frequency_hours: nudgeFreqHours,
        appointment_based: appointmentBased,
        // Only sent once chosen — never store a currency the owner did not pick.
        ...(currency ? { currency } : {}),
      })
      // The zone is stored now, so the "not set yet" note must go with it.
      if (timeZone) setTimeZoneConfigured(true)
      setFeedback({ ok: true, msg: t('settingsSavedOk') })
    } catch {
      setFeedback({ ok: false, msg: t('settingsSaveError') })
    } finally {
      setSaving(false)
    }
  }

  return (
    /* The settings FORM stops after its Save button. Everything below it —
       plan, Telegram, feedback, the tour replay, the privacy link — is not a
       settings field, and FeedbackPanel has a <form> of its own. A form nested
       inside another form is invalid HTML: the browser drops the inner one, so
       pressing Enter in the feedback box submitted the SETTINGS form instead
       of sending the feedback. React warned about it on every render. */
    <div className="space-y-8 max-w-sm">
    <form onSubmit={handleSave} className="space-y-8">

      <div className="bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800 rounded-xl px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
        {t('settingsHelpText')}
      </div>

      {/* Opening days + hours — grouped for tour targeting */}
      <div data-tour="settings-schedule">

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
                  : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-700'
              }`}
            >
              {t(dayKey(i) as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
        {openDays.length === 1 && (
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">{t('atLeastOneDay')}</p>
        )}
      </div>

      {/* Opening hours */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('openingHoursLabel')}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600 dark:text-slate-400 w-16">{t('opensLabel')}</span>
          <select
            aria-label={`${t('openingHoursLabel')} — ${t('opensLabel')}`}
            value={openingHour}
            onChange={e => setOpeningHour(Number(e.target.value))}
            className="border border-slate-300 dark:border-slate-600 rounded-xl px-3 min-h-11 text-slate-900 dark:text-slate-100
                       bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600 dark:text-slate-400 w-16">{t('closesLabel')}</span>
          <select
            aria-label={`${t('openingHoursLabel')} — ${t('closesLabel')}`}
            value={closingHour}
            onChange={e => setClosingHour(Number(e.target.value))}
            className="border border-slate-300 dark:border-slate-600 rounded-xl px-3 min-h-11 text-slate-900 dark:text-slate-100
                       bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Time zone — what "today" means for this business. Nested in the
          schedule block on purpose: it is the same question as opening hours,
          not a new top-level choice. */}
      <div>
        <label
          htmlFor="settings-timezone"
          className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1"
        >
          {t('timeZoneLabel')}
        </label>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
          {t('timeZoneDesc')}
        </p>
        {/* A business created before this field existed has no zone, and the
            backend then falls back to UTC for every "today". The backfill sets
            one where it can work it out; where it cannot, saying so is the only
            honest option — a silent UTC fallback looks like a working setting. */}
        {!timeZoneConfigured && (
          <p role="status" className="text-xs leading-relaxed mb-3 rounded-xl px-3 py-2.5
                                     text-amber-800 dark:text-amber-300
                                     bg-amber-50 dark:bg-amber-900/20
                                     border border-amber-100 dark:border-amber-900/40">
            {t('timeZoneUnsetWarning')}
          </p>
        )}
        <select
          id="settings-timezone"
          value={timeZone}
          onChange={e => setTimeZone(e.target.value)}
          className="w-full max-w-xs border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 min-h-11
                     text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700 text-sm
                     focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {timeZoneOptions.map(tz => (
            <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      </div>{/* end settings-schedule */}

      {/* Currency — every money figure in Ope is shown in this */}
      <div data-tour="settings-currency">
        <label
          htmlFor="settings-currency"
          className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1"
        >
          {t('currencyLabel')}
        </label>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
          {t('currencySettingsDesc')}
        </p>
        <CurrencyPicker id="settings-currency" value={currency} onChange={setCurrency} />
      </div>

      {/* Average service time + staffing — grouped for tour targeting */}
      <div data-tour="settings-staffing">

      {/* Average service time */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
          {t('avgServiceTimeLabel')}
        </label>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
          {t('avgServiceTimeDesc')}
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={120}
            aria-label={`${t('avgServiceTimeLabel')} (${t('minPerCustomer')})`}
            value={avgServiceTime}
            onChange={e => setAvgServiceTime(Math.max(1, Number(e.target.value)))}
            className="w-24 px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100
                       bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 tabular-nums"
          />
          <span className="text-sm text-slate-600 dark:text-slate-400">{t('minPerCustomer')}</span>
        </div>
      </div>

      {/* Staffing threshold */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
          {t('staffingGoalLabel')}
        </label>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
          {t('staffingGoalDesc')}
        </p>

        <div className="space-y-2 mb-3">
          {([ ['none', t('staffingOptionBusy')],
               ['wait', t('staffingOptionWait')],
               ['queue', t('staffingOptionQueue')],
          ] as const).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="thresholdType"
                value={val}
                checked={thresholdType === val}
                onChange={() => setThresholdType(val)}
                className="accent-teal-600"
              />
              <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
            </label>
          ))}
        </div>

        {thresholdType === 'wait' && (
          <div className="flex items-center gap-3 pl-6">
            <input
              type="number"
              min={1}
              max={60}
              aria-label={`${t('staffingGoalLabel')} — ${t('minutesMaxWait')}`}
              value={maxWaitMinutes}
              onChange={e => setMaxWaitMinutes(Math.max(1, Number(e.target.value)))}
              className="w-24 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100
                         bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 tabular-nums"
            />
            <span className="text-sm text-slate-600 dark:text-slate-400">{t('minutesMaxWait')}</span>
          </div>
        )}

        {thresholdType === 'queue' && (
          <div className="flex items-center gap-3 pl-6">
            <input
              type="number"
              min={1}
              max={50}
              aria-label={`${t('staffingGoalLabel')} — ${t('peopleMaxInLine')}`}
              value={maxQueueLength}
              onChange={e => setMaxQueueLength(Math.max(1, Number(e.target.value)))}
              className="w-24 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100
                         bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 tabular-nums"
            />
            <span className="text-sm text-slate-600 dark:text-slate-400">{t('peopleMaxInLine')}</span>
          </div>
        )}
      </div>

      </div>{/* end settings-staffing */}

      {/* Stock & reorder management toggle */}
      <div data-tour="settings-stock" className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('stockMgmtLabel')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">{t('stockMgmtDesc')}</p>
        <button
          type="button"
          onClick={() => setStockMgmtEnabled(v => !v)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full text-left
            ${stockMgmtEnabled
              ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-700 text-teal-800 dark:text-teal-300'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
        >
          <span className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${stockMgmtEnabled ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${stockMgmtEnabled ? 'translate-x-4' : 'translate-x-0.5'} dark:bg-slate-800`} />
          </span>
          <span className="text-sm font-medium">{stockMgmtEnabled ? t('stockMgmtOn') : t('stockMgmtOff')}</span>
        </button>
      </div>

      {/* Appointment-based toggle — blends booked counts into the forecast */}
      <div data-tour="settings-appointments" className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('appointmentBasedLabel')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">{t('appointmentBasedDesc')}</p>
        <button
          type="button"
          onClick={() => setAppointmentBased(v => !v)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full text-left
            ${appointmentBased
              ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-700 text-teal-800 dark:text-teal-300'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
        >
          <span className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${appointmentBased ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${appointmentBased ? 'translate-x-4' : 'translate-x-0.5'} dark:bg-slate-800`} />
          </span>
          <span className="text-sm font-medium">{appointmentBased ? t('appointmentBasedOn') : t('appointmentBasedOff')}</span>
        </button>
      </div>

      {/* Proactive nudges toggle */}
      <div data-tour="settings-nudges" className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('nudgesLabel')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">{t('nudgesDesc')}</p>
        <button
          type="button"
          onClick={() => setNudgesEnabled(v => !v)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full text-left
            ${nudgesEnabled
              ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-700 text-teal-800 dark:text-teal-300'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
        >
          <span className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${nudgesEnabled ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${nudgesEnabled ? 'translate-x-4' : 'translate-x-0.5'} dark:bg-slate-800`} />
          </span>
          <span className="text-sm font-medium">{nudgesEnabled ? t('nudgesOn') : t('nudgesOff')}</span>
        </button>

        {nudgesEnabled && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-600 dark:text-slate-400 shrink-0" htmlFor={`${fieldId}-f1`}>{t('nudgesFrequencyLabel')}:</label>
              <input id={`${fieldId}-f1`}
                type="number"
                min={1}
                max={168}
                value={nudgeFreqHours}
                onChange={e => setNudgeFreqHours(Math.max(1, Math.min(168, Number(e.target.value))))}
                className="w-20 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg
                           text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700
                           text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 tabular-nums"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300">h</span>
            </div>

            <button
              type="button"
              disabled={nudgeSending}
              onClick={async () => {
                setNudgeSending(true)
                setNudgeFeedback(null)
                try {
                  const res = await nudgesApi.sendTelegram()
                  if (res.sent) {
                    setNudgeFeedback({ ok: true, msg: t('nudgesSent') })
                  } else {
                    setNudgeFeedback({ ok: false, msg: t('nudgesNothingToSend') })
                  }
                } catch {
                  setNudgeFeedback({ ok: false, msg: t('nudgesSendError') })
                } finally {
                  setNudgeSending(false)
                }
              }}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-teal-300 dark:border-teal-700
                         text-teal-700 dark:text-teal-300 bg-white dark:bg-slate-800
                         hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors disabled:opacity-50"
            >
              {nudgeSending ? t('savingLabel') : t('nudgesSendNow')}
            </button>

            {nudgeFeedback && (
              <p role="status" aria-live="polite" className={`text-xs rounded-lg px-3 py-2 ${nudgeFeedback.ok
                ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20'
                : 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800'}`}>
                {nudgeFeedback.msg}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Dark mode toggle */}
      <div data-tour="settings-appearance" className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('appearanceLabel')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">{t('appearanceDesc')}</p>
        <button
          type="button"
          onClick={toggleTheme}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full
            ${isDark
              ? 'bg-slate-700 border-slate-600 text-slate-100'
              : 'bg-white border-slate-200 text-slate-700 hover:border-teal-300 dark:text-slate-200'} dark:bg-slate-800 dark:border-slate-600`}
        >
          {isDark ? (
            <svg className="w-5 h-5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.7.7M6.34 17.66l-.7.7M17.66 17.66l-.7-.7M6.34 6.34l-.7-.7M12 5a7 7 0 100 14A7 7 0 0012 5z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
          <span className="text-sm font-medium">{isDark ? t('darkModeLabel') : t('lightModeLabel')}</span>
        </button>
      </div>

      {/* Simple language mode toggle */}
      <div data-tour="settings-simple-lang" className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('simpleModeLabel')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">{t('simpleModeDesc')}</p>
        <button
          type="button"
          onClick={() => setSimpleMode(!simpleMode)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full text-left
            ${simpleMode
              ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-700 text-teal-800 dark:text-teal-300'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
        >
          <span className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${simpleMode ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${simpleMode ? 'translate-x-4' : 'translate-x-0.5'} dark:bg-slate-800`} />
          </span>
          <span className="text-sm font-medium">{simpleMode ? t('simpleModeOn') : t('simpleModeOff')}</span>
        </button>
      </div>

      {feedback && (
        <p role="status" aria-live="polite" className={`text-sm rounded-xl px-3 py-2.5 ${feedback.ok
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
    </form>

      {/* ── Plan / tier ─────────────────────────────────────────────── */}
      <div data-tour="settings-plan" className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('planLabel')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
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
                : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-700'}`}
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
                : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-700'}`}
          >
            {t('planPremium')}
          </button>
        </div>

        {tierFeedback && (
          <p role="status" aria-live="polite" className={`mt-3 text-sm rounded-xl px-3 py-2.5 ${tierFeedback.ok
            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20'
            : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20'}`}>
            {tierFeedback.msg}
          </p>
        )}
      </div>

      {/* ── Telegram integration ─────────────────────────────────────── */}
      <div data-tour="settings-telegram">
        <TelegramConnectPanel />
      </div>

      {/* ── Feedback ─────────────────────────────────────────────────── */}
      <FeedbackPanel />

      {/* ── Guided tour ─────────────────────────────────────────────── */}
      {onReplayTour && (
        <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('tourReplayLabel')}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">{t('tourReplayDesc')}</p>
          <button
            type="button"
            onClick={onReplayTour}
            className="px-5 py-2.5 rounded-xl border border-teal-300 dark:border-teal-700
                       text-teal-700 dark:text-teal-300 text-sm font-medium
                       hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
          >
            {t('tourReplayBtn')}
          </button>
        </div>
      )}

      {/* ── Legal ────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-4 text-center">
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-700 transition-colors"
        >
          {t('privacyPolicy')}
        </a>
      </div>
    </div>
  )
}
