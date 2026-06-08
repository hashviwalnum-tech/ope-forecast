import { useEffect, useRef, useState } from 'react'
import { analytics, periods as periodsApi, products as productsApi } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { LiftResponse, PeriodLift, PeriodRead, ProductRead } from '../api/types'

// ── helpers ─────────────────────────────────────────────────────────────────

const MONTH_KEYS = [
  'monthJan','monthFeb','monthMar','monthApr','monthMay','monthJun',
  'monthJul','monthAug','monthSep','monthOct','monthNov','monthDec',
] as const

function fmtDate(iso: string, t: (k: typeof MONTH_KEYS[number]) => string) {
  const [y, m, d] = iso.split('-')
  return `${parseInt(d)} ${t(MONTH_KEYS[parseInt(m) - 1])} ${y}`
}

function fmtRange(start: string, end: string, t: (k: typeof MONTH_KEYS[number]) => string) {
  if (start === end) return fmtDate(start, t)
  return `${fmtDate(start, t)} – ${fmtDate(end, t)}`
}

function sign(n: number) { return n >= 0 ? '+' : '' }

// ── type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const styles =
    type === 'event'
      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
      : 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${styles}`}>
      {type}
    </span>
  )
}

// ── lift result card ─────────────────────────────────────────────────────────

function LiftCard({ lift }: { lift: PeriodLift }) {
  const { t } = useLanguage()
  const positive = lift.total_lift_customers >= 0
  const liftColor = positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
  const liftBg    = positive
    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'

  return (
    <div className={`rounded-xl border p-5 ${liftBg}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TypeBadge type={lift.type} />
            <span className="font-semibold text-slate-800 dark:text-slate-100">{lift.label}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{fmtRange(lift.start_date, lift.end_date, t as (k: typeof MONTH_KEYS[number]) => string)}</p>
        </div>
        <div className={`text-right ${liftColor}`}>
          <p className="text-2xl font-bold tabular-nums leading-none">
            {sign(lift.total_lift_customers)}{Math.round(lift.total_lift_customers)}
          </p>
          <p className="text-sm font-medium">
            {sign(lift.pct_lift)}{lift.pct_lift.toFixed(1)}{t('periodVsBaseline')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label={t('periodActualCustomers')} value={Math.round(lift.total_actual).toString()} />
        <Stat label={t('periodExpectedBaseline')} value={Math.round(lift.total_baseline).toString()} />
        {lift.lift_per_cost != null && (
          <Stat
            label={t('periodExtraPerUnit')}
            value={lift.lift_per_cost >= 0
              ? `+${lift.lift_per_cost.toFixed(2)}`
              : lift.lift_per_cost.toFixed(2)}
          />
        )}
      </div>

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        {t('periodExpectedNote', { type: lift.type })}
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-teal-25/70 dark:bg-slate-800/60 rounded-lg px-3 py-2">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
      <p className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums">{value}</p>
    </div>
  )
}

// ── create-period form ───────────────────────────────────────────────────────

type FormState = {
  label: string
  type: 'event' | 'ad'
  start_date: string
  end_date: string
  cost: string
  target_product_id: number | null  // null = measure total customers
}

const EMPTY: FormState = { label: '', type: 'event', start_date: '', end_date: '', cost: '', target_product_id: null }

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useLanguage()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [productList, setProductList] = useState<ProductRead[]>([])
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => { productsApi.list().then(setProductList).catch(() => {}) }, [])

  function set(key: keyof FormState, val: string) {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.label.trim()) { setError(t('periodLabelRequired')); return }
    if (!form.start_date)   { setError(t('periodStartRequired')); return }
    if (!form.end_date)     { setError(t('periodEndRequired')); return }
    if (form.end_date < form.start_date) { setError(t('periodEndAfterStart')); return }

    setSaving(true)
    setError(null)
    try {
      const cost = form.cost.trim() ? parseFloat(form.cost) : undefined
      if (cost !== undefined && (isNaN(cost) || cost < 0)) {
        setError(t('periodCostPositive')); setSaving(false); return
      }
      await periodsApi.create({
        label: form.label.trim(),
        type: form.type,
        start_date: form.start_date,
        end_date: form.end_date,
        cost,
        target_product_id: form.target_product_id ?? undefined,
      })
      setForm(EMPTY)
      labelRef.current?.focus()
      onCreated()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Label */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('periodsNameLabel')}</label>
          <input
            ref={labelRef}
            type="text"
            placeholder={t('periodNamePlaceholder')}
            value={form.label}
            onChange={e => set('label', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400
                       bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('periodsTypeLabel')}</label>
          <div className="flex gap-3">
            {(['event', 'ad'] as const).map(tp => (
              <button
                key={tp}
                type="button"
                onClick={() => set('type', tp)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.type === tp
                    ? tp === 'event'
                      ? 'bg-violet-100 dark:bg-violet-900/40 border-violet-300 dark:border-violet-700 text-violet-800 dark:text-violet-300'
                      : 'bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-300'
                    : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {tp === 'event' ? t('periodsEventLabel') : t('periodsAdLabel')}
              </button>
            ))}
          </div>
        </div>

        {/* Cost */}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {t('periodsCostLabel')} <span className="text-slate-400 dark:text-slate-500 font-normal">{t('periodsCostNote')}</span>
          </label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="e.g. 200"
            value={form.cost}
            onChange={e => set('cost', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400
                       bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
          />
        </div>

        {/* Product target — what this ad/event is meant to promote */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {t('periodsTargetLabel')}
          </label>
          <select
            value={form.target_product_id ?? ''}
            onChange={e => setForm(f => ({ ...f, target_product_id: e.target.value ? parseInt(e.target.value) : null }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400
                       bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
          >
            <option value="">{t('periodsTargetCustomers')}</option>
            {productList.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('periodsTargetNote')}</p>
        </div>

        {/* Dates */}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('periodsStartDate')}</label>
          <input
            type="date"
            value={form.start_date}
            onChange={e => {
              set('start_date', e.target.value)
              if (form.end_date && e.target.value > form.end_date) set('end_date', e.target.value)
            }}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400
                       bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('periodsEndDate')}</label>
          <input
            type="date"
            min={form.start_date || undefined}
            value={form.end_date}
            onChange={e => set('end_date', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400
                       bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-3 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
      >
        {saving ? t('savingLabel') : t('periodsSaveBtn')}
      </button>
    </form>
  )
}

// ── period list ──────────────────────────────────────────────────────────────

function PeriodRow({ period, onDeleted }: { period: PeriodRead; onDeleted: () => void }) {
  const { t } = useLanguage()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting]     = useState(false)

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await periodsApi.delete(period.id)
      onDeleted()
    } catch {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <TypeBadge type={period.type} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{period.label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {fmtRange(period.start_date, period.end_date, t as (k: typeof MONTH_KEYS[number]) => string)}
            {period.cost != null && (
              <span className="ml-2 text-slate-400 dark:text-slate-500">
                {t('periodCost', { cost: String(period.cost) })}
              </span>
            )}
          </p>
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
          confirming
            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
        }`}
      >
        {deleting ? '…' : confirming ? t('periodConfirmDelete') : t('periodDelete')}
      </button>
    </div>
  )
}

// ── main component ───────────────────────────────────────────────────────────

export default function PeriodsPanel() {
  const { t } = useLanguage()
  const [periodList, setPeriodList] = useState<PeriodRead[]>([])
  const [liftData, setLiftData]     = useState<LiftResponse | null>(null)
  const [loadingLift, setLoadingLift] = useState(false)

  async function loadAll() {
    const [p, l] = await Promise.all([periodsApi.list(), analytics.lift()])
    setPeriodList(p)
    setLiftData(l)
  }

  useEffect(() => { loadAll() }, [])

  async function refreshLift() {
    setLoadingLift(true)
    try {
      const [p, l] = await Promise.all([periodsApi.list(), analytics.lift()])
      setPeriodList(p)
      setLiftData(l)
    } finally {
      setLoadingLift(false)
    }
  }

  return (
    <div className="space-y-8">

      {/* ── create form ── */}
      <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">{t('periodsSomethingSpecial')}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          {t('periodsTagDesc')}
        </p>
        <CreateForm onCreated={refreshLift} />
      </section>

      {/* ── period list ── */}
      {periodList.length > 0 && (
        <section className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 px-6 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
            {t('periodsSavedTitle')}
            <span className="ml-2 text-sm font-normal text-slate-400 dark:text-slate-500">({periodList.length})</span>
          </h2>
          <div>
            {periodList.map(p => (
              <PeriodRow key={p.id} period={p} onDeleted={refreshLift} />
            ))}
          </div>
        </section>
      )}

      {/* ── lift results ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('periodsDifference')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('periodsDiffDesc')}
            </p>
          </div>
          <button
            onClick={refreshLift}
            disabled={loadingLift}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300
                       bg-slate-100 dark:bg-slate-700 rounded-lg
                       hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
          >
            {loadingLift ? t('periodsRefreshing') : t('periodsRefresh')}
          </button>
        </div>

        {!liftData || liftData.status === 'no_periods' ? (
          <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
            <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
              {t('periodsNoneTagged')}
            </p>
          </div>
        ) : liftData.periods.length === 0 ? (
          <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
            <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
              {liftData.message ?? t('periodsNotEnough')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {liftData.periods.map(lift => (
              <LiftCard key={lift.period_id} lift={lift} />
            ))}
          </div>
        )}
      </section>

    </div>
  )
}
