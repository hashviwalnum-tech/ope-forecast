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
import { analytics } from '../api/client'
import type { ProductForecastItem, ProductForecastResponse } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, unit: string) {
  return `${n % 1 === 0 ? Math.round(n) : n.toFixed(1)} ${unit}`
}

// ── per-product 7-day chart ───────────────────────────────────────────────────

function DemandChart({ item }: { item: ProductForecastItem }) {
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
        No open days in the next 7 days match your schedule.
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
              <div className="bg-white border border-teal-100 rounded-xl px-3 py-2 shadow text-xs">
                <p className="font-semibold text-slate-700 mb-1">{d.fullDay}</p>
                <p className="text-teal-600">
                  Expected: <strong>{d.predicted} {item.unit}</strong>
                </p>
                <p className="text-slate-400">Likely range: {d.low} – {d.high} {item.unit}</p>
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

function OrderCard({ item }: { item: ProductForecastItem }) {
  const { unit } = item

  return (
    <div className="mt-5 rounded-xl border border-slate-100 overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Ordering advice</p>
        {item.order_now && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
            Order now
          </span>
        )}
        {!item.order_now && item.current_stock != null && (
          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
            You're good
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100">
        <Stat
          label={`Expected over ${item.lead_time_days} day${item.lead_time_days !== 1 ? 's' : ''}`}
          value={fmt(item.forecast_demand_over_lead_time, unit)}
          sub="forecast demand while waiting for stock"
        />
        <Stat
          label="Safety buffer"
          value={fmt(item.safety_stock_units, unit)}
          sub="extra stock to absorb demand swings"
        />
        <Stat
          label="Reorder when below"
          value={fmt(item.reorder_point, unit)}
          sub={item.current_stock != null
            ? `you have ${fmt(item.current_stock, unit)} now`
            : 'track stock to see order-now alerts'}
        />
        <Stat
          label={item.eoq != null ? 'Ideal order size (EOQ)' : 'Suggested order size'}
          value={fmt(item.suggested_order_qty, unit)}
          sub={item.eoq != null
            ? 'minimises ordering + holding costs'
            : 'covers lead time + safety buffer'}
          highlight={item.order_now}
        />
      </div>

      <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
        <p className="text-xs text-slate-400 leading-relaxed">
          Based on your average of <strong className="text-slate-600">{fmt(item.avg_daily_demand, unit)}/day</strong>
          {' '}from <strong className="text-slate-600">{item.n_days_data}</strong> logged days.
          Reorder point uses the forecasted demand, not just the average.
        </p>
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
          : 'border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700 bg-white'
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

function ProductDetail({ item }: { item: ProductForecastItem }) {
  if (item.status !== 'ok') {
    return (
      <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 px-5 py-8 text-center">
        <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
          {item.message ?? `Log more ${item.name} sales to see a forecast.`}
        </p>
        {item.n_days_data > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            {item.n_days_data} day{item.n_days_data !== 1 ? 's' : ''} recorded so far
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-5">
      <DemandChart item={item} />
      <OrderCard item={item} />
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface Props { refreshKey?: number }

export default function ProductForecastPanel({ refreshKey = 0 }: Props) {
  const [data, setData]         = useState<ProductForecastResponse | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading]   = useState(true)

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
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Forecast by product</h2>
        <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
      </section>
    )
  }

  if (!data || data.status === 'no_products' || data.products.length === 0) {
    return (
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-2">Forecast by product</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          Add products in <strong>My Products</strong>, then log sales for each one —
          you'll see per-product demand forecasts and ordering advice here.
        </p>
      </section>
    )
  }

  const active = data.products.find(p => p.product_id === selectedId) ?? null
  const orderNowCount = data.products.filter(p => p.status === 'ok' && p.order_now).length

  return (
    <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-base font-semibold text-slate-800">Forecast by product</h2>
        {orderNowCount > 0 && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold shrink-0">
            {orderNowCount} need{orderNowCount === 1 ? 's' : ''} ordering
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
        Select a product to see how much you'll need this week and when to reorder.
        Red dot = order now. Green = stock is fine. Grey = not enough data yet.
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
      {active && <ProductDetail item={active} />}
    </section>
  )
}
