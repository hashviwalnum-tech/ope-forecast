import { useEffect, useState } from 'react'
import { recurringPatterns as api } from '../api/client'
import type { RecurringPatternCreate, RecurringPatternRead } from '../api/types'

const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WD_LONG  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function fmtWeekdays(wds: number[]) {
  if (wds.length === 7) return 'Every day'
  return wds.map(w => WD_SHORT[w]).join(', ')
}

function fmtHourRange(start: number | null, end: number | null) {
  if (start === null && end === null) return 'All hours'
  function fmt(h: number) {
    if (h === 0) return '12 am'
    if (h < 12) return `${h} am`
    if (h === 12) return '12 pm'
    return `${h - 12} pm`
  }
  if (start !== null && end !== null) return `${fmt(start)}–${fmt(end)}`
  if (start !== null) return `From ${fmt(start)}`
  return `Until ${fmt(end!)}`
}

export default function RecurringPatternsPanel() {
  const [rows, setRows]       = useState<RecurringPatternRead[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const [form, setForm] = useState<RecurringPatternCreate>({
    label: '', weekdays: [], effect: 'higher',
    hour_start: undefined, hour_end: undefined,
  })

  async function load() {
    setLoading(true)
    try { setRows(await api.list()) } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function toggleWd(wd: number) {
    setForm(f => ({
      ...f,
      weekdays: f.weekdays.includes(wd)
        ? f.weekdays.filter(w => w !== wd)
        : [...f.weekdays, wd].sort((a, b) => a - b),
    }))
  }

  function cancel() {
    setAdding(false)
    setForm({ label: '', weekdays: [], effect: 'higher', hour_start: undefined, hour_end: undefined })
    setError(null)
  }

  async function save() {
    if (!form.label.trim() || form.weekdays.length === 0) {
      setError('Please fill in a name and choose at least one day.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.create(form)
      cancel()
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function del(id: number) {
    if (!confirm('Remove this recurring pattern?')) return
    await api.delete(id)
    load()
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-teal-50 border border-teal-100 px-4 py-3 text-sm text-teal-700">
        <strong>Teach Ope your world.</strong> Declare patterns you know repeat — like a school trip every Sunday
        — and Ope will expect them instead of flagging them as unusual.
      </div>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 text-white
                     text-sm font-semibold hover:bg-teal-700 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Declare a recurring pattern
        </button>
      )}

      {adding && (
        <div className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-700">New recurring pattern</h3>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
            <input
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="e.g. School trip Sundays"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">Which days?</label>
            <div className="flex flex-wrap gap-2">
              {WD_LONG.map((_name, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleWd(idx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    form.weekdays.includes(idx)
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
                  }`}
                >
                  {WD_SHORT[idx]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Effect</label>
              <select
                value={form.effect ?? 'higher'}
                onChange={e => setForm(f => ({ ...f, effect: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              >
                <option value="higher">Busier than usual</option>
                <option value="lower">Quieter than usual</option>
                <option value="expected">Just expected (no change)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Start hour (optional)
              </label>
              <input
                type="number" min="0" max="23"
                value={form.hour_start ?? ''}
                onChange={e => setForm(f => ({ ...f, hour_start: e.target.value ? parseInt(e.target.value) : undefined }))}
                placeholder="e.g. 9"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                End hour (optional)
              </label>
              <input
                type="number" min="0" max="23"
                value={form.hour_end ?? ''}
                onChange={e => setForm(f => ({ ...f, hour_end: e.target.value ? parseInt(e.target.value) : undefined }))}
                placeholder="e.g. 11"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold
                         hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save pattern'}
            </button>
            <button
              onClick={cancel}
              className="px-5 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm
                         hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/40 p-8 text-center">
          <p className="text-sm text-teal-600 font-medium">No recurring patterns yet</p>
          <p className="text-xs text-teal-400 mt-1">
            Declare patterns you know repeat — Ope will expect them and stop flagging them.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(rp => (
            <div
              key={rp.id}
              className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">{rp.label}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium border ${
                    rp.effect === 'higher'
                      ? 'bg-teal-50 text-teal-600 border-teal-100'
                      : rp.effect === 'lower'
                        ? 'bg-amber-50 text-amber-600 border-amber-100'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}>
                    {rp.effect === 'higher' ? 'Busier' : rp.effect === 'lower' ? 'Quieter' : 'Expected'}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {fmtWeekdays(rp.weekdays)}
                  {(rp.hour_start !== null || rp.hour_end !== null) && (
                    <span className="ml-2 text-slate-400">
                      · {fmtHourRange(rp.hour_start, rp.hour_end)}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => del(rp.id)}
                className="px-3 py-1.5 rounded-lg border border-rose-100 text-rose-500 text-xs
                           hover:bg-rose-50 transition-colors shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
