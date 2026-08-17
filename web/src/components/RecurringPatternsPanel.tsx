import { useEffect, useState } from 'react'
import { recurringPatterns as api } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { RecurringPatternCreate, RecurringPatternRead } from '../api/types'

const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WD_LONG  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function RecurringPatternsPanel() {
  const { t } = useLanguage()
  const [rows, setRows]       = useState<RecurringPatternRead[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const [form, setForm] = useState<RecurringPatternCreate>({
    label: '', weekdays: [], effect: 'higher',
    hour_start: undefined, hour_end: undefined,
  })

  function fmtWeekdays(wds: number[]) {
    if (wds.length === 7) return t('everyDay')
    return wds.map(w => WD_SHORT[w]).join(', ')
  }

  function fmt12h(h: number): string {
    if (h === 0) return '12 am'
    if (h < 12) return `${h} am`
    if (h === 12) return '12 pm'
    return `${h - 12} pm`
  }

  function fmtHourRange(start: number | null, end: number | null): string {
    if (start === null && end === null) return t('allHours')
    if (start !== null && end !== null) return `${fmt12h(start)}–${fmt12h(end)}`
    if (start !== null) return t('fromHourInferred', { hour: fmt12h(start) })
    return t('untilHour', { hour: fmt12h(end!) })
  }

  function effectLabel(effect: string): string {
    if (effect === 'higher') return t('effectBusier')
    if (effect === 'lower')  return t('effectQuieter')
    return t('effectExpectedLabel')
  }

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
      setError(t('patternFillName'))
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
    if (!confirm(t('removeBtn') + '?')) return
    await api.delete(id)
    load()
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800 px-4 py-3 text-sm text-teal-700 dark:text-teal-300">
        <strong>{t('teachOpeTitle')}</strong> {t('teachOpeDesc')}
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
          {t('declarePattern')}
        </button>
      )}

      {adding && (
        <div className="rounded-2xl border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-700 dark:text-slate-200">{t('newPatternTitle')}</h3>

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('nameLabel')}</label>
            <input
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder={`${t('egPrefix')} ${t('egPatternLabel')}`}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                         bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t('whichDays')}</label>
            <div className="flex flex-wrap gap-2">
              {WD_LONG.map((_name, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleWd(idx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    form.weekdays.includes(idx)
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-teal-300'
                  }`}
                >
                  {WD_SHORT[idx]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('effectLabel')}</label>
              <select
                value={form.effect ?? 'higher'}
                onChange={e => setForm(f => ({ ...f, effect: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                           bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              >
                <option value="higher">{t('effectHigher')}</option>
                <option value="lower">{t('effectLower')}</option>
                <option value="expected">{t('effectExpected')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t('startHourOptional')}
              </label>
              <input
                type="number" min="0" max="23"
                value={form.hour_start ?? ''}
                onChange={e => setForm(f => ({ ...f, hour_start: e.target.value ? parseInt(e.target.value) : undefined }))}
                placeholder={`${t('egPrefix')} 9`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                           bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t('endHourOptional')}
              </label>
              <input
                type="number" min="0" max="23"
                value={form.hour_end ?? ''}
                onChange={e => setForm(f => ({ ...f, hour_end: e.target.value ? parseInt(e.target.value) : undefined }))}
                placeholder={`${t('egPrefix')} 11`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                           bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
              {form.hour_start != null && form.hour_end == null && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  {t('endHourNote')}
                </p>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold
                         hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? t('savingLabel') : t('savePattern')}
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
          <p className="text-sm text-teal-600 dark:text-teal-400 font-medium">{t('noRecurringPatterns')}</p>
          <p className="text-xs text-teal-400 dark:text-teal-600 mt-1">
            {t('noRecurringDesc')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(rp => (
            <div
              key={rp.id}
              className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm flex items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{rp.label}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium border ${
                    rp.effect === 'higher'
                      ? 'bg-teal-50 dark:bg-teal-900/40 text-teal-600 dark:text-teal-300 border-teal-100 dark:border-teal-800'
                      : rp.effect === 'lower'
                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800'
                        : 'bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'
                  }`}>
                    {effectLabel(rp.effect)}
                  </span>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {fmtWeekdays(rp.weekdays)}
                  {(rp.hour_start !== null || rp.hour_end !== null) && (
                    <span className="ml-2 text-slate-400 dark:text-slate-500">
                      · {fmtHourRange(rp.hour_start, rp.hour_end)}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => del(rp.id)}
                className="px-3 py-1.5 rounded-lg border border-rose-100 dark:border-rose-900 text-rose-500 dark:text-rose-400 text-xs
                           hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors shrink-0"
              >
                {t('removeBtn')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
