import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { products as productsApi, saleEvents } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { HourSlot, ProductRead, RecentTap, TodaySummaryResponse } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtHour(h: number) {
  if (h === 0)  return '12 am'
  if (h < 12)  return `${h} am`
  if (h === 12) return '12 pm'
  return `${h - 12} pm`
}

function today(): string {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

// ── tap button ────────────────────────────────────────────────────────────────

function TapButton({
  label,
  unit,
  count,
  loading,
  onTap,
}: {
  label: string
  unit?: string
  count: number
  loading: boolean
  onTap: () => void
}) {
  const [flash, setFlash] = useState(false)
  const prevCount = useRef(count)

  useEffect(() => {
    if (count !== prevCount.current) {
      prevCount.current = count
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 300)
      return () => clearTimeout(t)
    }
  }, [count])

  return (
    <button
      onClick={onTap}
      disabled={loading}
      className={`
        relative flex flex-col items-center justify-center gap-1
        rounded-2xl border-2 p-5 min-h-[110px] w-full
        text-left select-none transition-all active:scale-95
        ${flash
          ? 'bg-teal-100 border-teal-400 shadow-md'
          : 'bg-white dark:bg-slate-700 border-teal-100 dark:border-slate-600 hover:border-teal-300 hover:bg-teal-50/50 shadow-sm'
        }
        disabled:opacity-60
      `}
    >
      <span className="text-base font-semibold text-slate-800 dark:text-slate-100 text-center leading-tight">
        {label}
      </span>
      {unit && (
        <span className="text-xs text-slate-400">{unit}</span>
      )}
      {count > 0 && (
        <span className={`
          absolute top-2 right-2 min-w-[22px] h-[22px] rounded-full
          flex items-center justify-center text-xs font-bold px-1
          ${flash ? 'bg-teal-500 text-white' : 'bg-teal-100 text-teal-700'}
          transition-colors
        `}>
          {count}
        </span>
      )}
    </button>
  )
}

// ── recent taps list ──────────────────────────────────────────────────────────

function RecentTapsList({
  taps,
  onDelete,
}: {
  taps: RecentTap[]
  onDelete: (id: number) => void
}) {
  const { t } = useLanguage()
  if (taps.length === 0) return null

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('recentTaps')}</h3>
      <ul className="space-y-1">
        {taps.map(tap => {
          const ts = new Date(tap.timestamp)
          const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          const label = tap.product_name ?? t('customerNoProduct')
          const qty = tap.quantity !== 1 ? ` ×${tap.quantity}` : ''
          return (
            <li
              key={tap.id}
              className="flex items-center justify-between gap-3 px-3 py-2
                         rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 group"
            >
              <span className="text-xs text-slate-400 tabular-nums w-14 shrink-0">{timeStr}</span>
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">{label}{qty}</span>
              <button
                onClick={() => onDelete(tap.id)}
                aria-label={`Remove ${label} at ${timeStr}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100
                           text-slate-400 hover:text-red-500 transition-all
                           rounded-lg p-1 -mr-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── hourly chart ──────────────────────────────────────────────────────────────

function HourlyChart({ hours, salesByHourLabel }: { hours: HourSlot[]; salesByHourLabel: string }) {
  if (hours.length === 0) return null

  const data = hours.map(h => ({
    name: fmtHour(h.hour),
    taps: h.taps,
  }))

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">{salesByHourLabel}</h3>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} barSize={28}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            labelStyle={{ color: '#334155', fontWeight: 600 }}
            formatter={(v) => [typeof v === 'number' ? v : 0, 'taps']}
          />
          <Bar dataKey="taps" fill="#4e8b87" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── hourly detail table ───────────────────────────────────────────────────────

function HourlyTable({ hours }: { hours: HourSlot[] }) {
  const { t } = useLanguage()
  if (hours.length === 0) return null

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-700">
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t('hourLabel')}
            </th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t('tapsLabel')}
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t('whatWasSold')}
            </th>
          </tr>
        </thead>
        <tbody>
          {hours.map(h => (
            <tr key={h.hour} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
              <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                {fmtHour(h.hour)}
              </td>
              <td className="px-4 py-3 text-right font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                {h.taps}
              </td>
              <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                {h.product_taps
                  .filter(pt => pt.product_id !== null)
                  .map(pt => `${pt.product_name} ×${pt.units}`)
                  .join(', ') || <span className="text-slate-300 dark:text-slate-600">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface TapSellPanelProps {
  onGoToProducts?: () => void
}

export default function TapSellPanel({ onGoToProducts }: TapSellPanelProps = {}) {
  const { t } = useLanguage()
  const [productList, setProductList]   = useState<ProductRead[]>([])
  const [summary, setSummary]           = useState<TodaySummaryResponse | null>(null)
  const [tapping, setTapping]           = useState<number | 'customer' | null>(null)
  const [lastTap, setLastTap]           = useState<{ id: number; label: string } | null>(null)
  const [undoTimer, setUndoTimer]       = useState<ReturnType<typeof setTimeout> | null>(null)
  // tap-unit per product (decimal products only): maps product_id -> qty string
  const [tapQty, setTapQty]             = useState<Record<number, string>>({})

  const loadSummary = useCallback(async () => {
    try { setSummary(await saleEvents.today()) } catch { /* non-critical */ }
  }, [])

  useEffect(() => {
    productsApi.list().then(setProductList).catch(() => {})
    loadSummary()
  }, [loadSummary])

  // Count today's taps per product from the summary
  const countFor = useCallback((productId: number | null): number => {
    if (!summary) return 0
    const entry = summary.product_totals.find(pt => pt.product_id === productId)
    return entry ? entry.units : 0
  }, [summary])

  async function handleTap(productId: number | null, label: string, qty = 1) {
    setTapping(productId ?? 'customer')
    try {
      const ev = await saleEvents.tap({ product_id: productId ?? null, quantity: qty })
      await loadSummary()

      if (undoTimer) clearTimeout(undoTimer)
      setLastTap({ id: ev.id, label })
      const timer = setTimeout(() => setLastTap(null), 5000)
      setUndoTimer(timer)
    } catch { /* silent */ } finally {
      setTapping(null)
    }
  }

  async function handleUndo() {
    if (!lastTap) return
    if (undoTimer) clearTimeout(undoTimer)
    setLastTap(null)
    try {
      await saleEvents.undo(lastTap.id)
      await loadSummary()
    } catch { /* silent */ }
  }

  async function handleDeleteTap(id: number) {
    if (lastTap?.id === id) {
      if (undoTimer) clearTimeout(undoTimer)
      setLastTap(null)
    }
    try {
      await saleEvents.undo(id)
      await loadSummary()
    } catch { /* silent */ }
  }

  const dateStr = today()

  return (
    <div className="space-y-6">

      {/* ── header strip ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 px-6 py-4 shadow-sm
                      flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Today — {dateStr}</p>
          <p className="text-2xl font-bold text-teal-700 dark:text-teal-400 tabular-nums">
            {summary?.total_taps ?? 0}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400 ml-2">{t('tapsRecorded')}</span>
          </p>
        </div>

        {/* Undo chip */}
        {lastTap && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200
                       text-amber-700 text-sm font-medium rounded-xl hover:bg-amber-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            {t('undoLabel')} "{lastTap.label}"
          </button>
        )}
      </div>

      {/* ── tap grid ── */}
      <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
          {t('tapTitle')}
        </h2>
        {/* Short plain explanation next to tap screen */}
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
          {t('tapExplanation')}
        </p>

        {productList.length === 0 ? (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 p-8 text-center">
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto mb-4">
              {t('noProductsAddFirst')}
            </p>
            {onGoToProducts && (
              <button
                onClick={onGoToProducts}
                className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
              >
                {t('onboardingGoToProducts')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {productList.map(p => {
              const isDecimal = p.unit_mode === 'decimal'
              const rawQty = tapQty[p.id]
              const parsedQty = rawQty !== undefined ? parseFloat(rawQty) : 1
              const effectiveQty = isDecimal && !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : 1

              return (
                <div key={p.id} className="flex flex-col gap-1.5">
                  <TapButton
                    label={p.name}
                    unit={p.unit}
                    count={countFor(p.id)}
                    loading={tapping === p.id}
                    onTap={() => handleTap(p.id, p.name, effectiveQty)}
                  />
                  {isDecimal && (
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{t('tapUnit')}</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.1"
                        value={tapQty[p.id] ?? '1'}
                        onChange={e => setTapQty(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-16 text-xs px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg
                                   bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200
                                   focus:outline-none focus:ring-1 focus:ring-teal-400 tabular-nums"
                      />
                      <span className="text-xs text-slate-400 dark:text-slate-500">{p.unit}</span>
                    </div>
                  )}
                </div>
              )
            })}
            {/* Customer-only tap (no specific product) */}
            <TapButton
              label={t('customerNoProduct')}
              count={countFor(null)}
              loading={tapping === 'customer'}
              onTap={() => handleTap(null, t('customerNoProduct'))}
            />
          </div>
        )}
      </section>

      {/* ── recent taps list ── */}
      {summary && summary.recent_taps && summary.recent_taps.length > 0 && (
        <RecentTapsList
          taps={summary.recent_taps}
          onDelete={handleDeleteTap}
        />
      )}

      {/* ── end-of-day view ── */}
      {summary && summary.hours.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {t('howTodayLooks')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('eachBarHour')}
            </p>
          </div>
          <HourlyChart hours={summary.hours} salesByHourLabel={t('salesByHour')} />
          <HourlyTable hours={summary.hours} />
        </section>
      )}

      {summary && summary.hours.length === 0 && productList.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
          <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
            {t('noTapsYet')}
          </p>
        </div>
      )}
    </div>
  )
}
