import 'react-native-url-polyfill/auto'
import { enableScreens } from 'react-native-screens'
import * as Sentry from '@sentry/react-native'
import { useEffect, useState } from 'react'

enableScreens()

// Crash reporting, before anything else runs, so a crash during startup is
// still caught. The web app has had this since June; the phone had nothing at
// all, which meant a beta tester whose app died on a handset nobody here owns
// would simply stop using Ope and never be heard from.
//
// Same shape as web/src/main.tsx: no DSN, no Sentry. A missing environment
// variable must leave the app working rather than crash it on launch, and it is
// genuinely absent in development.
const _sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN
if (_sentryDsn) {
  Sentry.init({
    dsn: _sentryDsn,
    // Off by default in the SDK, and left off deliberately: Ope's own users are
    // shop owners, and an error report should not carry their email or their
    // customers' names out to a third party.
    sendDefaultPii: false,
  })
}
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
import { BusinessTimeProvider } from './src/contexts/BusinessTimeContext'

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
          {/* Inside BusinessProvider: the currency AND the clock both come
              from the business, not from the device. */}
          <CurrencyProvider>
            <BusinessTimeProvider>
              <SettingsProvider>
                <AppNavigator />
              </SettingsProvider>
            </BusinessTimeProvider>
          </CurrencyProvider>
        </BusinessProvider>
      ) : (
        <LoginScreen />
      )}
    </>
  )
}

function App() {
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

// `Sentry.wrap` is what catches a render crash in the tree below it. Without it
// only errors thrown outside React would ever be reported, which is the smaller
// half. It is a no-op when `init` was never called.
export default Sentry.wrap(App)
