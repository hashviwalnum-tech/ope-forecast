import { useEffect, useRef, useState } from 'react'
import { OrderingPanel } from './ForecastDashboard'
import HourlyDashboard from './HourlyDashboard'
import LogDayForm from './LogDayForm'
import MergedForecastPanel from './MergedForecastPanel'
import PredictionsPanel from './PredictionsPanel'
import TapSellPanel from './TapSellPanel'
import TrendsView from './TrendsView'
import { businesses as businessesApi, dayRecords as dayRecordsApi, regulars as regularsApi, saleEvents } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { RegularRead } from '../api/types'
import type { TranslationKey } from '../i18n'
import { ALL_CARD_DEFS, type CardId, type CardDef } from '../lib/homeLayout'

// ── Card catalogue ────────────────────────────────────────────────────────────

export type { CardId }

type CardConfig = CardDef

const STORAGE_KEY = 'ope_home_layout_v3'

function loadLayout(): CardConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return ALL_CARD_DEFS
    const saved: CardConfig[] = JSON.parse(raw)
    const ids = new Set(saved.map(c => c.id))
    const merged = [...saved]
    for (const def of ALL_CARD_DEFS) {
      if (!ids.has(def.id)) merged.push(def)
    }
    // Remove 'week' if it was in an old saved layout
    return merged.filter(c => c.id !== ('week' as string))
  } catch {
    return ALL_CARD_DEFS
  }
}

export function saveLayout(cards: CardConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards))
}


// ── Record-a-regular inline panel ─────────────────────────────────────────────

function RecordRegularPanel({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage()
  const [rows, setRows]             = useState<RegularRead[]>([])
  const [loading, setLoading]       = useState(true)
  const [recording, setRecording]   = useState<number | null>(null)
  const [msg, setMsg]               = useState<string | null>(null)
  const [errMsg, setErrMsg]         = useState<string | null>(null)
  const [amounts, setAmounts]       = useState<Record<number, string>>({})

  useEffect(() => {
    regularsApi.list()
      .then(data => {
        setRows(data)
        const defaults: Record<number, string> = {}
        for (const r of data) defaults[r.id] = String(r.today_amount ?? r.avg_spend)
        setAmounts(defaults)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function record(id: number, name: string) {
    setRecording(id)
    setErrMsg(null)
    try {
      const amountStr = amounts[id]
      const amount_paid = amountStr ? parseFloat(amountStr) : undefined
      await regularsApi.recordVisit(id, amount_paid != null && !isNaN(amount_paid) ? { amount_paid } : undefined)
      setMsg(t('visitRecordedFor', { name }))
      setTimeout(() => { setMsg(null); onDone() }, 1800)
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : 'Could not record visit')
    } finally {
      setRecording(null) }
  }

  if (loading) return <p className="text-sm text-slate-400 p-2">{t('savingLabel')}</p>

  if (rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
        <p>{t('noRegularsYet')}</p>
        <p className="text-xs mt-1 text-slate-400">
          {t('goToRegulars')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {msg && <p className="text-sm text-teal-700 dark:text-teal-300 font-medium">{msg}</p>}
      {errMsg && <p className="text-sm text-rose-600 dark:text-rose-400">{errMsg}</p>}
      {!msg && rows.map(r => (
        <div key={r.id} className="py-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 flex-1 min-w-0">{r.name}</span>
            {r.today_amount != null && (
              <span className="text-xs text-teal-600 dark:text-teal-400 font-medium shrink-0">
                {t('todayLoggedLabel', { amount: String(r.today_amount.toFixed(2)) })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
              {r.today_amount != null ? t('updateTodaysTotalLabel') : t('recordVisitAmountLabel')}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-400 dark:text-slate-500">$</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={amounts[r.id] ?? r.avg_spend}
                onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value }))}
                className="w-20 text-sm px-2 py-1.5 border border-slate-200 dark:border-slate-600
                           rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200
                           focus:outline-none focus:ring-2 focus:ring-teal-300 tabular-nums"
              />
            </div>
            <button
              onClick={() => record(r.id, r.name)}
              disabled={recording === r.id}
              className={`px-3 py-1.5 text-white text-xs font-semibold rounded-lg
                         hover:bg-teal-700 disabled:opacity-50 transition-colors
                         ${r.today_amount != null ? 'bg-teal-500' : 'bg-teal-600'}`}
            >
              {recording === r.id ? '…' : r.today_amount != null ? t('updateVisitBtn') : t('recordVisit')}
            </button>
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">
        {t('amountDefaultsSpend')}
      </p>
    </div>
  )
}

// ── HomeScreen ─────────────────────────────────────────────────────────────────

interface Props {
  refreshKey: number
  onSaved: () => void
}

function localToday(): string {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

export default function HomeScreen({ refreshKey, onSaved }: Props) {
  const { t } = useLanguage()
  const [showSell, setShowSell]       = useState(false)
  const [showLog, setShowLog]         = useState(false)
  const [showRegular, setShowRegular] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [layout, setLayout]           = useState<CardConfig[]>(loadLayout)
  const [tapRollover, setTapRollover] = useState(false)

  // Drag state for reorder
  const dragIdx = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  useEffect(() => {
    async function checkRollover() {
      try {
        const bizData = await businessesApi.me()
        const settings = bizData.settings || {}
        const closingHour = typeof settings.closing_hour === 'number' ? settings.closing_hour : null
        if (closingHour === null) return
        if (new Date().getHours() < closingHour) return
        const [summary, records] = await Promise.all([
          saleEvents.today(),
          dayRecordsApi.list(),
        ])
        const todayStr = localToday()
        const alreadyLogged = records.some((r: { date: string }) => r.date === todayStr)
        setTapRollover(summary.total_taps > 0 && !alreadyLogged)
      } catch {
        // non-critical; ignore
      }
    }
    checkRollover()
  }, [refreshKey])

  function handleSaved() {
    setShowLog(false)
    setTapRollover(false)
    onSaved()
  }

  function toggleCard(id: CardId) {
    setLayout(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c))
  }

  function handleDragStart(idx: number) {
    dragIdx.current = idx
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    setDragOver(idx)
  }

  function handleDrop(idx: number) {
    const from = dragIdx.current
    if (from === null || from === idx) { setDragOver(null); return }
    setLayout(prev => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(idx, 0, item)
      return arr
    })
    dragIdx.current = null
    setDragOver(null)
  }

  function doneCustomizing() {
    saveLayout(layout)
    setCustomizing(false)
  }

  function resetLayout() {
    setLayout(ALL_CARD_DEFS)
  }

  const visibleCards = layout.filter(c => c.visible)

  function renderCard(card: CardConfig) {
    switch (card.id) {
      case 'ordering':
        return <OrderingPanel key="ordering" refreshKey={refreshKey} />
      case 'forecast':
        return <MergedForecastPanel key="forecast" refreshKey={refreshKey} />
      case 'hours':
        return (
          <section key="hours">
            <h2 className="text-base font-semibold text-teal-700/70 dark:text-teal-400/70 uppercase tracking-wide mb-4">
              {t('cardHours')}
            </h2>
            <HourlyDashboard />
          </section>
        )
      case 'accuracy':
        return (
          <section key="accuracy">
            <h2 className="text-base font-semibold text-teal-700/70 dark:text-teal-400/70 uppercase tracking-wide mb-4">
              {t('cardAccuracy')}
            </h2>
            <PredictionsPanel />
          </section>
        )
      case 'trends':
        return (
          <section key="trends">
            <h2 className="text-base font-semibold text-teal-700/70 dark:text-teal-400/70 uppercase tracking-wide mb-4">
              {t('cardTrends')}
            </h2>
            <TrendsView />
          </section>
        )
    }
  }

  return (
    <div className="space-y-8">

      {/* Tap-only rollover banner */}
      {tapRollover && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-amber-200 dark:border-amber-800
                        bg-amber-50 dark:bg-amber-900/20 px-5 py-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t('tapRolloverTitle')}</p>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                {t('tapRolloverMsg')}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setShowLog(true); setShowSell(false); setShowRegular(false) }}
            className="shrink-0 px-4 py-2 bg-amber-500 text-white text-sm font-semibold
                       rounded-xl hover:bg-amber-600 transition-colors"
          >
            {t('logToday')}
          </button>
        </div>
      )}

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
            {t('recordASale')}
            <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${showSell ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            onClick={() => { setShowLog(l => !l); setShowSell(false); setShowRegular(false) }}
            className={`flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold
                        transition-colors border ${
              showLog
                ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-teal-200 hover:bg-teal-50 dark:hover:bg-teal-900/20'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0
                   00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            {t('logToday')}
            <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${showLog ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            onClick={() => { setShowRegular(r => !r); setShowSell(false); setShowLog(false) }}
            className={`flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold
                        transition-colors border ${
              showRegular
                ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-teal-200 hover:bg-teal-50 dark:hover:bg-teal-900/20'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {t('recordARegular')}
            <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${showRegular ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {showSell && (
          <div className="mt-4 rounded-2xl border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <TapSellPanel />
          </div>
        )}
        {showLog && (
          <div className="mt-4 rounded-2xl border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <LogDayForm onSaved={handleSaved} />
          </div>
        )}
        {showRegular && (
          <div className="mt-4 rounded-2xl border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">{t('recordRegularTitle')}</h3>
            <RecordRegularPanel onDone={() => setShowRegular(false)} />
          </div>
        )}
      </section>

      {/* ② Analytics cards (customizable) */}
      {customizing ? (
        <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-slate-800 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-teal-700 dark:text-teal-300">{t('customizeTitle')}</h3>
            <div className="flex gap-2">
              <button
                onClick={resetLayout}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400
                           hover:bg-white dark:hover:bg-slate-700 transition-colors"
              >
                {t('resetDefault')}
              </button>
              <button
                onClick={doneCustomizing}
                className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold
                           hover:bg-teal-700 transition-colors"
              >
                {t('done')}
              </button>
            </div>
          </div>
          <p className="text-xs text-teal-600 dark:text-teal-400">
            {t('toggleAndDrag')}
          </p>

          <div className="space-y-2">
            {layout.map((card, idx) => (
              <div
                key={card.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={e => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => setDragOver(null)}
                className={`flex items-center gap-3 bg-white dark:bg-slate-700 rounded-xl px-4 py-3 border shadow-sm
                            cursor-grab active:cursor-grabbing transition-colors select-none
                            ${dragOver === idx
                              ? 'border-teal-400 dark:border-teal-500 bg-teal-50 dark:bg-teal-900/30'
                              : 'border-slate-100 dark:border-slate-600'}`}
              >
                {/* Drag handle */}
                <svg className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 8h16M4 16h16" />
                </svg>

                <span className={`flex-1 text-sm font-medium ${card.visible ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500 line-through'}`}>
                  {t(card.labelKey as TranslationKey)}
                </span>

                <button
                  onClick={() => toggleCard(card.id)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    card.visible ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700
                         text-xs text-slate-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400
                         hover:border-teal-200 dark:hover:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
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
              {t('customizeHome')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
