import { useEffect, useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as api from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { currencySymbol } from '../lib/money'
import type { Theme } from '../lib/theme'
import type { CurrencyRead } from '../api/types'

/**
 * Guess a currency from the device, as a SUGGESTION only.
 *
 * Mirrors the web picker. The owner always confirms: a wrong guess applied
 * silently means every price they type afterwards is mislabelled.
 */
export function guessCurrency(supported: Set<string>, locales: string[]): string | null {
  for (const tag of locales) {
    if (!tag) continue
    try {
      const region = new Intl.Locale(tag).maximize().region
      const code = region ? REGION_CURRENCY[region] : undefined
      if (code && supported.has(code)) return code
    } catch { /* try the next tag */ }
  }
  return null
}

/**
 * Country → currency for the places Ope is most likely to be opened from.
 * A missing country simply produces no guess, which is a far better failure
 * than a confident wrong one.
 */
const REGION_CURRENCY: Record<string, string> = {
  IL: 'ILS', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', CN: 'CNY', KR: 'KRW', IN: 'INR', ID: 'IDR', SG: 'SGD',
  MY: 'MYR', TH: 'THB', VN: 'VND', PH: 'PHP', BD: 'BDT', PK: 'PKR',
  TR: 'TRY', RU: 'RUB', UA: 'UAH', CH: 'CHF', NO: 'NOK', SE: 'SEK',
  DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', EG: 'EGP', MA: 'MAD', GH: 'GHS',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
  JO: 'JOD', LB: 'LBP', IQ: 'IQD',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR',
  AT: 'EUR', IE: 'EUR', PT: 'EUR', GR: 'EUR', FI: 'EUR', SK: 'EUR',
  SI: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', CY: 'EUR', MT: 'EUR',
  LU: 'EUR', HR: 'EUR',
}

/** The currency's name in the owner's language, falling back to the API's English. */
function localisedName(code: string, lang: string, fallback: string): string {
  try {
    // Not present in every React Native runtime — hence the fallback.
    const DisplayNames = (Intl as unknown as {
      DisplayNames?: new (l: string[], o: { type: string }) => { of(c: string): string | undefined }
    }).DisplayNames
    if (DisplayNames) {
      const name = new DisplayNames([lang], { type: 'currency' }).of(code)
      if (name && name !== code) return name
    }
  } catch { /* fall through */ }
  return fallback
}

interface Props {
  value: string
  onChange: (code: string) => void
  /** Propose a device-based guess when nothing is selected yet. */
  suggestOnLoad?: boolean
}

export default function CurrencyPicker({ value, onChange, suggestOnLoad = false }: Props) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const { t, lang } = useLanguage()
  const [list, setList] = useState<CurrencyRead[]>([])
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    api.currencies.list()
      .then(res => {
        if (cancelled) return
        setList(res.currencies)
        if (suggestOnLoad && !value) {
          const guess = guessCurrency(new Set(res.currencies.map(x => x.code)), [lang])
          if (guess) onChange(guess)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
    // Run once: re-suggesting after the owner has picked would fight them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = useMemo(() => {
    const rows = list.map(x => ({
      code: x.code,
      label: localisedName(x.code, lang, x.name),
      symbol: currencySymbol(x.code, lang),
    }))
    const q = query.trim().toLowerCase()
    const filtered = q
      ? rows.filter(r => r.label.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
      : rows
    try {
      const collator = new Intl.Collator(lang)
      return filtered.sort((a, b) => collator.compare(a.label, b.label))
    } catch {
      return filtered.sort((a, b) => a.label.localeCompare(b.label))
    }
  }, [list, lang, query])

  if (failed) {
    return <Text style={styles.error}>{t('currencyLoadFailed')}</Text>
  }

  const selected = list.find(x => x.code === value)

  return (
    <>
      <Pressable style={styles.field} onPress={() => setOpen(true)} disabled={!list.length}>
        <Text style={[styles.fieldText, !value && styles.placeholder]}>
          {selected
            ? `${localisedName(selected.code, lang, selected.name)} — ${selected.code} ${currencySymbol(selected.code, lang)}`
            : t('currencyChoosePlaceholder')}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('currencyLabel')}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('currencyChoosePlaceholder')}
            placeholderTextColor={c.textMuted}
          />
          <FlatList
            data={options}
            keyExtractor={item => item.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, item.code === value && styles.rowSelected]}
                onPress={() => { onChange(item.code); setOpen(false); setQuery('') }}
              >
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.rowCode}>{item.code} {item.symbol}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </>
  )
}

function makeStyles(c: Theme) {
  return StyleSheet.create({
    field: {
      backgroundColor: c.card, borderColor: c.border, borderWidth: 1,
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    },
    fieldText: { color: c.text, fontSize: 16 },
    placeholder: { color: c.textMuted },
    error: { color: c.textMuted, fontSize: 13, paddingVertical: 8 },
    sheet: { flex: 1, backgroundColor: c.bg, paddingTop: 56, paddingHorizontal: 16 },
    sheetHeader: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: 12,
    },
    sheetTitle: { color: c.text, fontSize: 20, fontWeight: '700' },
    close: { color: c.textMuted, fontSize: 22 },
    search: {
      backgroundColor: c.card, borderColor: c.border, borderWidth: 1,
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
      color: c.text, fontSize: 16, marginBottom: 12,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border,
    },
    rowSelected: { backgroundColor: c.card },
    rowLabel: { color: c.text, fontSize: 16, flexShrink: 1, paddingRight: 12 },
    rowCode: { color: c.textMuted, fontSize: 14 },
  })
}
