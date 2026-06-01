import { useState } from 'react'
import ForecastDashboard from './ForecastDashboard'
import HourlyDashboard from './HourlyDashboard'
import LogDayForm from './LogDayForm'
import TapSellPanel from './TapSellPanel'

interface Props {
  refreshKey: number
  onSaved: () => void
}

export default function HomeScreen({ refreshKey, onSaved }: Props) {
  const [showSell, setShowSell] = useState(false)
  const [showLog, setShowLog]   = useState(false)

  function handleSaved() {
    setShowLog(false)
    onSaved()
  }

  return (
    <div className="space-y-10">

      {/* This week */}
      <section>
        <h2 className="text-base font-semibold text-slate-500 uppercase tracking-wide mb-4">
          This week
        </h2>
        <ForecastDashboard refreshKey={refreshKey} />
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="text-base font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-3 mb-4">
          <button
            onClick={() => { setShowSell(s => !s); setShowLog(false) }}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold
                        transition-colors shadow-sm ${
              showSell
                ? 'bg-teal-700 text-white'
                : 'bg-teal-600 text-white hover:bg-teal-700'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 4v16m8-8H4" />
            </svg>
            Record a Sale
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${showSell ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            onClick={() => { setShowLog(l => !l); setShowSell(false) }}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold
                        transition-colors border ${
              showLog
                ? 'bg-teal-50 border-teal-300 text-teal-700'
                : 'bg-white border-slate-200 text-slate-700 hover:border-teal-200 hover:bg-teal-50'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Log Today
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${showLog ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {showSell && (
          <div className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
            <TapSellPanel />
          </div>
        )}
        {showLog && (
          <div className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
            <LogDayForm onSaved={handleSaved} />
          </div>
        )}
      </section>

      {/* Busy hours today */}
      <section>
        <h2 className="text-base font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Busy hours today
        </h2>
        <HourlyDashboard />
      </section>

    </div>
  )
}
