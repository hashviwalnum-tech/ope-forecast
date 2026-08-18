import { useEffect, useMemo, useState } from 'react'
import { currencies } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import { currencySymbol } from '../lib/money'
import { guessCurrency } from '../lib/currencyGuess'
import type { CurrencyRead } from '../api/types'

/** The currency's name in the owner's language, falling back to the API's English. */
function localisedName(code: string, lang: string, fallback: string): string {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'currency' }).of(code)
    if (name && name !== code) return name
  } catch { /* fall through */ }
  return fallback
}

interface Props {
  /** Currently selected code, or empty when nothing is chosen yet. */
  value: string
  onChange: (code: string) => void
  /** Propose a locale-based guess when nothing is selected yet. */
  suggestOnLoad?: boolean
  disabled?: boolean
  id?: string
}

export default function CurrencyPicker({
  value, onChange, suggestOnLoad = false, disabled = false, id,
}: Props) {
  const { t, lang } = useLanguage()
  const [list, setList] = useState<CurrencyRead[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    currencies.list()
      .then(res => {
        if (cancelled) return
        setList(res.currencies)
        if (suggestOnLoad && !value) {
          const guess = guessCurrency(new Set(res.currencies.map(c => c.code)))
          if (guess) onChange(guess)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
    // Run once: re-suggesting after the owner has picked would fight them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sorted by the name the owner actually reads, not by the ISO code.
  const options = useMemo(() => {
    const collator = new Intl.Collator(lang)
    return list
      .map(c => ({ code: c.code, label: localisedName(c.code, lang, c.name) }))
      .sort((a, b) => collator.compare(a.label, b.label))
  }, [list, lang])

  if (failed) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-300">
        {t('currencyLoadFailed')}
      </p>
    )
  }

  return (
    <select
      id={id}
      value={value}
      disabled={disabled || !list.length}
      onChange={e => onChange(e.target.value)}
      className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100
                 focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:opacity-60"
    >
      <option value="">{t('currencyChoosePlaceholder')}</option>
      {options.map(o => (
        <option key={o.code} value={o.code}>
          {o.label} — {o.code} {currencySymbol(o.code, lang)}
        </option>
      ))}
    </select>
  )
}
