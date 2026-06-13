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
import type { DayRecordRead, ProductRead, SaleRead } from '../../api/types'
import { useTheme, type Theme } from '../../lib/theme'

interface Props { onClose: () => void }

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return !isNaN(new Date(s).getTime())
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(l => l.trim())
    .map(line => {
      const fields: string[] = []
      let cur = ''
      let inQ = false
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { fields.push(cur.trim().replace(/^"|"$/g, '')); cur = '' }
        else { cur += ch }
      }
      fields.push(cur.trim().replace(/^"|"$/g, ''))
      return fields
    })
}

function parseDateStr(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10)
    let day: number, month: number
    if (a > 12 && b <= 12) { day = a; month = b }
    else { day = b; month = a }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

interface ParsedRow {
  date: string
  customers: number
  products: Record<string, number>  // product name → units
}

function parseCSVRows(
  rows: string[][],
  productList: ProductRead[],
): { parsed: ParsedRow[]; skipped: number } {
  if (rows.length < 2) return { parsed: [], skipped: 0 }
  const headers = rows[0].map(h => h.toLowerCase().trim())
  const dateIdx = headers.findIndex(h => h === 'date')
  const custIdx = headers.findIndex(h => h === 'customers' || h === 'customer')
  if (dateIdx < 0 || custIdx < 0) return { parsed: [], skipped: rows.length - 1 }

  // Map header names to product ids
  const productCols: Array<{ colIdx: number; productName: string }> = []
  for (let i = 0; i < headers.length; i++) {
    if (i === dateIdx || i === custIdx) continue
    const matchedProd = productList.find(
      p => p.name.toLowerCase() === headers[i]
    )
    if (matchedProd) {
      productCols.push({ colIdx: i, productName: matchedProd.name })
    }
  }

  const parsed: ParsedRow[] = []
  let skipped = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const rawDate = row[dateIdx] ?? ''
    const rawCust = row[custIdx] ?? ''
    const dateIso = parseDateStr(rawDate)
    const customers = parseInt(rawCust, 10)
    if (!dateIso || isNaN(customers) || customers < 0) { skipped++; continue }
    const products: Record<string, number> = {}
    for (const { colIdx, productName } of productCols) {
      const units = parseFloat(row[colIdx] ?? '')
      if (!isNaN(units) && units > 0) products[productName] = units
    }
    parsed.push({ date: dateIso, customers, products })
  }

  return { parsed, skipped }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PastDaysModal({ onClose }: Props) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])

  const [records, setRecords] = useState<DayRecordRead[]>([])
  const [products, setProducts] = useState<ProductRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add/edit form
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [customers, setCustomers] = useState('')
  const [unitsSold, setUnitsSold] = useState<Record<number, string>>({})
  const [existingSales, setExistingSales] = useState<SaleRead[]>([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // CSV import
  const [showImport, setShowImport] = useState(false)
  const [csvRows, setCsvRows] = useState<ParsedRow[]>([])
  const [csvSkipped, setCsvSkipped] = useState(0)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResult, setCsvResult] = useState<string | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)

  const loadRecords = async () => {
    setLoading(true)
    try {
      const [data, prods] = await Promise.all([
        api.dayRecords.list(),
        api.products.list(),
      ])
      setRecords([...data].sort((a, b) => b.date.localeCompare(a.date)))
      setProducts(prods)
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
    setUnitsSold({})
    setExistingSales([])
    setSaveError(null)
    setShowForm(true)
  }

  const openEdit = async (r: DayRecordRead) => {
    setEditId(r.id)
    setDate(r.date)
    setCustomers(String(r.customers))
    setSaveError(null)
    setSalesLoading(true)
    setShowForm(true)
    try {
      const existing = await api.sales.list(r.id)
      setExistingSales(existing)
      const map: Record<number, string> = {}
      for (const s of existing) map[s.product_id] = String(s.units_sold)
      setUnitsSold(map)
    } catch {
      setExistingSales([])
      setUnitsSold({})
    } finally {
      setSalesLoading(false)
    }
  }

  const closeForm = () => {
    setShowForm(false)
    setEditId(null)
    setSaveError(null)
    setUnitsSold({})
    setExistingSales([])
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

    const existing = records.find(r => r.date === date && r.id !== editId)
    if (existing) {
      Alert.alert(
        'Record already exists',
        `A record for ${date} already exists (${existing.customers} customers). Overwrite it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Overwrite', style: 'destructive',
            onPress: async () => {
              // Load existing sales before overwrite so we can update/delete them
              try {
                const exSales = await api.sales.list(existing.id)
                setExistingSales(exSales)
              } catch {}
              await performSave(existing.id, cust)
            },
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
      let savedId: number
      const body = { customers: cust }

      if (overwriteId !== null) {
        await api.dayRecords.update(overwriteId, body)
        savedId = overwriteId
        setRecords(rs => {
          const updated = rs.map(r =>
            r.id === overwriteId ? { ...r, customers: cust } : r
          )
          return [...updated].sort((a, b) => b.date.localeCompare(a.date))
        })
      } else if (editId !== null) {
        await api.dayRecords.update(editId, body)
        savedId = editId
        setRecords(rs => rs.map(r => r.id === editId ? { ...r, customers: cust } : r))
      } else {
        const created = await api.dayRecords.create({ date, customers: cust })
        savedId = created.id
        setRecords(rs => [created, ...rs].sort((a, b) => b.date.localeCompare(a.date)))
      }

      // Sync product sales
      for (const product of products) {
        const unitsStr = unitsSold[product.id] ?? ''
        const units = parseFloat(unitsStr) || 0
        const existingSale = existingSales.find(s => s.product_id === product.id)
        if (existingSale) {
          if (units > 0) {
            await api.sales.update(existingSale.id, { units_sold: units })
          } else {
            await api.sales.delete(existingSale.id)
          }
        } else if (units > 0) {
          await api.sales.create({ day_record_id: savedId, product_id: product.id, units_sold: units })
        }
      }

      closeForm()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const deleteRecord = (id: number, dateStr: string) => {
    Alert.alert(
      'Delete Record',
      `Delete the record for ${dateStr}? This cannot be undone.`,
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

  // ── CSV import ───────────────────────────────────────────────────────────────

  const openImport = () => {
    setCsvRows([])
    setCsvSkipped(0)
    setCsvResult(null)
    setCsvError(null)
    setShowImport(true)
  }

  const handlePickFile = async () => {
    try {
      // Dynamic import so the app still works if expo-document-picker isn't installed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const DocumentPicker = await import('expo-document-picker') as any
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'text/comma-separated-values', '*/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      const uri: string = asset.uri

      // Read file
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FileSystem = await import('expo-file-system') as any
      const text: string = await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' })
      const rows = parseCSV(text)
      const { parsed, skipped } = parseCSVRows(rows, products)
      setCsvRows(parsed)
      setCsvSkipped(skipped)
      setCsvError(parsed.length === 0 ? 'No valid rows found. Make sure the file has date and customers columns.' : null)
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : 'Failed to read file.')
    }
  }

  const runImport = async () => {
    if (csvRows.length === 0) return
    setCsvImporting(true)
    setCsvError(null)
    let imported = 0
    let failed = 0

    for (const row of csvRows) {
      try {
        // Check for existing record
        const existing = records.find(r => r.date === row.date)
        let dayId: number
        if (existing) {
          await api.dayRecords.update(existing.id, { customers: row.customers })
          dayId = existing.id
          // Delete old product sales for this day to re-create
          try {
            const oldSales = await api.sales.list(existing.id)
            for (const s of oldSales) await api.sales.delete(s.id)
          } catch {}
        } else {
          const created = await api.dayRecords.create({ date: row.date, customers: row.customers })
          dayId = created.id
        }

        // Create product sales
        for (const product of products) {
          const units = row.products[product.name]
          if (units != null && units > 0) {
            await api.sales.create({ day_record_id: dayId, product_id: product.id, units_sold: units })
          }
        }

        imported++
      } catch {
        failed++
      }
    }

    await loadRecords()
    setCsvImporting(false)
    setCsvResult(
      failed === 0
        ? `Imported ${imported} day${imported !== 1 ? 's' : ''} successfully.`
        : `Imported ${imported}, failed ${failed}.`
    )
  }

  const handleBack = () => {
    if (showForm) { closeForm() }
    else if (showImport) { setShowImport(false) }
    else { onClose() }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const headerTitle = showForm
    ? (editId ? 'Edit Day' : 'Add Past Day')
    : showImport
      ? 'Import CSV'
      : 'Past Days'

  const backLabel = showForm || showImport ? 'Cancel' : 'Manage'

  return (
    <Modal visible animationType="slide" onRequestClose={handleBack}>
      <SafeAreaView style={styles.root} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={c.onPrimary} />
            <Text style={styles.backLabel}>{backLabel}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          {!showForm && !showImport && (
            <View style={styles.headerBtns}>
              <TouchableOpacity onPress={openImport} style={styles.iconHeaderBtn} hitSlop={8}>
                <Ionicons name="cloud-upload-outline" size={22} color={c.onPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={openAdd} style={styles.addBtn} hitSlop={8}>
                <Ionicons name="add" size={24} color={c.onPrimary} />
              </TouchableOpacity>
            </View>
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
          {showImport && !csvResult && (
            <View style={{ width: 40 }} />
          )}
        </View>

        {/* ── Add / Edit form ── */}
        {showForm && (
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
                Format: YYYY-MM-DD. Add earlier dates to build up more history.
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

              {/* Per-product inputs */}
              {products.length > 0 && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
                    Products sold (optional)
                  </Text>
                  {salesLoading ? (
                    <ActivityIndicator size="small" color={c.primary} style={{ marginTop: 8 }} />
                  ) : (
                    products.map(product => (
                      <View key={product.id} style={styles.productRow}>
                        <Text style={styles.productRowLabel} numberOfLines={1}>
                          {product.name}
                          <Text style={styles.productRowUnit}> ({product.unit})</Text>
                        </Text>
                        <TextInput
                          style={styles.productInput}
                          value={unitsSold[product.id] ?? ''}
                          onChangeText={v =>
                            setUnitsSold(m => ({ ...m, [product.id]: v }))
                          }
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={c.textMuted}
                        />
                      </View>
                    ))
                  )}
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {/* ── CSV Import view ── */}
        {showImport && (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.importHint}>
              Pick a CSV file with columns: <Text style={{ fontWeight: '700' }}>date</Text>,{' '}
              <Text style={{ fontWeight: '700' }}>customers</Text>
              {products.length > 0
                ? `, and optionally a column for each product (${products.map(p => p.name).join(', ')}).`
                : '.'}
            </Text>
            <Text style={styles.importSubHint}>
              Dates can be YYYY-MM-DD or DD/MM/YYYY. Existing dates will be overwritten.
            </Text>

            {csvResult ? (
              <>
                <View style={styles.importSuccess}>
                  <Ionicons name="checkmark-circle" size={24} color="#16a34a" />
                  <Text style={styles.importSuccessText}>{csvResult}</Text>
                </View>
                <TouchableOpacity
                  style={styles.importBtn}
                  onPress={() => setShowImport(false)}
                >
                  <Text style={styles.importBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.importBtn}
                  onPress={() => void handlePickFile()}
                >
                  <Ionicons name="document-outline" size={20} color={c.onPrimary} />
                  <Text style={styles.importBtnText}>Choose CSV file</Text>
                </TouchableOpacity>

                {csvError && (
                  <Text style={styles.importError}>{csvError}</Text>
                )}

                {csvRows.length > 0 && (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewTitle}>
                      {csvRows.length} day{csvRows.length !== 1 ? 's' : ''} ready to import
                      {csvSkipped > 0 ? ` (${csvSkipped} rows skipped — couldn't parse)` : ''}
                    </Text>
                    {csvRows.slice(0, 5).map(row => (
                      <Text key={row.date} style={styles.previewRow}>
                        {row.date} — {row.customers} customers
                        {Object.entries(row.products).length > 0
                          ? ' · ' + Object.entries(row.products).map(([n, u]) => `${u} ${n}`).join(', ')
                          : ''}
                      </Text>
                    ))}
                    {csvRows.length > 5 && (
                      <Text style={styles.previewMore}>…and {csvRows.length - 5} more</Text>
                    )}

                    <TouchableOpacity
                      style={[styles.importConfirmBtn, csvImporting && { opacity: 0.6 }]}
                      onPress={() => void runImport()}
                      disabled={csvImporting}
                    >
                      {csvImporting
                        ? <ActivityIndicator size="small" color={c.onPrimary} />
                        : <Text style={styles.importBtnText}>
                            Import {csvRows.length} day{csvRows.length !== 1 ? 's' : ''}
                          </Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        )}

        {/* ── Record list ── */}
        {!showForm && !showImport && (
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
                    {r.outlier_status === 'flagged' && (
                      <Text style={styles.outlierBadge}>Flagged as unusual</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => void openEdit(r)}
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
    headerBtns: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconHeaderBtn: { padding: 4 },
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

    productRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginBottom: 8, backgroundColor: c.card, borderRadius: 10,
      borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 10,
    },
    productRowLabel: { flex: 1, fontSize: 14, color: c.text, fontWeight: '600' },
    productRowUnit: { fontWeight: '400', color: c.textMuted, fontSize: 12 },
    productInput: {
      width: 80, textAlign: 'right', fontSize: 15, color: c.primaryDark,
      fontWeight: '700', borderWidth: 1, borderColor: c.border,
      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
      backgroundColor: c.bg,
    },

    // CSV import
    importHint: {
      fontSize: 14, color: c.text, lineHeight: 22, marginBottom: 6,
    },
    importSubHint: {
      fontSize: 12, color: c.textSub, lineHeight: 18, marginBottom: 20,
    },
    importBtn: {
      backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      marginBottom: 16,
    },
    importConfirmBtn: {
      backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      marginTop: 14,
    },
    importBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },
    importError: {
      fontSize: 13, color: c.danger, marginBottom: 12, lineHeight: 18,
    },
    previewBox: {
      backgroundColor: c.card, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: c.border,
    },
    previewTitle: {
      fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 10,
    },
    previewRow: {
      fontSize: 12, color: c.textSub, marginBottom: 4, lineHeight: 18,
    },
    previewMore: {
      fontSize: 12, color: c.textMuted, fontStyle: 'italic', marginTop: 4,
    },
    importSuccess: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: '#f0fdf4', borderRadius: 14, padding: 16, marginBottom: 16,
      borderWidth: 1, borderColor: '#86efac',
    },
    importSuccessText: { fontSize: 14, color: '#16a34a', fontWeight: '600', flex: 1 },
  })
}
