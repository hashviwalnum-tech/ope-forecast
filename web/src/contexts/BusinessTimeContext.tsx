import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  hourIn, isNonWorkingDay as isNonWorkingDayFor, isoDateIn, minutesIntoDay,
  resolveTimeZone, shiftIso,
} from '../lib/businessTime'

/**
 * The business's own clock, for the whole client.
 *
 * Same shape as CurrencyProvider, and for the same reason: "today" is a
 * function of a setting that lives on the business, and every place that
 * answered it from `new Date()` answered it differently from the server. A
 * component now asks `today` and cannot get it wrong.
 *
 * The value refreshes every 30 seconds so a screen left open across closing
 * time, or across midnight, corrects itself without a reload.
 */
interface BusinessTimeValue {
  /** IANA zone actually in use — the business's, or the device's if unset. */
  timeZone: string
  /** True when the business has a zone of its own, rather than us falling back. */
  isConfigured: boolean
  /** The business's own today, `YYYY-MM-DD`. */
  today: string
  /** The day before it. */
  yesterday: string
  /** Hour 0–23 on the business's wall clock. */
  hour: number
  /** Minutes since the business's midnight. */
  minutesNow: number
  /** True while the shop is still open (before closing_hour), when known. */
  beforeClosing: boolean
  /** True before the shop opens (before opening_hour), when known. */
  beforeOpening: boolean
  /** Is this ISO date a day the business is closed? */
  isNonWorkingDay: (isoDate: string) => boolean
  /** Move an ISO date by whole days. */
  shiftDays: (isoDate: string, days: number) => string
}

const BusinessTimeContext = createContext<BusinessTimeValue | null>(null)

export function BusinessTimeProvider({
  settings, children,
}: {
  settings: Record<string, unknown> | null | undefined
  children: React.ReactNode
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const value = useMemo<BusinessTimeValue>(() => {
    const timeZone = resolveTimeZone(settings)
    const configured = typeof settings?.timezone === 'string' && (settings.timezone as string).trim() !== ''
    const now = new Date(nowMs)
    const today = isoDateIn(now, timeZone)
    const hour = hourIn(now, timeZone)
    const closing = settings?.closing_hour
    const opening = settings?.opening_hour
    return {
      timeZone,
      isConfigured: configured,
      today,
      yesterday: shiftIso(today, -1),
      hour,
      minutesNow: minutesIntoDay(now, timeZone),
      beforeClosing: typeof closing === 'number' ? hour < closing : false,
      beforeOpening: typeof opening === 'number' ? hour < opening : false,
      isNonWorkingDay: (isoDate: string) => isNonWorkingDayFor(isoDate, settings),
      shiftDays: shiftIso,
    }
  }, [settings, nowMs])

  return <BusinessTimeContext.Provider value={value}>{children}</BusinessTimeContext.Provider>
}

export function useBusinessTime(): BusinessTimeValue {
  const ctx = useContext(BusinessTimeContext)
  if (!ctx) throw new Error('useBusinessTime must be used inside a BusinessTimeProvider')
  return ctx
}
