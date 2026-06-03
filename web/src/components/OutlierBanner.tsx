import { useEffect, useState } from 'react'
import { dayRecords, outliers as outliersApi } from '../api/client'
import type { OutlierFlag } from '../api/types'

interface Props {
  onResolved: () => void
}

export default function OutlierBanner({ onResolved }: Props) {
  const [flags, setFlags]         = useState<OutlierFlag[]>([])
  const [resolving, setResolving] = useState<number | null>(null)

  useEffect(() => {
    outliersApi.list()
      .then(res => setFlags(res.flags))
      .catch(() => {})   // non-critical — don't disrupt the app on failure
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
    <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="text-sm font-semibold text-amber-800">
          {flags.length === 1
            ? '1 unusual day needs your attention'
            : `${flags.length} unusual days need your attention`}
        </h3>
      </div>

      <div className="space-y-3">
        {flags.map(flag => (
          <div
            key={flag.day_record_id}
            className="bg-white rounded-xl border border-amber-200 p-4"
          >
            <p className="text-sm text-slate-700 mb-3 leading-relaxed">{flag.message}</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => resolve(flag.day_record_id, 'event')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-teal-50 text-teal-700 border border-teal-200 text-xs font-medium
                           rounded-lg hover:bg-teal-100 disabled:opacity-50 transition-colors"
              >
                It was a special event
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'ad')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-teal-50 text-teal-700 border border-teal-200 text-xs font-medium
                           rounded-lg hover:bg-teal-100 disabled:opacity-50 transition-colors"
              >
                It was an ad / promo
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'recurring')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-teal-50 text-teal-700 border border-teal-200 text-xs font-medium
                           rounded-lg hover:bg-teal-100 disabled:opacity-50 transition-colors"
              >
                It repeats every {flag.weekday}
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'excluded')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-slate-100 text-slate-700 text-xs font-medium
                           rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
              >
                Exclude it (one-off fluke)
              </button>
              <button
                onClick={() => resolve(flag.day_record_id, 'keep')}
                disabled={resolving === flag.day_record_id}
                className="px-3 py-2 bg-slate-50 text-slate-600 border border-slate-200 text-xs font-medium
                           rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-colors"
              >
                Keep it as-is
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-amber-700 leading-relaxed">
        Until you decide, unusual days are down-weighted so they don't skew your forecast.
        Marking a day as recurring teaches Ope to expect it in the future.
      </p>
    </div>
  )
}
