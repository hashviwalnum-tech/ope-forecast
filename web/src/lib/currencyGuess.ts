// Guessing a business's currency from the browser.
//
// Kept out of the picker component so the table is plain data that can be
// tested directly, and so the component file exports only a component.

/**
 * Guess a currency from the browser, as a SUGGESTION only.
 *
 * The owner always confirms. A guess is worth making — most people are in the
 * country their machine says they are — but it is never applied on its own,
 * because getting it wrong silently means every price they type afterwards is
 * mislabelled.
 *
 * Returns null rather than a default when there is nothing to go on, so the
 * caller can tell "we think it's this" from "we have no idea".
 */
export function guessCurrency(supported: Set<string>): string | null {
  const region = regionFromBrowser()
  if (!region) return null
  const code = REGION_CURRENCY[region]
  return code && supported.has(code) ? code : null
}

function regionFromBrowser(): string | null {
  try {
    const locales = navigator.languages?.length
      ? [...navigator.languages]
      : [navigator.language]
    for (const tag of locales) {
      if (!tag) continue
      const region = new Intl.Locale(tag).maximize().region
      if (region) return region
    }
  } catch { /* fall through */ }
  return null
}

/**
 * Country → currency for the places Ope is most likely to be opened from.
 *
 * Deliberately not exhaustive: a country that is missing simply produces no
 * guess, and the owner picks from the full list. That is a far better failure
 * than a confident wrong guess, so this table only carries entries worth
 * betting on.
 */
const REGION_CURRENCY: Record<string, string> = {
  IL: 'ILS', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', CN: 'CNY', KR: 'KRW', IN: 'INR', ID: 'IDR', SG: 'SGD',
  MY: 'MYR', TH: 'THB', VN: 'VND', PH: 'PHP', BD: 'BDT', PK: 'PKR',
  TR: 'TRY', RU: 'RUB', UA: 'UAH', CH: 'CHF', NO: 'NOK', SE: 'SEK',
  DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', EG: 'EGP', MA: 'MAD', GH: 'GHS',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
  JO: 'JOD', LB: 'LBP', IQ: 'IQD',
  // The euro area
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR',
  AT: 'EUR', IE: 'EUR', PT: 'EUR', GR: 'EUR', FI: 'EUR', SK: 'EUR',
  SI: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', CY: 'EUR', MT: 'EUR',
  LU: 'EUR', HR: 'EUR',
}
