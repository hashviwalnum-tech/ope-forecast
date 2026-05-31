import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import logo from './assets/logo.png'
import BackfillForm from './components/BackfillForm'
import BusinessSetup from './components/BusinessSetup'
import BusinessSettings from './components/BusinessSettings'
import CsvImport from './components/CsvImport'
import DayList from './components/DayList'
import ForecastDashboard from './components/ForecastDashboard'
import HourlyDashboard from './components/HourlyDashboard'
import LogDayForm from './components/LogDayForm'
import OutlierBanner from './components/OutlierBanner'
import PeriodsPanel from './components/PeriodsPanel'
import ProductsPanel from './components/ProductsPanel'
import TapSellPanel from './components/TapSellPanel'
import { useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import * as api from './api/client'
import type { BusinessRead } from './api/types'

const FREE_BUSINESS_LIMIT = 2

type Tab = 'log' | 'backfill' | 'history' | 'import' | 'forecast' | 'events' | 'products' | 'sell' | 'hours' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'forecast',  label: 'This Week'       },
  { id: 'sell',      label: 'Record a Sale'   },
  { id: 'hours',     label: 'Busy Hours'      },
  { id: 'events',    label: 'Promos & Events' },
  { id: 'products',  label: 'My Products'     },
  { id: 'log',       label: 'Add Today'       },
  { id: 'backfill',  label: 'Add Past Day'    },
  { id: 'history',   label: 'Past Days'       },
  { id: 'import',    label: 'Import Data'     },
  { id: 'settings',  label: 'Settings'        },
]

const TAB_TITLES: Record<Tab, string> = {
  forecast:  "What's coming this week",
  sell:      "Record today's sales",
  hours:     'Busy hours & staffing',
  events:    'Promos & Events',
  products:  'My Products',
  log:       "Log today's numbers",
  backfill:  'Add a past day',
  history:   'Your past days',
  import:    'Bring in your past data',
  settings:  'Your business settings',
}

export default function App() {
  const { session, loading: authLoading, signOut } = useAuth()

  const [allBusinesses, setAllBusinesses]     = useState<BusinessRead[]>([])
  const [activeBusiness, setActiveBusiness]   = useState<BusinessRead | null>(null)
  const [bizLoaded, setBizLoaded]             = useState(false)
  const [bizError, setBizError]               = useState(false)
  const [showAddBusiness, setShowAddBusiness] = useState(false)

  const [tab, setTab]               = useState<Tab>('forecast')
  const [refreshKey, setRefreshKey] = useState(0)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

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

  if (authLoading || (session && !bizLoaded)) {
    return (
      <div className="min-h-screen bg-teal-50 flex items-center justify-center">
        <p className="text-teal-600 text-sm">Loading…</p>
      </div>
    )
  }

  if (!session) return <LoginPage />

  if (bizError) {
    return (
      <div className="min-h-screen bg-teal-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-md w-full max-w-sm p-8 text-center">
          <p className="text-slate-700 font-semibold mb-2">Couldn't reach the server</p>
          <p className="text-sm text-slate-500 mb-6">Check your connection and try again.</p>
          <button
            onClick={() => { setBizLoaded(false); setBizError(false); loadBusinesses() }}
            className="px-6 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold
                       hover:bg-teal-700 transition-colors"
          >
            Retry
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
    <div className="min-h-screen">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="bg-white border-b-2 border-teal-100 px-6 py-3
                         flex flex-wrap items-center gap-x-4 gap-y-2
                         sticky top-0 z-10 shadow-sm">

        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <img src={logo} alt="Ope logo" className="h-11 w-auto" />
          <div className="leading-tight">
            <span className="block text-xl font-bold text-teal-700 tracking-tight">Ope</span>
            <span className="block text-xs text-teal-500 font-medium">Know Tomorrow, Today.</span>
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
                    Add a business
                  </button>
                ) : (
                  <p className="px-4 py-2.5 text-xs text-slate-400">
                    Free plan: up to {FREE_BUSINESS_LIMIT} businesses
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-wrap gap-1 flex-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-teal-50 hover:text-teal-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Log out */}
        <button
          onClick={signOut}
          className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-200
                     text-slate-600 hover:border-rose-300 hover:text-rose-600
                     hover:bg-rose-50 transition-colors shrink-0"
        >
          Log out
        </button>
      </header>

      {/* ── Main content ────────────────────────────────────────────── */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-slate-700 mb-6">{TAB_TITLES[tab]}</h1>
        <OutlierBanner onResolved={refresh} />
        {tab === 'forecast'  && <ForecastDashboard refreshKey={refreshKey} />}
        {tab === 'sell'      && <TapSellPanel />}
        {tab === 'hours'     && <HourlyDashboard />}
        {tab === 'events'    && <PeriodsPanel />}
        {tab === 'products'  && <ProductsPanel />}
        {tab === 'log'       && <LogDayForm onSaved={refresh} />}
        {tab === 'backfill'  && <BackfillForm onSaved={refresh} />}
        {tab === 'history'   && <DayList refreshKey={refreshKey} />}
        {tab === 'import'    && <CsvImport onImported={afterImport} />}
        {tab === 'settings'  && <BusinessSettings />}
      </main>
    </div>
  )
}
