import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  hourIn, isNonWorkingDay as isNonWorkingDayFor, isoDateIn, minutesIntoDay,
  resolveTimeZone, shiftIso,
} from '../lib/businessTime'
import { useBusiness } from './BusinessContext'

/**
 * The business's own clock, for the whole app. Port of the web context, using
 * the same pure helpers in `lib/businessTime.ts`, so the two clients cannot
 * drift apart.
 *
 * Four screens each carried their own `todayStr()` built from `new Date()` on
 * the device. They agreed with the backend only because the device zone had
 * been adopted as the business zone — travel with the phone, or set a business
 * zone that differs from it, and the screen and the server disagree about which
 * day a sale belongs to. That is the same bug already fixed in the backend and
 * then again on the web; this is the last copy of it.
 *
 * The value refreshes every 30 seconds, so an app left open across midnight or
 * across closing time corrects itself without a restart.
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

export function BusinessTimeProvider({ children }: { children: React.ReactNode }) {
  const { business } = useBusiness()
  const settings = business?.settings as Record<string, unknown> | undefined
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
