import { useEffect, useRef, useState } from 'react'
import { analytics, periods as periodsApi } from '../api/client'
import type { LiftResponse, PeriodLift, PeriodRead } from '../api/types'

// ── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  // "2026-06-01" → "1 Jun 2026"
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`
}

function fmtRange(start: string, end: string) {
  if (start === end) return fmtDate(start)
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

function sign(n: number) { return n >= 0 ? '+' : '' }

// ── type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const styles =
    type === 'event'
      ? 'bg-violet-100 text-violet-700'
      : 'bg-sky-100 text-sky-700'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${styles}`}>
      {type}
    </span>
  )
}

// ── lift result card ─────────────────────────────────────────────────────────

function LiftCard({ lift }: { lift: PeriodLift }) {
  const positive = lift.total_lift_customers >= 0
  const liftColor = positive ? 'text-emerald-600' : 'text-red-600'
  const liftBg    = positive ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'

  return (
    <div className={`rounded-xl border p-5 ${liftBg}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TypeBadge type={lift.type} />
            <span className="font-semibold text-slate-800">{lift.label}</span>
          </div>
          <p className="text-xs text-slate-500">{fmtRange(lift.start_date, lift.end_date)}</p>
        </div>
        <div className={`text-right ${liftColor}`}>
          <p className="text-2xl font-bold tabular-nums leading-none">
            {sign(lift.total_lift_customers)}{Math.round(lift.total_lift_customers)}
          </p>
          <p className="text-sm font-medium">
            {sign(lift.pct_lift)}{lift.pct_lift.toFixed(1)}% vs baseline
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Actual customers" value={Math.round(lift.total_actual).toString()} />
        <Stat label="Expected (baseline)" value={Math.round(lift.total_baseline).toString()} />
        {lift.lift_per_cost != null && (
          <Stat
            label="Extra customers per unit spent"
            value={lift.lift_per_cost >= 0
              ? `+${lift.lift_per_cost.toFixed(2)}`
              : lift.lift_per_cost.toFixed(2)}
          />
        )}
      </div>

      <p className="mt-3 text-xs text-slate-500 leading-relaxed">
        "Expected" is what we predicted you'd get with no {lift.type}.
        The difference is how much extra business you got because of it.
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/70 rounded-lg px-3 py-2">
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-base font-bold text-slate-800 tabular-nums">{value}</p>
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
}

const EMPTY: FormState = { label: '', type: 'event', start_date: '', end_date: '', cost: '' }

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const labelRef = useRef<HTMLInputElement>(null)

  function set(key: keyof FormState, val: string) {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.label.trim()) { setError('Label is required.'); return }
    if (!form.start_date)   { setError('Start date is required.'); return }
    if (!form.end_date)     { setError('End date is required.'); return }
    if (form.end_date < form.start_date) { setError('End date must be on or after start date.'); return }

    setSaving(true)
    setError(null)
    try {
      const cost = form.cost.trim() ? parseFloat(form.cost) : undefined
      if (cost !== undefined && (isNaN(cost) || cost < 0)) {
        setError('Cost must be a positive number.'); setSaving(false); return
      }
      await periodsApi.create({
        label: form.label.trim(),
        type: form.type,
        start_date: form.start_date,
        end_date: form.end_date,
        cost,
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
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input
            ref={labelRef}
            type="text"
            placeholder="e.g. Summer sale, Facebook campaign"
            value={form.label}
            onChange={e => set('label', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
          <div className="flex gap-3">
            {(['event', 'ad'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => set('type', t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.type === t
                    ? t === 'event'
                      ? 'bg-violet-100 border-violet-300 text-violet-800'
                      : 'bg-sky-100 border-sky-300 text-sky-800'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {t === 'event' ? 'Event' : 'Ad campaign'}
              </button>
            ))}
          </div>
        </div>

        {/* Cost */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Cost <span className="text-slate-400 font-normal">(optional — enables ROI)</span>
          </label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="e.g. 200"
            value={form.cost}
            onChange={e => set('cost', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>

        {/* Dates */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Start date</label>
          <input
            type="date"
            value={form.start_date}
            onChange={e => {
              set('start_date', e.target.value)
              if (form.end_date && e.target.value > form.end_date) set('end_date', e.target.value)
            }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">End date</label>
          <input
            type="date"
            min={form.start_date || undefined}
            value={form.end_date}
            onChange={e => set('end_date', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-3 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : 'Save this period'}
      </button>
    </form>
  )
}

// ── period list ──────────────────────────────────────────────────────────────

function PeriodRow({ period, onDeleted }: { period: PeriodRead; onDeleted: () => void }) {
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
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <TypeBadge type={period.type} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{period.label}</p>
          <p className="text-xs text-slate-500">
            {fmtRange(period.start_date, period.end_date)}
            {period.cost != null && <span className="ml-2 text-slate-400">cost: {period.cost}</span>}
          </p>
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
          confirming
            ? 'bg-red-100 text-red-700 hover:bg-red-200'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`}
      >
        {deleting ? '…' : confirming ? 'Confirm delete' : 'Delete'}
      </button>
    </div>
  )
}

// ── main component ───────────────────────────────────────────────────────────

export default function PeriodsPanel() {
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
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Did something special happen?</h2>
        <p className="text-xs text-slate-500 mb-5">
          Tag a special event or ad campaign below. We'll keep it out of your normal baseline
          and show you how much extra business it brought.
        </p>
        <CreateForm onCreated={refreshLift} />
      </section>

      {/* ── period list ── */}
      {periodList.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 px-6 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Saved Periods
            <span className="ml-2 text-sm font-normal text-slate-400">({periodList.length})</span>
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
            <h2 className="text-base font-semibold text-slate-800">Did it make a difference?</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              We compare each tagged period against what we predicted you'd normally get — no event, no ad.
            </p>
          </div>
          <button
            onClick={refreshLift}
            disabled={loadingLift}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            {loadingLift ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {!liftData || liftData.status === 'no_periods' ? (
          <div className="bg-white rounded-2xl border border-teal-100 p-10 text-center shadow-sm">
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
              Once you tag a special day or ad campaign above, you'll see here whether it actually brought more customers.
            </p>
          </div>
        ) : liftData.periods.length === 0 ? (
          <div className="bg-white rounded-2xl border border-teal-100 p-10 text-center shadow-sm">
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
              {liftData.message ?? "We don't have enough logged days overlapping with your tagged periods yet — keep logging!"}
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
