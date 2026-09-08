import { useState, type FormEvent, useId } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import logo from '../assets/logo.png'

export default function LoginPage() {
  const fieldId = useId()
  const { t } = useLanguage()
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signedUp, setSignedUp] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        // Only say "check your email" when there is actually an email coming.
        // This used to be set unconditionally and was right only by accident:
        // with the project auto-confirming signups, the session arrived first
        // and re-rendered the whole page before the message could be seen.
        const active = await signUp(email, password)
        if (!active) setSignedUp(true)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('loginFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode() {
    setMode(m => m === 'signin' ? 'signup' : 'signin')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-teal-50 dark:bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-teal-25 dark:bg-slate-800 rounded-2xl shadow-md w-full max-w-sm p-8">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          <img src={logo} alt="Ope logo" className="logo-img h-12 w-auto" />
          <div className="leading-tight">
            <span className="block text-2xl font-bold text-teal-700 dark:text-teal-300">Ope</span>
            <span className="block text-sm text-teal-700 dark:text-teal-300">{t('loginSlogan')}</span>
          </div>
        </div>

        {signedUp ? (
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">{t('loginCheckEmailTitle')}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
              {t('loginCheckEmailBody')}
            </p>
            <button
              className="text-teal-600 dark:text-teal-300 underline text-sm"
              onClick={() => { setSignedUp(false); setMode('signin') }}
            >
              {t('loginBackToSignIn')}
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-700 dark:text-slate-200 mb-6">
              {mode === 'signin' ? t('loginSignIn') : t('loginSignUp')}
            </h1>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1" htmlFor={`${fieldId}-f1`}>{t('loginEmailLabel')}</label>
                <input id={`${fieldId}-f1`}
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600
                             bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100
                             focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1" htmlFor={`${fieldId}-f2`}>{t('loginPasswordLabel')}</label>
                <input id={`${fieldId}-f2`}
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
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
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-semibold
                           hover:bg-teal-700 disabled:opacity-60 transition-colors"
              >
                {submitting ? t('loadingLabel') : mode === 'signin' ? t('loginSignIn') : t('loginSignUp')}
              </button>
            </form>

            {/* One whole sentence, not a fragment either side of a button:
                a split sentence cannot be reordered by a translator, and three
                of the fifteen languages read right to left. */}
            <p className="mt-6 text-center text-sm">
              <button onClick={switchMode} className="text-teal-600 dark:text-teal-300 font-medium underline">
                {mode === 'signin' ? t('loginNeedAccount') : t('loginHaveAccount')}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
