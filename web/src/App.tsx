import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './App.css'
import logo from './assets/logo.png'
import AdvancedToolbox from './components/AdvancedToolbox'
import BackfillForm from './components/BackfillForm'
import BusinessSetup from './components/BusinessSetup'
import OnboardingWizard, { isOnboardingDone } from './components/OnboardingWizard'
import BusinessSettings from './components/BusinessSettings'
import CsvImport from './components/CsvImport'
import DayList from './components/DayList'
import HomeScreen from './components/HomeScreen'
import TrendsView from './components/TrendsView'
import OutlierBanner from './components/OutlierBanner'
import PeriodsPanel from './components/PeriodsPanel'
import ProductsPanel from './components/ProductsPanel'
import PredictionsPanel from './components/PredictionsPanel'
import PredictionsScreen from './components/PredictionsScreen'
import RecurringPatternsPanel from './components/RecurringPatternsPanel'
import RegularsPanel from './components/RegularsPanel'
import { useAuth } from './contexts/AuthContext'
import { LanguageProvider, useLanguage } from './contexts/LanguageContext'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import LoginPage from './pages/LoginPage'
import * as api from './api/client'
import type { BusinessRead } from './api/types'

const FREE_BUSINESS_LIMIT = 1  // §10: free = one location; premium = more
const SHOW_ADS = true

type Tab =
  | 'home' | 'predictions_home'
  | 'backfill' | 'history' | 'import' | 'trends'
  | 'events' | 'products' | 'regulars' | 'recurring' | 'predictions' | 'settings' | 'toolbox'
type NavGroup = 'history' | 'manage'

const GROUP_TAB_IDS: Record<NavGroup, Tab[]> = {
  history: ['history', 'backfill', 'trends', 'import'],
  manage:  ['products', 'regulars', 'recurring', 'events', 'predictions', 'toolbox', 'settings'],
}


function AppInner() {
  const { session, loading: authLoading, signOut } = useAuth()
  const { lang, setLang, t, dir } = useLanguage()
  const { isDark, toggleTheme } = useTheme()

  const [allBusinesses, setAllBusinesses]     = useState<BusinessRead[]>([])
  const [activeBusiness, setActiveBusiness]   = useState<BusinessRead | null>(null)
  const [bizLoaded, setBizLoaded]             = useState(false)
  const [bizError, setBizError]               = useState(false)
  const [showAddBusiness, setShowAddBusiness] = useState(false)
  const [waking, setWaking]                   = useState(false)
  const [onboardingDone, setOnboardingDone]   = useState(false)

  useEffect(() => {
    api.setWakingUpListener(setWaking)
    return () => api.setWakingUpListener(null)
  }, [])

  const [tab, setTab]               = useState<Tab>('home')
  const [refreshKey, setRefreshKey] = useState(0)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [openGroup, setOpenGroup]   = useState<NavGroup | null>(null)
  const switcherRef = useRef<HTMLDivElement>(null)
  const navRef      = useRef<HTMLDivElement>(null)

  // ── Load all businesses on login ─────────────────────────────────────────

  const loadBusinesses = useCallback(async (keepActiveId?: number) => {
    if (!session) {
      setAllBusinesses([])
      setActiveBusiness(null)
      api.setActiveBusinessId(null)
      setBizLoaded(false)
      setBizError(false)
      return
    }
    try {
      const list = await api.businesses.list()
      setAllBusinesses(list)
      if (list.length > 0) {
        // Preserve the currently active business when reloading for tier/delete changes
        const chosen = keepActiveId
          ? (list.find(b => b.id === keepActiveId) ?? list[0])
          : list[0]
        setActiveBusiness(chosen)
        api.setActiveBusinessId(chosen.id)
        setOnboardingDone(
          isOnboardingDone(chosen.id) || chosen.settings?.onboarding_done === true
        )
      } else {
        setActiveBusiness(null)
        api.setActiveBusinessId(null)
      }
      setBizLoaded(true)
      setBizError(false)
    } catch {
      setBizLoaded(true)
      setBizError(true)
    }
  }, [session])

  useEffect(() => { loadBusinesses() }, [loadBusinesses])

  // ── Close switcher on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!switcherOpen) return
    function handle(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [switcherOpen])

  // ── Close nav dropdowns on outside click ─────────────────────────────────

  useEffect(() => {
    if (!openGroup) return
    function handle(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [openGroup])

  // ── Which dropdown group (if any) contains the active tab ────────────────

  const activeGroup = useMemo<NavGroup | null>(() => {
    for (const [gId, tabIds] of Object.entries(GROUP_TAB_IDS) as [NavGroup, Tab[]][]) {
      if (tabIds.includes(tab)) return gId
    }
    return null
  }, [tab])

  // ── Actions ───────────────────────────────────────────────────────────────

  function refresh() { setRefreshKey(k => k + 1) }
  function afterImport() { refresh(); setTab('history') }

  function switchBusiness(biz: BusinessRead) {
    setActiveBusiness(biz)
    api.setActiveBusinessId(biz.id)
    setSwitcherOpen(false)
    setRefreshKey(k => k + 1)
    setOnboardingDone(isOnboardingDone(biz.id) || biz.settings?.onboarding_done === true)
  }

  function handleBusinessCreated(biz: BusinessRead) {
    setAllBusinesses(prev => [...prev, biz])
    setActiveBusiness(biz)
    api.setActiveBusinessId(biz.id)
    setShowAddBusiness(false)
    setBizLoaded(true)
    setOnboardingDone(isOnboardingDone(biz.id) || biz.settings?.onboarding_done === true)
  }

  function handleDeleteBusiness(bizId: number, bizName: string) {
    if (!confirm(t('deleteLocationConfirm', { name: bizName }))) return
    setSwitcherOpen(false) // close immediately — keeps the UI responsive
    setTimeout(async () => {
      try {
        await api.businesses.delete(bizId)
        await loadBusinesses()
      } catch {
        alert(t('deleteLocationError'))
      }
    }, 0)
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  // ── Language-aware nav labels ─────────────────────────────────────────────

  const primaryTabs = [
    { id: 'home' as Tab,             label: t('home')        },
    { id: 'predictions_home' as Tab, label: t('predictions') },
  ]

  const dropdownGroups = [
    {
      id: 'history' as NavGroup,
      label: t('history'),
      tabs: [
        { id: 'history'  as Tab, label: t('pastDays')      },
        { id: 'backfill' as Tab, label: t('addPastDay')    },
        { id: 'trends'   as Tab, label: t('monthlyTrends') },
        { id: 'import'   as Tab, label: t('importData')    },
      ],
    },
    {
      id: 'manage' as NavGroup,
      label: t('manage'),
      tabs: [
        { id: 'products'    as Tab, label: t('myProducts')         },
        { id: 'regulars'    as Tab, label: t('myRegulars')         },
        { id: 'recurring'   as Tab, label: t('recurringPatterns')  },
        { id: 'events'      as Tab, label: t('promosEvents')       },
        { id: 'predictions' as Tab, label: t('predictionHistory')  },
        { id: 'toolbox'     as Tab, label: t('advancedPlanning')   },
        { id: 'settings'    as Tab, label: t('settings')           },
      ],
    },
  ]

  const tabTitles: Record<Tab, string> = {
    home:             t('tabHome'),
    predictions_home: t('tabPredictions'),
    trends:           t('tabTrends'),
    events:           t('tabEvents'),
    products:         t('tabProducts'),
    regulars:         t('tabRegulars'),
    recurring:        t('tabRecurring'),
    backfill:         t('tabBackfill'),
    history:          t('tabHistory'),
    import:           t('tabImport'),
    settings:         t('tabSettings'),
    predictions:      t('tabPredHistory'),
    toolbox:          t('tabToolbox'),
  }

  if (authLoading || (session && !bizLoaded)) {
    return (
      <div className="min-h-screen bg-teal-50/60 dark:bg-slate-900 flex items-center justify-center px-6">
        {waking ? (
          <div className="text-center space-y-4 max-w-xs">
            <svg className="w-12 h-12 text-teal-400 dark:text-teal-500 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-teal-700 dark:text-teal-300 font-semibold text-lg">{t('wakingUpTitle')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{t('wakingUpMsg')}</p>
          </div>
        ) : (
          <p className="text-teal-600 dark:text-teal-400 text-sm">Loading…</p>
        )}
      </div>
    )
  }

  if (!session) return <LoginPage />

  if (bizError) {
    return (
      <div className="min-h-screen bg-teal-50 dark:bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl shadow-md w-full max-w-sm p-8 text-center">
          <p className="text-slate-700 dark:text-slate-200 font-semibold mb-2">{t('serverUnreachable')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{t('checkConnection')}</p>
          <button
            onClick={() => { setBizLoaded(false); setBizError(false); loadBusinesses() }}
            className="px-6 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                       hover:bg-teal-700 transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!activeBusiness || showAddBusiness) {
    return (
      <BusinessSetup
        isAdditional={showAddBusiness}
        existingCount={allBusinesses.length}
        limit={FREE_BUSINESS_LIMIT}
        isPremium={activeBusiness?.tier === 'premium'}
        existingBusinesses={showAddBusiness ? allBusinesses : []}
        onCreated={handleBusinessCreated}
        onCancel={showAddBusiness ? () => setShowAddBusiness(false) : undefined}
      />
    )
  }

  // ── Main app ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-teal-50 dark:bg-slate-900" dir={dir}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="bg-teal-100 dark:bg-slate-800 backdrop-blur-sm border-b-2 border-teal-200 dark:border-slate-700 px-6 py-3
                         flex flex-wrap items-center gap-x-4 gap-y-2
                         sticky top-0 z-10 shadow-sm">

        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <img src={logo} alt="Ope logo" className="logo-img h-11 w-auto" />
          <div className="leading-tight">
            <span className="block text-xl font-bold text-teal-700 dark:text-teal-300 tracking-tight">Ope</span>
            <span className="block text-xs text-teal-500 dark:text-teal-400 font-medium">{t('slogan')}</span>
          </div>
        </div>

        {/* Business switcher */}
        <div className="relative shrink-0" ref={switcherRef}>
          <button
            onClick={() => setSwitcherOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                       text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-slate-700 hover:bg-teal-100 dark:hover:bg-slate-600 font-medium
                       border border-teal-100 dark:border-slate-600 transition-colors"
          >
            <span className="max-w-[140px] truncate">{activeBusiness.name}</span>
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {switcherOpen && (
            <div className="absolute left-0 top-full mt-1 w-56 bg-teal-25 dark:bg-slate-800 border border-teal-100 dark:border-slate-700
                            rounded-xl shadow-lg z-20 py-1 overflow-hidden">
              {allBusinesses.map(b => (
                <div key={b.id} className="flex items-center group">
                  <button
                    onClick={() => switchBusiness(b)}
                    className={`flex-1 text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors
                      ${b.id === activeBusiness.id
                        ? 'bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-medium'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                  >
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 transition-opacity
                        ${b.id === activeBusiness.id ? 'text-teal-600 opacity-100' : 'opacity-0'}`}
                      fill="currentColor" viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span className="truncate">{b.name}</span>
                  </button>
                  {allBusinesses.length > 1 && (
                    <button
                      onClick={() => handleDeleteBusiness(b.id, b.name)}
                      title={t('deleteLocation')}
                      className="px-2 py-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400
                                 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              <div className="border-t border-slate-100 dark:border-slate-700 mt-1 pt-1">
                {activeBusiness?.tier === 'premium' || allBusinesses.length < FREE_BUSINESS_LIMIT ? (
                  <button
                    onClick={() => { setShowAddBusiness(true); setSwitcherOpen(false) }}
                    className="w-full text-left px-4 py-2.5 text-sm text-teal-600 dark:text-teal-400
                               hover:bg-teal-50 dark:hover:bg-slate-700 flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t('addLocation')}
                  </button>
                ) : (
                  <div className="px-4 py-2.5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('freeOneLocation')}</p>
                    <button
                      onClick={() => { setTab('settings'); setSwitcherOpen(false) }}
                      className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 hover:underline transition-colors"
                    >
                      {t('upgradeForLocations')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav ref={navRef} className="flex flex-wrap gap-1 flex-1">

          {/* Primary tabs — always visible */}
          {primaryTabs.map(navTab => (
            <button
              key={navTab.id}
              onClick={() => { setTab(navTab.id); setOpenGroup(null) }}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                tab === navTab.id
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-slate-700 hover:text-teal-700 dark:hover:text-teal-300'
              }`}
            >
              {navTab.label}
            </button>
          ))}

          {/* Dropdown groups */}
          {dropdownGroups.map(group => {
            const isGroupActive = activeGroup === group.id
            const isOpen = openGroup === group.id
            return (
              <div key={group.id} className="relative">
                <button
                  onClick={() => setOpenGroup(isOpen ? null : group.id)}
                  className={`flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isGroupActive
                      ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-slate-700 hover:text-teal-700 dark:hover:text-teal-300'
                  }`}
                >
                  {group.label}
                  <svg
                    className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className={`absolute ${dir === 'rtl' ? 'right-0' : 'left-0'} top-full mt-1 w-48 bg-teal-25 dark:bg-slate-800 border border-teal-100 dark:border-slate-700
                                  rounded-xl shadow-lg z-20 py-1 overflow-hidden`}>
                    {group.tabs.map(navTab => (
                      <button
                        key={navTab.id}
                        onClick={() => { setTab(navTab.id); setOpenGroup(null) }}
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                          tab === navTab.id
                            ? 'bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-medium'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        {tab === navTab.id && (
                          <svg className="w-3.5 h-3.5 shrink-0 text-teal-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                        <span className={tab === navTab.id ? '' : 'ml-5'}>{navTab.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Language switcher */}
        <div className="flex items-center shrink-0">
          {(['en', 'he'] as const).map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
                lang === l
                  ? 'bg-teal-600 text-white'
                  : 'text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-slate-700'
              }`}
            >
              {l === 'en' ? 'EN' : 'HE'}
            </button>
          ))}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-300
                     hover:bg-teal-50 dark:hover:bg-slate-700 transition-colors shrink-0"
        >
          {isDark ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.7.7M6.34 17.66l-.7.7M17.66 17.66l-.7-.7M6.34 6.34l-.7-.7M12 5a7 7 0 100 14A7 7 0 0012 5z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {/* Log out */}
        <button
          onClick={signOut}
          className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-600
                     text-slate-600 dark:text-slate-300 hover:border-rose-300 hover:text-rose-600
                     hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors shrink-0"
        >
          {t('logOut')}
        </button>
      </header>

      {/* ── Content row (side ad slots + main) ─────────────────────── */}
      <div className="flex">

        {/* Left ad slot — wide screens only */}
        {SHOW_ADS && (
          <aside className="hidden xl:flex flex-col w-44 shrink-0 pt-8 px-3 sticky top-20 self-start">
            <div className="w-full min-h-[600px] bg-teal-50/70 dark:bg-slate-800/60 border border-teal-100 dark:border-slate-700 rounded-xl
                            flex items-center justify-center">
              <span className="text-[10px] text-teal-300 dark:text-teal-600 tracking-widest uppercase select-none">Ad</span>
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className={`flex-1 max-w-4xl mx-auto px-6 py-8 ${SHOW_ADS ? 'pb-20 xl:pb-8' : ''}`}>
          <h1 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-6">{tabTitles[tab]}</h1>
          <OutlierBanner onResolved={refresh} />
          {tab === 'home'             && (!onboardingDone ? (
            <OnboardingWizard
              bizId={activeBusiness.id}
              onGoToProducts={() => setTab('products')}
              onDone={() => {
                setOnboardingDone(true)
                api.businesses.updateSettings({ onboarding_done: true }).catch(() => {})
              }}
            />
          ) : (
            <HomeScreen refreshKey={refreshKey} onSaved={refresh} onGoToProducts={() => setTab('products')} />
          ))}
          {tab === 'predictions_home' && <PredictionsScreen refreshKey={refreshKey} />}
          {tab === 'trends'           && <TrendsView />}
          {tab === 'events'           && <PeriodsPanel />}
          {tab === 'products'         && <ProductsPanel />}
          {tab === 'regulars'         && <RegularsPanel />}
          {tab === 'recurring'        && <RecurringPatternsPanel />}
          {tab === 'backfill'         && <BackfillForm onSaved={refresh} />}
          {tab === 'history'          && <DayList refreshKey={refreshKey} />}
          {tab === 'import'           && <CsvImport onImported={afterImport} />}
          {tab === 'settings'         && <BusinessSettings onTierChanged={() => loadBusinesses(activeBusiness?.id)} />}
          {tab === 'predictions'      && <PredictionsPanel />}
          {tab === 'toolbox'          && <AdvancedToolbox />}
        </main>

        {/* Right ad slot — wide screens only */}
        {SHOW_ADS && (
          <aside className="hidden xl:flex flex-col w-44 shrink-0 pt-8 px-3 sticky top-20 self-start">
            <div className="w-full min-h-[600px] bg-teal-50/70 dark:bg-slate-800/60 border border-teal-100 dark:border-slate-700 rounded-xl
                            flex items-center justify-center">
              <span className="text-[10px] text-teal-300 dark:text-teal-600 tracking-widest uppercase select-none">Ad</span>
            </div>
          </aside>
        )}

      </div>

      {/* Bottom ad banner — narrow screens only */}
      {SHOW_ADS && (
        <div className="fixed bottom-0 inset-x-0 xl:hidden h-14 bg-teal-50/90 dark:bg-slate-800/90 backdrop-blur-sm
                        border-t border-teal-100 dark:border-slate-700 flex items-center justify-center z-10">
          <span className="text-[10px] text-teal-300 dark:text-teal-600 tracking-widest uppercase select-none">Ad</span>
        </div>
      )}

    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AppInner />
      </LanguageProvider>
    </ThemeProvider>
  )
}
