import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { WEB_APP_URL } from '../lib/urls'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'

/**
 * Sign in, or create an account.
 *
 * The app had no way to sign UP: a new owner had to find the web app, register
 * there, and only then log in on their phone. For this product's audience —
 * small-business owners who mostly have a phone — that is the realistic first
 * step being missing, and onboarding was unreachable without it.
 *
 * One screen, one toggle. The fields are identical either way, so a separate
 * screen would only add a place to get lost.
 */
export default function LoginScreen() {
  const c = useTheme()
  const { t } = useLanguage()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async () => {
    // Resetting needs the address and nothing else — there is no password to
    // type when the whole problem is not having one.
    if (!email.trim() || (mode !== 'reset' && !password)) {
      setError(t('loginFillFields'))
      return
    }
    if (mode === 'signup' && password.length < 6) {
      setError(t('signUpPasswordShort'))
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: WEB_APP_URL,
        })
        if (error) throw error
        // Says nothing about whether the address is registered: confirming that
        // would make this a way of finding out who has an account.
        setNotice(`${t('pwResetSentBody')} ${t('pwResetOnWebNote')}`)
        setMode('signin')
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
        })
        if (error) throw error
        // With email confirmation ON, Supabase returns a user but no session —
        // the owner has to confirm before signing in. Saying so beats a screen
        // that appears to do nothing.
        if (!data.session) {
          setNotice(t('signUpCheckEmail'))
          setMode('signin')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(), password,
        })
        if (error) throw error
      }
    } catch (e: unknown) {
      const fallback = mode === 'reset' ? t('pwResetFailed')
        : mode === 'signup' ? t('signUpFailed') : t('loginFailed')
      setError(e instanceof Error ? e.message : fallback)
    } finally {
      setLoading(false)
    }
  }

  const switchMode = () => {
    setMode(m => (m === 'signin' ? 'signup' : 'signin'))
    setError(null)
    setNotice(null)
  }

  const goToReset = () => {
    setMode('reset')
    setError(null)
    setNotice(null)
  }

  const backToSignIn = () => {
    setMode('signin')
    setError(null)
    setNotice(null)
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.logo, { color: c.primary }]}>Ope</Text>
          <Text style={[styles.slogan, { color: c.textSub }]}>{t('loginSlogan')}</Text>

          {error !== null && (
            <Text style={[styles.errorText, { color: c.danger, backgroundColor: c.dangerBg }]}>{error}</Text>
          )}
          {notice !== null && (
            <Text style={[styles.noticeText, { color: c.primaryDark, backgroundColor: c.primaryBg }]}>
              {notice}
            </Text>
          )}

          {mode === 'reset' && (
            <Text style={[styles.resetHint, { color: c.textSub }]}>{t('pwResetDesc')}</Text>
          )}

          <Text style={[styles.label, { color: c.text }]}>{t('loginEmailLabel')}</Text>
          <TextInput
            style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
            placeholderTextColor={c.textMuted}
          />

          {mode !== 'reset' && (
            <>
              <Text style={[styles.label, { color: c.text }]}>{t('loginPasswordLabel')}</Text>
              <TextInput
                style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                placeholderTextColor={c.textMuted}
              />
            </>
          )}

          <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {mode === 'reset' ? t('pwResetSend')
                  : mode === 'signup' ? t('loginSignUp') : t('loginSignIn')}
              </Text>
            )}
          </TouchableOpacity>

          {mode === 'reset' ? (
            <TouchableOpacity style={styles.switchLink} onPress={backToSignIn} disabled={loading}>
              <Text style={[styles.switchText, { color: c.primary }]}>{t('loginBackToSignIn')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.switchLink} onPress={switchMode} disabled={loading}>
              <Text style={[styles.switchText, { color: c.primary }]}>
                {mode === 'signup' ? t('loginHaveAccount') : t('loginNeedAccount')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Only when signing in: someone part-way through creating an account
              has no password to have forgotten. */}
          {mode === 'signin' && (
            <TouchableOpacity style={styles.forgotLink} onPress={goToReset} disabled={loading}>
              <Text style={[styles.forgotText, { color: c.textSub }]}>{t('pwForgotLink')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f0fdfa' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  logo: {
    fontSize: 40,
    fontWeight: '700',
    color: '#0d9488',
    textAlign: 'center',
    marginBottom: 4,
  },
  slogan: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 28,
  },
  errorText: {
    color: '#b91c1c',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
  },
  noticeText: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    marginBottom: 18,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#0d9488',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  switchLink: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  switchText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Quieter than the mode switch, and still a 48pt target — this is a thumb on
  // a phone, not a cursor.
  forgotLink: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forgotText: {
    fontSize: 14,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  resetHint: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
})
