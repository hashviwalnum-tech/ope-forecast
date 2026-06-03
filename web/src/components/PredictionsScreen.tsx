import { OrderingPanel, WeekPredictionPanel } from './ForecastDashboard'
import HourlyDashboard from './HourlyDashboard'
import MergedForecastPanel from './MergedForecastPanel'

interface Props {
  refreshKey: number
}

/**
 * Fixed copy of the default home layout — shows all analytics cards in their
 * original order regardless of the owner's home customization.
 * This tab preserves the full view so customizing home never loses anything.
 */
export default function PredictionsScreen({ refreshKey }: Props) {
  return (
    <div className="space-y-8">
      <OrderingPanel refreshKey={refreshKey} />
      <MergedForecastPanel refreshKey={refreshKey} />
      <WeekPredictionPanel refreshKey={refreshKey} />
      <section>
        <h2 className="text-base font-semibold text-teal-700/70 uppercase tracking-wide mb-4">
          Busy hours
        </h2>
        <HourlyDashboard />
      </section>
    </div>
  )
}
