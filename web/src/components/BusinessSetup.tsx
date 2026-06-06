import { useState, type FormEvent } from 'react'
import * as api from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { BusinessRead } from '../api/types'

interface Props {
  onCreated: (biz: BusinessRead) => void
  isAdditional?: boolean
  existingCount?: number
  limit?: number
  isPremium?: boolean
  existingBusinesses?: BusinessRead[]
  onCancel?: () => void
}

export default function BusinessSetup({
  onCreated,
  isAdditional = false,
  existingCount = 0,
  limit = 1,
  isPremium = false,
  existingBusinesses = [],
  onCancel,
}: Props) {
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showCopyOption = isAdditional && isPremium && existingBusinesses.length > 0
  const [mode, setMode] = useState<'fresh' | 'copy'>('fresh')
  const [copySourceId, setCopySourceId] = useState<number>(existingBusinesses[0]?.id ?? 0)

  const atLimit = !isPremium && existingCount >= limit

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      let biz: BusinessRead
      if (mode === 'copy' && copySourceId) {
        biz = await api.businesses.copyFrom(copySourceId, name.trim())
      } else {
        biz = await api.businesses.create(name.trim())
      }
      onCreated(biz)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-teal-50 dark:bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl shadow-md w-full max-w-sm p-8">

        {atLimit ? (
          <>
            <h1 className="text-xl font-semibold text-slate-700 dark:text-slate-100 mb-2">
              {t('oneFreeLocation')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
              {t('freePlanOneLocMsg')}
            </p>
            {onCancel && (
              <button
                onClick={onCancel}
                className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-600
                           text-slate-600 dark:text-slate-300
                           text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {t('goBack')}
              </button>
            )}
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-700 dark:text-slate-100 mb-2">
              {isAdditional ? t('addLocation') : t('welcomeTitle')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              {isAdditional ? t('locationNameHint') : t('businessNameHint')}
            </p>

            {showCopyOption && (
              <div className="mb-5 rounded-xl border border-teal-100 dark:border-teal-800 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMode('fresh')}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                    mode === 'fresh'
                      ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'
                      : 'bg-teal-25 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    mode === 'fresh' ? 'border-teal-600' : 'border-slate-300 dark:border-slate-500'
                  }`}>
                    {mode === 'fresh' && <span className="w-2 h-2 rounded-full bg-teal-600" />}
                  </span>
                  <div>
                    <span className="font-medium">{t('startFreshLabel')}</span>
                    <span className="block text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t('startFreshDesc')}</span>
                  </div>
                </button>

                <div className={`border-t border-teal-100 dark:border-teal-800 transition-colors ${
                  mode === 'copy' ? 'bg-teal-50 dark:bg-teal-900/30' : 'bg-teal-25 dark:bg-slate-800 hover:bg-teal-50 dark:hover:bg-slate-700'
                }`}>
                  <button
                    type="button"
                    onClick={() => setMode('copy')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm"
                  >
                    <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      mode === 'copy' ? 'border-teal-600' : 'border-slate-300 dark:border-slate-500'
                    }`}>
                      {mode === 'copy' && <span className="w-2 h-2 rounded-full bg-teal-600" />}
                    </span>
                    <div>
                      <span className={`font-medium ${mode === 'copy' ? 'text-teal-700 dark:text-teal-300' : 'text-slate-600 dark:text-slate-300'}`}>
                        {t('copySettingsTitle')}
                      </span>
                      <span className="block text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {t('copySettingsDesc')}
                      </span>
                    </div>
                  </button>

                  {mode === 'copy' && (
                    <div className="px-4 pb-3">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                        {t('copyFromWhich')}
                      </label>
                      <select
                        value={copySourceId}
                        onChange={e => setCopySourceId(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm
                                   text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700
                                   focus:outline-none focus:ring-2 focus:ring-teal-400"
                      >
                        {existingBusinesses.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isAdditional ? t('locationNamePlaceholder') : t('businessNamePlaceholder')}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600
                           text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-700
                           focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              {error && (
                <p className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-semibold
                           hover:bg-teal-700 disabled:opacity-60 transition-colors"
              >
                {submitting
                  ? (mode === 'copy' ? t('copying') : t('settingUp'))
                  : isAdditional ? t('addLocationBtn') : t('getStartedBtn')}
              </button>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-600
                             text-slate-600 dark:text-slate-300
                             text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {t('cancelBtn')}
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  )
}
