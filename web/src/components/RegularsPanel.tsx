import { useEffect, useState } from 'react'
import { regulars as api } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { RegularCreate, RegularRead, RegularUpdate } from '../api/types'

function fmtCLV(clv: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(clv)
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function liveClv(avgSpend: number, freq: number, years: number) {
  return freq * 52 * avgSpend * years
}

export default function RegularsPanel() {
  const { t } = useLanguage()
  const [rows, setRows]         = useState<RegularRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [adding, setAdding]     = useState(false)
  const [editing, setEditing]   = useState<RegularRead | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [visitMsg, setVisitMsg] = useState<string | null>(null)
  const [visitErr, setVisitErr] = useState<string | null>(null)
  const [showOptional, setShowOptional] = useState(false)

  const [visitAmounts, setVisitAmounts] = useState<Record<number, string>>({})
  const [visitRecording, setVisitRecording] = useState<number | null>(null)

  const [form, setForm] = useState<RegularCreate>({
    name: '', visit_frequency_per_week: 1, avg_spend: 0, expected_lifespan_years: 3,
  })

  function resetForm() {
    setForm({ name: '', visit_frequency_per_week: 1, avg_spend: 0, expected_lifespan_years: 3 })
    setError(null)
    setShowOptional(false)
  }

  async function load() {
    setLoading(true)
    try {
      const data = await api.list()
      setRows(data)
      const defaults: Record<number, string> = {}
      for (const r of data) defaults[r.id] = String(r.avg_spend)
      setVisitAmounts(defaults)
    } catch { /* ignore */ }
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
    setShowOptional(r.visit_frequency_per_week !== 1 || r.expected_lifespan_years !== 3)
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
    if (!confirm(t('removeRegularConfirm'))) return
    await api.delete(id)
    load()
  }

  async function recordVisit(id: number, name: string) {
    setVisitRecording(id)
    setVisitMsg(null)
    setVisitErr(null)
    try {
      const amountStr = visitAmounts[id]
      const amount_paid = amountStr ? parseFloat(amountStr) : undefined
      await api.recordVisit(id, amount_paid != null && !isNaN(amount_paid) ? { amount_paid } : undefined)
      setVisitMsg(t('visitRecordedFor', { name }))
      setTimeout(() => setVisitMsg(null), 3000)
      load()
    } catch (e: unknown) {
      setVisitErr(e instanceof Error ? e.message : 'Could not record visit')
      setTimeout(() => setVisitErr(null), 4000)
    } finally {
      setVisitRecording(null)
    }
  }

  const showForm = adding || editing !== null
  const clvPreview = liveClv(form.avg_spend, form.visit_frequency_per_week, form.expected_lifespan_years ?? 3)

  return (
    <div className="space-y-6">

      {visitMsg && (
        <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 px-4 py-3 text-sm text-teal-700 dark:text-teal-300">
          {visitMsg}
        </div>
      )}
      {visitErr && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {visitErr}
        </div>
      )}

      {!showForm && (
        <button
          onClick={startAdd}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 text-white
                     text-sm font-semibold hover:bg-teal-700 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('addARegular')}
        </button>
      )}

      {showForm && (
        <div className="rounded-2xl border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-700 dark:text-slate-200">
            {editing ? t('editRegularTitle') : t('addARegular')}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('nameLabel')}</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sarah"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                           bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t('avgSpendLabel')}
              </label>
              <input
                type="number" min="0" step="0.5"
                value={form.avg_spend}
                onChange={e => setForm(f => ({ ...f, avg_spend: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                           bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>
          </div>

          {/* Live CLV preview */}
          <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 px-4 py-3">
            <p className="text-xs text-teal-600 dark:text-teal-400 font-medium">
              {t('clvEstimateText', { years: String(form.expected_lifespan_years ?? 3) })}
              <span className="text-teal-800 dark:text-teal-200 font-bold ml-1">{fmtCLV(clvPreview)}</span>
            </p>
            <p className="text-[11px] text-teal-500 dark:text-teal-500 mt-0.5">
              {t('clvFormulaText', {
                freq: String(form.visit_frequency_per_week),
                spend: String(form.avg_spend),
                years: String(form.expected_lifespan_years ?? 3),
              })}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowOptional(o => !o)}
            className="text-xs text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
          >
            {showOptional ? '▴' : '▾'} {t('optionalDetailsToggle')}
          </button>

          {showOptional && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {t('visitsPerWeek')}
                </label>
                <input
                  type="number" min="0.1" step="0.5"
                  value={form.visit_frequency_per_week}
                  onChange={e => setForm(f => ({ ...f, visit_frequency_per_week: parseFloat(e.target.value) || 0 }))}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {t('expectedLoyalty')}
                </label>
                <input
                  type="number" min="0.5" step="0.5"
                  value={form.expected_lifespan_years}
                  onChange={e => setForm(f => ({ ...f, expected_lifespan_years: parseFloat(e.target.value) || 1 }))}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('notesOptional')}</label>
                <input
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value || undefined }))}
                  placeholder="e.g. loves the latte, allergic to nuts"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving || !form.name}
              className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold
                         hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? t('savingLabel') : t('saveLabel')}
            </button>
            <button
              onClick={cancel}
              className="px-5 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm
                         hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              {t('cancelBtn')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{t('savingLabel')}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 p-8 text-center">
          <p className="text-sm text-teal-600 dark:text-teal-400 font-medium">{t('noRegularsEmptyTitle')}</p>
          <p className="text-xs text-teal-400 dark:text-teal-600 mt-1">
            {t('noRegularsEmptyDesc')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <div
              key={r.id}
              className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm"
            >
              <div className="flex flex-wrap gap-4 items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{r.name}</span>
                    <span className="text-xs bg-teal-50 dark:bg-teal-900/40 text-teal-600 dark:text-teal-300 border border-teal-100 dark:border-teal-800
                                     rounded-full px-2 py-0.5 font-medium">
                      CLV {fmtCLV(r.clv)}
                    </span>
                    {r.visit_count > 0 && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {t('visitsLogged', { n: String(r.visit_count), s: r.visit_count !== 1 ? 's' : '', ים: r.visit_count !== 1 ? 'ים' : '', ו: r.visit_count !== 1 ? 'ו' : '' })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {r.visit_frequency_per_week}×/week · ${r.avg_spend}/visit · {r.expected_lifespan_years} yr
                  </p>
                  {r.notes && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 italic">{r.notes}</p>}
                  {r.last_visit_date && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {t('lastVisitLabel', { date: fmtDate(r.last_visit_date) ?? '' })}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(r)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs
                               hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    {t('editBtn')}
                  </button>
                  <button
                    onClick={() => del(r.id)}
                    className="px-3 py-1.5 rounded-lg border border-rose-100 dark:border-rose-900 text-rose-500 dark:text-rose-400 text-xs
                               hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  >
                    {t('removeBtn')}
                  </button>
                </div>
              </div>

              {/* Record visit row */}
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{t('recordVisitAmountLabel')}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400 dark:text-slate-500">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={visitAmounts[r.id] ?? r.avg_spend}
                    onChange={e => setVisitAmounts(a => ({ ...a, [r.id]: e.target.value }))}
                    className="w-20 text-sm px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg
                               bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200
                               focus:outline-none focus:ring-2 focus:ring-teal-300 tabular-nums"
                  />
                </div>
                <button
                  onClick={() => recordVisit(r.id, r.name)}
                  disabled={visitRecording === r.id}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold
                             hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {visitRecording === r.id ? '…' : t('recordVisit')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {t('regularsNote')}
      </p>
    </div>
  )
}
