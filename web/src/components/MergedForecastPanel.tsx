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
import type { Lang } from '../i18n'
import type { ForecastResponse, ProductForecastItem, ProductForecastResponse } from '../api/types'

// ── weekday translation map ───────────────────────────────────────────────────

const WEEKDAY_SHORT: Record<Lang, Record<string, string>> = {
  en: {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
    Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
  },
  he: {
    Monday: 'שני', Tuesday: 'שלישי', Wednesday: 'רביעי', Thursday: 'חמישי',
    Friday: 'שישי', Saturday: 'שבת', Sunday: 'ראשון',
  },
}

function shortDay(weekday: string, lang: Lang): string {
  return WEEKDAY_SHORT[lang][weekday] ?? weekday.slice(0, 3)
}

function fmtQty(n: number, unitMode: 'whole' | 'decimal', unit: string) {
  const s = unitMode === 'decimal' ? n.toFixed(2) : String(Math.round(n))
  return `${s} ${unit}`
}

// ── ordering advice shown when a product chip is selected ─────────────────────

function OrderCard({ item }: { item: ProductForecastItem }) {
  const { t } = useLanguage()
  const { unit } = item
  const uMode = (item.unit_mode ?? 'whole') as 'whole' | 'decimal'
  const qty = item.suggested_order_qty
  const notes = item.constraint_notes ?? []

  const haveNow = item.current_stock != null
    ? t('haveNow', { qty: fmtQty(item.current_stock, uMode, unit) })
    : t('trackStockAlerts')

  return (
    <div className="mt-4 rounded-xl border border-teal-100 dark:border-teal-800 overflow-hidden">
      <div className="bg-teal-50/60 dark:bg-teal-900/20 px-4 py-2.5 border-b border-teal-100 dark:border-teal-800 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">{t('orderingAdvice')}</p>
        <div className="flex items-center gap-2">
          {item.order_now ? (
            <span className="px-2.5 py-1 bg-teal-600 text-white rounded-full text-xs font-bold">
              {t('orderNowBadge', { qty: fmtQty(qty, uMode, unit) })}
            </span>
          ) : item.current_stock != null ? (
            <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-semibold">
              {t('youreGood')}
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{t('reorderWhenBelow')}</p>
          <p className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">{fmtQty(item.reorder_point, uMode, unit)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{haveNow}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{t('safetyBufferLabel')}</p>
          <p className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">{fmtQty(item.safety_stock_units, uMode, unit)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t('extraAbsorbSwings')}</p>
        </div>
        <div className={`px-4 py-3 ${item.order_now ? 'bg-teal-50/40 dark:bg-teal-900/10' : ''}`}>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">
            {item.eoq != null ? t('idealOrderEOQ') : t('suggestedOrder')}
          </p>
          <p className={`text-base font-bold tabular-nums ${item.order_now ? 'text-teal-700 dark:text-teal-400' : 'text-slate-800 dark:text-slate-100'}`}>
            {fmtQty(qty, uMode, unit)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {item.eoq != null ? t('minimisesOrderingHolding') : t('coversLeadTimeSafety')}
          </p>
        </div>
      </div>
      {notes.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-900">
          {notes.map((note, i) => (
            <p key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">⚠</span>
              {note}
            </p>
          ))}
        </div>
      )}
      <div className="px-4 py-2 bg-teal-50/40 dark:bg-teal-900/10 border-t border-teal-100 dark:border-teal-800">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {t('avgPerDayData', {
            qty: fmtQty(item.avg_daily_demand, uMode, unit),
            n: String(item.n_days_data),
            lt: String(item.lead_time_days),
          })}
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
          : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-teal-300 hover:text-teal-700 bg-white dark:bg-slate-800'
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
  const { t, lang } = useLanguage()
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
      <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">{t('demandForecast')}</h2>
        <p className="text-sm text-slate-400 animate-pulse">{t('savingLabel')}</p>
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

  const activeUMode = (activeProduct?.unit_mode ?? 'whole') as 'whole' | 'decimal'

  if (selected === 'customers' && forecast?.status === 'ok') {
    chartData = forecast.days.map(d => ({
      name: `${shortDay(d.weekday, lang)} ${d.date.slice(5).replace('-', '/')}`,
      fullDay: d.weekday,
      predicted: Math.round(d.predicted_customers),
      low: Math.round(d.interval_low),
      high: Math.round(d.interval_high),
    }))
    yLabel = t('customersLabel')
  } else if (activeProduct?.status === 'ok') {
    chartData = activeProduct.days.map(d => ({
      name: `${shortDay(d.weekday, lang)} ${d.date.slice(5).replace('-', '/')}`,
      fullDay: d.weekday,
      predicted: activeUMode === 'decimal' ? d.predicted_units : Math.round(d.predicted_units),
      low: activeUMode === 'decimal' ? d.interval_low : Math.round(d.interval_low),
      high: activeUMode === 'decimal' ? d.interval_high : Math.round(d.interval_high),
    }))
    yLabel = activeProduct.unit
  }

  const noData = chartData.length === 0
  const noDataMsg = selected === 'customers'
    ? (forecast?.message ?? t('keepLoggingForecast'))
    : (activeProduct?.message ?? t('logMoreProductSales', { name: activeProduct?.name ?? '' }))

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('demandForecast')}</h2>
        {orderNowCount > 0 && (
          <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 rounded-full text-xs font-semibold shrink-0">
            {t('needsOrdering', { n: String(orderNowCount), s: orderNowCount === 1 ? '' : 's' })}
          </span>
        )}
      </div>

      {/* Series chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Chip
          label={t('customersLabel')}
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
          <p className="text-sm text-center max-w-xs leading-relaxed text-slate-500 dark:text-slate-400">{noDataMsg}</p>
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
                const dayLabel = shortDay(d.fullDay, lang) + (lang === 'he' ? '' : ` (${d.fullDay})`)
                return (
                  <div className="bg-white dark:bg-slate-800 border border-teal-100 dark:border-teal-700 rounded-xl px-3 py-2 shadow text-xs">
                    <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">{dayLabel}</p>
                    <p className="text-teal-600 dark:text-teal-400">
                      {t('expectedLabel')}: <strong>{d.predicted}</strong> {yLabel}
                    </p>
                    <p className="text-slate-400 dark:text-slate-500">{t('likelyRange')}: {d.low} – {d.high}</p>
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
        <div className="mt-3 rounded-xl bg-teal-50/40 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-800 px-4 py-4 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
            {activeProduct.message ?? t('logMoreProductSales', { name: activeProduct.name })}
          </p>
          {activeProduct.n_days_data > 0 && (
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {t('daysRecordedSoFar', { n: String(activeProduct.n_days_data), s: activeProduct.n_days_data !== 1 ? 's' : '' })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
