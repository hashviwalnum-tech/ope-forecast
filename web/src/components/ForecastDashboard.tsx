import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { analytics, orders as ordersApi } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import type {
  ForecastResponse,
  OrderingResponse,
  OrderRecordRead,
  OrderingRow,
} from '../api/types'

// ── shared primitives ─────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-4">{title}</h2>
      {children}
    </section>
  )
}

function NotEnoughData({ message }: { message?: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
      <div className="w-14 h-14 mb-4 rounded-full bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center">
        <svg className="w-7 h-7 text-teal-300 dark:text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0
               002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0
               002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <p className="text-sm text-center max-w-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {message ?? t('keepLogging')}
      </p>
    </div>
  )
}

// ── weekday short-name via i18n ───────────────────────────────────────────────

const WDAY_KEY: Record<string, 'dayMon' | 'dayTue' | 'dayWed' | 'dayThu' | 'dayFri' | 'daySat' | 'daySun'> = {
  Monday: 'dayMon', Tuesday: 'dayTue', Wednesday: 'dayWed',
  Thursday: 'dayThu', Friday: 'dayFri', Saturday: 'daySat', Sunday: 'daySun',
}

function wdayShort(weekday: string, t: ReturnType<typeof useLanguage>['t']): string {
  const key = WDAY_KEY[weekday]
  return key ? t(key) : weekday.slice(0, 3)
}

// ── week prediction (7-day customer bars) ─────────────────────────────────────

function ForecastChart({ data }: { data: ForecastResponse }) {
  const { t } = useLanguage()
  const { isDark } = useTheme()
  if (data.status !== 'ok' || data.days.length === 0) {
    return <NotEnoughData message={data.message} />
  }

  const chartData = data.days.map(d => ({
    name: `${wdayShort(d.weekday, t)} ${d.date.slice(5).replace('-', '/')}`,
    fullDay: t(`weekdayFull_${d.weekday}` as Parameters<typeof t>[0]) ?? d.weekday,
    predicted: Math.round(d.predicted_customers),
    low: Math.round(d.interval_low),
    high: Math.round(d.interval_high),
  }))

  const topModel = (weights: Record<string, number>) =>
    Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

  const tickFill = isDark ? '#94a3b8' : '#64748b'
  const gridStroke = isDark ? '#334155' : '#e2e8f0'

  return (
    <>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 leading-relaxed">
        {t('predMixNote')}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: tickFill }} width={36} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: isDark ? '#1e293b' : '#f2f8f7' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="bg-white dark:bg-slate-800 border border-teal-100 dark:border-slate-600 rounded-xl px-3 py-2 shadow text-xs">
                  <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">{d.fullDay}</p>
                  <p className="text-teal-600 dark:text-teal-400">{t('expectedLabel')}: <strong>{d.predicted}</strong> {t('customersLabel')}</p>
                  <p className="text-slate-400 dark:text-slate-500">{t('likelyRange')}: {d.low} – {d.high}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="predicted" fill="#3a7470" radius={[6, 6, 0, 0]} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.days.map(d => {
          const top = topModel(d.model_weights)
          const modelLabel: Record<string, string> = {
            seasonal_naive: t('modelNameSeasonal'),
            wma: t('modelNameWma'),
            exp_smoothing: t('modelNameExpSmooth'),
            linear_trend: t('modelNameLinearTrend'),
            same_date_last_year: t('modelNameLastYear'),
          }
          return (
            <span key={d.date} className="text-xs text-slate-400 dark:text-slate-500">
              {wdayShort(d.weekday, t)}: <span className="text-slate-600 dark:text-slate-300">{modelLabel[top] ?? top}</span>
            </span>
          )
        })}
      </div>
    </>
  )
}

// ── per-product order actions (shown inside each ordering row) ────────────────

function ProductOrderActions({
  productId,
  unit,
  unitMode,
  suggestedQty,
  productOrders,
  today,
  onChanged,
}: {
  productId: number
  unit: string
  unitMode: string
  suggestedQty: number
  productOrders: OrderRecordRead[]
  today: string
  onChanged: () => void
}) {
  const { t } = useLanguage()

  const isWhole = unitMode === 'whole'

  // Only orders that are genuinely still coming.  effective_status accounts for
  // the "always assume orders arrive on time" setting — without it, an owner
  // with that switched on saw a year of long-since-delivered orders listed as
  // "in transit", one row each, which made this card thousands of lines long.
  const allPending = productOrders
    .filter(o => (o.effective_status ?? o.status) === 'pending')
    .sort((a, b) => b.ordered_date.localeCompare(a.ordered_date))
  const activePending = allPending[0] ?? null
  // Older deliveries still on their way, newest first.  Capped, because a long
  // list of them is noise — the owner cares about what is arriving soon.
  const MAX_IN_TRANSIT_SHOWN = 4
  const otherPending = allPending.slice(1)
  const shownPending = otherPending.slice(0, MAX_IN_TRANSIT_SHOWN)
  const hiddenPendingCount = otherPending.length - shownPending.length

  const [showForm, setShowForm]   = useState(false)
  const [qty, setQty]             = useState(
    isWhole ? String(Math.round(suggestedQty || 1)) : String(suggestedQty || 1)
  )
  const [saving, setSaving]       = useState(false)
  const [editing, setEditing]     = useState(false)
  const [editQty, setEditQty]     = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [arriving, setArriving]   = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  async function placeOrder() {
    let q = parseFloat(qty)
    if (isNaN(q) || q <= 0) { setErr('Enter a valid quantity'); return }
    if (isWhole) q = Math.round(q)
    setSaving(true); setErr(null)
    try {
      await ordersApi.create({ product_id: productId, ordered_date: today, quantity: q })
      setShowForm(false)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally { setSaving(false) }
  }

  async function saveEdit() {
    if (!activePending) return
    let q = parseFloat(editQty)
    if (isNaN(q) || q <= 0) { setErr('Enter a valid quantity'); return }
    if (isWhole) q = Math.round(q)
    setSaving(true); setErr(null)
    try {
      await ordersApi.update(activePending.id, { quantity: q })
      setEditing(false)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not update')
    } finally { setSaving(false) }
  }

  async function doMarkArrived(orderId: number) {
    setArriving(true)
    try { await ordersApi.update(orderId, { status: 'arrived' }); onChanged() }
    catch { /* already arrived or cancelled */ }
    finally { setArriving(false) }
  }

  async function doCancel(orderId: number) {
    setCancelling(true)
    try { await ordersApi.cancel(orderId); onChanged() } catch { /* locked */ }
    finally { setCancelling(false) }
  }

  return (
    <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
      {/* Additional in-transit pending orders */}
      {shownPending.map(o => (
        <div key={o.id} className="flex items-center gap-3 flex-wrap">
          <p className="text-xs text-teal-600 dark:text-teal-300 flex-1">
            📦 {t('inTransitInfo', { qty: String(o.quantity), unit, date: o.expected_arrival_date })}
          </p>
          {o.expected_arrival_date <= today && (
            <button
              onClick={() => void doMarkArrived(o.id)}
              disabled={arriving}
              className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 disabled:opacity-50"
            >
              {t('confirmArrived')}
            </button>
          )}
        </div>
      ))}
      {hiddenPendingCount > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {t('moreOnTheWay', { n: String(hiddenPendingCount) })}
        </p>
      )}

      {/* Active (most recent) pending order — info row with edit / mark arrived / cancel */}
      {activePending && !editing && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-emerald-700 dark:text-emerald-400 flex-1">
            ✓ {t('orderedTodayInfo', { qty: String(activePending.quantity), unit, date: activePending.expected_arrival_date })}
          </span>
          {activePending.expected_arrival_date <= today && (
            <button
              onClick={() => void doMarkArrived(activePending.id)}
              disabled={arriving}
              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700
                         rounded-lg px-2 py-0.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 shrink-0 disabled:opacity-50"
            >
              {arriving ? '…' : t('confirmArrived')}
            </button>
          )}
          <button
            onClick={() => { setEditing(true); setEditQty(String(activePending.quantity)); setErr(null) }}
            className="text-xs text-teal-600 dark:text-teal-400 hover:underline shrink-0"
          >{t('editBtn')}</button>
          <button
            onClick={() => doCancel(activePending.id)}
            disabled={cancelling}
            className="text-xs text-rose-500 hover:underline shrink-0 disabled:opacity-50"
          >{cancelling ? '…' : t('cancelOrder')}</button>
        </div>
      )}

      {/* Edit active pending order quantity */}
      {activePending && editing && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{t('quantityOrdered')}</label>
            <input
              type="number"
              min={isWhole ? '1' : '0.01'}
              step={isWhole ? '1' : '0.01'}
              value={editQty}
              onChange={e => setEditQty(e.target.value)}
              className="w-20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm
                         bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
            <span className="text-xs text-slate-400 shrink-0">{unit}</span>
            <button
              onClick={saveEdit} disabled={saving}
              className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-3 py-1.5"
            >{saving ? '…' : t('saveChangesBtn')}</button>
            <button
              onClick={() => { setEditing(false); setErr(null) }}
              className="text-sm text-slate-400 hover:underline"
            >{t('cancelBtn')}</button>
          </div>
          {err && <p className="text-xs text-rose-500">{err}</p>}
        </div>
      )}

      {/* "I ordered this" — only shown when no pending order exists */}
      {!activePending && !showForm && (
        <button
          onClick={() => { setShowForm(true); setQty(isWhole ? String(Math.round(suggestedQty || 1)) : String(suggestedQty || 1)) }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 dark:text-teal-400
                     border border-teal-200 dark:border-teal-700 rounded-lg px-3 py-1.5
                     hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
        >
          📦 {t('iOrderedThis')}
        </button>
      )}

      {!activePending && showForm && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{t('quantityOrdered')}</label>
            <input
              type="number"
              min={isWhole ? '1' : '0.01'}
              step={isWhole ? '1' : '0.01'}
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-20 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-sm
                         bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
            <span className="text-xs text-slate-400 shrink-0">{unit}</span>
            <button
              onClick={placeOrder} disabled={saving}
              className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
            >{saving ? '…' : t('confirmOrder')}</button>
            <button
              onClick={() => { setShowForm(false); setErr(null) }}
              className="text-sm text-slate-400 hover:underline"
            >{t('cancelBtn')}</button>
          </div>
          {err && <p className="text-xs text-rose-500">{err}</p>}
        </div>
      )}
    </div>
  )
}

// ── ordering table ─────────────────────────────────────────────────────────────

function sortByFavorite(products: OrderingRow[]): OrderingRow[] {
  return [...products].sort((a, b) => {
    const af = (a as OrderingRow & { is_favorite?: boolean }).is_favorite ? 1 : 0
    const bf = (b as OrderingRow & { is_favorite?: boolean }).is_favorite ? 1 : 0
    return bf - af
  })
}

function OrderingProductCard({
  p, ordersByProduct, today, onOrdersChanged,
}: {
  p: OrderingRow
  ordersByProduct: Map<number, OrderRecordRead[]>
  today: string
  onOrdersChanged: () => void
}) {
  const { t } = useLanguage()
  const noHistory = (p.n_days_data ?? 0) === 0
  const hasQty = p.suggested_order_qty != null && p.suggested_order_qty > 0
  const stockUntracked = p.stock_untracked ?? false
  const displayStock = p.projected_stock ?? p.current_stock
  const isFav = (p as OrderingRow & { is_favorite?: boolean }).is_favorite
  const uMode = p.unit_mode ?? 'whole'

  const fmtQty = (q: number) =>
    uMode === 'whole' ? String(Math.round(q)) : q.toFixed(2)

  if (noHistory) {
    return (
      <div className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/60 dark:bg-slate-700/40">
          <div className="min-w-0">
            {isFav && <span className="text-xs text-amber-500 mr-1">★</span>}
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p.name}</span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {displayStock != null && !stockUntracked
                ? t('inStockSuffix', { qty: `${displayStock} ${p.unit}` })
                : stockUntracked ? t('setStartingStockHint') : ''}
            </p>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{t('noStockTracked')}</span>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">{t('noSalesDataYet')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border overflow-hidden
      ${p.order_now ? 'border-red-200 dark:border-red-800' : p.approaching_reorder ? 'border-amber-200 dark:border-amber-700' : 'border-slate-100 dark:border-slate-700'}`}
    >
      <div className={`flex items-center justify-between gap-3 px-4 py-3
        ${p.order_now ? 'bg-red-50/60 dark:bg-red-900/20' : p.approaching_reorder ? 'bg-amber-50/60 dark:bg-amber-900/20' : 'bg-slate-50/60 dark:bg-slate-700/40'}`}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {isFav && <span className="text-amber-500 mr-1">★</span>}
            {p.name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            ~{p.avg_daily_demand} {p.unit}{t('perDaySuffix')} · {t('restockInNDays', { n: String(p.lead_time_days) })}
            {displayStock != null && !stockUntracked
              ? ` · ${t('inStockSuffix', { qty: `${displayStock} ${p.unit}` })}`
              : stockUntracked ? ` · ${t('setStartingStockHint')}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {p.order_now ? (
            hasQty ? (
              <span className="inline-block px-3 py-1 bg-red-500 text-white rounded-full text-xs font-bold">
                {t('orderNowBadge', { qty: `${fmtQty(p.suggested_order_qty!)} ${p.unit}` })}
              </span>
            ) : (
              <span className="inline-block px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full text-xs font-semibold">
                {t('orderNowLabel')}
              </span>
            )
          ) : p.approaching_reorder ? (
            <span className="inline-block px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full text-xs font-semibold">
              ⚠ {t('reorderWhenBelow')}
            </span>
          ) : displayStock != null && !stockUntracked ? (
            <span className="inline-block px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-semibold">
              {t('youreGood')}
            </span>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">{t('noStockTracked')}</span>
          )}
        </div>
      </div>
      <div className="px-4 py-2 bg-teal-25 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex flex-wrap gap-x-4 gap-y-0.5">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {t('reorderBelowColon')} <strong className="text-slate-600 dark:text-slate-300">{fmtQty(p.reorder_point)} {p.unit}</strong>
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {t('safetyBufferColon')} <strong className="text-slate-600 dark:text-slate-300">{fmtQty(p.safety_stock_units)} {p.unit}</strong>
        </span>
        {p.eoq != null && (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {t('eoqLabelColon')} <strong className="text-slate-600 dark:text-slate-300">{fmtQty(p.eoq)} {p.unit}</strong>
          </span>
        )}
      </div>
      <ProductOrderActions
        productId={p.product_id}
        unit={p.unit}
        unitMode={uMode}
        suggestedQty={p.suggested_order_qty ?? 1}
        productOrders={ordersByProduct.get(p.product_id) ?? []}
        today={today}
        onChanged={onOrdersChanged}
      />
    </div>
  )
}

function OrderingTable({
  data,
  ordersByProduct,
  today,
  onOrdersChanged,
}: {
  data: OrderingResponse
  ordersByProduct: Map<number, OrderRecordRead[]>
  today: string
  onOrdersChanged: () => void
}) {
  const { t } = useLanguage()
  if (data.status !== 'ok' || data.products.length === 0) {
    return <NotEnoughData message={data.message} />
  }

  // Show only products that need attention (at or below reorder point, or approaching it)
  const needsAttention = sortByFavorite(
    data.products.filter(p => p.order_now || (p.approaching_reorder ?? false) || (p.n_days_data ?? 0) === 0 && p.stock_untracked)
  )
  const stockOkCount = data.products.filter(
    p => !p.order_now && !(p.approaching_reorder ?? false) && (p.n_days_data ?? 0) > 0
  ).length

  if (needsAttention.length === 0 && data.products.length > 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-2xl mb-2">✓</p>
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{t('nothingToOrder')}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          {t('fullyStockedNote', { n: String(data.products.length), s: data.products.length === 1 ? '' : 's' })}
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 leading-relaxed">
        {t('orderingNoteText')}
      </p>
      <div className="space-y-3">
        {needsAttention.map(p => (
          <OrderingProductCard
            key={p.product_id}
            p={p}
            ordersByProduct={ordersByProduct}
            today={today}
            onOrdersChanged={onOrdersChanged}
          />
        ))}
      </div>
      {stockOkCount > 0 && (
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500 text-center">
          {t('fullyStockedNote', { n: String(stockOkCount), s: stockOkCount === 1 ? '' : 's' })}
        </p>
      )}
    </>
  )
}

// ── self-fetching exported panels ─────────────────────────────────────────────

interface PanelProps { refreshKey?: number }

export function WeekPredictionPanel({ refreshKey = 0 }: PanelProps) {
  const { t } = useLanguage()
  const [forecast, setForecast] = useState<ForecastResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    analytics.forecast()
      .then(setForecast)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <Card title={t('weekPredictionTitle')}>
        <p className="text-sm text-slate-400 dark:text-slate-500 animate-pulse py-8 text-center">{t('loadingLabel')}</p>
      </Card>
    )
  }

  if (error) {
    return (
      <Card title={t('weekPredictionTitle')}>
        <p className="text-sm text-red-600 dark:text-red-400 py-4">{error}</p>
      </Card>
    )
  }

  return (
    <Card title={t('weekPredictionTitle')}>
      {forecast ? <ForecastChart data={forecast} /> : <NotEnoughData />}
    </Card>
  )
}

export function OrderingPanel({ refreshKey = 0 }: PanelProps) {
  const { t } = useLanguage()
  const [ordering, setOrdering] = useState<OrderingResponse | null>(null)
  const [allOrders, setAllOrders] = useState<OrderRecordRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  const ordersByProduct = useMemo(() => {
    const map = new Map<number, OrderRecordRead[]>()
    for (const o of allOrders) {
      if (o.status !== 'cancelled') {
        const existing = map.get(o.product_id) ?? []
        existing.push(o)
        map.set(o.product_id, existing)
      }
    }
    return map
  }, [allOrders])

  async function refreshOrders() {
    try {
      const [ord, list] = await Promise.all([analytics.ordering(), ordersApi.list()])
      setOrdering(ord)
      setAllOrders(list)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([analytics.ordering(), ordersApi.list()])
      .then(([ord, list]) => { setOrdering(ord); setAllOrders(list) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <Card title={t('whatToOrderTitle')}>
        <p className="text-sm text-slate-400 dark:text-slate-500 animate-pulse py-8 text-center">{t('loadingLabel')}</p>
      </Card>
    )
  }

  if (error) {
    return (
      <Card title={t('whatToOrderTitle')}>
        <p className="text-sm text-red-600 dark:text-red-400 py-4">{error}</p>
      </Card>
    )
  }

  return (
    <Card title={t('whatToOrderTitle')}>
      {ordering ? (
        <OrderingTable
          data={ordering}
          ordersByProduct={ordersByProduct}
          today={today}
          onOrdersChanged={refreshOrders}
        />
      ) : (
        <NotEnoughData />
      )}
    </Card>
  )
}
