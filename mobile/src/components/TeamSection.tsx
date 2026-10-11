/**
 * Settings → Team.
 *
 * Owner: make a join code to read out to staff, see who has joined, remove
 * someone. Staff: which business they log sales for, and a way to leave.
 * What staff can actually do is enforced by the server, not here.
 */
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../api/client'
import type { BusinessRead, TeamRead } from '../api/types'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../contexts/LanguageContext'

interface Props {
  business: BusinessRead
  /** Staff left the team: the app reloads its businesses. */
  onLeft: () => void
}

export default function TeamSection({ business, onLeft }: Props) {
  const c = useTheme()
  const { t } = useLanguage()
  const isStaff = business.role === 'staff'

  const [team, setTeam] = useState<TeamRead | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isStaff) return
    try {
      setTeam(await api.team.get())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailedBody'))
    }
  }, [isStaff, t])

  useEffect(() => { void load() }, [load])

  const makeCode = async () => {
    setBusy(true)
    setError(null)
    try {
      setCode((await api.team.makeInvite()).code)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSave'))
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: number, email: string | null) => {
    Alert.alert(t('teamTitle'), t('teamRemoveConfirm', { email: email ?? '' }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('teamRemove'), style: 'destructive',
        onPress: async () => {
          try {
            await api.team.removeMember(id)
            void load()
          } catch (e) {
            setError(e instanceof Error ? e.message : t('failedToDelete'))
          }
        },
      },
    ])
  }

  const leave = () => {
    Alert.alert(t('teamLeave'), t('teamLeaveConfirm', { name: business.name }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('teamLeave'), style: 'destructive',
        onPress: async () => {
          try {
            await api.team.leave(business.id)
            onLeft()
          } catch (e) {
            setError(e instanceof Error ? e.message : t('failedToSave'))
          }
        },
      },
    ])
  }

  const label = [styles.label, { color: c.text }]
  const hint = [styles.hint, { color: c.textMuted }]

  if (isStaff) {
    return (
      <View style={styles.wrap}>
        <Text style={label}>{t('teamTitle')}</Text>
        <Text style={hint}>{t('teamStaffNote', { name: business.name })}</Text>
        <TouchableOpacity
          style={[styles.btn, { borderColor: c.danger }]}
          onPress={leave}
          accessibilityRole="button"
        >
          <Text style={[styles.btnText, { color: c.danger }]}>{t('teamLeave')}</Text>
        </TouchableOpacity>
        {error && <Text style={[styles.hint, { color: c.danger }]}>{error}</Text>}
      </View>
    )
  }

  return (
    <View style={styles.wrap}>
      <Text style={label}>{t('teamTitle')}</Text>
      <Text style={hint}>{t('teamDesc')}</Text>

      {team && !team.available ? (
        <Text style={[hint, { marginTop: 6 }]}>{t('teamNeedsPremiumNote')}</Text>
      ) : (
        <>
          {code && (
            <View style={[styles.codeBox, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
              <Text
                style={[styles.code, { color: c.primaryDark }]}
                selectable
                accessibilityLabel={code.split('').join(' ')}
              >
                {code}
              </Text>
              <Text style={[hint, { textAlign: 'center' }]}>{t('teamCodeHint')}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.btn, { borderColor: c.primary, backgroundColor: c.primaryBg }, busy && { opacity: 0.6 }]}
            onPress={() => void makeCode()}
            disabled={busy || team === null}
            accessibilityRole="button"
          >
            {busy
              ? <ActivityIndicator size="small" color={c.primary} />
              : <Text style={[styles.btnText, { color: c.primary }]}>{t('teamMakeCode')}</Text>}
          </TouchableOpacity>

          <Text style={[label, { fontSize: 13, marginTop: 14 }]}>{t('teamMembersLabel')}</Text>
          {team && team.members.length === 0 && <Text style={hint}>{t('teamNoMembers')}</Text>}
          {team?.members.map(m => (
            <View key={m.id} style={[styles.member, { borderBottomColor: c.border }]}>
              <Ionicons name="person-outline" size={18} color={c.textSub} />
              <Text style={[styles.memberText, { color: c.text }]} numberOfLines={1}>{m.email ?? '—'}</Text>
              <TouchableOpacity
                onPress={() => remove(m.id, m.email)}
                style={styles.removeBtn}
                accessibilityRole="button"
                accessibilityLabel={`${t('teamRemove')}: ${m.email ?? ''}`}
              >
                <Text style={[styles.removeText, { color: c.danger }]}>{t('teamRemove')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
      {error && <Text style={[styles.hint, { color: c.danger }]}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  label: { fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  hint: { fontSize: 13, lineHeight: 18 },
  btn: {
    minHeight: 48, borderRadius: 12, borderWidth: 1.5, marginTop: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
  },
  btnText: { fontSize: 14, fontWeight: '700' },
  codeBox: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 10, alignItems: 'center', gap: 6 },
  code: { fontSize: 30, fontWeight: '700', letterSpacing: 3 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderBottomWidth: 1 },
  memberText: { flex: 1, fontSize: 14 },
  removeBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { fontSize: 13, fontWeight: '600' },
})
