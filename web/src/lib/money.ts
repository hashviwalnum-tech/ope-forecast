// One place that decides how money is written.
//
// It was not one place before: the regulars screen formatted as US dollars,
// the planning toolbox hardcoded a euro sign, and the ordering screens did
// their own thing again — so the same owner saw "$120" on one screen and
// "€120" on the next.
//
// KNOWN GAP: there is no currency setting anywhere in Ope — not on the
// business, not in settings, not in the API. Until there is, everything uses
// the constant below, which at least makes the app internally consistent and
// leaves exactly one line to change. Ope is launching in Israel (spec §10
// prices in ₪), so this needs a real per-business setting before real owners
// type prices into it.

/** The currency every screen formats in, until businesses can choose one. */
export const CURRENCY = 'USD'

/**
 * Format an amount in the language the owner PICKED in Ope, not the one their
 * browser happens to be set to — passing `undefined` follows the browser, so
 * an owner who had switched Ope to English still read Hebrew-marked currency.
 */
export function formatMoney(value: number, lang: string, fractionDigits = 2): string {
  return new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/**
 * Format with an explicit sign, for figures whose direction is the point.
 *
 * The toolbox printed the downside of over-ordering with a hardcoded minus in
 * one place and none in another, so a number that was still a profit appeared
 * bare inside a red "this is the downside" panel and read as a loss.
 */
export function formatSignedMoney(value: number, lang: string, fractionDigits = 2): string {
  const formatted = formatMoney(Math.abs(value), lang, fractionDigits)
  if (value > 0) return `+${formatted}`
  if (value < 0) return `−${formatted}`
  return formatted
}

/** Just the currency symbol, for use as an input prefix. */
export function currencySymbol(lang: string): string {
  const parts = new Intl.NumberFormat(lang, { style: 'currency', currency: CURRENCY })
    .formatToParts(0)
  return parts.find(p => p.type === 'currency')?.value ?? '$'
}
