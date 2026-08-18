import { createContext, useContext, useMemo } from 'react'
import { useLanguage } from './LanguageContext'
import {
  amountStep, currencySymbol, FALLBACK_CURRENCY, formatAmount, formatMoney,
  formatSignedMoney, minorUnits, parseLocaleNumber,
} from '../lib/money'

/**
 * The business's currency, and formatters already bound to it.
 *
 * Money is a function of two settings that live in different places — the
 * CURRENCY belongs to the business, the NUMBER FORMAT to the language the
 * owner picked in Ope — and getting either from the wrong place is how the
 * app ended up showing dollars on one screen and euros on the next. Binding
 * both here means a component writes `money(120)` and cannot get it wrong.
 */
interface CurrencyContextValue {
  /** ISO 4217 code in use, e.g. "ILS". */
  currency: string
  /** True when the owner has actually chosen, rather than us falling back. */
  isChosen: boolean
  /** Decimal places this currency uses: 0 for yen, 2 for shekels, 3 for dinars. */
  digits: number
  /** Smallest step a money input should move in. */
  step: number
  /** The currency mark alone, for an input prefix. */
  symbol: string
  /** "₪120.00" — a full money figure. */
  money: (value: number) => string
  /** "+₪120.00" / "−₪120.00" — when the direction is the point. */
  signedMoney: (value: number) => string
  /** "120.00" — no currency mark, for a column already headed with one. */
  amount: (value: number) => string
  /** Read a number the owner typed, in their language's conventions. */
  parseNumber: (input: string) => number | null
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

export function CurrencyProvider({
  currency, children,
}: {
  /** Straight from business settings; undefined until the owner chooses. */
  currency?: string | null
  children: React.ReactNode
}) {
  const { lang } = useLanguage()

  const value = useMemo<CurrencyContextValue>(() => {
    const chosen = typeof currency === 'string' && currency.trim() !== ''
    const code = chosen ? currency.trim().toUpperCase() : FALLBACK_CURRENCY
    return {
      currency: code,
      isChosen: chosen,
      digits: minorUnits(code),
      step: amountStep(code),
      symbol: currencySymbol(code, lang),
      money: v => formatMoney(v, code, lang),
      signedMoney: v => formatSignedMoney(v, code, lang),
      amount: v => formatAmount(v, code, lang),
      parseNumber: s => parseLocaleNumber(s, lang),
    }
  }, [currency, lang])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) {
    throw new Error('useCurrency must be used inside a CurrencyProvider')
  }
  return ctx
}
