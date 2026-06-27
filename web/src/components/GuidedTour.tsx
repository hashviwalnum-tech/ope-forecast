import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../i18n'

const STEPS: Array<{ title: TranslationKey; body: TranslationKey; target?: string }> = [
  { title: 'tourWelcomeTitle',      body: 'tourWelcomeBody' },
  { title: 'tourQuickActionsTitle', body: 'tourQuickActionsBody', target: '[data-tour="quick-actions"]' },
  { title: 'tourForecastTitle',     body: 'tourForecastBody',     target: '[data-tour="forecast-chart"]' },
  { title: 'tourBusyHoursTitle',    body: 'tourBusyHoursBody',    target: '[data-tour="busy-hours"]' },
  { title: 'tourPredictionsTitle',  body: 'tourPredictionsBody',  target: '[data-tour="nav-predictions"]' },
  { title: 'tourInsightsTitle',     body: 'tourInsightsBody',     target: '[data-tour="nav-insights"]' },
  { title: 'tourHistoryTitle',      body: 'tourHistoryBody',      target: '[data-tour="nav-history"]' },
  { title: 'tourManageTitle',       body: 'tourManageBody',       target: '[data-tour="nav-manage"]' },
  { title: 'tourDoneTitle',         body: 'tourDoneBody' },
]

const PADDING = 10
const POP_W = 320

interface Props {
  bizId: number
  onDone: () => void
}

export function isTourDone(bizId: number): boolean {
  return localStorage.getItem(`ope_tour_done_${bizId}`) === '1'
}

export function clearTourDone(bizId: number): void {
  localStorage.removeItem(`ope_tour_done_${bizId}`)
}

export default function GuidedTour({ bizId, onDone }: Props) {
  const { t } = useLanguage()
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [tick, setTick] = useState(0)

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  const calcRect = useCallback(() => {
    if (current.target) {
      const el = document.querySelector(current.target)
      setRect(el ? el.getBoundingClientRect() : null)
    } else {
      setRect(null)
    }
  }, [current.target])

  useEffect(() => {
    const id = setTimeout(() => {
      calcRect()
      if (current.target) {
        const el = document.querySelector(current.target)
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 80)
    return () => clearTimeout(id)
  }, [step, calcRect, current.target])

  useEffect(() => {
    const handle = () => { calcRect(); setTick(n => n + 1) }
    window.addEventListener('resize', handle)
    window.addEventListener('scroll', handle, true)
    return () => {
      window.removeEventListener('resize', handle)
      window.removeEventListener('scroll', handle, true)
    }
  }, [calcRect])

  // Suppress unused-tick warning (tick is only used to force re-render on scroll)
  void tick

  function finish() {
    localStorage.setItem(`ope_tour_done_${bizId}`, '1')
    onDone()
  }

  function next() { isLast ? finish() : setStep(s => s + 1) }

  const vpW = window.innerWidth
  const vpH = window.innerHeight

  // Spotlight bounds
  const sTop    = rect ? Math.max(0, rect.top    - PADDING) : 0
  const sLeft   = rect ? Math.max(0, rect.left   - PADDING) : 0
  const sBottom = rect ? rect.bottom + PADDING : 0
  const sRight  = rect ? rect.right  + PADDING : 0
  const sW      = rect ? rect.width  + PADDING * 2 : 0
  const sH      = rect ? rect.height + PADDING * 2 : 0

  // Popover position — prefer below the target, fall back above
  let popTop: number
  let popLeft: number
  if (!rect) {
    popTop  = Math.max(10, vpH / 2 - 160)
    popLeft = Math.max(10, vpW / 2 - POP_W / 2)
  } else {
    popTop = sBottom + 14
    if (popTop + 240 > vpH - 10) popTop = sTop - 240 - 14
    popTop  = Math.max(10, Math.min(popTop, vpH - 250))
    popLeft = sLeft + sW / 2 - POP_W / 2
    popLeft = Math.max(10, Math.min(popLeft, vpW - POP_W - 10))
  }

  const stopProp = (e: React.MouseEvent) => e.stopPropagation()
  const OVERLAY = 'rgba(0,0,0,0.55)'

  return (
    <div className="fixed inset-0" style={{ zIndex: 9000 }} onClick={finish}>

      {/* ── Backdrop ──────────────────────────────────────────────────── */}
      {rect ? (
        <>
          {/* 4 dark panels surrounding the spotlight hole */}
          <div style={{ position:'fixed', inset:'0 0 auto 0', height: sTop,             background: OVERLAY }} />
          <div style={{ position:'fixed', top: sBottom, left:0, right:0, bottom:0,      background: OVERLAY }} />
          <div style={{ position:'fixed', top: sTop, left:0, width: sLeft, height: sH,  background: OVERLAY }} />
          <div style={{ position:'fixed', top: sTop, left: sRight, right:0, height: sH, background: OVERLAY }} />
          {/* Invisible click-blocker over the exposed element */}
          <div style={{ position:'fixed', top: sTop, left: sLeft, width: sW, height: sH }} />
          {/* Teal highlight ring */}
          <div style={{
            position: 'fixed',
            top: sTop, left: sLeft, width: sW, height: sH,
            border: '2.5px solid rgb(13 148 136)',
            borderRadius: 10,
            boxShadow: '0 0 0 3px rgba(13,148,136,0.2)',
            pointerEvents: 'none',
          }} />
        </>
      ) : (
        <div style={{ position:'fixed', inset:0, background: OVERLAY }} />
      )}

      {/* ── Popover ───────────────────────────────────────────────────── */}
      <div
        className="fixed bg-white dark:bg-slate-800 rounded-2xl shadow-2xl
                   border border-teal-100 dark:border-teal-800 p-5"
        style={{ top: popTop, left: popLeft, width: POP_W, zIndex: 9001 }}
        onClick={stopProp}
      >
        {/* Progress strip */}
        <div className="flex items-center gap-1 mb-3">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-200"
              style={{
                height: 5,
                width:  i === step ? 20 : 6,
                background: i === step ? 'rgb(13 148 136)' : i < step ? 'rgb(94 234 212)' : 'rgb(226 232 240)',
              }}
            />
          ))}
        </div>

        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">
          {t(current.title)}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
          {t(current.body)}
        </p>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={(e) => { stopProp(e); finish() }}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
          >
            {t('tourSkipAll')}
          </button>

          <div className="flex items-center gap-3">
            {!isLast && (
              <button
                onClick={(e) => { stopProp(e); next() }}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                {t('tourSkipStep')}
              </button>
            )}
            <button
              onClick={(e) => { stopProp(e); next() }}
              className="px-5 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl
                         hover:bg-teal-700 transition-colors"
            >
              {isLast ? t('tourFinish') : t('tourNext')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
