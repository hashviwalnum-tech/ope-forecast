import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useState } from 'react'
import { I18nManager } from 'react-native'
import { type Lang, type TranslationKey, makeT, translations } from '../lib/i18n'

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  dir: 'ltr' | 'rtl'
  simpleMode: boolean
  setSimpleMode: (v: boolean) => void
}

const STORAGE_KEY = '@ope_language'
const SIMPLE_MODE_KEY = '@ope_simple_mode'

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
  t: makeT('en'),
  dir: 'ltr',
  simpleMode: false,
  setSimpleMode: () => {},
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')
  const [simpleMode, setSimpleModeState] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'en' || saved === 'he') setLangState(saved)
    }).catch(() => {})
    AsyncStorage.getItem(SIMPLE_MODE_KEY).then(saved => {
      if (saved === '1') setSimpleModeState(true)
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

  function setSimpleMode(v: boolean) {
    setSimpleModeState(v)
    AsyncStorage.setItem(SIMPLE_MODE_KEY, v ? '1' : '0').catch(() => {})
  }

  const t = makeT(lang, simpleMode)

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir, simpleMode, setSimpleMode }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

// Re-export for convenience
export type { Lang, TranslationKey }
