import { useLanguage } from '../contexts/LanguageContext'
import type { TranslationKey } from '../i18n'
import type { LearningMilestone } from '../api/types'

/**
 * The first fortnight, made worth waiting for: what Ope will show, and how
 * close each piece is. Every count comes from the server, counted the way the
 * feature itself counts it — this only draws them.
 */
const LABELS: Record<string, TranslationKey> = {
  rough_range: 'msRoughRange',
  product_demand: 'msProductDemand',
  busy_hours: 'msBusyHours',
  full_forecast: 'msFullForecast',
}

interface Props {
  milestones: LearningMilestone[]
  daysLogged: number
  daysNeeded: number
  onGoToImport?: () => void
}

export default function LearningMilestones({ milestones, daysLogged, daysNeeded, onGoToImport }: Props) {
  const { t } = useLanguage()
  const pct = Math.min(100, Math.round((daysLogged / Math.max(1, daysNeeded)) * 100))
  return (
    <div className="mb-4 rounded-xl bg-teal-50/60 dark:bg-teal-900/15 border border-teal-100 dark:border-teal-900/40 px-4 py-4">
      <p className="text-sm font-semibold text-teal-800 dark:text-teal-200">{t('milestonesTitle')}</p>
      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
        {t('milestonesDays', { n: String(daysLogged), needed: String(daysNeeded) })}
      </p>
      <div
        className="mt-2 h-1.5 rounded-full bg-teal-100 dark:bg-slate-700 overflow-hidden"
        role="progressbar" aria-valuemin={0} aria-valuemax={daysNeeded} aria-valuenow={daysLogged}
        aria-label={t('milestonesDays', { n: String(daysLogged), needed: String(daysNeeded) })}
      >
        <div className="h-full bg-teal-500 dark:bg-teal-400 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 space-y-2">
        {milestones.filter(m => LABELS[m.key]).map(m => {
          const ready = m.have >= m.needed
          return (
            <li key={m.key} className="flex items-start gap-2.5 text-sm">
              <span aria-hidden="true"
                className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  ready ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-400 dark:border-slate-500'
                }`}>
                {ready && (
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                  </svg>
                )}
              </span>
              <span className="flex-1 text-slate-700 dark:text-slate-200 leading-snug">{t(LABELS[m.key])}</span>
              <span className={`shrink-0 text-xs ${ready ? 'font-semibold text-teal-700 dark:text-teal-300' : 'text-slate-600 dark:text-slate-400'}`}>
                {ready ? t('msReady') : t('msProgress', { have: String(m.have), needed: String(m.needed) })}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
        {t('milestonesImportHint')}{' '}
        {onGoToImport && (
          <button type="button" onClick={onGoToImport}
            className="font-semibold text-teal-700 dark:text-teal-300 underline underline-offset-2 min-h-6">
            {t('tabImport')}
          </button>
        )}
      </p>
    </div>
  )
}
