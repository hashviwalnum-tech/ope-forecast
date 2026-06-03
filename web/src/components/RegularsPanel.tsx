import { useEffect, useState } from 'react'
import { regulars as api } from '../api/client'
import type { RegularCreate, RegularRead, RegularUpdate } from '../api/types'

function fmtCLV(clv: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(clv)
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RegularsPanel() {
  const [rows, setRows]         = useState<RegularRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [adding, setAdding]     = useState(false)
  const [editing, setEditing]   = useState<RegularRead | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [visitMsg, setVisitMsg] = useState<string | null>(null)

  const [form, setForm] = useState<RegularCreate>({
    name: '', visit_frequency_per_week: 1, avg_spend: 0, expected_lifespan_years: 3,
  })

  function resetForm() {
    setForm({ name: '', visit_frequency_per_week: 1, avg_spend: 0, expected_lifespan_years: 3 })
    setError(null)
  }

  async function load() {
    setLoading(true)
    try { setRows(await api.list()) } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function startAdd() { resetForm(); setEditing(null); setAdding(true) }
  function startEdit(r: RegularRead) {
    setForm({
      name: r.name,
      visit_frequency_per_week: r.visit_frequency_per_week,
      avg_spend: r.avg_spend,
      expected_lifespan_years: r.expected_lifespan_years,
      notes: r.notes ?? undefined,
    })
    setEditing(r)
    setAdding(false)
  }
  function cancel() { setAdding(false); setEditing(null); resetForm() }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        const upd: RegularUpdate = {
          name: form.name,
          visit_frequency_per_week: form.visit_frequency_per_week,
          avg_spend: form.avg_spend,
          expected_lifespan_years: form.expected_lifespan_years,
          notes: form.notes,
        }
        await api.update(editing.id, upd)
      } else {
        await api.create(form)
      }
      cancel()
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function del(id: number) {
    if (!confirm('Remove this regular?')) return
    await api.delete(id)
    load()
  }

  async function recordVisit(id: number, name: string) {
    await api.recordVisit(id)
    setVisitMsg(`Visit recorded for ${name}`)
    setTimeout(() => setVisitMsg(null), 3000)
    load()
  }

  function liveClv() {
    return form.visit_frequency_per_week * 52 * form.avg_spend * (form.expected_lifespan_years ?? 3)
  }

  const showForm = adding || editing !== null

  return (
    <div className="space-y-6">

      {visitMsg && (
        <div className="rounded-xl bg-teal-50 border border-teal-200 px-4 py-3 text-sm text-teal-700">
          {visitMsg}
        </div>
      )}

      {/* Add button */}
      {!showForm && (
        <button
          onClick={startAdd}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 text-white
                     text-sm font-semibold hover:bg-teal-700 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add a regular
        </button>
      )}

      {/* Form */}
      {showForm && (
        <div className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-700">
            {editing ? 'Edit regular' : 'Add a regular'}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sarah"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Visits per week
              </label>
              <input
                type="number" min="0.1" step="0.5"
                value={form.visit_frequency_per_week}
                onChange={e => setForm(f => ({ ...f, visit_frequency_per_week: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Average spend per visit ($)
              </label>
              <input
                type="number" min="0" step="0.5"
                value={form.avg_spend}
                onChange={e => setForm(f => ({ ...f, avg_spend: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Expected loyalty (years)
              </label>
              <input
                type="number" min="0.5" step="0.5"
                value={form.expected_lifespan_years}
                onChange={e => setForm(f => ({ ...f, expected_lifespan_years: parseFloat(e.target.value) || 1 }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Notes (optional)</label>
              <input
                value={form.notes ?? ''}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value || undefined }))}
                placeholder="e.g. loves the latte, allergic to nuts"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>
          </div>

          {/* Live CLV preview */}
          <div className="rounded-xl bg-teal-50 px-4 py-3">
            <p className="text-xs text-teal-600 font-medium">
              Estimated customer value over {form.expected_lifespan_years} years:
              <span className="text-teal-800 font-bold ml-1">{fmtCLV(liveClv())}</span>
            </p>
            <p className="text-[11px] text-teal-500 mt-0.5">
              {form.visit_frequency_per_week} visits/week × ${form.avg_spend}/visit × 52 weeks × {form.expected_lifespan_years} yrs
            </p>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving || !form.name}
              className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold
                         hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
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

      {/* List */}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/40 p-8 text-center">
          <p className="text-sm text-teal-600 font-medium">No regulars yet</p>
          <p className="text-xs text-teal-400 mt-1">
            Add your loyal customers to track how valuable they are over time.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <div
              key={r.id}
              className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-wrap gap-4 items-start"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">{r.name}</span>
                  <span className="text-xs bg-teal-50 text-teal-600 border border-teal-100
                                   rounded-full px-2 py-0.5 font-medium">
                    CLV {fmtCLV(r.clv)}
                  </span>
                  {r.visit_count > 0 && (
                    <span className="text-xs text-slate-400">{r.visit_count} visit{r.visit_count !== 1 ? 's' : ''} logged</span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {r.visit_frequency_per_week}×/week · ${r.avg_spend}/visit · {r.expected_lifespan_years} yr lifespan
                </p>
                {r.notes && <p className="text-xs text-slate-400 mt-0.5 italic">{r.notes}</p>}
                {r.last_visit_date && (
                  <p className="text-xs text-slate-400 mt-0.5">Last visit: {fmtDate(r.last_visit_date)}</p>
                )}
              </div>

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => recordVisit(r.id, r.name)}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold
                             hover:bg-teal-700 transition-colors"
                >
                  Record visit
                </button>
                <button
                  onClick={() => startEdit(r)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs
                             hover:bg-slate-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => del(r.id)}
                  className="px-3 py-1.5 rounded-lg border border-rose-100 text-rose-500 text-xs
                             hover:bg-rose-50 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Regulars are tracked separately — their visits never mix with your daily demand data.
      </p>
    </div>
  )
}
