import { useState, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as api from '../../api/client'
import type { DayRecordRead } from '../../api/types'
import { useTheme, type Theme } from '../../lib/theme'

interface Props { onClose: () => void }

function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

export default function PastDaysModal({ onClose }: Props) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const [records, setRecords] = useState<DayRecordRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [customers, setCustomers] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadRecords = async () => {
    setLoading(true)
    try {
      const data = await api.dayRecords.list()
      // Show newest first
      const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date))
      setRecords(sorted)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadRecords() }, [])

  const openAdd = () => {
    setEditId(null)
    setDate(todayStr())
    setCustomers('')
    setNotes('')
    setSaveError(null)
    setShowForm(true)
  }

  const openEdit = (r: DayRecordRead) => {
    setEditId(r.id)
    setDate(r.date)
    setCustomers(String(r.customers))
    setNotes(r.notes ?? '')
    setSaveError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditId(null)
    setSaveError(null)
  }

  const save = async () => {
    if (!isValidDate(date)) {
      setSaveError('Enter a valid date in YYYY-MM-DD format (e.g. 2026-01-15).')
      return
    }
    const cust = parseInt(customers, 10)
    if (isNaN(cust) || cust < 0) {
      setSaveError('Customers must be 0 or more.')
      return
    }

    // Check for existing record on this date
    const existing = records.find(r => r.date === date && r.id !== editId)

    if (existing) {
      Alert.alert(
        'Record already exists',
        `A record for ${date} already exists (${existing.customers} customers). Overwrite it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Overwrite', style: 'destructive',
            onPress: () => void performSave(existing.id, cust),
          },
        ]
      )
      return
    }

    await performSave(editId ?? null, cust)
  }

  const performSave = async (overwriteId: number | null, cust: number) => {
    setSaving(true)
    setSaveError(null)
    try {
      const body = {
        customers: cust,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }
      if (overwriteId !== null) {
        const updated = await api.dayRecords.update(overwriteId, body)
        setRecords(rs => {
          const filtered = rs.filter(r => r.id !== overwriteId)
          return [updated, ...filtered].sort((a, b) => b.date.localeCompare(a.date))
        })
      } else if (editId !== null) {
        const updated = await api.dayRecords.update(editId, body)
        setRecords(rs => rs.map(r => r.id === editId ? updated : r))
      } else {
        const created = await api.dayRecords.create({ date, customers: cust, ...(notes.trim() ? { notes: notes.trim() } : {}) })
        setRecords(rs => [created, ...rs].sort((a, b) => b.date.localeCompare(a.date)))
      }
      closeForm()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const deleteRecord = (id: number, date: string) => {
    Alert.alert(
      'Delete Record',
      `Delete the record for ${date}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await api.dayRecords.delete(id)
              setRecords(rs => rs.filter(r => r.id !== id))
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete.')
            }
          },
        },
      ]
    )
  }

  const handleBack = () => {
    if (showForm) { closeForm() } else { onClose() }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={handleBack}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>{showForm ? 'Cancel' : 'Manage'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {showForm ? (editId ? 'Edit Day' : 'Add Past Day') : 'Past Days'}
          </Text>
          {!showForm && (
            <TouchableOpacity onPress={openAdd} style={styles.addBtn} hitSlop={8}>
              <Ionicons name="add" size={24} color={c.onPrimary} />
            </TouchableOpacity>
          )}
          {showForm && (
            <TouchableOpacity
              onPress={() => void save()}
              style={styles.saveBtn}
              disabled={saving}
              hitSlop={8}
            >
              {saving
                ? <ActivityIndicator size="small" color={c.onPrimary} />
                : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          )}
        </View>

        {showForm ? (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {saveError && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{saveError}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>Date *</Text>
              <TextInput
                style={styles.input}
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD (e.g. 2026-01-15)"
                placeholderTextColor={c.textMuted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.fieldHint}>
                Format: YYYY-MM-DD. To add older history, fill in earlier dates here.
              </Text>

              <Text style={styles.fieldLabel}>Customers *</Text>
              <TextInput
                style={styles.input}
                value={customers}
                onChangeText={setCustomers}
                keyboardType="number-pad"
                placeholder="How many customers that day"
                placeholderTextColor={c.textMuted}
              />

              <Text style={styles.fieldLabel}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. public holiday, bad weather"
                placeholderTextColor={c.textMuted}
                multiline
                numberOfLines={3}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={c.primary} />
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => void loadRecords()}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : records.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="calendar-outline" size={36} color={c.textMuted} />
                <Text style={styles.emptyTitle}>No records yet</Text>
                <Text style={styles.emptyText}>
                  Add past days to build up history for the forecasting engine.
                </Text>
                <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
                  <Text style={styles.emptyAddBtnText}>Add a Day</Text>
                </TouchableOpacity>
              </View>
            ) : (
              records.map(r => (
                <View key={r.id} style={styles.recordRow}>
                  <View style={styles.recordInfo}>
                    <Text style={styles.recordDate}>{r.date}</Text>
                    <Text style={styles.recordCustomers}>
                      {r.customers} customer{r.customers !== 1 ? 's' : ''}
                    </Text>
                    {r.notes && (
                      <Text style={styles.recordNotes} numberOfLines={1}>{r.notes}</Text>
                    )}
                    {r.outlier_status === 'flagged' && (
                      <Text style={styles.outlierBadge}>Flagged as unusual</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => openEdit(r)}
                    hitSlop={8}
                  >
                    <Ionicons name="pencil-outline" size={18} color={c.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => deleteRecord(r.id, r.date)}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={c.danger} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        )}
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
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 8 },
    backLabel: { fontSize: 14, color: c.onPrimary },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: c.onPrimary, textAlign: 'center' },
    addBtn: { padding: 4 },
    saveBtn: { paddingHorizontal: 4 },
    saveBtnText: { fontSize: 15, fontWeight: '700', color: c.onPrimary },

    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 40 },
    center: { justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
    errorText: { color: c.danger, fontSize: 14, textAlign: 'center', marginBottom: 12 },
    retryBtn: {
      backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20,
    },
    retryText: { color: c.onPrimary, fontWeight: '600', fontSize: 14 },
    errorBanner: {
      backgroundColor: c.dangerBg, borderRadius: 10, padding: 12, marginBottom: 14,
    },
    errorBannerText: { color: c.danger, fontSize: 13 },

    emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 48 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    emptyText: {
      fontSize: 14, color: c.textSub, textAlign: 'center', maxWidth: 280, lineHeight: 20,
    },
    emptyAddBtn: {
      backgroundColor: c.primary, borderRadius: 12,
      paddingVertical: 12, paddingHorizontal: 28, marginTop: 8,
    },
    emptyAddBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },

    recordRow: {
      backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 8,
      flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border,
    },
    recordInfo: { flex: 1, gap: 2 },
    recordDate: { fontSize: 14, fontWeight: '700', color: c.primaryDark },
    recordCustomers: { fontSize: 15, color: c.text, fontWeight: '600' },
    recordNotes: { fontSize: 12, color: c.textSub },
    outlierBadge: {
      fontSize: 10, color: '#a16207', fontWeight: '700',
      backgroundColor: '#fefce8', borderRadius: 4,
      paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start',
    },
    iconBtn: { padding: 8 },

    fieldLabel: {
      fontSize: 13, fontWeight: '600', color: c.text, marginTop: 14, marginBottom: 6,
    },
    fieldHint: { fontSize: 11, color: c.textMuted, marginTop: 4, lineHeight: 16 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: c.text,
    },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  })
}
