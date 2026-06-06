import { useEffect, useState } from 'react'
import { telegram } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'

export default function TelegramConnectPanel() {
  const { t } = useLanguage()
  const [linked, setLinked]       = useState(false)
  const [chatId, setChatId]       = useState<string | null>(null)
  const [pending, setPending]     = useState(false)
  const [code, setCode]           = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [working, setWorking]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    telegram.getStatus()
      .then(s => {
        setLinked(s.linked)
        setChatId(s.chat_id ?? null)
        setPending(s.has_pending_code)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleGenerate() {
    setWorking(true)
    setError(null)
    try {
      const res = await telegram.generateCode()
      setCode(res.code)
      setPending(true)
    } catch {
      setError(t('telegramGenerateError'))
    } finally {
      setWorking(false)
    }
  }

  async function handleRevoke() {
    if (!confirm(t('telegramRevokeConfirm'))) return
    setWorking(true)
    setError(null)
    try {
      await telegram.revoke()
      setLinked(false)
      setChatId(null)
      setPending(false)
      setCode(null)
    } catch {
      setError(t('telegramRevokeError'))
    } finally {
      setWorking(false)
    }
  }

  if (loading) return null

  return (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-6 space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
          {t('telegramLabel')}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
          {t('telegramDesc')}
        </p>
      </div>

      {linked ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300
                          bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2.5">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{t('telegramLinked', { id: chatId ?? '' })}</span>
          </div>

          {/* Regenerate a code to re-link (e.g. different chat) */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={working}
              onClick={handleGenerate}
              className="flex-1 py-2 rounded-xl text-sm font-medium border border-slate-200
                         dark:border-slate-600 text-slate-600 dark:text-slate-300
                         hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-300
                         disabled:opacity-50 transition-colors"
            >
              {t('telegramRelink')}
            </button>
            <button
              type="button"
              disabled={working}
              onClick={handleRevoke}
              className="flex-1 py-2 rounded-xl text-sm font-medium border border-red-200
                         dark:border-red-800 text-red-600 dark:text-red-400
                         hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
            >
              {t('telegramRevoke')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!pending && (
            <button
              type="button"
              disabled={working}
              onClick={handleGenerate}
              className="w-full py-2.5 rounded-xl text-sm font-medium border border-teal-300
                         text-teal-700 dark:text-teal-300 dark:border-teal-700
                         hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-50 transition-colors"
            >
              {working ? t('telegramGenerating') : t('telegramGenerate')}
            </button>
          )}
        </div>
      )}

      {/* Display the generated code with copy & instructions */}
      {code && (
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('telegramCodeInstructions')}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600
                              rounded-lg px-3 py-2 text-sm font-mono text-slate-800 dark:text-slate-100 break-all">
              /link {code}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(`/link ${code}`)}
              title={t('copyToClipboard')}
              className="shrink-0 p-2 rounded-lg border border-slate-200 dark:border-slate-600
                         text-slate-500 hover:text-teal-600 hover:border-teal-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('telegramCodeExpiry')}
          </p>
          {!linked && (
            <button
              type="button"
              disabled={working}
              onClick={handleGenerate}
              className="text-xs text-teal-600 dark:text-teal-400 underline underline-offset-2
                         hover:no-underline disabled:opacity-50"
            >
              {t('telegramRefreshCode')}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}
    </div>
  )
}
