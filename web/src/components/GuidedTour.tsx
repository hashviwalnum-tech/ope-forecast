import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { LANG_LABELS, type Lang, type TranslationKey } from '../i18n'

// ── Section / step structure ────────────────────────────────────────────────

interface TourStep {
  titleKey:    TranslationKey
  bodyKey:     TranslationKey
  target?:     string
  navigateTo?: string  // tab id to navigate to when this step is shown
  interactive?: boolean  // allow clicking the spotlit element during the tour
}

interface TourSection {
  // null = Welcome / Done — no "Skip [section]" button shown
  nameKey: TranslationKey | null
  steps:   TourStep[]
}

const SECTIONS: TourSection[] = [
  {
    nameKey: null,
    steps: [
      { titleKey: 'tourWelcomeTitle', bodyKey: 'tourWelcomeBody', navigateTo: 'home' },
    ],
  },
  {
    nameKey: 'tourSectionPreferences',
    steps: [
      { titleKey: 'tourDarkModeTitle',     bodyKey: 'tourDarkModeBody',     navigateTo: 'home',     target: '[data-tour="dark-mode-toggle"]',    interactive: true },
      { titleKey: 'tourFriendlyModeTitle', bodyKey: 'tourFriendlyModeBody', navigateTo: 'settings', target: '[data-tour="settings-simple-lang"]', interactive: true },
    ],
  },
  {
    nameKey: 'home',
    steps: [
      { titleKey: 'tourQuickActionsTitle', bodyKey: 'tourQuickActionsBody', navigateTo: 'home', target: '[data-tour="quick-actions"]' },
      { titleKey: 'tourForecastTitle',     bodyKey: 'tourForecastBody',     navigateTo: 'home', target: '[data-tour="forecast-chart"]' },
      { titleKey: 'tourBusyHoursTitle',    bodyKey: 'tourBusyHoursBody',    navigateTo: 'home', target: '[data-tour="busy-hours"]' },
    ],
  },
  {
    nameKey: 'predictions',
    steps: [
      { titleKey: 'tourPredictionsTitle',  bodyKey: 'tourPredictionsBody',  navigateTo: 'predictions_home', target: '[data-tour="nav-predictions"]' },
      { titleKey: 'tourPredWeekTitle',     bodyKey: 'tourPredWeekBody',     navigateTo: 'predictions_home' },
      { titleKey: 'tourPredOrderingTitle', bodyKey: 'tourPredOrderingBody', navigateTo: 'predictions_home' },
    ],
  },
  {
    nameKey: 'insightsNavLabel',
    steps: [
      { titleKey: 'tourInsightsTitle',           bodyKey: 'tourInsightsBody',           navigateTo: 'insights', target: '[data-tour="nav-insights"]' },
      { titleKey: 'tourInsightsDayPatternsTitle', bodyKey: 'tourInsightsDayPatternsBody', navigateTo: 'insights' },
      { titleKey: 'tourInsightsHoursTitle',       bodyKey: 'tourInsightsHoursBody',       navigateTo: 'insights' },
      { titleKey: 'tourInsightsYoYTitle',         bodyKey: 'tourInsightsYoYBody',         navigateTo: 'insights' },
      { titleKey: 'tourInsightsAccuracyTitle',    bodyKey: 'tourInsightsAccuracyBody',    navigateTo: 'insights' },
      { titleKey: 'tourInsightsTrendsTitle',      bodyKey: 'tourInsightsTrendsBody',      navigateTo: 'insights' },
    ],
  },
  {
    nameKey: 'history',
    steps: [
      { titleKey: 'tourHistoryTitle',    bodyKey: 'tourHistoryBody',    navigateTo: 'history',  target: '[data-tour="nav-history"]' },
      { titleKey: 'tourHistAddDayTitle', bodyKey: 'tourHistAddDayBody', navigateTo: 'backfill' },
      { titleKey: 'tourHistTrendsTitle', bodyKey: 'tourHistTrendsBody', navigateTo: 'trends' },
      { titleKey: 'tourHistImportTitle', bodyKey: 'tourHistImportBody', navigateTo: 'import' },
    ],
  },
  {
    nameKey: 'manage',
    steps: [
      { titleKey: 'tourManageTitle',          bodyKey: 'tourManageBody',          navigateTo: 'products',  target: '[data-tour="nav-manage"]' },
      { titleKey: 'tourManageProductsTitle',  bodyKey: 'tourManageProductsBody',  navigateTo: 'products' },
      { titleKey: 'tourManageRegularsTitle',  bodyKey: 'tourManageRegularsBody',  navigateTo: 'regulars' },
      { titleKey: 'tourManageRecurringTitle', bodyKey: 'tourManageRecurringBody', navigateTo: 'recurring' },
      { titleKey: 'tourManageEventsTitle',    bodyKey: 'tourManageEventsBody',    navigateTo: 'events' },
    ],
  },
  {
    nameKey: 'settings',
    steps: [
      { titleKey: 'tourSettingsGearTitle',       bodyKey: 'tourSettingsGearBody',       navigateTo: 'home',     target: '[data-tour="settings-gear"]' },
      { titleKey: 'tourSettingsScheduleTitle',   bodyKey: 'tourSettingsScheduleBody',   navigateTo: 'settings', target: '[data-tour="settings-schedule"]' },
      { titleKey: 'tourSettingsCurrencyTitle',   bodyKey: 'tourSettingsCurrencyBody',   navigateTo: 'settings', target: '[data-tour="settings-currency"]' },
      { titleKey: 'tourSettingsStaffingTitle',   bodyKey: 'tourSettingsStaffingBody',   navigateTo: 'settings', target: '[data-tour="settings-staffing"]' },
      { titleKey: 'tourSettingsStockNudgesTitle', bodyKey: 'tourSettingsStockNudgesBody', navigateTo: 'settings', target: '[data-tour="settings-stock"]' },
      { titleKey: 'tourSettingsNudgesTitle',      bodyKey: 'tourSettingsNudgesBody',      navigateTo: 'settings', target: '[data-tour="settings-nudges"]' },
      { titleKey: 'tourSettingsAppointmentsTitle', bodyKey: 'tourSettingsAppointmentsBody', navigateTo: 'settings', target: '[data-tour="settings-appointments"]' },
      { titleKey: 'tourSettingsAppearanceTitle',  bodyKey: 'tourSettingsAppearanceBody',  navigateTo: 'settings', target: '[data-tour="settings-appearance"]', interactive: true },
      { titleKey: 'tourSettingsPlanTitle',       bodyKey: 'tourSettingsPlanBody',       navigateTo: 'settings', target: '[data-tour="settings-plan"]' },
      { titleKey: 'tourSettingsTelegramTitle',   bodyKey: 'tourSettingsTelegramBody',   navigateTo: 'settings', target: '[data-tour="settings-telegram"]' },
    ],
  },
  {
    nameKey: null,
    steps: [
      { titleKey: 'tourDoneTitle', bodyKey: 'tourDoneBody', navigateTo: 'home' },
    ],
  },
]

// ── Persistence ─────────────────────────────────────────────────────────────

const PADDING = 10
// The popover was a fixed 340px, which overflows a 320px phone, and its
// position assumed a ~280px-tall card, so longer translated text ran off the
// bottom with no way to reach the buttons.
const POP_MAX_W = 340
const POP_MARGIN = 10

interface Props {
  bizId:      number
  onDone:     () => void
  onNavigate?: (tab: string) => void
}

export function isTourDone(bizId: number): boolean {
  return localStorage.getItem(`ope_tour_done_${bizId}`) === '1'
}

export function clearTourDone(bizId: number): void {
  localStorage.removeItem(`ope_tour_done_${bizId}`)
}

// ── Component ───────────────────────────────────────────────────────────────

export default function GuidedTour({ bizId, onDone, onNavigate }: Props) {
  const { t, lang, setLang, dir } = useLanguage()

  const [sectionIdx, setSectionIdx] = useState(0)
  const [stepIdx, setStepIdx]       = useState(0)
  const [rect, setRect]             = useState<DOMRect | null>(null)
  const popRef                      = useRef<HTMLDivElement>(null)
  const [popH, setPopH]             = useState(280)
  const [tick, setTick]             = useState(0)

  const section     = SECTIONS[sectionIdx]
  const step        = section.steps[stepIdx]
  const isLastSec   = sectionIdx === SECTIONS.length - 1
  const isLastStep  = isLastSec && stepIdx === section.steps.length - 1
  const showSkipSec = section.nameKey !== null && !isLastSec

  // Section-based progress (one dot per section, simpler than one per step)
  const totalSections = SECTIONS.length

  const totalSteps = useMemo(() =>
    SECTIONS.reduce((sum, s) => sum + s.steps.length, 0), [])
  const flatIdx = useMemo(() =>
    SECTIONS.slice(0, sectionIdx).reduce((sum, s) => sum + s.steps.length, 0) + stepIdx,
    [sectionIdx, stepIdx])

  // ── Target tracking ───────────────────────────────────────────────────────

  const calcRect = useCallback(() => {
    if (step.target) {
      const el = document.querySelector(step.target)
      setRect(el ? el.getBoundingClientRect() : null)
    } else {
      setRect(null)
    }
  }, [step.target])

  useEffect(() => {
    // Navigate to the relevant app screen first, then find the target element
    if (step.navigateTo) onNavigate?.(step.navigateTo)
    const id = setTimeout(() => {
      calcRect()
      if (step.target) {
        document.querySelector(step.target)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 120)  // slightly longer to let React re-render after tab change
    return () => clearTimeout(id)
  }, [sectionIdx, stepIdx, calcRect, step.target, step.navigateTo, onNavigate])

  useEffect(() => {
    const handle = () => { calcRect(); setTick(n => n + 1) }
    window.addEventListener('resize', handle)
    window.addEventListener('scroll', handle, true)
    return () => {
      window.removeEventListener('resize', handle)
      window.removeEventListener('scroll', handle, true)
    }
  }, [calcRect])

  // Re-measure after every render that could change the card's height (step,
  // language, viewport). The guard stops it settling into a loop.
  useEffect(() => {
    const h = popRef.current?.offsetHeight
    if (h && Math.abs(h - popH) > 2) setPopH(h)
  }, [popH, sectionIdx, stepIdx, lang, tick])

  void tick

  // ── Actions ───────────────────────────────────────────────────────────────

  function finish() {
    localStorage.setItem(`ope_tour_done_${bizId}`, '1')
    onDone()
  }

  // Modal focus behaviour: pull focus into the card on open, keep Tab inside it
  // (it is aria-modal, so a keyboard/SR user must not land on the page behind),
  // and let Escape leave the tour like every other dismissable layer.
  useEffect(() => {
    popRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); return }
      if (e.key !== 'Tab') return
      const card = popRef.current
      if (!card) return
      const items = card.querySelectorAll<HTMLElement>(
        'button, [href], select, input, [tabindex]:not([tabindex="-1"])',
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || active === card)) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus()
      } else if (active && !card.contains(active)) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // finish is stable enough for this; re-binding per step is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ── Popover positioning ───────────────────────────────────────────────────

  const vpW = window.innerWidth
  const vpH = window.innerHeight
  // Never wider than the screen allows.
  const POP_W = Math.min(POP_MAX_W, vpW - POP_MARGIN * 2)
  // The card scrolls inside itself rather than off the screen.
  const popMaxH = Math.max(200, vpH - POP_MARGIN * 2 - 56)
  // Position against what the card actually measures, capped by that maximum.
  const popH_ = Math.min(popH, popMaxH)

  const sTop    = rect ? Math.max(0, rect.top    - PADDING) : 0
  const sLeft   = rect ? Math.max(0, rect.left   - PADDING) : 0
  const sBottom = rect ? rect.bottom + PADDING : 0
  const sRight  = rect ? rect.right  + PADDING : 0
  const sW      = rect ? rect.width  + PADDING * 2 : 0
  const sH      = rect ? rect.height + PADDING * 2 : 0

  let popTop: number
  let popLeft: number
  if (!rect) {
    popTop  = Math.max(POP_MARGIN, (vpH - popH_) / 2)
    popLeft = Math.max(POP_MARGIN, vpW / 2 - POP_W / 2)
  } else {
    popTop = sBottom + 14
    // Flip above the spotlight when there is no room below, then clamp so the
    // card is always fully on screen — its own scrollbar handles the rest.
    if (popTop + popH_ > vpH - POP_MARGIN) popTop = sTop - popH_ - 14
    popTop  = Math.max(POP_MARGIN, Math.min(popTop, vpH - popH_ - POP_MARGIN))
    popLeft = sLeft + sW / 2 - POP_W / 2
    popLeft = Math.max(POP_MARGIN, Math.min(popLeft, vpW - POP_W - POP_MARGIN))
  }

  const stopProp = (e: React.MouseEvent) => e.stopPropagation()
  const OVERLAY  = 'rgba(0,0,0,0.55)'
  const isRtl    = dir === 'rtl'

  // Progress: show individual step dots up to 10 total; beyond that show section dots
  const useStepDots = totalSteps <= 12
  const dotCount  = useStepDots ? totalSteps : totalSections
  const activeDot = useStepDots ? flatIdx : sectionIdx

  // When a step is interactive the overlay panels don't dismiss on click — the user
  // is expected to interact with the spotlit element first, then press Next.
  // The outer container uses pointer-events:none so each panel handles its own clicks.
  const isInteractive = step.interactive === true && rect !== null

  return (
    <div className="fixed inset-0" style={{ zIndex: 9000, pointerEvents: 'none' }}>

      {/* ── Backdrop with spotlight ──────────────────────────────────────── */}
      {rect ? (
        <>
          {/* Four overlay panels — each handles pointer events independently */}
          <div style={{ position:'fixed', inset:'0 0 auto 0', height: sTop,             background: OVERLAY, pointerEvents: 'auto' }} onClick={isInteractive ? undefined : finish} />
          <div style={{ position:'fixed', top: sBottom, left:0, right:0, bottom:0,      background: OVERLAY, pointerEvents: 'auto' }} onClick={isInteractive ? undefined : finish} />
          <div style={{ position:'fixed', top: sTop, left:0, width: sLeft, height: sH,  background: OVERLAY, pointerEvents: 'auto' }} onClick={isInteractive ? undefined : finish} />
          <div style={{ position:'fixed', top: sTop, left: sRight, right:0, height: sH, background: OVERLAY, pointerEvents: 'auto' }} onClick={isInteractive ? undefined : finish} />
          {/* Click-blocker: only in non-interactive mode — prevents spotlight clicks from dismissing */}
          {!isInteractive && (
            <div style={{ position:'fixed', top: sTop, left: sLeft, width: sW, height: sH, pointerEvents: 'auto' }} onClick={stopProp} />
          )}
          <div style={{
            position: 'fixed', top: sTop, left: sLeft, width: sW, height: sH,
            border: '2.5px solid rgb(13 148 136)',
            borderRadius: 10,
            boxShadow: '0 0 0 3px rgba(13,148,136,0.2)',
            pointerEvents: 'none',
          }} />
        </>
      ) : (
        <div style={{ position:'fixed', inset:0, background: OVERLAY, pointerEvents: 'auto' }} onClick={finish} />
      )}

      {/* ── Popover ───────────────────────────────────────────────────────── */}
      <div
        ref={popRef}
        className="fixed bg-white dark:bg-slate-800 rounded-2xl shadow-2xl
                   border border-teal-100 dark:border-teal-800 p-5 overflow-y-auto"
        style={{ top: popTop, left: popLeft, width: POP_W, maxHeight: popMaxH, zIndex: 9001, pointerEvents: 'auto' }}
        role="dialog"
        aria-modal="true"
        aria-label={t(step.titleKey)}
        tabIndex={-1}
        dir={dir}
        onClick={stopProp}
      >
        {/* Top row: progress dots + language toggle */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 flex-1 min-w-0">
            {Array.from({ length: dotCount }).map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-200 shrink-0"
                style={{
                  height: 5,
                  width:  i === activeDot ? 18 : 5,
                  background: i === activeDot
                    ? 'rgb(13 148 136)'
                    : i < activeDot
                      ? 'rgb(94 234 212)'
                      : 'rgb(226 232 240)',
                }}
              />
            ))}
          </div>

          {/* In-tour language toggle */}
          <div className={`flex items-center shrink-0 ${isRtl ? 'mr-3' : 'ml-3'}`}>
            <select
              value={lang}
              onChange={e => { setLang(e.target.value as Lang) }}
              onClick={stopProp}
              className="text-sm rounded-lg border border-teal-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 px-2 min-h-11 cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              aria-label={t('a11yLanguage')}
            >
              {(Object.entries(LANG_LABELS) as [Lang, string][]).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Section label */}
        {section.nameKey && (
          <div className="text-xs font-semibold text-teal-700 dark:text-teal-300 uppercase tracking-widest mb-1.5">
            {t(section.nameKey as TranslationKey)}
          </div>
        )}

        {/* Content */}
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">
          {t(step.titleKey)}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
          {t(step.bodyKey)}
        </p>

        {/* Buttons: Skip all | [spacer] | ← Back · Skip [Section] · Next */}
        <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <button
            onClick={(e) => { stopProp(e); finish() }}
            className="text-sm text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0 min-h-11 px-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            {t('tourSkipAll')}
          </button>

          <div className={`flex items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
            {!isFirstStep && (
              <button
                onClick={(e) => { stopProp(e); back() }}
                className="text-sm text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap min-h-11 px-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                {t('tourBack')}
              </button>
            )}
            {showSkipSec && (
              <button
                onClick={(e) => { stopProp(e); skipSection() }}
                className="text-sm text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap min-h-11 px-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                {t('tourSkipSection', { section: t(section.nameKey as TranslationKey) })}
              </button>
            )}
            <button
              onClick={(e) => { stopProp(e); next() }}
              className="px-5 min-h-11 bg-teal-600 text-white text-sm font-semibold rounded-xl
                         hover:bg-teal-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
            >
              {isLastStep ? t('tourFinish') : t('tourNext')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
