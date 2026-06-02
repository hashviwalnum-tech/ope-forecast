import { useEffect, useState } from 'react'
import {
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
import type { AccuracyResponse, ForecastHistoryResponse } from '../api/types'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 mb-4">{title}</h2>
      {children}
    </section>
  )
}

function Empty({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-14 h-14 mb-4 rounded-full bg-teal-50 flex items-center justify-center">
        <svg className="w-7 h-7 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0
               0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0
               002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <p className="text-sm text-center max-w-xs leading-relaxed text-slate-500">
        {message ?? "Once a predicted day has passed, you'll see here how close we were."}
      </p>
    </div>
  )
}

function StatCard({ label, value, sub, valueClass = 'text-slate-800' }: {
  label: string; value: string; sub: string; valueClass?: string
}) {
  return (
    <div className="bg-teal-50/50 rounded-xl p-4 text-center">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  )
}

export default function PredictionsPanel() {
  const [history, setHistory]   = useState<ForecastHistoryResponse | null>(null)
  const [accuracy, setAccuracy] = useState<AccuracyResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([analytics.forecastHistory(), analytics.accuracy()])
      .then(([h, a]) => { setHistory(h); setAccuracy(a) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-teal-400">
        <span className="text-sm animate-pulse">Loading predictions…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
        Couldn't load predictions — is the backend running?
        <span className="block mt-1 text-xs text-red-400">{error}</span>
      </div>
    )
  }

  const histData = history?.status === 'ok' && history.history.length > 0
    ? history.history.map(h => ({
        name: h.date.slice(5).replace('-', '/'),
        actual: h.actual,
        predicted: h.predicted,
      }))
    : null

  const tsAbs = accuracy?.tracking_signal != null ? Math.abs(accuracy.tracking_signal) : 0
  const tsColor = tsAbs > 4 ? 'text-red-700' : tsAbs > 2 ? 'text-amber-700' : 'text-slate-800'

  return (
    <div className="space-y-6">

      <Card title="How our predictions did">
        {histData ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={histData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f2f8f7" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} width={36} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="bg-white border border-teal-100 rounded-xl px-3 py-2 shadow text-xs">
                      <p className="font-semibold text-slate-600 mb-1">{label}</p>
                      {payload.map(p => (
                        <p key={p.name} style={{ color: p.color as string }}>
                          {p.name}: <strong>{p.value}</strong>
                        </p>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="actual" stroke="#3a7470" strokeWidth={2}
                dot={{ r: 3, fill: '#3a7470' }} name="Actual" />
              <Line type="monotone" dataKey="predicted" stroke="#6ba3a0" strokeWidth={2}
                strokeDasharray="5 4" dot={false} name="Predicted" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <Empty message={history?.message} />
        )}
      </Card>

      {accuracy?.status === 'ok' && (
        <Card title="How well is the app doing?">
          {accuracy.bias_warning && (
            <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              {accuracy.bias_warning}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Average error"
              value={accuracy.mape != null ? `${accuracy.mape}%` : '—'}
              sub="how far off, as a %"
            />
            <StatCard
              label="Off by"
              value={accuracy.mad != null ? String(accuracy.mad) : '—'}
              sub="customers, on average"
            />
            <div className="bg-teal-50/50 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">Drift check</p>
              <p className={`text-xl font-bold tabular-nums ${tsColor}`}>
                {accuracy.tracking_signal != null ? String(accuracy.tracking_signal) : '—'}
              </p>
              <p className="text-xs text-slate-400 mt-1">±4 or more = worth a look</p>
            </div>
            <StatCard
              label="Based on"
              value={String(accuracy.n_observations)}
              sub="days compared"
            />
          </div>
        </Card>
      )}

    </div>
  )
}
