import { useState, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { TelegramLinkCodeResponse, TelegramLinkStatus } from '../../api/types'
import { useTheme, type Theme } from '../../lib/theme'

interface Props { onClose: () => void }

export default function TelegramModal({ onClose }: Props) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const [status, setStatus] = useState<TelegramLinkStatus | null>(null)
  const [code, setCode] = useState<TelegramLinkCodeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [revoking, setRevoking] = useState(false)

  const loadStatus = async () => {
    setLoading(true)
    try {
      const s = await api.telegram.getStatus()
      setStatus(s)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Telegram status.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadStatus() }, [])

  const generateCode = async () => {
    setGenerating(true)
    setError(null)
    try {
      const result = await api.telegram.generateCode()
      setCode(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate code.')
    } finally {
      setGenerating(false)
    }
  }

  const revoke = () => {
    Alert.alert(
      'Disconnect Telegram',
      'This will unlink your Telegram bot. You can reconnect any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect', style: 'destructive',
          onPress: async () => {
            setRevoking(true)
            try {
              await api.telegram.revoke()
              setStatus({ linked: false, chat_id: null, has_pending_code: false })
              setCode(null)
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to disconnect.')
            } finally {
              setRevoking(false)
            }
          },
        },
      ]
    )
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>Manage</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Telegram</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => void loadStatus()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : status?.linked ? (
            /* ── Linked ── */
            <>
              <View style={styles.connectedCard}>
                <Ionicons name="checkmark-circle" size={36} color="#16a34a" />
                <Text style={styles.connectedTitle}>Telegram Connected</Text>
                {status.chat_id && (
                  <Text style={styles.connectedSub}>Chat ID: {status.chat_id}</Text>
                )}
              </View>
              <Text style={styles.infoText}>
                Your Ope bot is active. You can send messages to the bot to log sales and get
                forecasts directly in Telegram.
              </Text>
              <TouchableOpacity
                style={styles.dangerBtn}
                onPress={revoke}
                disabled={revoking}
                activeOpacity={0.8}
              >
                {revoking
                  ? <ActivityIndicator size="small" color={c.danger} />
                  : <>
                    <Ionicons name="unlink-outline" size={18} color={c.danger} />
                    <Text style={styles.dangerBtnText}>Disconnect Telegram</Text>
                  </>}
              </TouchableOpacity>
            </>
          ) : (
            /* ── Not linked ── */
            <>
              <View style={styles.heroIcon}>
                <Ionicons name="paper-plane-outline" size={48} color={c.primary} />
              </View>
              <Text style={styles.heroTitle}>Connect Telegram</Text>
              <Text style={styles.infoText}>
                Link your Ope account to a Telegram bot so you can log sales and ask for forecasts
                in plain language — without opening the app.
              </Text>

              <Text style={styles.stepsTitle}>How to connect:</Text>
              <View style={styles.step}>
                <Text style={styles.stepNum}>1</Text>
                <Text style={styles.stepText}>
                  Tap "Generate Code" below to get a one-time code.
                </Text>
              </View>
              <View style={styles.step}>
                <Text style={styles.stepNum}>2</Text>
                <Text style={styles.stepText}>
                  Open Telegram and find the Ope bot (your admin will give you the bot name).
                </Text>
              </View>
              <View style={styles.step}>
                <Text style={styles.stepNum}>3</Text>
                <Text style={styles.stepText}>
                  Send the bot: <Text style={styles.codeInline}>/link YOUR_CODE</Text>
                </Text>
              </View>

              {code ? (
                <View style={styles.codeCard}>
                  <Text style={styles.codeLabel}>Your one-time code:</Text>
                  <Text style={styles.codeValue} selectable>{code.code}</Text>
                  <Text style={styles.codeExpiry}>
                    Expires in {code.expires_in_minutes} minutes
                  </Text>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { marginTop: 16 }]}
                    onPress={() => void generateCode()}
                    disabled={generating}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.primaryBtnText}>
                      {generating ? 'Generating…' : 'Generate a new code'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 24 }]}
                  onPress={() => void generateCode()}
                  disabled={generating}
                  activeOpacity={0.8}
                >
                  {generating
                    ? <ActivityIndicator size="small" color={c.onPrimary} />
                    : <Text style={styles.primaryBtnText}>Generate Code</Text>}
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      backgroundColor: c.headerBg, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 10,
      flexDirection: 'row', alignItems: 'center',
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 80 },
    backLabel: { fontSize: 14, color: c.onPrimary },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: c.onPrimary, textAlign: 'center' },

    body: { flex: 1 },
    bodyContent: { padding: 20, paddingBottom: 40 },
    center: { justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
    errorText: { color: c.danger, fontSize: 14, textAlign: 'center', marginBottom: 12 },
    retryBtn: {
      backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20,
    },
    retryText: { color: c.onPrimary, fontWeight: '600', fontSize: 14 },

    connectedCard: {
      alignItems: 'center', gap: 10, backgroundColor: '#f0fdf4',
      borderRadius: 16, padding: 24, marginBottom: 16,
      borderWidth: 1, borderColor: '#86efac',
    },
    connectedTitle: { fontSize: 18, fontWeight: '700', color: '#15803d' },
    connectedSub: { fontSize: 13, color: '#166534' },

    heroIcon: { alignItems: 'center', marginBottom: 12, marginTop: 12 },
    heroTitle: {
      fontSize: 22, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 12,
    },
    infoText: {
      fontSize: 14, color: c.textSub, lineHeight: 22, textAlign: 'center', marginBottom: 20,
    },

    stepsTitle: {
      fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 10,
    },
    step: {
      flexDirection: 'row', gap: 12, marginBottom: 10, alignItems: 'flex-start',
    },
    stepNum: {
      width: 24, height: 24, backgroundColor: c.primary, borderRadius: 12,
      textAlign: 'center', lineHeight: 24, color: c.onPrimary, fontWeight: '700', fontSize: 13,
      overflow: 'hidden',
    },
    stepText: { flex: 1, fontSize: 14, color: c.text, lineHeight: 20 },
    codeInline: {
      fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
      backgroundColor: c.border, borderRadius: 4, paddingHorizontal: 4,
      color: c.primaryDark,
    } as object,

    codeCard: {
      backgroundColor: c.primaryBg, borderRadius: 16, padding: 20, marginTop: 24,
      borderWidth: 1, borderColor: c.primary, alignItems: 'center', gap: 4,
    },
    codeLabel: { fontSize: 12, color: c.primaryDark, fontWeight: '600' },
    codeValue: {
      fontSize: 32, fontWeight: '700', color: c.primaryDark, letterSpacing: 4,
      fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    } as object,
    codeExpiry: { fontSize: 11, color: c.textMuted },

    primaryBtn: {
      backgroundColor: c.primary, borderRadius: 14,
      paddingVertical: 16, alignItems: 'center',
    },
    primaryBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 16 },

    dangerBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.dangerBg, borderRadius: 14, paddingVertical: 16, marginTop: 12,
    },
    dangerBtnText: { fontSize: 15, fontWeight: '600', color: c.danger },
  })
}
