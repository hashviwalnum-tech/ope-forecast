import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native'
import { supabase } from '../lib/supabase'
import * as api from '../api/client'
import type { BusinessRead, ForecastDay } from '../api/types'

const WEEKDAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
}

const STATUS_TOP = Platform.OS === 'ios' ? 50 : (RNStatusBar.currentHeight ?? 24) + 4

export default function DashboardScreen() {
  const [business, setBusiness] = useState<BusinessRead | null>(null)
  const [forecast, setForecast] = useState<ForecastDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const list = await api.businesses.list()
      if (list.length === 0) {
        setError('No business found. Please set up your business on the web app first.')
        return
      }
      const biz = list[0]
      api.setActiveBusinessId(biz.id)
      setBusiness(biz)

      const forecastData = await api.analytics.forecast()
      setForecast(
        forecastData.status === 'ok' || forecastData.status === 'learning'
          ? forecastData.days
          : []
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: STATUS_TOP }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.appName}>Ope</Text>
            {business !== null && (
              <Text style={styles.bizName}>{business.name}</Text>
            )}
          </View>
          <TouchableOpacity
            onPress={() => void supabase.auth.signOut()}
            style={styles.signOutBtn}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#0d9488" />
            <Text style={styles.loadingText}>
              Loading… first load may take ~45 s if the server is waking up
            </Text>
          </View>
        )}

        {!loading && error !== null && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void load()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && (
          <>
            <Text style={styles.sectionTitle}>This Week's Forecast</Text>

            {forecast.length === 0 ? (
              <Text style={styles.emptyText}>
                Not enough data yet — log a few days on the web app first.
              </Text>
            ) : (
              forecast.map((day) => (
                <View key={day.date} style={styles.forecastRow}>
                  <View style={styles.dayCol}>
                    <Text style={styles.dayName}>
                      {WEEKDAY_SHORT[day.weekday] ?? day.weekday}
                    </Text>
                    <Text style={styles.dayDate}>{day.date.slice(5)}</Text>
                  </View>
                  <View style={styles.predCol}>
                    <Text style={styles.predNumber}>
                      {Math.round(day.predicted_customers)}
                    </Text>
                    <Text style={styles.predLabel}>customers</Text>
                  </View>
                  <View style={styles.rangeCol}>
                    <Text style={styles.rangeText}>
                      {Math.round(day.interval_low)}–{Math.round(day.interval_high)}
                    </Text>
                    <Text style={styles.rangeLabel}>range</Text>
                  </View>
                </View>
              ))
            )}

            {business !== null && (
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>Connected</Text>
                <Text style={styles.infoLine}>Business: {business.name}</Text>
                <Text style={styles.infoLine}>Tier: {business.tier}</Text>
                <Text style={styles.infoLine}>
                  API: {process.env.EXPO_PUBLIC_API_BASE_URL}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f0fdfa' },

  header: { backgroundColor: '#0d9488', paddingBottom: 18, paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  appName: { fontSize: 28, fontWeight: '700', color: '#fff' },
  bizName: { fontSize: 13, color: '#ccfbf1', marginTop: 2 },
  signOutBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  signOutText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 48 },

  center: { paddingTop: 48, alignItems: 'center' },
  loadingText: { marginTop: 16, color: '#64748b', textAlign: 'center', fontSize: 13, maxWidth: 280 },

  errorBox: { backgroundColor: '#fef2f2', borderRadius: 12, padding: 16, marginBottom: 16 },
  errorText: { color: '#dc2626', fontSize: 14 },
  retryBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#0d9488',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  retryText: { color: '#fff', fontSize: 14 },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#0f766e', marginBottom: 12, marginTop: 4 },
  emptyText: { color: '#64748b', fontSize: 14, fontStyle: 'italic' },

  forecastRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  dayCol: { width: 52 },
  dayName: { fontSize: 14, fontWeight: '700', color: '#0d9488' },
  dayDate: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  predCol: { flex: 1, alignItems: 'center' },
  predNumber: { fontSize: 26, fontWeight: '700', color: '#1e293b' },
  predLabel: { fontSize: 11, color: '#94a3b8' },
  rangeCol: { alignItems: 'flex-end' },
  rangeText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  rangeLabel: { fontSize: 11, color: '#94a3b8' },

  infoCard: { backgroundColor: '#e0f2fe', borderRadius: 12, padding: 14, marginTop: 20 },
  infoTitle: { fontWeight: '700', color: '#0369a1', fontSize: 14, marginBottom: 6 },
  infoLine: { fontSize: 13, color: '#1e40af', marginBottom: 2 },
})
