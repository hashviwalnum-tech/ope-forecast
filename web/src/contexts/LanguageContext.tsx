import { createContext, useContext, useEffect, useState } from 'react'
import { translations, simpleTranslations, RTL_LANGS, type Lang, type TranslationKey } from '../i18n'

const VALID_LANGS = new Set<string>(['en','he','zh','es','hi','ar','pt','ru','fr','bn','ur','id','de','ja','tr'])

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  dir: 'ltr' | 'rtl'
  simpleMode: boolean
  setSimpleMode: (v: boolean) => void
  simpleModeNeverSet: boolean  // true when user has never interacted with the toggle
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

const STORAGE_KEY = 'ope_language'
const SIMPLE_MODE_KEY = 'ope_simple_mode'

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return VALID_LANGS.has(saved ?? '') ? saved as Lang : 'en'
    } catch {
      return 'en'
    }
  })

  const [simpleMode, setSimpleModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIMPLE_MODE_KEY) === '1'
    } catch {
      return false
    }
  })

  // True when the user has never explicitly touched the simple-mode toggle
  const [simpleModeNeverSet, setSimpleModeNeverSet] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIMPLE_MODE_KEY) === null
    } catch {
      return false
    }
  })

  const dir: 'ltr' | 'rtl' = RTL_LANGS.has(lang) ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])

  function setLang(l: Lang) {
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
  }

  function setSimpleMode(v: boolean) {
    setSimpleModeState(v)
    setSimpleModeNeverSet(false)
    try { localStorage.setItem(SIMPLE_MODE_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }

  function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    const map = translations[lang] as Record<string, string>
    const enMap = translations['en'] as Record<string, string>
    const simpleMap = simpleMode ? (simpleTranslations[lang] as Record<string, string>) : {}
    const simpleEnMap = simpleMode ? (simpleTranslations['en'] as Record<string, string>) : {}
    let str: string
    const override = simpleMap[key] ?? simpleEnMap[key]
    if (override !== undefined) {
      str = override
    } else if (map[key] !== undefined) {
      str = map[key]
    } else {
      if (lang !== 'en' && import.meta.env.DEV) {
        console.warn(`[i18n] Missing ${lang} translation: "${key}"`)
      }
      str = enMap[key] ?? key
    }
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        // replaceAll — some languages need the same token twice for grammatical
        // agreement (e.g. Spanish "{n} producto{s} seleccionado{s}"); a plain
        // replace() only fills the first occurrence and leaks "{s}" literally.
        str = str.replaceAll(`{${k}}`, String(v))
      }
    }
    return str
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir, simpleMode, setSimpleMode, simpleModeNeverSet }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
