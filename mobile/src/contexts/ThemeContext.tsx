import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import { dark, light, type Theme } from '../lib/theme'

type ThemePreference = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  isDark: boolean
}

const STORAGE_KEY = '@ope_theme'

const ThemeContext = createContext<ThemeContextValue>({
  theme: light,
  preference: 'system',
  setPreference: () => {},
  isDark: false,
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const systemScheme = useColorScheme()

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'system' || saved === 'light' || saved === 'dark') {
        setPreferenceState(saved)
      }
    }).catch(() => {})
  }, [])

  function setPreference(p: ThemePreference) {
    setPreferenceState(p)
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {})
  }

  const isDark =
    preference === 'dark' ||
    (preference === 'system' && systemScheme === 'dark')

  const theme = isDark ? dark : light

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, isDark }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useAppTheme() {
  return useContext(ThemeContext)
}

/** Drop-in replacement for the old useTheme() — reads user preference. */
export function useTheme() {
  return useContext(ThemeContext).theme
}
