import 'react-native-url-polyfill/auto'
import { enableScreens } from 'react-native-screens'
import { useEffect, useState } from 'react'

enableScreens()
import { View, ActivityIndicator } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './src/lib/supabase'
import LoginScreen from './src/screens/LoginScreen'
import AppNavigator from './src/navigation/AppNavigator'
import { BusinessProvider } from './src/contexts/BusinessContext'
import { LanguageProvider } from './src/contexts/LanguageContext'
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext'
import { SettingsProvider } from './src/contexts/SettingsContext'
import { CurrencyProvider } from './src/contexts/CurrencyContext'

function AppRoot() {
  const c = useTheme()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator size="large" color={c.primary} />
        <StatusBar style="auto" />
      </View>
    )
  }

  return (
    <>
      <StatusBar style="auto" />
      {session ? (
        <BusinessProvider>
          {/* Inside BusinessProvider: the currency comes from the business. */}
          <CurrencyProvider>
            <SettingsProvider>
              <AppNavigator />
            </SettingsProvider>
          </CurrencyProvider>
        </BusinessProvider>
      ) : (
        <LoginScreen />
      )}
    </>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <ThemeProvider>
          <AppRoot />
        </ThemeProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  )
}
