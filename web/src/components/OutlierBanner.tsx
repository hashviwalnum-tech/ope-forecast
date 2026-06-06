import { useEffect, useState } from 'react'
import { dayRecords, outliers as outliersApi } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { OutlierFlag } from '../api/types'

interface Props {
  onResolved: () => void
}

export default function OutlierBanner({ onResolved }: Props) {
  const { t } = useLanguage()
  const [flags, setFlags]         = useState<OutlierFlag[]>([])
  const [resolving, setResolving] = useState<number | null>(null)

  useEffect(() => {
    outliersApi.list()
      .then(res => setFlags(res.flags))
      .catch(() => {})
  }, [])

  if (flags.length === 0) return null

  async function resolve(id: number, action: 'keep' | 'excluded' | 'event' | 'ad' | 'recurring') {
    setResolving(id)
    try {
      await dayRecords.resolveOutlier(id, action)
      setFlags(prev => prev.filter(f => f.day_record_id !== id))
      onResolved()
    } catch {
      // silent — user can try again
    } finally {
      setResolving(null)
    }
  }

  return (
    <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          {flags.length === 1
            ? t('unusualDaySingular')
            : t('unusualDaysPlural', { n: String(flags.length) })}
        </h3>
      </div>

      <div className="space-y-3">
        {flags.map(flag => (
          <div
            key={flag.day_record_id}
            className="bg-white dark:bg-slate-800 rounded-xl border border-amber-200 dark:border-amber-800 p-4"
          >
            <p className="text-sm text-slate-700 dark:text-slate-200 mb-3 leading-relaxed">{flag.message}</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => resolve(flag.day_record_id, 'event')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700 text-xs font-medium
                           rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/50 disabled:opacity-50 transition-colors"
              >
                {t('outlierSpecialEvent')}
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'ad')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700 text-xs font-medium
                           rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/50 disabled:opacity-50 transition-colors"
              >
                {t('outlierAd')}
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'recurring')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700 text-xs font-medium
                           rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/50 disabled:opacity-50 transition-colors"
              >
                {t('outlierRecurring', { weekday: flag.weekday })}
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'excluded')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium
                           rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
              >
                {t('outlierExclude')}
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'keep')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 text-xs font-medium
                           rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {t('outlierKeep')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
        {t('outlierDownweightNote')}
      </p>
    </div>
  )
}
