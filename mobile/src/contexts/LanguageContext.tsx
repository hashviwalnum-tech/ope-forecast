import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useState } from 'react'
import { I18nManager } from 'react-native'
import { type Lang, type TranslationKey, makeT, translations, RTL_LANGS } from '../lib/i18n'

const VALID_LANGS = new Set<string>(['en','he','zh','es','hi','ar','pt','ru','fr','bn','ur','id','de','ja','tr'])

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  dir: 'ltr' | 'rtl'
  simpleMode: boolean
  setSimpleMode: (v: boolean) => void
  simpleModeNeverSet: boolean
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
  simpleModeNeverSet: false,
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')
  const [simpleMode, setSimpleModeState] = useState(false)
  const [simpleModeNeverSet, setSimpleModeNeverSet] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (VALID_LANGS.has(saved ?? '')) setLangState(saved as Lang)
    }).catch(() => {})
    AsyncStorage.getItem(SIMPLE_MODE_KEY).then(saved => {
      if (saved === '1') {
        setSimpleModeState(true)
        setSimpleModeNeverSet(false)
      } else if (saved === null) {
        setSimpleModeNeverSet(true)  // key not present → user never interacted
      }
    }).catch(() => {})
  }, [])

  const dir: 'ltr' | 'rtl' = RTL_LANGS.has(lang) ? 'rtl' : 'ltr'

  function setLang(l: Lang) {
    setLangState(l)
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {})
    I18nManager.forceRTL(RTL_LANGS.has(l))
  }

  function setSimpleMode(v: boolean) {
    setSimpleModeState(v)
    setSimpleModeNeverSet(false)
    AsyncStorage.setItem(SIMPLE_MODE_KEY, v ? '1' : '0').catch(() => {})
  }

  const t = makeT(lang, simpleMode)

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir, simpleMode, setSimpleMode, simpleModeNeverSet }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

// Re-export for convenience
export type { Lang, TranslationKey }
