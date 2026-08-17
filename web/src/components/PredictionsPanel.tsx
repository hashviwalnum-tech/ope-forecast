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
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import type { AccuracyResponse, ForecastHistoryResponse } from '../api/types'
import { addCardToHome, isCardOnHome, removeCardFromHome } from '../lib/homeLayout'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-4">{title}</h2>
      {children}
    </section>
  )
}


function StatCard({ label, value, sub, valueClass = 'text-slate-800 dark:text-slate-100' }: {
  label: string; value: string; sub: string; valueClass?: string
}) {
  return (
    <div className="bg-teal-50/50 dark:bg-teal-900/20 rounded-xl p-4 text-center">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>
    </div>
  )
}

function HomeToggleButton() {
  const { t } = useLanguage()
  const [onHome, setOnHome] = useState(() => isCardOnHome('accuracy'))
  const [flash, setFlash]   = useState(false)

  function toggle() {
    if (onHome) {
      removeCardFromHome('accuracy')
      setOnHome(false)
    } else {
      addCardToHome('accuracy')
      setOnHome(true)
      setFlash(true)
      setTimeout(() => setFlash(false), 1800)
    }
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700
                 text-xs text-slate-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400
                 hover:border-teal-200 dark:hover:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
    >
      {flash ? (
        <><svg className="w-3.5 h-3.5 shrink-0 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>{t('addedToHomeConfirm')}</>
      ) : onHome ? (
        <><svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>{t('removeFromHome')}</>
      ) : (
        <><svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>{t('addToHome')}</>
      )}
    </button>
  )
}

export default function PredictionsPanel() {
  const { t } = useLanguage()
  const { isDark } = useTheme()
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
        <span className="text-sm animate-pulse">{t('loadingPredictions')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-300">
        {t('cantLoadPredictions')}
        <span className="block mt-1 text-xs text-red-400 dark:text-red-500">{error}</span>
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
  const tsColor = tsAbs > 4
    ? 'text-red-700 dark:text-red-400'
    : tsAbs > 2
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-slate-800 dark:text-slate-100'

  const tickFill   = isDark ? '#94a3b8' : '#64748b'
  const gridStroke = isDark ? '#334155' : '#e2e8f0'

  return (
    <div className="space-y-6">

      <div className="flex justify-end">
        <HomeToggleButton />
      </div>

      <Card title={t('howPredictionsDid')}>
        {histData ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={histData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: tickFill }} width={36} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="bg-white dark:bg-slate-800 border border-teal-100 dark:border-slate-600 rounded-xl px-3 py-2 shadow text-xs">
                      <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">{label}</p>
                      {payload.map(p => (
                        <p key={p.name} style={{ color: p.color as string }}>
                          {p.name}: <strong>{p.value}</strong>
                        </p>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }} />
              <Line type="monotone" dataKey="actual" stroke="#3a7470" strokeWidth={2}
                dot={{ r: 3, fill: '#3a7470' }} name={t('chartActual')} />
              <Line type="monotone" dataKey="predicted" stroke="#6ba3a0" strokeWidth={2}
                strokeDasharray="5 4" dot={false} name={t('chartPredicted')} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500 text-center leading-relaxed py-4">
            {t('forecastHistoryBuilding')}
          </p>
        )}
      </Card>

      {accuracy?.status === 'ok' && (
        <Card title={t('howAppDoing')}>
          {!histData && (
            <div className="mb-4 px-3 py-2.5 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-xl">
              <p className="text-xs text-teal-700 dark:text-teal-300 leading-relaxed">
                {t('accuracyFromHoldout')}
              </p>
            </div>
          )}
          {accuracy.bias_warning && (
            <div className="mb-4 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-300">
              {accuracy.bias_warning}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label={t('averageError')}
              value={accuracy.mape != null ? `${accuracy.mape}%` : '—'}
              sub={t('howFarOff')}
            />
            <StatCard
              label={t('offByLabel')}
              value={accuracy.mad != null ? String(accuracy.mad) : '—'}
              sub={t('customersOnAverage')}
            />
            <div className="bg-teal-50/50 dark:bg-teal-900/20 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('driftCheck')}</p>
              <p className={`text-xl font-bold tabular-nums ${tsColor}`}>
                {accuracy.tracking_signal != null ? String(accuracy.tracking_signal) : '—'}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('driftNote')}</p>
            </div>
            <StatCard
              label={t('basedOnLabel')}
              value={String(accuracy.n_observations)}
              sub={t('daysCompared')}
            />
          </div>
        </Card>
      )}

    </div>
  )
}
