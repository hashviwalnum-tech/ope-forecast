import { OrderingPanel } from './ForecastDashboard'
import HourlyDashboard from './HourlyDashboard'
import MergedForecastPanel from './MergedForecastPanel'
import { useLanguage } from '../contexts/LanguageContext'

interface Props {
  refreshKey: number
}

export default function PredictionsScreen({ refreshKey }: Props) {
  const { t } = useLanguage()
  return (
    <div className="space-y-8">
      <OrderingPanel refreshKey={refreshKey} />
      <MergedForecastPanel refreshKey={refreshKey} />
      <section>
        <h2 className="text-base font-semibold text-teal-700/70 dark:text-teal-400/70 uppercase tracking-wide mb-4">
          {t('busyHoursLabel')}
        </h2>
        <HourlyDashboard />
      </section>
    </div>
  )
}
