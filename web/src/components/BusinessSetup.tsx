import { useState, type FormEvent } from 'react'
import * as api from '../api/client'
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
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // copy-from flow
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
    <div className="min-h-screen bg-teal-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-sm p-8">

        {atLimit ? (
          <>
            <h1 className="text-xl font-semibold text-slate-700 mb-2">One location on the free plan</h1>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              Your free plan includes one location. Upgrade to premium in{' '}
              <strong>Manage → Settings</strong> to add more.
            </p>
            {onCancel && (
              <button
                onClick={onCancel}
                className="w-full py-3 rounded-xl border border-slate-200 text-slate-600
                           text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                Go back
              </button>
            )}
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-700 mb-2">
              {isAdditional ? 'Add a location' : 'Welcome to Ope!'}
            </h1>
            <p className="text-sm text-slate-500 mb-6">
              {isAdditional
                ? 'Give your new location a name to get started.'
                : "Let's get started. What's your business called?"}
            </p>

            {showCopyOption && (
              <div className="mb-5 rounded-xl border border-teal-100 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMode('fresh')}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                    mode === 'fresh' ? 'bg-teal-50 text-teal-700' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    mode === 'fresh' ? 'border-teal-600' : 'border-slate-300'
                  }`}>
                    {mode === 'fresh' && <span className="w-2 h-2 rounded-full bg-teal-600" />}
                  </span>
                  <div>
                    <span className="font-medium">Start fresh</span>
                    <span className="block text-xs text-slate-400 mt-0.5">Empty location, no products or settings</span>
                  </div>
                </button>

                <div className={`border-t border-teal-100 transition-colors ${
                  mode === 'copy' ? 'bg-teal-50' : 'bg-white hover:bg-slate-50'
                }`}>
                  <button
                    type="button"
                    onClick={() => setMode('copy')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm"
                  >
                    <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      mode === 'copy' ? 'border-teal-600' : 'border-slate-300'
                    }`}>
                      {mode === 'copy' && <span className="w-2 h-2 rounded-full bg-teal-600" />}
                    </span>
                    <div>
                      <span className={`font-medium ${mode === 'copy' ? 'text-teal-700' : 'text-slate-600'}`}>
                        Copy settings & products
                      </span>
                      <span className="block text-xs text-slate-400 mt-0.5">
                        Same hours, open days, and product list — no history copied
                      </span>
                    </div>
                  </button>

                  {mode === 'copy' && (
                    <div className="px-4 pb-3">
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">
                        Copy from which location?
                      </label>
                      <select
                        value={copySourceId}
                        onChange={e => setCopySourceId(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800
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
                placeholder={isAdditional ? 'Second Location, North Branch, …' : 'Corner Café, My Salon, …'}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800
                           focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              {error && (
                <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-semibold
                           hover:bg-teal-700 disabled:opacity-60 transition-colors"
              >
                {submitting
                  ? (mode === 'copy' ? 'Copying…' : 'Setting up…')
                  : isAdditional ? 'Add location' : 'Get started'}
              </button>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-full py-3 rounded-xl border border-slate-200 text-slate-600
                             text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  )
}
