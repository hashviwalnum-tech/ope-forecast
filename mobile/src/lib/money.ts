// Formatting and reading money, in the business's currency and the owner's
// language.
//
// It was neither before: the regulars screen formatted as US dollars, the
// planning toolbox hardcoded a euro sign, and there was no currency setting
// anywhere — so the same owner saw "$120" on one screen and "€120" on the next,
// and an Israeli café never saw ₪ at all.
//
// Two rules everything here follows:
//
//  1. The CURRENCY comes from the business, never from a constant and never
//     from the browser. Two owners on one laptop must each see their own.
//  2. The NUMBER OF DECIMAL PLACES comes from the currency, never from a
//     hardcoded 2. The yen and won have none (¥1200, not ¥1200.00) and the
//     Gulf dinars have three. `Intl.NumberFormat` already knows this for every
//     ISO 4217 code, so the correct behaviour is to let it decide rather than
//     pass a fraction-digit count of our own.
//
// The LANGUAGE comes from the owner's choice in Ope, not `navigator.language`:
// an owner who switched Ope to English was still reading Hebrew-marked numbers.
//
// MOBILE COPY. Kept in step with web/src/lib/money.ts by hand — the two apps
// have no shared package yet (spec §4 leaves that as "where practical").
//
// Every function here already falls back rather than throwing, which matters
// more on a phone than in a browser: React Native's Hermes engine ships a
// reduced Intl, and on some Android builds `style: 'currency'` or a given
// locale may be unavailable. When that happens these degrade to a readable
// "USD 12.50" instead of blanking the screen.

/** Used only when a business has not chosen yet. Never assumed to be right. */
export const FALLBACK_CURRENCY = 'USD'

/**
 * Decimal places this currency is written with, straight from the runtime's
 * own ISO 4217 data — 0 for JPY, 2 for USD, 3 for KWD.
 */
export function minorUnits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency })
      .resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/**
 * Format an amount as money.
 *
 * Deliberately passes no fraction-digit options: that is what makes ¥1200
 * come out as ¥1200 and KWD 1.234 as three places, instead of everything
 * being forced to two.
 */
export function formatMoney(value: number, currency: string, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency }).format(value)
  } catch {
    // An unknown code or an odd locale tag must not blank out a screen.
    return `${currency} ${value.toFixed(minorUnits(currency))}`
  }
}

/**
 * Format with an explicit sign, for figures whose direction is the point.
 *
 * The toolbox printed the downside of over-ordering with a hardcoded minus in
 * one place and none in another, so a number that was still a profit appeared
 * bare inside a red "this is the downside" panel and read as a loss.
 */
export function formatSignedMoney(value: number, currency: string, lang: string): string {
  const formatted = formatMoney(Math.abs(value), currency, lang)
  if (value > 0) return `+${formatted}`
  if (value < 0) return `−${formatted}`
  return formatted
}

/**
 * Format without the currency mark, for a column that is already headed with
 * one. Still uses the currency's decimal places, not two.
 */
export function formatAmount(value: number, currency: string, lang: string): string {
  const digits = minorUnits(currency)
  try {
    return new Intl.NumberFormat(lang, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  } catch {
    return value.toFixed(digits)
  }
}

/**
 * The currency's symbol on its own, for use as an input prefix.
 *
 * Extracted from a formatted number rather than kept in a table of our own,
 * so it is whatever the owner's language actually calls it — "US$" in some
 * locales, "$" in others.
 */
export function currencySymbol(currency: string, lang: string): string {
  try {
    const parts = new Intl.NumberFormat(lang, { style: 'currency', currency })
      .formatToParts(0)
    return parts.find(p => p.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

/**
 * The step a money input should move in: 1 for yen, 0.01 for dollars, 0.001
 * for dinars. Hardcoding "0.01" would let someone type ¥1200.50.
 */
export function amountStep(currency: string): number {
  return 1 / 10 ** minorUnits(currency)
}

/**
 * Read a number a person typed, in their own language's conventions.
 *
 * `parseFloat` only understands a dot. Most of the languages Ope speaks write
 * "0,5", and French groups thousands with a space — so `parseFloat('0,5')`
 * returns 0 and `parseFloat('1 234')` returns 1. Typed into a price field
 * that is a silently wrong number, not a rejected one.
 *
 * Returns null for anything that is not a number, so callers can tell "empty
 * or nonsense" from "zero" — the old code returned 0 for both.
 */
export function parseLocaleNumber(input: string, lang: string): number | null {
  // Keep only digits, a leading sign, and the two characters that can act as
  // separators. This also drops currency marks and every flavour of space —
  // French groups thousands with a non-breaking space, which `parseFloat`
  // treats as the end of the number.
  const kept = input.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(kept)) return null

  const negative = /^-/.test(kept.trim())
  const digitsAndSeps = kept.replace(/-/g, '')

  const lastDot = digitsAndSeps.lastIndexOf('.')
  const lastComma = digitsAndSeps.lastIndexOf(',')

  let decimalSep: string | null = null
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present, so one groups and one marks the decimal: whichever comes
    // last is the decimal point. "1.234,5" is 1234.5; "1,234.5" is also 1234.5.
    decimalSep = lastDot > lastComma ? '.' : ','
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ','
    const occurrences = digitsAndSeps.split(sep).length - 1
    const trailingDigits = digitsAndSeps.length - digitsAndSeps.lastIndexOf(sep) - 1
    if (occurrences > 1) {
      decimalSep = null                      // "1.234.567" — grouping
    } else if (trailingDigits === 3) {
      // Genuinely ambiguous: "1,234" is a thousand in English and 1.234 in
      // German. Only the owner's language can break the tie.
      decimalSep = sep === separatorsFor(lang).decimal ? sep : null
    } else {
      decimalSep = sep                       // "0,5" or "12.75" — a decimal
    }
  }

  const normalised = decimalSep === null
    ? digitsAndSeps.replace(/[.,]/g, '')
    : digitsAndSeps
        .replace(new RegExp(`[.,]`, 'g'), ch => (ch === decimalSep ? '.' : ''))

  const n = Number(normalised)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/** What this language uses to mark the decimal point and group thousands. */
export function separatorsFor(lang: string): { decimal: string; group: string } {
  try {
    const parts = new Intl.NumberFormat(lang).formatToParts(1234567.8)
    return {
      decimal: parts.find(p => p.type === 'decimal')?.value ?? '.',
      group: parts.find(p => p.type === 'group')?.value ?? ',',
    }
  } catch {
    return { decimal: '.', group: ',' }
  }
}
