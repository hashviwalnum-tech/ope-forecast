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

export default function App() {
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
      <SafeAreaProvider>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0fdfa' }}>
          <ActivityIndicator size="large" color="#0d9488" />
          <StatusBar style="auto" />
        </View>
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {session ? (
        <BusinessProvider>
          <AppNavigator />
        </BusinessProvider>
      ) : (
        <LoginScreen />
      )}
    </SafeAreaProvider>
  )
}
