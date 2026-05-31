import { useState, type FormEvent } from 'react'
import * as api from '../api/client'

interface Props {
  onCreated: () => void
}

export default function BusinessSetup({ onCreated }: Props) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await api.businesses.create(name.trim())
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-teal-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-700 mb-2">Welcome to Ope!</h1>
        <p className="text-sm text-slate-500 mb-6">
          Let's get started. What's your business called?
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Corner Café, My Salon, …"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800
                       focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full py-3 rounded-xl bg-teal-600 text-white font-semibold
                       hover:bg-teal-700 disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Setting up…' : 'Get started'}
          </button>
        </form>
      </div>
    </div>
  )
}
