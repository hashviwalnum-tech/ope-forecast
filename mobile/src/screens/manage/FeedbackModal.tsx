import { useState, useMemo } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import type { Theme } from '../../lib/theme'

interface Props {
  onClose: () => void
}

export default function FeedbackModal({ onClose }: Props) {
  const c = useTheme()
  const { t } = useLanguage()
  const styles = useMemo(() => makeStyles(c), [c])

  const [name,    setName]    = useState('')
  const [biz,     setBiz]     = useState('')
  const [msg,     setMsg]     = useState('')
  const [sending, setSending] = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSend() {
    if (!name.trim()) { setError(t('feedbackNameRequired')); return }
    if (!msg.trim())  { setError(t('feedbackMessageRequired')); return }
    setSending(true)
    setError(null)
    try {
      await api.feedback.submit({
        name: name.trim(),
        business_name: biz.trim() || '—',
        message: msg.trim(),
      })
      setDone(true)
    } catch {
      setError(t('feedbackError'))
    } finally {
      setSending(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('feedbackTitle')}</Text>
        <View style={styles.closeBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {done ? (
            <View style={[styles.thankYouBox, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
              <Text style={[styles.thankYouIcon]}>✓</Text>
              <Text style={[styles.thankYouTitle, { color: c.primaryDark }]}>{t('feedbackThankYou')}</Text>
              <Text style={[styles.thankYouMsg,   { color: c.primaryDark }]}>{t('feedbackThankYouMsg')}</Text>
              <TouchableOpacity
                style={[styles.doneBtn, { backgroundColor: c.primary }]}
                onPress={onClose}
                activeOpacity={0.8}
              >
                <Text style={[styles.doneBtnText, { color: c.onPrimary }]}>{t('close')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={[styles.desc, { color: c.textSub }]}>{t('feedbackDesc')}</Text>

              <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{t('feedbackNameLabel')}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
                value={name}
                onChangeText={v => { setName(v); setError(null) }}
                placeholder={t('feedbackNameLabel')}
                placeholderTextColor={c.textMuted}
                maxLength={200}
                returnKeyType="next"
              />

              <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{t('feedbackBusinessLabel')}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
                value={biz}
                onChangeText={setBiz}
                placeholder={t('feedbackBusinessLabel')}
                placeholderTextColor={c.textMuted}
                maxLength={200}
                returnKeyType="next"
              />

              <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{t('feedbackMessageLabel')}</Text>
              <TextInput
                style={[styles.textarea, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
                value={msg}
                onChangeText={v => { setMsg(v); setError(null) }}
                placeholder={t('feedbackMessagePlaceholder')}
                placeholderTextColor={c.textMuted}
                maxLength={2000}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                returnKeyType="default"
              />

              {error && (
                <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
              )}

              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: c.primary }, sending && { opacity: 0.6 }]}
                onPress={() => void handleSend()}
                disabled={sending}
                activeOpacity={0.8}
              >
                {sending
                  ? <ActivityIndicator size="small" color={c.onPrimary} />
                  : <Text style={[styles.sendBtnText, { color: c.onPrimary }]}>{t('feedbackSendBtn')}</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    root: { flex: 1 },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
    },
    headerTitle: { fontSize: 17, fontWeight: '700' },
    closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

    content: { padding: 20, gap: 10 },

    desc: { fontSize: 14, lineHeight: 21, marginBottom: 6 },

    fieldLabel: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: 0.6, marginTop: 6,
    },
    input: {
      borderWidth: 1, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    },
    textarea: {
      borderWidth: 1, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
      minHeight: 120,
    },

    errorText: { fontSize: 13, marginTop: 2 },

    sendBtn: {
      borderRadius: 14, paddingVertical: 15,
      alignItems: 'center', justifyContent: 'center', marginTop: 8,
    },
    sendBtnText: { fontSize: 15, fontWeight: '700' },

    thankYouBox: {
      borderRadius: 18, borderWidth: 1, padding: 28,
      alignItems: 'center', gap: 10, marginTop: 20,
    },
    thankYouIcon: { fontSize: 40 },
    thankYouTitle: { fontSize: 20, fontWeight: '800' },
    thankYouMsg:   { fontSize: 14, textAlign: 'center', lineHeight: 20 },
    doneBtn: {
      borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32, marginTop: 8,
    },
    doneBtnText: { fontSize: 15, fontWeight: '700' },
  })
}
