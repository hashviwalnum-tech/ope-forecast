/**
 * What day is it *for this business*?
 *
 * The backend has always answered that from `business.settings["timezone"]`
 * (see `app/clock.py`); the web client answered it from the device clock, and
 * six places answered it from `new Date().toISOString()`, which is UTC. So a
 * New York café at 8pm was already on tomorrow, and an Israeli owner at 1am was
 * still on yesterday — the screen and the server disagreed about which day a
 * sale belonged to.
 *
 * These are pure functions of (instant, timezone). Nothing here reads a global
 * clock of its own: the caller passes `now`, which is what makes the near-
 * midnight cases testable.
 */

/** The device's own IANA zone — the honest fallback when a business has none. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * The zone to use for a business.
 *
 * An unset or unusable zone falls back to the device's, NOT to UTC: the backend
 * falls back to UTC, but a client that silently jumped to UTC would move an
 * owner's "today" by hours the moment we shipped. Settings offers the zone so
 * the two can be brought into line deliberately.
 */
export function resolveTimeZone(settings: Record<string, unknown> | null | undefined): string {
  const tz = settings?.timezone
  if (typeof tz === 'string' && tz.trim() !== '' && isValidTimeZone(tz.trim())) return tz.trim()
  return deviceTimeZone()
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

interface ZonedParts {
  year: number
  month: number   // 1–12
  day: number     // 1–31
  hour: number    // 0–23
  minute: number
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23',
    })
    partsCache.set(tz, f)
  }
  return f
}

/** Wall-clock parts of `now` as read in `tz`. */
export function zonedParts(now: Date, tz: string): ZonedParts {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = formatterFor(tz).formatToParts(now)
  } catch {
    // An unknown zone must never throw its way onto the screen — same rule the
    // backend applies in clock.now_local().
    parts = formatterFor('UTC').formatToParts(now)
  }
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some runtimes render midnight as hour "24" under h23; normalise it.
    hour: get('hour') % 24,
    minute: get('minute'),
  }
}

function iso(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** The business's own today, as `YYYY-MM-DD`. */
export function isoDateIn(now: Date, tz: string): string {
  return iso(zonedParts(now, tz))
}

/** The hour (0–23) on the business's own wall clock. */
export function hourIn(now: Date, tz: string): number {
  return zonedParts(now, tz).hour
}

/** Move an ISO date by whole days, without ever touching a timezone. */
export function shiftIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + days)
  return iso({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() })
}

/** Weekday of an ISO date as the app numbers them: 0 = Monday … 6 = Sunday. */
export function weekdayMon0(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay()   // 0 = Sunday
  return (jsDay + 6) % 7
}

/** True when `isoDate` is a day the business is not open. */
export function isNonWorkingDay(
  isoDate: string,
  settings: Record<string, unknown> | null | undefined,
): boolean {
  const days = settings?.opening_days
  if (!Array.isArray(days) || days.length === 0) return false
  return !days.includes(weekdayMon0(isoDate))
}

/** The business's own now, in minutes since its midnight — for hour comparisons. */
export function minutesIntoDay(now: Date, tz: string): number {
  const p = zonedParts(now, tz)
  return p.hour * 60 + p.minute
}
