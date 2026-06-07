import { useEffect, useState } from 'react'
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
import type { OrderRecordRead, ProductForecastItem, ProductForecastResponse } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, unit: string) {
  return `${n % 1 === 0 ? Math.round(n) : n.toFixed(1)} ${unit}`
}

// ── per-product 7-day chart ───────────────────────────────────────────────────

function DemandChart({ item }: { item: ProductForecastItem }) {
  const { t } = useLanguage()
  const chartData = item.days.map(d => ({
    name: `${d.weekday.slice(0, 3)} ${d.date.slice(5).replace('-', '/')}`,
    fullDay: d.weekday,
    predicted: d.predicted_units,
    low: d.interval_low,
    high: d.interval_high,
  }))

  if (chartData.length === 0) {
    return (
      <p className="text-sm text-slate-400 py-6 text-center">
        {t('noOpenDaysWeek')}
      </p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f2f8f7" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={44}
          axisLine={false}
          tickLine={false}
          label={{ value: item.unit, angle: -90, position: 'insideLeft', offset: 8, style: { fontSize: 10, fill: '#94a3b8' } }}
        />
        <Tooltip
          cursor={{ fill: '#f2f8f7' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div className="bg-teal-25 dark:bg-slate-700 border border-teal-100 dark:border-slate-600 rounded-xl px-3 py-2 shadow text-xs">
                <p className="font-semibold text-slate-700 mb-1">{d.fullDay}</p>
                <p className="text-teal-600">
                  {t('expectedLabel')}: <strong>{d.predicted} {item.unit}</strong>
                </p>
                <p className="text-slate-400">{t('likelyRange')}: {d.low} – {d.high} {item.unit}</p>
              </div>
            )
          }}
        />
        <Bar dataKey="predicted" fill="#3a7470" radius={[5, 5, 0, 0]} maxBarSize={52} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── ordering advice card ──────────────────────────────────────────────────────

function OrderCard({
  item,
  dismissedWarnings,
  onDismissWarning,
  onOrderPlaced,
}: {
  item: ProductForecastItem
  dismissedWarnings: Set<number>
  onDismissWarning: (productId: number) => void
  onOrderPlaced: (order: OrderRecordRead) => void
}) {
  const { t } = useLanguage()
  const { unit } = item

  const [showOrderForm, setShowOrderForm] = useState(false)
  const [orderQty, setOrderQty]           = useState(String(Math.ceil(item.suggested_order_qty || 1)))
  const [submitting, setSubmitting]       = useState(false)
  const [recentOrder, setRecentOrder]     = useState<OrderRecordRead | null>(null)
  const [cancellingId, setCancellingId]   = useState<number | null>(null)

  const showWarning = item.projected_runout_warning && !dismissedWarnings.has(item.product_id)

  async function submitOrder() {
    const qty = parseFloat(orderQty)
    if (isNaN(qty) || qty <= 0) return
    setSubmitting(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const order = await ordersApi.create({
        product_id: item.product_id,
        ordered_date: today,
        quantity: qty,
      })
      setRecentOrder(order)
      setShowOrderForm(false)
      onOrderPlaced(order)
    } catch {
      // keep form open; user can retry
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelRecentOrder() {
    if (!recentOrder) return
    setCancellingId(recentOrder.id)
    try {
      await ordersApi.cancel(recentOrder.id)
      setRecentOrder(null)
    } catch {
      // locked or already cancelled — silently ignore
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-slate-100 overflow-hidden">
      {/* Low stock warning — fires ONLY when projected stock is about to run out */}
      {showWarning && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200">
          <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠</span>
          <p className="text-sm text-amber-800 flex-1 leading-snug">
            {t('lowStockWarning', { name: item.name })}
          </p>
          <button
            onClick={() => onDismissWarning(item.product_id)}
            className="text-xs text-amber-600 hover:underline flex-shrink-0 mt-0.5"
          >
            {t('leaveItBe')}
          </button>
        </div>
      )}

      <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{t('orderingAdvice')}</p>
        {item.order_now && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
            {t('orderNowLabel')}
          </span>
        )}
        {!item.order_now && item.current_stock != null && (
          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
            {t('youreGood')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100">
        <Stat
          label={t('expectedOverNDays', { n: String(item.lead_time_days), s: item.lead_time_days !== 1 ? 's' : '' })}
          value={fmt(item.forecast_demand_over_lead_time, unit)}
          sub={t('forecastDemandWhileWaiting')}
        />
        <Stat
          label={t('safetyBufferLabel')}
          value={fmt(item.safety_stock_units, unit)}
          sub={t('extraAbsorbSwings')}
        />
        <Stat
          label={t('reorderWhenBelow')}
          value={fmt(item.reorder_point, unit)}
          sub={item.current_stock != null
            ? t('haveNow', { qty: fmt(item.current_stock, unit) })
            : t('trackStockAlerts')}
        />
        <Stat
          label={item.eoq != null ? t('idealOrderEOQ') : t('suggestedOrder')}
          value={fmt(item.suggested_order_qty, unit)}
          sub={item.eoq != null
            ? t('minimisesOrderingHolding')
            : t('coversLeadTimeSafety')}
          highlight={item.order_now}
        />
      </div>

      {/* "I ordered this" section */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-2">
        <p className="text-xs text-slate-400 leading-relaxed">
          {t('basedOnAvgDays', { qty: fmt(item.avg_daily_demand, unit), n: String(item.n_days_data) })}{' '}
          {t('reorderPointForecastNote')}
        </p>

        {/* Recent order confirmation */}
        {recentOrder && (
          <div className="flex items-center gap-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <span>✓ {t('orderLoggedConfirm', { qty: String(recentOrder.quantity), unit, arrival: recentOrder.expected_arrival_date })}</span>
            <button
              onClick={cancelRecentOrder}
              disabled={cancellingId !== null}
              className="ml-auto text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
            >
              {cancellingId !== null ? '…' : t('cancelOrder')}
            </button>
          </div>
        )}

        {/* "I ordered this" button / inline form */}
        {!recentOrder && !showOrderForm && (
          <button
            onClick={() => { setShowOrderForm(true); setOrderQty(String(Math.ceil(item.suggested_order_qty || 1))) }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600
                       border border-teal-200 rounded-lg px-3 py-1.5 hover:bg-teal-50 transition-colors"
          >
            📦 {t('iOrderedThis')}
          </button>
        )}

        {!recentOrder && showOrderForm && (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-slate-600">{t('quantityOrdered')}</label>
            <input
              type="number" min="0.1" step="0.1"
              value={orderQty}
              onChange={e => setOrderQty(e.target.value)}
              className="w-24 border border-slate-300 rounded px-2 py-1 text-sm"
            />
            <span className="text-xs text-slate-400">{unit}</span>
            <button
              onClick={submitOrder}
              disabled={submitting}
              className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700
                         disabled:bg-teal-300 rounded-lg px-3 py-1.5 transition-colors"
            >
              {submitting ? '…' : t('confirmOrder')}
            </button>
            <button
              onClick={() => setShowOrderForm(false)}
              className="text-sm text-slate-400 hover:underline"
            >
              {t('cancelBtn')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({
  label, value, sub, highlight = false,
}: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`px-4 py-3 ${highlight ? 'bg-red-50' : ''}`}>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-base font-bold tabular-nums ${highlight ? 'text-red-700' : 'text-slate-800'}`}>
        {value}
      </p>
      <p className="text-xs text-slate-400 mt-0.5 leading-snug">{sub}</p>
    </div>
  )
}

// ── product selector chip ─────────────────────────────────────────────────────

function ProductChip({
  item,
  active,
  onClick,
}: {
  item: ProductForecastItem
  active: boolean
  onClick: () => void
}) {
  const hasData = item.status === 'ok'
  const orderNow = hasData && item.order_now

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-colors
        ${active
          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
          : 'border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700 bg-teal-25 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300'
        }`}
    >
      {orderNow && (
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-red-300' : 'bg-red-500'}`} />
      )}
      {!hasData && (
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-teal-300' : 'bg-slate-300'}`} />
      )}
      {hasData && !orderNow && (
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-emerald-300' : 'bg-emerald-400'}`} />
      )}
      {item.name}
    </button>
  )
}

// ── detail view for one product ───────────────────────────────────────────────

function ProductDetail({
  item,
  dismissedWarnings,
  onDismissWarning,
  onOrderPlaced,
}: {
  item: ProductForecastItem
  dismissedWarnings: Set<number>
  onDismissWarning: (productId: number) => void
  onOrderPlaced: (order: OrderRecordRead) => void
}) {
  const { t } = useLanguage()
  if (item.status !== 'ok') {
    return (
      <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 px-5 py-8 text-center">
        <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
          {item.message ?? t('logMoreProductSales', { name: item.name })}
        </p>
        {item.n_days_data > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            {t('daysRecordedSoFar', { n: String(item.n_days_data), s: item.n_days_data !== 1 ? 's' : '' })}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-5">
      <DemandChart item={item} />
      <OrderCard
        item={item}
        dismissedWarnings={dismissedWarnings}
        onDismissWarning={onDismissWarning}
        onOrderPlaced={onOrderPlaced}
      />
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface Props { refreshKey?: number }

export default function ProductForecastPanel({ refreshKey = 0 }: Props) {
  const { t } = useLanguage()
  const [data, setData]         = useState<ProductForecastResponse | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading]   = useState(true)
  // Tracks which product IDs have had their low-stock warning dismissed this session
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(new Set())

  function handleDismissWarning(productId: number) {
    setDismissedWarnings(prev => new Set(prev).add(productId))
  }

  function handleOrderPlaced(order: OrderRecordRead) {
    // Reset the dismissal for this product — a new order changes the stock picture
    setDismissedWarnings(prev => {
      const next = new Set(prev)
      next.delete(order.product_id)
      return next
    })
  }

  useEffect(() => {
    setLoading(true)
    analytics.productForecast()
      .then(d => {
        setData(d)
        // Auto-select first product when loading; preserve selection on refresh
        setSelectedId(prev => {
          if (prev !== null && d.products.some(p => p.product_id === prev)) return prev
          return d.products.length > 0 ? d.products[0].product_id : null
        })
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-4">{t('forecastByProduct')}</h2>
        <p className="text-sm text-slate-400 animate-pulse">{t('loadingLabel')}</p>
      </section>
    )
  }

  if (!data || data.status === 'no_products' || data.products.length === 0) {
    return (
      <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-2">{t('forecastByProduct')}</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          {t('productForecastNoProducts')}
        </p>
      </section>
    )
  }

  const active = data.products.find(p => p.product_id === selectedId) ?? null
  const orderNowCount = data.products.filter(p => p.status === 'ok' && p.order_now).length

  return (
    <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-base font-semibold text-slate-800">{t('forecastByProduct')}</h2>
        {orderNowCount > 0 && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold shrink-0">
            {t('needsOrdering', { n: String(orderNowCount), s: orderNowCount !== 1 ? 's' : '' })}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
        {t('productSelectorDesc')}
      </p>

      {/* product selector */}
      <div className="flex flex-wrap gap-2">
        {data.products.map(p => (
          <ProductChip
            key={p.product_id}
            item={p}
            active={p.product_id === selectedId}
            onClick={() => setSelectedId(p.product_id)}
          />
        ))}
      </div>

      {/* detail for selected product */}
      {active && (
        <ProductDetail
          item={active}
          dismissedWarnings={dismissedWarnings}
          onDismissWarning={handleDismissWarning}
          onOrderPlaced={handleOrderPlaced}
        />
      )}
    </section>
  )
}
