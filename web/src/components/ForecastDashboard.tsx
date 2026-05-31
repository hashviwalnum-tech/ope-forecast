import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { analytics } from '../api/client'
import type {
  AccuracyResponse,
  ForecastHistoryResponse,
  ForecastResponse,
  OrderingResponse,
  WeekdayAvgResponse,
} from '../api/types'

// ── shared primitives ───────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 mb-4">{title}</h2>
      {children}
    </section>
  )
}

function NotEnoughData({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
      <div className="w-14 h-14 mb-4 rounded-full bg-teal-50 flex items-center justify-center">
        <svg className="w-7 h-7 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <p className="text-sm text-center max-w-xs leading-relaxed text-slate-500">
        {message ?? 'Keep adding days — your patterns will appear here after a couple of weeks of logging.'}
      </p>
    </div>
  )
}

// ── next 7 days ─────────────────────────────────────────────────────────────

function ForecastSection({ data }: { data: ForecastResponse | null }) {
  if (!data) return null
  if (data.status !== 'ok' || data.days.length === 0) {
    return <Card title="What to expect this week"><NotEnoughData message={data.message} /></Card>
  }

  const chartData = data.days.map(d => ({
    name: `${d.weekday.slice(0, 3)} ${d.date.slice(5).replace('-', '/')}`,
    fullDay: d.weekday,
    predicted: Math.round(d.predicted_customers),
    low: Math.round(d.interval_low),
    high: Math.round(d.interval_high),
  }))

  const topModel = (weights: Record<string, number>) =>
    Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

  return (
    <Card title="What to expect this week">
      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
        We mix several prediction methods and give more weight to whichever has been most accurate lately.
        Hover over a bar to see the expected range.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0fdfa" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} width={36} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: '#f0fdfa' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="bg-white border border-teal-100 rounded-xl px-3 py-2 shadow text-xs">
                  <p className="font-semibold text-slate-700 mb-1">{d.fullDay}</p>
                  <p className="text-teal-600">Expected: <strong>{d.predicted}</strong> customers</p>
                  <p className="text-slate-400">Likely range: {d.low} – {d.high}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="predicted" fill="#0d9488" radius={[6, 6, 0, 0]} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.days.map(d => {
          const top = topModel(d.model_weights)
          const label: Record<string, string> = {
            seasonal_naive: 'seasonal', wma: 'WMA', exp_smoothing: 'exp. smooth.'
          }
          return (
            <span key={d.date} className="text-xs text-slate-400">
              {d.weekday.slice(0, 3)}: <span className="text-slate-600">{label[top] ?? top}</span>
            </span>
          )
        })}
      </div>
    </Card>
  )
}

// ── average by day of week ───────────────────────────────────────────────────

function WeekdaySection({ data }: { data: WeekdayAvgResponse | null }) {
  if (!data) return null
  if (data.status !== 'ok' || data.weekdays.length === 0) {
    return <Card title="Your typical week"><NotEnoughData message={data.message} /></Card>
  }

  const chartData = data.weekdays.map(w => ({
    name: w.weekday.slice(0, 3),
    avg: w.avg_customers,
    n: w.n_observations,
  }))

  return (
    <Card title="Your typical week">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0fdfa" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} width={36} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: '#f0fdfa' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="bg-white border border-teal-100 rounded-xl px-3 py-2 shadow text-xs">
                  <p className="text-teal-600">Average: <strong>{d.avg}</strong> customers</p>
                  <p className="text-slate-400">{d.n} recorded {d.n === 1 ? 'day' : 'days'}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="avg" fill="#14b8a6" radius={[6, 6, 0, 0]} maxBarSize={56} name="Avg customers" />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── actual vs forecast history ───────────────────────────────────────────────

function HistorySection({ data }: { data: ForecastHistoryResponse | null }) {
  if (!data) return null
  if (data.status !== 'ok' || data.history.length === 0) {
    return (
      <Card title="How our predictions did">
        <NotEnoughData message={data?.message ?? 'Once a predicted day has passed, you\'ll see here how close we were.'} />
      </Card>
    )
  }

  const chartData = data.history.map(h => ({
    name: h.date.slice(5).replace('-', '/'),
    actual: h.actual,
    predicted: h.predicted,
  }))

  return (
    <Card title="How our predictions did">
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0fdfa" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} width={36} axisLine={false} tickLine={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="bg-white border border-teal-100 rounded-xl px-3 py-2 shadow text-xs">
                  <p className="font-semibold text-slate-600 mb-1">{label}</p>
                  {payload.map(p => (
                    <p key={p.name} style={{ color: p.color }}>
                      {p.name}: <strong>{p.value}</strong>
                    </p>
                  ))}
                </div>
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone" dataKey="actual" stroke="#0d9488" strokeWidth={2}
            dot={{ r: 3, fill: '#0d9488' }} name="Actual"
          />
          <Line
            type="monotone" dataKey="predicted" stroke="#f97316" strokeWidth={2}
            strokeDasharray="5 4" dot={false} name="Predicted"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── accuracy panel ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-teal-50/50 rounded-xl p-4 text-center">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-800 tabular-nums">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  )
}

function AccuracySection({ data }: { data: AccuracyResponse | null }) {
  if (!data) return null
  if (data.status !== 'ok') {
    return <Card title="How well is the app doing?"><NotEnoughData message={data.message} /></Card>
  }

  const tsAbs = data.tracking_signal != null ? Math.abs(data.tracking_signal) : 0
  const tsColor = tsAbs > 4 ? 'text-red-600' : tsAbs > 2 ? 'text-amber-600' : 'text-slate-800'

  return (
    <Card title="How well is the app doing?">
      {data.bias_warning && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          {data.bias_warning}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Average error"
          value={data.mape != null ? `${data.mape}%` : '—'}
          sub="how far off, as a %"
        />
        <StatCard
          label="Off by"
          value={data.mad != null ? String(data.mad) : '—'}
          sub="customers, on average"
        />
        <div className="bg-teal-50/50 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">Drift check</p>
          <p className={`text-xl font-bold tabular-nums ${tsColor}`}>
            {data.tracking_signal != null ? String(data.tracking_signal) : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-1">±4 or more = worth a look</p>
        </div>
        <StatCard
          label="Based on"
          value={String(data.n_observations)}
          sub="days compared"
        />
      </div>
    </Card>
  )
}

// ── ordering recommendations ─────────────────────────────────────────────────

function OrderingSection({ data }: { data: OrderingResponse | null }) {
  if (!data) return null
  if (data.status !== 'ok' || data.products.length === 0) {
    return <Card title="What to order now"><NotEnoughData message={data.message} /></Card>
  }

  return (
    <Card title="What to order now">
      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
        Tells you when to reorder based on how long your supplier takes and how much demand varies day to day.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-teal-100">
              <th className="pb-2 pr-6 font-medium">Product</th>
              <th className="pb-2 pr-6 font-medium">Avg daily</th>
              <th className="pb-2 pr-6 font-medium">Supplier lead</th>
              <th className="pb-2 pr-6 font-medium">Buffer stock</th>
              <th className="pb-2 pr-6 font-medium">Order when at</th>
              <th className="pb-2 pr-6 font-medium">In stock</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map(p => (
              <tr
                key={p.product_id}
                className={`border-b border-slate-50 ${p.order_now ? 'bg-red-50/60' : ''}`}
              >
                <td className="py-3 pr-6 font-medium text-slate-800">{p.name}</td>
                <td className="py-3 pr-6 text-slate-600 tabular-nums">
                  {p.avg_daily_demand} {p.unit}
                </td>
                <td className="py-3 pr-6 text-slate-600">{p.lead_time_days}d</td>
                <td className="py-3 pr-6 text-slate-600 tabular-nums">
                  {p.safety_stock_units} {p.unit}
                </td>
                <td className="py-3 pr-6 font-semibold text-slate-800 tabular-nums">
                  {p.reorder_point} {p.unit}
                  {p.eoq != null && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      ideal order: {p.eoq}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-6 text-slate-600 tabular-nums">
                  {p.current_stock != null ? `${p.current_stock} ${p.unit}` : '—'}
                </td>
                <td className="py-3">
                  {p.order_now ? (
                    <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                      Order now
                    </span>
                  ) : p.current_stock != null ? (
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                      You're good
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">No stock tracked</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── main component ───────────────────────────────────────────────────────────

interface Props { refreshKey?: number }

export default function ForecastDashboard({ refreshKey = 0 }: Props) {
  const [forecast, setForecast] = useState<ForecastResponse | null>(null)
  const [accuracy, setAccuracy] = useState<AccuracyResponse | null>(null)
  const [weekdayAvgs, setWeekdayAvgs] = useState<WeekdayAvgResponse | null>(null)
  const [history, setHistory] = useState<ForecastHistoryResponse | null>(null)
  const [ordering, setOrdering] = useState<OrderingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      analytics.forecast(),
      analytics.accuracy(),
      analytics.weekdayAverages(),
      analytics.forecastHistory(),
      analytics.ordering(),
    ])
      .then(([f, a, w, h, o]) => {
        setForecast(f)
        setAccuracy(a)
        setWeekdayAvgs(w)
        setHistory(h)
        setOrdering(o)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-teal-400">
        <span className="text-sm animate-pulse">Loading your forecast…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
        Couldn't load the forecast — is the backend running?
        <span className="block mt-1 text-xs text-red-400">{error}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ForecastSection data={forecast} />
      <WeekdaySection data={weekdayAvgs} />
      <HistorySection data={history} />
      <AccuracySection data={accuracy} />
      <OrderingSection data={ordering} />
    </div>
  )
}
