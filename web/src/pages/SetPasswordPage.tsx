import { useState, type FormEvent, useId } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import logo from '../assets/logo.png'

/**
 * Where a recovery link lands.
 *
 * Supabase reads the token out of the URL and signs the person in before any of
 * our code runs, so by the time this renders they already have a session — they
 * just have no password they can remember. This is the only screen shown while
 * `recovering` is true, so nobody can wander into the app and leave the link
 * unspent.
 *
 * The phone sends people here too. A mobile deep link would need a scheme
 * registered with both stores and a build to test it on, which is a great deal
 * of setup for a screen someone sees once; the app tells them to set the
 * password in a browser and come back to sign in.
 */
export default function SetPasswordPage() {
  const fieldId = useId()
  const { t } = useLanguage()
  const { setPassword, signOut } = useAuth()
  const [password, setPasswordValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 6) {
      setError(t('signUpPasswordShort'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await setPassword(password)
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('loginFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-teal-50 dark:bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl shadow-md w-full max-w-sm p-8">

        <div className="flex items-center gap-3 mb-8">
          <img src={logo} alt="Ope logo" className="logo-img h-12 w-auto" />
          <div className="leading-tight">
            <span className="block text-2xl font-bold text-teal-700 dark:text-teal-300">Ope</span>
            <span className="block text-sm text-teal-700 dark:text-teal-300">{t('loginSlogan')}</span>
          </div>
        </div>

        {done ? (
          /* `setPassword` clears `recovering`, so the app is one render away.
             This exists so the change is acknowledged rather than the dashboard
             simply appearing. */
          <p className="text-center text-lg font-semibold text-slate-700 dark:text-slate-200">
            {t('pwNewDone')}
          </p>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-700 dark:text-slate-200 mb-6">
              {t('pwNewTitle')}
            </h1>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1"
                  htmlFor={`${fieldId}-pw`}
                >
                  {t('pwNewLabel')}
                </label>
                <input id={`${fieldId}-pw`}
                  type="password"
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPasswordValue(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-semibold
                           hover:bg-teal-700 disabled:opacity-60 transition-colors"
              >
                {saving ? t('savingLabel') : t('pwNewSave')}
              </button>
            </form>

            {/* A way out for someone who clicked the link by mistake, or on a
                machine that is not theirs. Signing out clears `recovering`. */}
            <p className="mt-6 text-center text-sm">
              <button
                onClick={() => void signOut()}
                className="text-teal-600 dark:text-teal-300 font-medium underline"
              >
                {t('loginBackToSignIn')}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
