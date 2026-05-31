import { useEffect, useState } from 'react'
import { businesses } from '../api/client'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

function hourLabel(h: number): string {
  if (h === 0)  return '12:00 midnight'
  if (h === 12) return '12:00 noon'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

export default function BusinessSettings() {
  const [openDays,     setOpenDays]     = useState<number[]>(ALL_DAYS)
  const [openingHour,  setOpeningHour]  = useState<number>(9)
  const [closingHour,  setClosingHour]  = useState<number>(22)
  const [saving,       setSaving]       = useState(false)
  const [feedback,     setFeedback]     = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    businesses.me().then(biz => {
      const s = biz.settings as Record<string, unknown>
      if (Array.isArray(s.opening_days))   setOpenDays(s.opening_days as number[])
      if (typeof s.opening_hour === 'number') setOpeningHour(s.opening_hour)
      if (typeof s.closing_hour === 'number') setClosingHour(s.closing_hour)
    }).catch(() => {})
  }, [])

  function toggleDay(d: number) {
    setOpenDays(prev =>
      prev.includes(d)
        ? prev.length > 1 ? prev.filter(x => x !== d) : prev  // keep at least 1
        : [...prev, d].sort((a, b) => a - b)
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (closingHour <= openingHour) {
      setFeedback({ ok: false, msg: 'Closing time must be after opening time.' })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      await businesses.updateSettings({
        opening_days: openDays,
        opening_hour: openingHour,
        closing_hour: closingHour,
      })
      setFeedback({ ok: true, msg: 'Settings saved!' })
    } catch {
      setFeedback({ ok: false, msg: 'Could not save — please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-8 max-w-sm">

      <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3 text-sm text-slate-600">
        These settings help Ope skip days you're closed and never treat a day
        you forgot to log as zero sales.
      </div>

      {/* Opening days */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-3">
          Which days are you open?
        </label>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map((name, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleDay(i)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                openDays.includes(i)
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-teal-300 hover:text-teal-700'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        {openDays.length === 1 && (
          <p className="text-xs text-amber-600 mt-2">At least one day must stay selected.</p>
        )}
      </div>

      {/* Opening hours */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          What are your opening hours?
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 w-16">Opens</span>
          <select
            value={openingHour}
            onChange={e => setOpeningHour(Number(e.target.value))}
            className="border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 w-16">Closes</span>
          <select
            value={closingHour}
            onChange={e => setClosingHour(Number(e.target.value))}
            className="border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>
      </div>

      {feedback && (
        <p className={`text-sm rounded-xl px-3 py-2.5 ${feedback.ok
          ? 'text-emerald-700 bg-emerald-50'
          : 'text-red-600 bg-red-50'}`}>
          {feedback.msg}
        </p>
      )}

      <button
        type="submit" disabled={saving}
        className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300
                   text-white font-medium py-3 rounded-xl transition-colors text-base"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}
