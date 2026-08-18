import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useBusiness } from './BusinessContext'
import { useLanguage } from './LanguageContext'
import {
  amountStep, currencySymbol, FALLBACK_CURRENCY, formatAmount, formatMoney,
  formatSignedMoney, minorUnits, parseLocaleNumber,
} from '../lib/money'

/**
 * The business's currency, and formatters already bound to it.
 *
 * Mirrors web/src/contexts/CurrencyContext.tsx. Reads straight from the
 * BusinessContext rather than taking a prop, because on mobile the business is
 * already loaded once at the top of the app and every screen has it.
 */
interface CurrencyContextValue {
  currency: string
  isChosen: boolean
  digits: number
  step: number
  symbol: string
  money: (value: number) => string
  signedMoney: (value: number) => string
  amount: (value: number) => string
  parseNumber: (input: string) => number | null
}

function build(currency: string | undefined, lang: string): CurrencyContextValue {
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
}

const CurrencyContext = createContext<CurrencyContextValue>(build(undefined, 'en'))

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { business } = useBusiness()
  const { lang } = useLanguage()
  const currency = (business?.settings as Record<string, unknown> | undefined)?.currency

  const value = useMemo(
    () => build(typeof currency === 'string' ? currency : undefined, lang),
    [currency, lang],
  )

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext)
}
