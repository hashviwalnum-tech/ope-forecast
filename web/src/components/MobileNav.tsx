import { useEffect, useRef } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../i18n'

/**
 * Phone and tablet navigation: a bottom tab bar, and a sheet for everything else.
 *
 * Until now the web app had one navigation — the desktop one — and on a narrow
 * screen it simply wrapped. Measured on the year-long account, that left the
 * header **339px tall on a 390px phone and 381px on a 360px phone**, stuck to
 * the top while scrolling: 40% and 60% of the viewport, permanently, on every
 * screen. This is the same four-tab shape the mobile app uses (Log, Forecast,
 * Analytics, Manage), so the two feel like one product, and it sits under the
 * thumb rather than above the fold.
 *
 * Every destination here already existed in the desktop menus. Nothing new is
 * exposed; it is the same map, reachable with one thumb.
 */

export interface NavDestination {
  id: string
  label: string
}

export interface NavSection {
  titleKey: TranslationKey
  items: NavDestination[]
}

interface Props {
  /** Currently open tab id, so the bar can show where you are. */
  active: string
  onNavigate: (tabId: string) => void
  /** The four bottom-bar slots, in order. */
  tabs: { id: string; label: string; icon: 'log' | 'forecast' | 'insights' | 'manage' }[]
  /** Grouped destinations for the "Manage" sheet. */
  sections: NavSection[]
  /** Whether the sheet is open — held by App so the tour can drive it. */
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  /** Rendered at the bottom of the sheet: language, theme, sign out. */
  sheetFooter?: React.ReactNode
  /** Ids that belong to the "Manage" slot, so it highlights on those screens. */
  sheetTabIds: string[]
}

function Icon({ name, filled }: { name: Props['tabs'][number]['icon']; filled: boolean }) {
  const stroke = filled ? 2.25 : 1.75
  const common = { className: 'w-6 h-6', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', 'aria-hidden': true } as const
  switch (name) {
    case 'log':      // a plus in a circle — "record a sale", the most frequent action
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" strokeWidth={stroke} />
          <path strokeLinecap="round" strokeWidth={stroke} d="M12 8.5v7M8.5 12h7" />
        </svg>
      )
    case 'forecast':  // a calendar — what the days ahead look like
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" strokeWidth={stroke} />
          <path strokeLinecap="round" strokeWidth={stroke} d="M8 3.5v3M16 3.5v3M3.5 10h17" />
        </svg>
      )
    case 'insights':  // bars — what Ope has learned
      return (
        <svg {...common}>
          <path strokeLinecap="round" strokeWidth={stroke} d="M6.5 19v-6M12 19V6M17.5 19v-9" />
        </svg>
      )
    case 'manage':    // a grid — everything else
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" strokeWidth={stroke} />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" strokeWidth={stroke} />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" strokeWidth={stroke} />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" strokeWidth={stroke} />
        </svg>
      )
  }
}

export default function MobileNav({
  active, onNavigate, tabs, sections, sheetOpen, setSheetOpen, sheetFooter, sheetTabIds,
}: Props) {
  const { t } = useLanguage()
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape closes the sheet, opening it moves focus inside, and Tab is kept
  // within it — it is aria-modal, so focus must not reach the page behind.
  useEffect(() => {
    if (!sheetOpen) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSheetOpen(false); return }
      if (e.key !== 'Tab') return
      const panel = sheetRef.current
      if (!panel) return
      const items = panel.querySelectorAll<HTMLElement>(
        'button, [href], select, input, [tabindex]:not([tabindex="-1"])',
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [sheetOpen, setSheetOpen])

  function pick(id: string) {
    onNavigate(id)
    setSheetOpen(false)
  }

  return (
    <>
      {/* ── The sheet ─────────────────────────────────────────────────── */}
      {sheetOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <button
            aria-label={t('closeLabel')}
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('manage')}
            className="relative bg-teal-25 dark:bg-slate-800 rounded-t-3xl border-t border-teal-100 dark:border-slate-700
                       max-h-[80vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+5.5rem)] shadow-2xl"
          >
            <div className="sticky top-0 bg-teal-25 dark:bg-slate-800 px-5 pt-3 pb-2 flex items-center justify-between
                            border-b border-teal-100 dark:border-slate-700">
              <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('manage')}</span>
              <button
                ref={closeRef}
                onClick={() => setSheetOpen(false)}
                className="w-11 h-11 -mr-2 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300
                           hover:bg-teal-50 dark:hover:bg-slate-700
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                aria-label={t('closeLabel')}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {sections.map(section => (
              <div key={section.titleKey} className="px-3 py-2">
                <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  {t(section.titleKey)}
                </p>
                {section.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => pick(item.id)}
                    aria-current={active === item.id ? 'page' : undefined}
                    className={`w-full text-start px-3 min-h-12 py-3 rounded-xl text-base transition-colors
                                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                      active === item.id
                        ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-50 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-teal-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}

            {sheetFooter && (
              <div className="px-5 py-4 border-t border-teal-100 dark:border-slate-700 space-y-3">
                {sheetFooter}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── The bar ───────────────────────────────────────────────────── */}
      <nav
        aria-label={t('a11yMainNav')}
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-teal-25/95 dark:bg-slate-800/95 backdrop-blur
                   border-t border-teal-100 dark:border-slate-700 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex">
          {tabs.map(tab => {
            const isManage = tab.icon === 'manage'
            const isActive = isManage
              ? sheetOpen || sheetTabIds.includes(active)
              : !sheetOpen && active === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => (isManage ? setSheetOpen(!sheetOpen) : pick(tab.id))}
                aria-current={isActive && !isManage ? 'page' : undefined}
                aria-expanded={isManage ? sheetOpen : undefined}
                className={`flex-1 min-h-14 py-2 flex flex-col items-center justify-center gap-0.5 transition-colors
                            focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600 ${
                  isActive
                    ? 'text-teal-700 dark:text-teal-300'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Icon name={tab.icon} filled={isActive} />
                <span className="text-xs font-medium leading-none">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
