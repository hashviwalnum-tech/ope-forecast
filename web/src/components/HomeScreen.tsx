import { useEffect, useState } from 'react'
import { OrderingPanel, WeekPredictionPanel } from './ForecastDashboard'
import HourlyDashboard from './HourlyDashboard'
import LogDayForm from './LogDayForm'
import MergedForecastPanel from './MergedForecastPanel'
import TapSellPanel from './TapSellPanel'
import { regulars as regularsApi } from '../api/client'
import type { RegularRead } from '../api/types'

// ── Card IDs and default layout ─────────────────────────────────────────────

type CardId = 'ordering' | 'forecast' | 'week' | 'hours'

interface CardConfig {
  id: CardId
  label: string
  visible: boolean
}

const DEFAULT_LAYOUT: CardConfig[] = [
  { id: 'ordering', label: 'What to order',   visible: true  },
  { id: 'forecast', label: 'Demand forecast', visible: true  },
  { id: 'week',     label: 'Week prediction', visible: false },
  { id: 'hours',    label: 'Busy hours',      visible: true  },
]

const STORAGE_KEY = 'ope_home_layout_v1'

function loadLayout(): CardConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const saved: CardConfig[] = JSON.parse(raw)
    // Merge to handle new card additions in future updates
    const ids = new Set(saved.map(c => c.id))
    const merged = [...saved]
    for (const def of DEFAULT_LAYOUT) {
      if (!ids.has(def.id)) merged.push(def)
    }
    return merged
  } catch {
    return DEFAULT_LAYOUT
  }
}

function saveLayout(cards: CardConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards))
}

// ── Record-a-regular inline panel ───────────────────────────────────────────

function RecordRegularPanel({ onDone }: { onDone: () => void }) {
  const [rows, setRows]   = useState<RegularRead[]>([])
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState<number | null>(null)
  const [msg, setMsg]     = useState<string | null>(null)

  useEffect(() => {
    regularsApi.list()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function record(id: number, name: string) {
    setRecording(id)
    try {
      await regularsApi.recordVisit(id)
      setMsg(`Visit recorded for ${name}`)
      setTimeout(() => { setMsg(null); onDone() }, 1800)
    } catch { /* ignore */ }
    finally { setRecording(null) }
  }

  if (loading) return <p className="text-sm text-slate-400 p-2">Loading regulars…</p>

  if (rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-4">
        <p>No regulars added yet.</p>
        <p className="text-xs mt-1 text-slate-400">
          Go to <strong>Manage → My Regulars</strong> to add your loyal customers.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {msg && (
        <p className="text-sm text-teal-700 font-medium">{msg}</p>
      )}
      {!msg && rows.map(r => (
        <div key={r.id} className="flex items-center justify-between gap-3 py-1">
          <div>
            <span className="text-sm font-medium text-slate-700">{r.name}</span>
            <span className="text-xs text-slate-400 ml-2">
              {r.visit_count} visit{r.visit_count !== 1 ? 's' : ''} logged
            </span>
          </div>
          <button
            onClick={() => record(r.id, r.name)}
            disabled={recording === r.id}
            className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg
                       hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {recording === r.id ? '…' : 'Record visit'}
          </button>
        </div>
      ))}
    </div>
  )
}

// ── HomeScreen ───────────────────────────────────────────────────────────────

interface Props {
  refreshKey: number
  onSaved: () => void
}

export default function HomeScreen({ refreshKey, onSaved }: Props) {
  const [showSell, setShowSell]       = useState(false)
  const [showLog, setShowLog]         = useState(false)
  const [showRegular, setShowRegular] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [layout, setLayout]           = useState<CardConfig[]>(loadLayout)

  function handleSaved() {
    setShowLog(false)
    onSaved()
  }

  function toggleCard(id: CardId) {
    setLayout(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c))
  }

  function moveCard(id: CardId, dir: -1 | 1) {
    setLayout(prev => {
      const idx = prev.findIndex(c => c.id === id)
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }

  function doneCustomizing() {
    saveLayout(layout)
    setCustomizing(false)
  }

  function resetLayout() {
    setLayout(DEFAULT_LAYOUT)
  }

  const visibleCards = layout.filter(c => c.visible)

  function renderCard(card: CardConfig) {
    switch (card.id) {
      case 'ordering':
        return <OrderingPanel key="ordering" refreshKey={refreshKey} />
      case 'forecast':
        return <MergedForecastPanel key="forecast" refreshKey={refreshKey} />
      case 'week':
        return <WeekPredictionPanel key="week" refreshKey={refreshKey} />
      case 'hours':
        return (
          <section key="hours">
            <h2 className="text-base font-semibold text-teal-700/70 uppercase tracking-wide mb-4">
              Busy hours
            </h2>
            <HourlyDashboard />
          </section>
        )
    }
  }

  return (
    <div className="space-y-8">

      {/* ① Quick actions */}
      <section>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => { setShowSell(s => !s); setShowLog(false); setShowRegular(false) }}
            className={`flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold
                        transition-colors shadow-sm ${
              showSell
                ? 'bg-teal-700 text-white'
                : 'bg-teal-600 text-white hover:bg-teal-700'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Record a Sale
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${showSell ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            onClick={() => { setShowLog(l => !l); setShowSell(false); setShowRegular(false) }}
            className={`flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold
                        transition-colors border ${
              showLog
                ? 'bg-teal-50 border-teal-300 text-teal-700'
                : 'bg-white border-slate-200 text-slate-700 hover:border-teal-200 hover:bg-teal-50'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0
                   00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Log Today
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${showLog ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            onClick={() => { setShowRegular(r => !r); setShowSell(false); setShowLog(false) }}
            className={`flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold
                        transition-colors border ${
              showRegular
                ? 'bg-teal-50 border-teal-300 text-teal-700'
                : 'bg-white border-slate-200 text-slate-700 hover:border-teal-200 hover:bg-teal-50'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Record a Regular
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${showRegular ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {showSell && (
          <div className="mt-4 rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
            <TapSellPanel />
          </div>
        )}
        {showLog && (
          <div className="mt-4 rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
            <LogDayForm onSaved={handleSaved} />
          </div>
        )}
        {showRegular && (
          <div className="mt-4 rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Record a regular's visit</h3>
            <RecordRegularPanel onDone={() => setShowRegular(false)} />
          </div>
        )}
      </section>

      {/* ② Analytics cards (customizable) */}
      {customizing ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-teal-700">Customize your home</h3>
            <div className="flex gap-2">
              <button
                onClick={resetLayout}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500
                           hover:bg-white transition-colors"
              >
                Reset to default
              </button>
              <button
                onClick={doneCustomizing}
                className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold
                           hover:bg-teal-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
          <p className="text-xs text-teal-600">
            Toggle cards on/off and drag them into the order you want.
          </p>

          <div className="space-y-2">
            {layout.map((card, idx) => (
              <div
                key={card.id}
                className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-slate-100 shadow-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveCard(card.id, -1)}
                    disabled={idx === 0}
                    className="text-slate-300 hover:text-teal-500 disabled:opacity-20 leading-none text-lg"
                    title="Move up"
                  >▲</button>
                  <button
                    onClick={() => moveCard(card.id, 1)}
                    disabled={idx === layout.length - 1}
                    className="text-slate-300 hover:text-teal-500 disabled:opacity-20 leading-none text-lg"
                    title="Move down"
                  >▼</button>
                </div>

                <span className={`flex-1 text-sm font-medium ${card.visible ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                  {card.label}
                </span>

                <button
                  onClick={() => toggleCard(card.id)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    card.visible ? 'bg-teal-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm
                                 transition-transform ${card.visible ? 'translate-x-4' : ''}`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {visibleCards.map(card => renderCard(card))}

          <div className="flex justify-end">
            <button
              onClick={() => setCustomizing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200
                         text-xs text-slate-400 hover:text-teal-600 hover:border-teal-200
                         hover:bg-teal-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94
                     3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724
                     1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426
                     1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724
                     1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31
                     2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Customize home
            </button>
          </div>
        </>
      )}
    </div>
  )
}
