/**
 * Sentences the server used to write in English, said in the owner's language.
 *
 * The backend still sends its English sentence (`detail`, `message`) — the
 * Telegram bot reads those — but beside it now sends a code and the numbers.
 * Everything here builds the sentence from those, so a Hebrew-speaking owner
 * stops reading "Your business is still open until 5 pm" in English.
 *
 * Pure: every function takes `t` and `lang`, so it is tested without React.
 * A copy of web/src/lib/serverText.ts without the nudge banner, which the
 * phone does not have — keep the two in step.
 * When a code is unknown the caller falls back to the server's English, which
 * is worse than a translation but better than nothing.
 */
import type { Lang, TranslationKey } from './i18n'

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

/** A calendar date ("2026-10-04") as the owner would say it: "Sunday, 4 October". */
export function sayDate(iso: string, lang: Lang, withWeekday = true): string {
  // Noon, so no timezone can tip the date into the previous or next day.
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(lang, {
      ...(withWeekday ? { weekday: 'long' } : {}), day: 'numeric', month: 'long',
    }).format(d)
  } catch {
    return iso
  }
}

/** An hour of the day (17) as the owner's language writes it: "5 PM", "17:00". */
export function sayHour(hour: number, lang: Lang): string {
  const d = new Date(2026, 0, 1, hour, 0, 0)
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(d)
  } catch {
    return `${hour}:00`
  }
}

const ERROR_KEYS: Record<string, TranslationKey> = {
  history_cap: 'errHistoryCap',
  future_date: 'errFutureDate',
  day_not_started: 'errDayNotStarted',
  still_open: 'errStillOpen',
  closed_day: 'errClosedDay',
  ads_limit: 'errAdsLimit',
  events_limit: 'errEventsLimit',
  locations_limit: 'errLocationsLimit',
  invalid_input: 'errInvalidInput',
}

/** The owner's-language version of a coded server refusal, or null if unknown. */
export function serverErrorText(
  code: string | undefined,
  params: Record<string, unknown> | undefined,
  t: Translate,
  lang: Lang,
): string | null {
  if (!code) return null
  const key = ERROR_KEYS[code]
  if (!key) return null
  const p = params ?? {}
  const vars: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number' && /hour$/.test(k)) vars[k] = sayHour(v, lang)
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) vars[k] = sayDate(v, lang, k === 'date')
    else if (typeof v === 'string' || typeof v === 'number') vars[k] = v
  }
  return t(key, vars)
}

export interface OutlierLike {
  date: string
  customers: number
  weekday_median: number
  direction: string
}

/** "Was Sunday, 4 October a special event?" — the unusual-day question. */
export function outlierText(flag: OutlierLike, t: Translate, lang: Lang): string {
  const vars = {
    date: sayDate(flag.date, lang),
    customers: new Intl.NumberFormat(lang).format(flag.customers),
    usual: new Intl.NumberFormat(lang).format(Math.round(flag.weekday_median)),
  }
  return t(flag.direction === 'high' ? 'outlierPromptHigh' : 'outlierPromptLow', vars)
}

/**
 * A "not enough data yet" sentence from the server, or undefined to use the
 * screen's own translated one. The server's is more specific ("5 of 14 days")
 * but only English; outside English the translated generic one is kinder than
 * a sentence the owner may not be able to read.
 */
export function serverSentence(message: string | null | undefined, lang: Lang): string | undefined {
  return lang === 'en' && message ? message : undefined
}
