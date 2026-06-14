import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useState } from 'react'
import { I18nManager } from 'react-native'
import { type Lang, type TranslationKey, makeT, translations } from '../lib/i18n'

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  dir: 'ltr' | 'rtl'
}

const STORAGE_KEY = '@ope_language'

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
  t: makeT('en'),
  dir: 'ltr',
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'en' || saved === 'he') setLangState(saved)
    }).catch(() => {})
  }, [])

  const dir: 'ltr' | 'rtl' = lang === 'he' ? 'rtl' : 'ltr'

  function setLang(l: Lang) {
    setLangState(l)
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {})
    // RTL layout support: React Native requires a restart to fully apply, so we
    // just toggle the flag and let the user know if needed.
    I18nManager.forceRTL(l === 'he')
  }

  const t = makeT(lang)

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

// Re-export for convenience
export type { Lang, TranslationKey }
