import { useState } from 'react'
import { feedback } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'

export default function FeedbackPanel() {
  const { t } = useLanguage()
  const [name, setName]       = useState('')
  const [biz,  setBiz]        = useState('')
  const [msg,  setMsg]        = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError(t('feedbackNameRequired')); return }
    if (!msg.trim())  { setError(t('feedbackMessageRequired')); return }
    setSending(true)
    setError(null)
    try {
      await feedback.submit({
        name: name.trim(),
        business_name: biz.trim() || '—',
        message: msg.trim(),
      })
      setDone(true)
    } catch {
      setError(t('feedbackError'))
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl px-4 py-5 text-center">
          <p className="text-2xl mb-1">✓</p>
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t('feedbackThankYou')}</p>
          <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">{t('feedbackThankYouMsg')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('feedbackTitle')}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 leading-relaxed">{t('feedbackDesc')}</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            {t('feedbackNameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('feedbackNameLabel')}
            maxLength={200}
            className="w-full border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5
                       text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700
                       focus:outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-slate-300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            {t('feedbackBusinessLabel')}
          </label>
          <input
            type="text"
            value={biz}
            onChange={e => setBiz(e.target.value)}
            placeholder={t('feedbackBusinessLabel')}
            maxLength={200}
            className="w-full border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5
                       text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700
                       focus:outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-slate-300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            {t('feedbackMessageLabel')}
          </label>
          <textarea
            value={msg}
            onChange={e => setMsg(e.target.value)}
            placeholder={t('feedbackMessagePlaceholder')}
            rows={4}
            maxLength={2000}
            className="w-full border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5
                       text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700
                       focus:outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-slate-300 resize-none"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={sending}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300
                     text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          {sending ? t('feedbackSending') : t('feedbackSendBtn')}
        </button>
      </form>
    </div>
  )
}
