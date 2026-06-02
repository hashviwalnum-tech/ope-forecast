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
import type { ForecastResponse, ProductForecastItem, ProductForecastResponse } from '../api/types'

function fmt(n: number, unit: string) {
  return `${n % 1 === 0 ? Math.round(n) : n.toFixed(1)} ${unit}`
}

// ── ordering advice shown when a product chip is selected ─────────────────────

function OrderCard({ item }: { item: ProductForecastItem }) {
  const { unit } = item
  const qty = item.suggested_order_qty

  return (
    <div className="mt-4 rounded-xl border border-teal-100 overflow-hidden">
      <div className="bg-teal-50/60 px-4 py-2.5 border-b border-teal-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Ordering advice</p>
        <div className="flex items-center gap-2">
          {item.order_now ? (
            <span className="px-2.5 py-1 bg-teal-600 text-white rounded-full text-xs font-bold">
              Order ~{Math.round(qty)} {unit}
            </span>
          ) : item.current_stock != null ? (
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
              You're good
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 bg-white">
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500 mb-0.5">Reorder when below</p>
          <p className="text-base font-bold tabular-nums text-slate-800">{fmt(item.reorder_point, unit)}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {item.current_stock != null
              ? `have ${fmt(item.current_stock, unit)} now`
              : 'track stock to get alerts'}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500 mb-0.5">Safety buffer</p>
          <p className="text-base font-bold tabular-nums text-slate-800">{fmt(item.safety_stock_units, unit)}</p>
          <p className="text-xs text-slate-400 mt-0.5">extra to absorb swings</p>
        </div>
        <div className={`px-4 py-3 ${item.order_now ? 'bg-teal-50/40' : ''}`}>
          <p className="text-xs text-slate-500 mb-0.5">
            {item.eoq != null ? 'Ideal order (EOQ)' : 'Suggested order'}
          </p>
          <p className={`text-base font-bold tabular-nums ${item.order_now ? 'text-teal-700' : 'text-slate-800'}`}>
            {fmt(qty, unit)}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {item.eoq != null ? 'minimises ordering + holding costs' : 'covers lead time + safety buffer'}
          </p>
        </div>
      </div>
      <div className="px-4 py-2 bg-teal-50/40 border-t border-teal-100">
        <p className="text-xs text-slate-400">
          Avg <strong className="text-slate-600">{fmt(item.avg_daily_demand, unit)}/day</strong> from{' '}
          <strong className="text-slate-600">{item.n_days_data}</strong> recorded days · lead time {item.lead_time_days}d
        </p>
      </div>
    </div>
  )
}

// ── series chip ───────────────────────────────────────────────────────────────

function Chip({
  label, active, dotColor, onClick,
}: {
  label: string
  active: boolean
  dotColor?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors
        ${active
          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
          : 'border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700 bg-white'
        }`}
    >
      {dotColor && (
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      )}
      {label}
    </button>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface Props { refreshKey?: number }

export default function MergedForecastPanel({ refreshKey = 0 }: Props) {
  const [forecast, setForecast]   = useState<ForecastResponse | null>(null)
  const [products, setProducts]   = useState<ProductForecastResponse | null>(null)
  const [selected, setSelected]   = useState<'customers' | number>('customers')
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([analytics.forecast(), analytics.productForecast()])
      .then(([f, p]) => { setForecast(f); setProducts(p) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-3">Demand forecast</h2>
        <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
      </section>
    )
  }

  const productItems = products?.products ?? []
  const activeProduct = typeof selected === 'number'
    ? productItems.find(p => p.product_id === selected) ?? null
    : null
  const orderNowCount = productItems.filter(p => p.status === 'ok' && p.order_now).length

  // Build chart data for whichever series is selected
  let chartData: { name: string; fullDay: string; predicted: number; low: number; high: number }[] = []
  let yLabel = ''

  if (selected === 'customers' && forecast?.status === 'ok') {
    chartData = forecast.days.map(d => ({
      name: `${d.weekday.slice(0, 3)} ${d.date.slice(5).replace('-', '/')}`,
      fullDay: d.weekday,
      predicted: Math.round(d.predicted_customers),
      low: Math.round(d.interval_low),
      high: Math.round(d.interval_high),
    }))
    yLabel = 'customers'
  } else if (activeProduct?.status === 'ok') {
    chartData = activeProduct.days.map(d => ({
      name: `${d.weekday.slice(0, 3)} ${d.date.slice(5).replace('-', '/')}`,
      fullDay: d.weekday,
      predicted: Math.round(d.predicted_units),
      low: Math.round(d.interval_low),
      high: Math.round(d.interval_high),
    }))
    yLabel = activeProduct.unit
  }

  const noData = chartData.length === 0
  const noDataMsg = selected === 'customers'
    ? (forecast?.message ?? 'Keep logging days to see your forecast.')
    : (activeProduct?.message ?? `Log more ${activeProduct?.name ?? 'product'} sales to see a forecast.`)

  return (
    <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <h2 className="text-base font-semibold text-slate-800">Demand forecast</h2>
        {orderNowCount > 0 && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold shrink-0">
            {orderNowCount} need{orderNowCount === 1 ? 's' : ''} ordering
          </span>
        )}
      </div>

      {/* Series chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Chip
          label="Customers"
          active={selected === 'customers'}
          onClick={() => setSelected('customers')}
        />
        {productItems.map(p => {
          const isActive = selected === p.product_id
          const orderNow = p.status === 'ok' && p.order_now
          const hasData = p.status === 'ok'
          const dotColor = orderNow
            ? (isActive ? 'bg-red-300' : 'bg-red-500')
            : hasData
              ? (isActive ? 'bg-emerald-300' : 'bg-emerald-400')
              : (isActive ? 'bg-teal-300' : 'bg-slate-300')
          return (
            <Chip
              key={p.product_id}
              label={p.name}
              active={isActive}
              dotColor={dotColor}
              onClick={() => setSelected(p.product_id)}
            />
          )
        })}
      </div>

      {/* Chart */}
      {noData ? (
        <div className="flex flex-col items-center justify-center py-10">
          <p className="text-sm text-center max-w-xs leading-relaxed text-slate-500">{noDataMsg}</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f2f8f7" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              width={yLabel.length > 4 ? 48 : 36}
              axisLine={false}
              tickLine={false}
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
                      Expected: <strong>{d.predicted}</strong> {yLabel}
                    </p>
                    <p className="text-slate-400">Likely range: {d.low} – {d.high}</p>
                  </div>
                )
              }}
            />
            <Bar dataKey="predicted" fill="#3a7470" radius={[6, 6, 0, 0]} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Ordering advice (product selected and has data) */}
      {activeProduct?.status === 'ok' && <OrderCard item={activeProduct} />}

      {/* Product selected but no data yet */}
      {activeProduct && activeProduct.status !== 'ok' && (
        <div className="mt-3 rounded-xl bg-teal-50/40 border border-teal-100 px-4 py-4 text-center">
          <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
            {activeProduct.message ?? `Log more ${activeProduct.name} sales to see a forecast.`}
          </p>
          {activeProduct.n_days_data > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              {activeProduct.n_days_data} day{activeProduct.n_days_data !== 1 ? 's' : ''} recorded so far
            </p>
          )}
        </div>
      )}
    </section>
  )
}
