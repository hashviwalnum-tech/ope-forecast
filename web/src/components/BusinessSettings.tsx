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
  const [openDays,       setOpenDays]       = useState<number[]>(ALL_DAYS)
  const [openingHour,    setOpeningHour]    = useState<number>(9)
  const [closingHour,    setClosingHour]    = useState<number>(22)
  const [avgServiceTime, setAvgServiceTime] = useState<number>(5)
  const [saving,         setSaving]         = useState(false)
  const [feedback,       setFeedback]       = useState<{ ok: boolean; msg: string } | null>(null)

  const [currentTier,   setCurrentTier]   = useState<string>('free')
  const [tierSaving,    setTierSaving]    = useState(false)
  const [tierFeedback,  setTierFeedback]  = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    businesses.me().then(biz => {
      const s = biz.settings as Record<string, unknown>
      if (Array.isArray(s.opening_days))             setOpenDays(s.opening_days as number[])
      if (typeof s.opening_hour === 'number')        setOpeningHour(s.opening_hour)
      if (typeof s.closing_hour === 'number')        setClosingHour(s.closing_hour)
      if (typeof s.avg_service_time_minutes === 'number') setAvgServiceTime(s.avg_service_time_minutes)
      setCurrentTier(biz.tier ?? 'free')
    }).catch(() => {})
  }, [])

  async function handleSetTier(tier: 'free' | 'premium') {
    setTierSaving(true)
    setTierFeedback(null)
    try {
      const biz = await businesses.setTier(tier)
      setCurrentTier(biz.tier)
      setTierFeedback({ ok: true, msg: `Switched to ${biz.tier} plan.` })
    } catch {
      setTierFeedback({ ok: false, msg: 'Could not change plan — please try again.' })
    } finally {
      setTierSaving(false)
    }
  }

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
        avg_service_time_minutes: avgServiceTime,
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

      {/* Average service time */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Average minutes to serve one customer
        </label>
        <p className="text-xs text-slate-400 mb-3 leading-relaxed">
          Used to calculate staffing recommendations in <strong>Busy Hours</strong>.
          A quick counter might be 2–3 min; a sit-down appointment might be 20–30 min.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={120}
            value={avgServiceTime}
            onChange={e => setAvgServiceTime(Math.max(1, Number(e.target.value)))}
            className="w-24 px-3 py-2.5 border border-slate-300 rounded-xl text-slate-900
                       text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 tabular-nums"
          />
          <span className="text-sm text-slate-500">minutes per customer</span>
        </div>
      </div>

      {feedback && (
        <p className={`text-sm rounded-xl px-3 py-2.5 ${feedback.ok
          ? 'text-emerald-700 bg-emerald-50'
          : 'text-red-700 bg-red-50'}`}>
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

      {/* ── Plan / tier ─────────────────────────────────────────────── */}
      <div className="border-t border-slate-100 pt-6">
        <p className="text-sm font-medium text-slate-700 mb-1">Your plan</p>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          {currentTier === 'premium'
            ? 'Premium — unlimited history and ads/events.'
            : 'Free — up to 1 year of history, up to 2 saved ads or events. All features included.'}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={tierSaving || currentTier === 'free'}
            onClick={() => handleSetTier('free')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors
              ${currentTier === 'free'
                ? 'bg-teal-600 text-white border-teal-600'
                : 'border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-700'}`}
          >
            Free
          </button>
          <button
            type="button"
            disabled={tierSaving || currentTier === 'premium'}
            onClick={() => handleSetTier('premium')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors
              ${currentTier === 'premium'
                ? 'bg-teal-600 text-white border-teal-600'
                : 'border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-700'}`}
          >
            Premium
          </button>
        </div>

        {tierFeedback && (
          <p className={`mt-3 text-sm rounded-xl px-3 py-2.5 ${tierFeedback.ok
            ? 'text-emerald-700 bg-emerald-50'
            : 'text-red-700 bg-red-50'}`}>
            {tierFeedback.msg}
          </p>
        )}
      </div>
    </form>
  )
}
