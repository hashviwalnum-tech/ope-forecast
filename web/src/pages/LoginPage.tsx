import { useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import logo from '../assets/logo.png'

export default function LoginPage() {
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
        await signUp(email, password)
        setSignedUp(true)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode() {
    setMode(m => m === 'signin' ? 'signup' : 'signin')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-teal-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-sm p-8">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          <img src={logo} alt="Ope logo" className="h-12 w-auto" />
          <div className="leading-tight">
            <span className="block text-2xl font-bold text-teal-700">Ope</span>
            <span className="block text-sm text-teal-500">Know Tomorrow, Today.</span>
          </div>
        </div>

        {signedUp ? (
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-700 mb-2">Check your email</p>
            <p className="text-sm text-slate-500 mb-6">
              We sent you a confirmation link. Click it, then come back to sign in.
            </p>
            <button
              className="text-teal-600 underline text-sm"
              onClick={() => { setSignedUp(false); setMode('signin') }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-700 mb-6">
              {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
            </h1>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800
                             focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800
                             focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-semibold
                           hover:bg-teal-700 disabled:opacity-60 transition-colors"
              >
                {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button onClick={switchMode} className="text-teal-600 font-medium underline">
                {mode === 'signin' ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
