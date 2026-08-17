import { useEffect, useState } from 'react'
import { bookedCounts as api, products as productsApi } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { BookedCountRead, ProductRead } from '../api/types'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

type Target = 'business' | number

export default function BookedCountsPanel() {
  const { t } = useLanguage()
  const [services, setServices] = useState<ProductRead[]>([])
  const [target, setTarget]   = useState<Target>('business')
  const [rows, setRows]       = useState<BookedCountRead[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate]       = useState(todayStr())
  const [count, setCount]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    productsApi.list()
      .then(all => setServices(all.filter(p => p.product_type === 'service')))
      .catch(() => {})
  }, [])

  async function load() {
    setLoading(true)
    try { setRows(await api.list(target === 'business' ? undefined : target)) } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [target])

  async function save() {
    const n = parseInt(count, 10)
    if (!date || isNaN(n) || n < 0) {
      setError(t('bookingsFillFields'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.upsert(date, n, target === 'business' ? undefined : target)
      setCount('')
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function del(d: string) {
    if (!confirm(t('removeBtn') + '?')) return
    await api.delete(d, target === 'business' ? undefined : target)
    load()
  }

  const today = todayStr()
  const upcoming = rows.filter(r => r.date >= today)
  const past = rows.filter(r => r.date < today)

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800 px-4 py-3 text-sm text-teal-700 dark:text-teal-300">
        <strong>{t('bookingsIntroTitle')}</strong> {t('bookingsIntroDesc')}
      </div>

      {services.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('bookingsForLabel')}</label>
          <select
            value={target === 'business' ? 'business' : String(target)}
            onChange={e => setTarget(e.target.value === 'business' ? 'business' : Number(e.target.value))}
            className="w-full sm:w-64 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                       bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                       focus:outline-none focus:ring-2 focus:ring-teal-300"
          >
            <option value="business">{t('wholeBusinessOption')}</option>
            {services.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="rounded-2xl border border-teal-100 dark:border-teal-800 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-700 dark:text-slate-200">{t('addBookedCountTitle')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('dateLabel')}</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                         bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('bookedCountLabel')}</label>
            <input
              type="number" min="0" step="1"
              value={count}
              onChange={e => setCount(e.target.value)}
              placeholder={`${t('egPrefix')} 14`}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
                         bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </div>
        </div>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {saving ? t('savingLabel') : t('saveBookedCount')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{t('savingLabel')}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 p-8 text-center">
          <p className="text-sm text-teal-600 dark:text-teal-400 font-medium">{t('noBookedCounts')}</p>
          <p className="text-xs text-teal-400 dark:text-teal-600 mt-1">{t('noBookedCountsDesc')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...upcoming, ...past].map(r => (
            <div
              key={r.date}
              className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm flex items-center justify-between gap-4"
            >
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{r.date}</span>
                <span className="ml-3 text-sm text-slate-500 dark:text-slate-400">
                  {t('bookedCountRow', { n: String(r.booked_count) })}
                </span>
              </div>
              <button
                onClick={() => del(r.date)}
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
