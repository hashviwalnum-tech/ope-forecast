import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { Lang, TranslationKey } from '../i18n'

// ── Section / step structure ────────────────────────────────────────────────

interface TourStep {
  titleKey:   TranslationKey
  bodyKey:    TranslationKey
  target?:    string
  navigateTo?: string  // tab id to navigate to when this step is shown
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
      { titleKey: 'tourManageTitle',           bodyKey: 'tourManageBody',           navigateTo: 'products',   target: '[data-tour="nav-manage"]' },
      { titleKey: 'tourManageProductsTitle',   bodyKey: 'tourManageProductsBody',   navigateTo: 'products' },
      { titleKey: 'tourManageRegularsTitle',   bodyKey: 'tourManageRegularsBody',   navigateTo: 'regulars' },
      { titleKey: 'tourManageRecurringTitle',  bodyKey: 'tourManageRecurringBody',  navigateTo: 'recurring' },
      { titleKey: 'tourManageEventsTitle',     bodyKey: 'tourManageEventsBody',     navigateTo: 'events' },
      { titleKey: 'tourManageSimpleLangTitle', bodyKey: 'tourManageSimpleLangBody', navigateTo: 'settings' },
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
const POP_W   = 340

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

  void tick

  // ── Actions ───────────────────────────────────────────────────────────────

  function finish() {
    localStorage.setItem(`ope_tour_done_${bizId}`, '1')
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

  function skipSection() {
    if (sectionIdx < SECTIONS.length - 1) {
      setSectionIdx(s => s + 1)
      setStepIdx(0)
    } else {
      finish()
    }
  }

  // ── Popover positioning ───────────────────────────────────────────────────

  const vpW = window.innerWidth
  const vpH = window.innerHeight

  const sTop    = rect ? Math.max(0, rect.top    - PADDING) : 0
  const sLeft   = rect ? Math.max(0, rect.left   - PADDING) : 0
  const sBottom = rect ? rect.bottom + PADDING : 0
  const sRight  = rect ? rect.right  + PADDING : 0
  const sW      = rect ? rect.width  + PADDING * 2 : 0
  const sH      = rect ? rect.height + PADDING * 2 : 0

  let popTop: number
  let popLeft: number
  if (!rect) {
    popTop  = Math.max(10, vpH / 2 - 180)
    popLeft = Math.max(10, vpW / 2 - POP_W / 2)
  } else {
    popTop = sBottom + 14
    if (popTop + 280 > vpH - 10) popTop = sTop - 280 - 14
    popTop  = Math.max(10, Math.min(popTop, vpH - 290))
    popLeft = sLeft + sW / 2 - POP_W / 2
    popLeft = Math.max(10, Math.min(popLeft, vpW - POP_W - 10))
  }

  const stopProp = (e: React.MouseEvent) => e.stopPropagation()
  const OVERLAY  = 'rgba(0,0,0,0.55)'
  const isRtl    = dir === 'rtl'

  // Progress: show individual step dots up to 10 total; beyond that show section dots
  const useStepDots = totalSteps <= 12
  const dotCount  = useStepDots ? totalSteps : totalSections
  const activeDot = useStepDots ? flatIdx : sectionIdx

  return (
    <div className="fixed inset-0" style={{ zIndex: 9000 }} onClick={finish}>

      {/* ── Backdrop with spotlight ──────────────────────────────────────── */}
      {rect ? (
        <>
          <div style={{ position:'fixed', inset:'0 0 auto 0', height: sTop,             background: OVERLAY }} />
          <div style={{ position:'fixed', top: sBottom, left:0, right:0, bottom:0,      background: OVERLAY }} />
          <div style={{ position:'fixed', top: sTop, left:0, width: sLeft, height: sH,  background: OVERLAY }} />
          <div style={{ position:'fixed', top: sTop, left: sRight, right:0, height: sH, background: OVERLAY }} />
          {/* click-blocker over the spotlit element so clicks don't dismiss */}
          <div style={{ position:'fixed', top: sTop, left: sLeft, width: sW, height: sH }} onClick={stopProp} />
          <div style={{
            position: 'fixed', top: sTop, left: sLeft, width: sW, height: sH,
            border: '2.5px solid rgb(13 148 136)',
            borderRadius: 10,
            boxShadow: '0 0 0 3px rgba(13,148,136,0.2)',
            pointerEvents: 'none',
          }} />
        </>
      ) : (
        <div style={{ position:'fixed', inset:0, background: OVERLAY }} />
      )}

      {/* ── Popover ───────────────────────────────────────────────────────── */}
      <div
        className="fixed bg-white dark:bg-slate-800 rounded-2xl shadow-2xl
                   border border-teal-100 dark:border-teal-800 p-5"
        style={{ top: popTop, left: popLeft, width: POP_W, zIndex: 9001 }}
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
          <div className={`flex items-center gap-1 shrink-0 ${isRtl ? 'mr-3' : 'ml-3'}`}>
            {(['en', 'he'] as Lang[]).map(l => (
              <button
                key={l}
                onClick={(e) => { stopProp(e); setLang(l) }}
                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                  lang === l
                    ? 'bg-teal-600 text-white'
                    : 'text-teal-500 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-slate-700'
                }`}
              >
                {l === 'en' ? 'EN' : 'עב'}
              </button>
            ))}
          </div>
        </div>

        {/* Section label */}
        {section.nameKey && (
          <div className="text-[10px] font-semibold text-teal-500 dark:text-teal-400 uppercase tracking-widest mb-1.5">
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

        {/* Buttons: Skip all | [spacer] | Skip [Section] · Next */}
        <div className={`flex items-center justify-between gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <button
            onClick={(e) => { stopProp(e); finish() }}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
          >
            {t('tourSkipAll')}
          </button>

          <div className={`flex items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
            {showSkipSec && (
              <button
                onClick={(e) => { stopProp(e); skipSection() }}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors whitespace-nowrap"
              >
                {t('tourSkipSection', { section: t(section.nameKey as TranslationKey) })}
              </button>
            )}
            <button
              onClick={(e) => { stopProp(e); next() }}
              className="px-5 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl
                         hover:bg-teal-700 transition-colors"
            >
              {isLastStep ? t('tourFinish') : t('tourNext')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
