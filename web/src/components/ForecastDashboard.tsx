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
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import type {
  ForecastResponse,
  OrderingResponse,
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

// ── ordering table ─────────────────────────────────────────────────────────────

function OrderingTable({ data }: { data: OrderingResponse }) {
  const { t } = useLanguage()
  if (data.status !== 'ok' || data.products.length === 0) {
    return <NotEnoughData message={data.message} />
  }

  return (
    <>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 leading-relaxed">
        {t('orderingNoteText')}
      </p>
      <div className="space-y-3">
        {data.products.map(p => {
          const hasQty = p.suggested_order_qty != null && p.suggested_order_qty > 0
          return (
            <div
              key={p.product_id}
              className={`rounded-xl border overflow-hidden
                ${p.order_now ? 'border-teal-200 dark:border-teal-700' : 'border-slate-100 dark:border-slate-700'}`}
            >
              <div className={`flex items-center justify-between gap-3 px-4 py-3
                ${p.order_now ? 'bg-teal-50/60 dark:bg-teal-900/20' : 'bg-slate-50/60 dark:bg-slate-700/40'}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    ~{p.avg_daily_demand} {p.unit}{t('perDaySuffix')} · {t('restockInNDays', { n: String(p.lead_time_days) })}
                    {p.current_stock != null && ` · ${t('inStockSuffix', { qty: `${p.current_stock} ${p.unit}` })}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {p.order_now ? (
                    hasQty ? (
                      <span className="inline-block px-3 py-1 bg-teal-600 text-white rounded-full text-xs font-bold">
                        {t('orderNowBadge', { qty: `${Math.round(p.suggested_order_qty!)} ${p.unit}` })}
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full text-xs font-semibold">
                        {t('orderNowLabel')}
                      </span>
                    )
                  ) : p.current_stock != null ? (
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
                  {t('reorderBelowColon')} <strong className="text-slate-600 dark:text-slate-300">{p.reorder_point} {p.unit}</strong>
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {t('safetyBufferColon')} <strong className="text-slate-600 dark:text-slate-300">{p.safety_stock_units} {p.unit}</strong>
                </span>
                {p.eoq != null && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {t('eoqLabelColon')} <strong className="text-slate-600 dark:text-slate-300">{p.eoq} {p.unit}</strong>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
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
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    analytics.ordering()
      .then(setOrdering)
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
      {ordering ? <OrderingTable data={ordering} /> : <NotEnoughData />}
    </Card>
  )
}
