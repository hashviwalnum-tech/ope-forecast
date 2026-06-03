import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './App.css'
import logo from './assets/logo.png'
import BackfillForm from './components/BackfillForm'
import BusinessSetup from './components/BusinessSetup'
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
import LoginPage from './pages/LoginPage'
import * as api from './api/client'
import type { BusinessRead } from './api/types'

const FREE_BUSINESS_LIMIT = 2
const SHOW_ADS = true

type Tab =
  | 'home' | 'predictions_home'
  | 'backfill' | 'history' | 'import' | 'trends'
  | 'events' | 'products' | 'regulars' | 'recurring' | 'predictions' | 'settings'
type NavGroup = 'history' | 'manage'

const GROUP_TAB_IDS: Record<NavGroup, Tab[]> = {
  history: ['history', 'backfill', 'trends', 'import'],
  manage:  ['products', 'regulars', 'recurring', 'events', 'predictions', 'settings'],
}


function AppInner() {
  const { session, loading: authLoading, signOut } = useAuth()
  const { lang, setLang, t, dir } = useLanguage()

  const [allBusinesses, setAllBusinesses]     = useState<BusinessRead[]>([])
  const [activeBusiness, setActiveBusiness]   = useState<BusinessRead | null>(null)
  const [bizLoaded, setBizLoaded]             = useState(false)
  const [bizError, setBizError]               = useState(false)
  const [showAddBusiness, setShowAddBusiness] = useState(false)

  const [tab, setTab]               = useState<Tab>('home')
  const [refreshKey, setRefreshKey] = useState(0)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [openGroup, setOpenGroup]   = useState<NavGroup | null>(null)
  const switcherRef = useRef<HTMLDivElement>(null)
  const navRef      = useRef<HTMLDivElement>(null)

  // ── Load all businesses on login ─────────────────────────────────────────

  const loadBusinesses = useCallback(async () => {
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
        setActiveBusiness(list[0])
        api.setActiveBusinessId(list[0].id)
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
  }

  function handleBusinessCreated(biz: BusinessRead) {
    setAllBusinesses(prev => [...prev, biz])
    setActiveBusiness(biz)
    api.setActiveBusinessId(biz.id)
    setShowAddBusiness(false)
    setBizLoaded(true)
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
  }

  if (authLoading || (session && !bizLoaded)) {
    return (
      <div className="min-h-screen bg-teal-50/60 flex items-center justify-center">
        <p className="text-teal-600 text-sm">Loading…</p>
      </div>
    )
  }

  if (!session) return <LoginPage />

  if (bizError) {
    return (
      <div className="min-h-screen bg-teal-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-md w-full max-w-sm p-8 text-center">
          <p className="text-slate-700 font-semibold mb-2">{t('serverUnreachable')}</p>
          <p className="text-sm text-slate-500 mb-6">{t('checkConnection')}</p>
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
        onCreated={handleBusinessCreated}
        onCancel={showAddBusiness ? () => setShowAddBusiness(false) : undefined}
      />
    )
  }

  // ── Main app ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-teal-50/40" dir={dir}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="bg-teal-50/80 backdrop-blur-sm border-b-2 border-teal-100 px-6 py-3
                         flex flex-wrap items-center gap-x-4 gap-y-2
                         sticky top-0 z-10 shadow-sm">

        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <img src={logo} alt="Ope logo" className="h-11 w-auto" />
          <div className="leading-tight">
            <span className="block text-xl font-bold text-teal-700 tracking-tight">Ope</span>
            <span className="block text-xs text-teal-500 font-medium">{t('slogan')}</span>
          </div>
        </div>

        {/* Business switcher */}
        <div className="relative shrink-0" ref={switcherRef}>
          <button
            onClick={() => setSwitcherOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                       text-teal-700 bg-teal-50 hover:bg-teal-100 font-medium
                       border border-teal-100 transition-colors"
          >
            <span className="max-w-[140px] truncate">{activeBusiness.name}</span>
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {switcherOpen && (
            <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-teal-100
                            rounded-xl shadow-lg z-20 py-1 overflow-hidden">
              {allBusinesses.map(b => (
                <button
                  key={b.id}
                  onClick={() => switchBusiness(b)}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors
                    ${b.id === activeBusiness.id
                      ? 'bg-teal-50 text-teal-700 font-medium'
                      : 'text-slate-700 hover:bg-slate-50'}`}
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
              ))}
              <div className="border-t border-slate-100 mt-1 pt-1">
                {allBusinesses.length < FREE_BUSINESS_LIMIT ? (
                  <button
                    onClick={() => { setShowAddBusiness(true); setSwitcherOpen(false) }}
                    className="w-full text-left px-4 py-2.5 text-sm text-teal-600
                               hover:bg-teal-50 flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t('addBusiness')}
                  </button>
                ) : (
                  <p className="px-4 py-2.5 text-xs text-slate-400">
                    {t('freePlanLimit', { n: FREE_BUSINESS_LIMIT })}
                  </p>
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
                  : 'text-slate-600 hover:bg-teal-50 hover:text-teal-700'
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
                      ? 'bg-teal-100 text-teal-700'
                      : 'text-slate-600 hover:bg-teal-50 hover:text-teal-700'
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
                  <div className={`absolute ${dir === 'rtl' ? 'right-0' : 'left-0'} top-full mt-1 w-48 bg-white border border-teal-100
                                  rounded-xl shadow-lg z-20 py-1 overflow-hidden`}>
                    {group.tabs.map(navTab => (
                      <button
                        key={navTab.id}
                        onClick={() => { setTab(navTab.id); setOpenGroup(null) }}
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                          tab === navTab.id
                            ? 'bg-teal-50 text-teal-700 font-medium'
                            : 'text-slate-700 hover:bg-slate-50'
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
                  : 'text-teal-600 hover:bg-teal-50'
              }`}
            >
              {l === 'en' ? 'EN' : 'HE'}
            </button>
          ))}
        </div>

        {/* Log out */}
        <button
          onClick={signOut}
          className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-200
                     text-slate-600 hover:border-rose-300 hover:text-rose-600
                     hover:bg-rose-50 transition-colors shrink-0"
        >
          {t('logOut')}
        </button>
      </header>

      {/* ── Content row (side ad slots + main) ─────────────────────── */}
      <div className="flex">

        {/* Left ad slot — wide screens only */}
        {SHOW_ADS && (
          <aside className="hidden xl:flex flex-col w-44 shrink-0 pt-8 px-3 sticky top-20 self-start">
            <div className="w-full min-h-[280px] bg-teal-50/70 border border-teal-100 rounded-xl
                            flex items-center justify-center">
              <span className="text-[10px] text-teal-300 tracking-widest uppercase select-none">Ad</span>
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className={`flex-1 max-w-4xl mx-auto px-6 py-8 ${SHOW_ADS ? 'pb-20 xl:pb-8' : ''}`}>
          <h1 className="text-lg font-semibold text-slate-700 mb-6">{tabTitles[tab]}</h1>
          <OutlierBanner onResolved={refresh} />
          {tab === 'home'             && <HomeScreen refreshKey={refreshKey} onSaved={refresh} />}
          {tab === 'predictions_home' && <PredictionsScreen refreshKey={refreshKey} />}
          {tab === 'trends'           && <TrendsView />}
          {tab === 'events'           && <PeriodsPanel />}
          {tab === 'products'         && <ProductsPanel />}
          {tab === 'regulars'         && <RegularsPanel />}
          {tab === 'recurring'        && <RecurringPatternsPanel />}
          {tab === 'backfill'         && <BackfillForm onSaved={refresh} />}
          {tab === 'history'          && <DayList refreshKey={refreshKey} />}
          {tab === 'import'           && <CsvImport onImported={afterImport} />}
          {tab === 'settings'         && <BusinessSettings />}
          {tab === 'predictions'      && <PredictionsPanel />}
        </main>

        {/* Right ad slot — wide screens only */}
        {SHOW_ADS && (
          <aside className="hidden xl:flex flex-col w-44 shrink-0 pt-8 px-3 sticky top-20 self-start">
            <div className="w-full min-h-[280px] bg-teal-50/70 border border-teal-100 rounded-xl
                            flex items-center justify-center">
              <span className="text-[10px] text-teal-300 tracking-widest uppercase select-none">Ad</span>
            </div>
          </aside>
        )}

      </div>

      {/* Bottom ad banner — narrow screens only */}
      {SHOW_ADS && (
        <div className="fixed bottom-0 inset-x-0 xl:hidden h-14 bg-teal-50/90 backdrop-blur-sm
                        border-t border-teal-100 flex items-center justify-center z-10">
          <span className="text-[10px] text-teal-300 tracking-widest uppercase select-none">Ad</span>
        </div>
      )}

    </div>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  )
}
