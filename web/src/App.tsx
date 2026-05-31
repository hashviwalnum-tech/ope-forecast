import { useState, useEffect } from 'react'
import './App.css'
import logo from './assets/logo.png'
import BackfillForm from './components/BackfillForm'
import BusinessSetup from './components/BusinessSetup'
import BusinessSettings from './components/BusinessSettings'
import CsvImport from './components/CsvImport'
import DayList from './components/DayList'
import ForecastDashboard from './components/ForecastDashboard'
import LogDayForm from './components/LogDayForm'
import OutlierBanner from './components/OutlierBanner'
import PeriodsPanel from './components/PeriodsPanel'
import ProductsPanel from './components/ProductsPanel'
import TapSellPanel from './components/TapSellPanel'
import { useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import * as api from './api/client'

type Tab = 'log' | 'backfill' | 'history' | 'import' | 'forecast' | 'events' | 'products' | 'sell' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'forecast',  label: 'This Week'       },
  { id: 'sell',      label: 'Record a Sale'   },
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
  const [hasBusiness, setHasBusiness] = useState<boolean | null>(null)
  const [tab, setTab]               = useState<Tab>('forecast')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!session) {
      setHasBusiness(null)
      return
    }
    api.businesses.me()
      .then(() => setHasBusiness(true))
      .catch(() => setHasBusiness(false))
  }, [session])

  function refresh() { setRefreshKey(k => k + 1) }

  function afterImport() {
    refresh()
    setTab('history')
  }

  if (authLoading || (session && hasBusiness === null)) {
    return (
      <div className="min-h-screen bg-teal-50 flex items-center justify-center">
        <p className="text-teal-600 text-sm">Loading…</p>
      </div>
    )
  }

  if (!session) return <LoginPage />
  if (!hasBusiness) return <BusinessSetup onCreated={() => setHasBusiness(true)} />

  return (
    <div className="min-h-screen">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="bg-white border-b-2 border-teal-100 px-6 py-3
                         flex flex-wrap items-center gap-x-8 gap-y-2
                         sticky top-0 z-10 shadow-sm">

        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <img src={logo} alt="Ope logo" className="h-11 w-auto" />
          <div className="leading-tight">
            <span className="block text-xl font-bold text-teal-700 tracking-tight">Ope</span>
            <span className="block text-xs text-teal-500 font-medium">Know Tomorrow, Today.</span>
          </div>
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
          className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
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
