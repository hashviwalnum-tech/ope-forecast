import { isApiError } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'

/**
 * The one honest failure state.
 *
 * Before this existed, a failed load looked like an empty account: an owner with
 * eight regulars was told "No regulars yet", and one with 311 logged days was
 * told "Keep logging days to see your forecast". Elsewhere the raw exception
 * reached the screen ("ApiError: boom"), or the copy asked a café owner whether
 * "the backend" was running.
 *
 * So: a failure says it is a failure, says the data is safe, and offers to try
 * again. An empty state is only ever shown when the server actually answered
 * and had nothing to give.
 */

/**
 * Plain words for a failed request. Never the exception text: a raw message is
 * either meaningless to the owner or, worse, reads like their data is gone.
 */
export function useErrorText(): (err: unknown) => string {
  const { t } = useLanguage()
  return (err: unknown) => {
    // A 4xx carries a message the API wrote for a person to read (FastAPI's
    // `detail`), so it is worth showing. Anything else is ours to explain.
    if (isApiError(err) && err.status >= 400 && err.status < 500 && err.message.trim() !== '') {
      return err.message
    }
    if (isApiError(err)) return t('loadFailedServerBody')
    return t('loadFailedBody')
  }
}

interface Props {
  /** Whatever was thrown. Never rendered directly. */
  error: unknown
  /** Runs the same load again. Omitted only where a retry is impossible. */
  onRetry?: () => void
  /** `inline` for a strip inside a card; `card` for a whole panel's body. */
  variant?: 'card' | 'inline'
}

export default function LoadError({ error, onRetry, variant = 'card' }: Props) {
  const { t } = useLanguage()
  const describe = useErrorText()
  const isServerFault = isApiError(error) && error.status >= 500
  const title = isServerFault ? t('loadFailedServerTitle') : t('loadFailedTitle')

  if (variant === 'inline') {
    return (
      <p role="status" className="text-sm text-slate-600 dark:text-slate-300 py-2">
        {describe(error)}{' '}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="underline underline-offset-2 text-teal-700 dark:text-teal-300 font-medium
                       min-h-11 px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            {t('tryAgainBtn')}
          </button>
        )}
      </p>
    )
  }

  return (
    <div
      role="status"
      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800
                 px-6 py-8 text-center space-y-2"
    >
      <p className="text-base font-semibold text-slate-700 dark:text-slate-100">{title}</p>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-sm mx-auto">
        {describe(error)}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">{t('loadFailedDataSafe')}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 px-6 min-h-11 rounded-xl bg-teal-600 text-white text-sm font-semibold
                     hover:bg-teal-700 transition-colors
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          {t('tryAgainBtn')}
        </button>
      )}
    </div>
  )
}
