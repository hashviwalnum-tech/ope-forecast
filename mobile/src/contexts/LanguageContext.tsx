import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useState } from 'react'
import { Alert, I18nManager } from 'react-native'
import { type Lang, type TranslationKey, makeT, translations, RTL_LANGS } from '../lib/i18n'

// Native layout mirroring is opt-in and, once changed, only takes effect on the
// next app launch — React Native cannot re-mirror a running UI. allowRTL must be
// enabled before any forceRTL call has an effect.
I18nManager.allowRTL(true)

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
      if (VALID_LANGS.has(saved ?? '')) {
        const l = saved as Lang
        setLangState(l)
        // Keep the native mirroring flag in step with the stored language, so a
        // relaunch comes up in the right direction even if it was last set on a
        // build where forceRTL had not run yet.
        const wantRtl = RTL_LANGS.has(l)
        if (I18nManager.isRTL !== wantRtl) I18nManager.forceRTL(wantRtl)
      }
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
    const wantRtl = RTL_LANGS.has(l)
    if (I18nManager.isRTL !== wantRtl) {
      // Text and translations swap immediately; the physical left/right mirroring
      // only lands after a full restart. Tell the owner rather than leaving a
      // half-flipped screen with no explanation.
      I18nManager.forceRTL(wantRtl)
      const tt = makeT(l, simpleMode)
      Alert.alert(tt('rtlRestartTitle'), tt('rtlRestartBody'))
    }
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
