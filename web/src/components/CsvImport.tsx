import { useEffect, useRef, useState } from 'react'
import { dayRecords, products as productsApi, sales as salesApi, saleEvents } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { HourlyBackfillSlot, ProductRead } from '../api/types'

// ── Date parsing ────────────────────────────────────────────────────────────

interface ParsedDate {
  iso: string        // YYYY-MM-DD sent to API
  display: string    // human-readable shown in preview
  ambiguous: boolean // true when DD/MM vs MM/DD can't be determined
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function displayDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function parseDate(raw: string): ParsedDate | null {
  const s = raw.trim()

  // YYYY-MM-DD — canonical, never ambiguous
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00')
    if (isNaN(d.getTime())) return null
    return { iso: s, display: displayDate(d), ambiguous: false }
  }

  // D/M/YYYY  DD/MM/YYYY  MM/DD/YYYY  (separator can be / - .)
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (m) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    const y = parseInt(m[3], 10)
    let day: number, month: number, ambiguous = false

    if (a > 12 && b <= 12) {        // a can only be day → DD/MM
      day = a; month = b
    } else if (b > 12 && a <= 12) { // b can only be day → MM/DD
      month = a; day = b
    } else {                        // both ≤ 12 → assume DD/MM, flag it
      day = a; month = b; ambiguous = true
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const date = new Date(y, month - 1, day)
    // Guard against JS rolling over (e.g. 31 Feb → 3 Mar)
    if (isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return { iso: toISO(y, month, day), display: displayDate(date), ambiguous }
  }

  return null
}

// ── CSV parsing ─────────────────────────────────────────────────────────────
// Skip leading comment lines (starting with #) when locating the header row,
// so the hourly template's first-line note doesn't swallow the real headers.

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (!lines.length) return { headers: [], rows: [] }

  // Find the first non-comment line — that's the headers row
  const headerIdx = lines.findIndex(l => !l.trim().startsWith('#'))
  if (headerIdx === -1) return { headers: [], rows: [] }

  return {
    headers: lines[headerIdx].split(',').map(h => h.trim()),
    rows:    lines.slice(headerIdx + 1).map(l => l.split(',').map(v => v.trim())),
  }
}

interface CsvRow {
  date: string
  dateRaw: string
  dateDisplay: string
  dateAmbiguous: boolean
  customers: number
  productUnits: Record<string, number>
  hourlyCustomers: HourlyBackfillSlot[]   // h00–h23 columns, empty when absent
  hourlyAutoSummed: boolean               // true when customers was derived from hourly sum
}

interface Props { onImported: () => void }

export default function CsvImport({ onImported }: Props) {
  const { t } = useLanguage()
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [preview, setPreview]         = useState<CsvRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [fileName, setFileName]       = useState('')
  const [importing, setImporting]     = useState(false)
  const [progress, setProgress]       = useState<{ done: number; total: number } | null>(null)
  const [result, setResult]           = useState<{ ok: number; skipped: number; failedDates: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { productsApi.list().then(setProductList).catch(() => {}) }, [])

  function downloadTemplate() {
    const headers = ['date', 'customers', ...productList.map(p => p.name)]
    // Prefix the example row with # so the parser skips it automatically on import.
    // Default date is 2026-01-01 so owners have a clear starting point to work from.
    const example = ['# EXAMPLE — delete this row before importing: 2026-01-01', '95', ...productList.map(() => '0')]
    const csv = [headers, example].map(r => r.join(',')).join('\n')
    triggerDownload(csv, 'ope-template.csv')
  }

  function downloadHourlyTemplate() {
    const hourCols = Array.from({ length: 24 }, (_, i) => `h${String(i).padStart(2, '0')}`)
    const headers  = ['date', 'customers', ...productList.map(p => p.name), ...hourCols]
    // Prefix both the note and the example row with # so both are skipped on import.
    const note     = `# Optional hourly columns h00–h23: customers per hour (leave blank if unknown). When hourly data is present, the daily total is auto-computed if customers column is 0.`
    // Default date starts at 2026-01-01.
    const exampleCells = ['# EXAMPLE — delete this row before importing: 2026-01-01', '0 (or 95)', ...productList.map(() => '0'), ...Array(24).fill('')]
    const csv      = [note, headers.join(','), exampleCells.join(',')].join('\n')
    triggerDownload(csv, 'ope-template-hourly.csv')
  }

  function triggerDownload(csv: string, filename: string) {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: filename,
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = evt => {
      const { headers, rows } = parseCSV((evt.target?.result ?? '') as string)
      const errors: string[] = []
      const parsed: CsvRow[] = []

      const productCols: { idx: number; product: ProductRead }[] = []
      const hourlyCols: { idx: number; hour: number }[] = []

      for (let i = 2; i < headers.length; i++) {
        const h = headers[i]
        if (!h) continue
        const hourMatch = h.match(/^h(\d{2})$/i)
        if (hourMatch) {
          const hr = parseInt(hourMatch[1], 10)
          if (hr >= 0 && hr <= 23) { hourlyCols.push({ idx: i, hour: hr }); continue }
        }
        if (h.startsWith('#')) continue   // comment columns
        const prod = productList.find(p => p.name.toLowerCase() === h.toLowerCase())
        if (prod) {
          productCols.push({ idx: i, product: prod })
        } else {
          errors.push(`Column "${h}" doesn't match any of your products — it will be skipped.`)
        }
      }

      rows.forEach((row, ri) => {
        if (row[0]?.trim().startsWith('#')) return   // skip comment/example rows
        const line = ri + 2
        const rawDate = row[0] ?? ''
        const custRaw = parseInt(row[1] ?? '')

        const dateParsed = parseDate(rawDate)
        if (!dateParsed) {
          errors.push(`Row ${line}: can't read date "${rawDate}" — use YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY`)
          return
        }

        const productUnits: Record<string, number> = {}
        for (const { idx, product } of productCols) {
          const v = parseFloat(row[idx] ?? '')
          if (!isNaN(v) && v > 0) productUnits[product.name] = v
        }

        const hourlyCustomers: HourlyBackfillSlot[] = []
        for (const { idx, hour } of hourlyCols) {
          const v = parseInt(row[idx] ?? '', 10)
          if (!isNaN(v) && v > 0) hourlyCustomers.push({ hour, customers: v })
        }

        // Auto-sum: when hourly columns are present and their total exceeds (or
        // replaces) the explicit customers column, use the hourly sum as the
        // daily total.  The daily total is always the source of truth, and
        // hourly data is the most granular form of it.
        const hourlySum = hourlyCustomers.reduce((s, h) => s + h.customers, 0)
        let customers = custRaw
        let hourlyAutoSummed = false

        if (hourlySum > 0) {
          if (isNaN(custRaw) || custRaw <= 0) {
            // No explicit daily total — derive from hourly
            customers = hourlySum
            hourlyAutoSummed = true
          } else if (hourlySum > custRaw) {
            // Hourly columns sum to more than the daily total the user entered.
            // The entered daily total is the source of truth — keep it.
            // Only warn so the user can review; do NOT overwrite their value.
            errors.push(
              `Row ${line} (${dateParsed.display}): hourly columns sum to ${hourlySum} but customers column says ${custRaw}. ` +
              `Keeping your entered total of ${custRaw}. If ${hourlySum} is correct, update the customers column.`
            )
            // customers stays at custRaw — intentional; the explicit entry wins
          }
        }

        if (isNaN(customers) || customers < 0) {
          errors.push(`Row ${line}: invalid customer count "${row[1]}"`)
          return
        }

        parsed.push({
          date:             dateParsed.iso,
          dateRaw:          rawDate,
          dateDisplay:      dateParsed.display,
          dateAmbiguous:    dateParsed.ambiguous,
          customers,
          productUnits,
          hourlyCustomers,
          hourlyAutoSummed,
        })
      })

      setParseErrors(errors)
      setPreview(parsed)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setImporting(true)
    setProgress({ done: 0, total: preview.length })

    let ok = 0
    let skipped = 0
    const failedDates: string[] = []

    // Process rows concurrently in small batches to balance speed vs server load
    const BATCH = 4
    for (let i = 0; i < preview.length; i += BATCH) {
      const batch = preview.slice(i, i + BATCH)
      await Promise.all(batch.map(async row => {
        try {
          const day = await dayRecords.create({ date: row.date, customers: row.customers })
          // Product sales and hourly data can run in parallel for this row
          await Promise.all([
            ...Object.entries(row.productUnits).map(([name, units]) => {
              const prod = productList.find(p => p.name === name)
              return prod ? salesApi.create({ day_record_id: day.id, product_id: prod.id, units_sold: units }) : Promise.resolve()
            }),
            row.hourlyCustomers.length > 0
              ? saleEvents.backfillHourly(row.date, row.hourlyCustomers)
              : Promise.resolve(),
          ])
          ok++
        } catch {
          skipped++
          failedDates.push(row.dateDisplay)
        }
      }))
      setProgress({ done: Math.min(i + BATCH, preview.length), total: preview.length })
    }

    setImporting(false)
    setProgress(null)
    setResult({ ok, skipped, failedDates })
    setPreview([])
    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
    if (ok > 0) onImported()
  }

  const hasAmbiguous = preview.some(r => r.dateAmbiguous)
  const hasAutoSummed = preview.some(r => r.hourlyAutoSummed)

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Format guidance + template */}
      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 space-y-2">
        <p className="text-sm text-slate-700 font-medium">{t('csvFormatTitle')}</p>
        <p className="text-sm text-slate-600">{t('csvDateHelp')}</p>
        <p className="text-xs text-slate-500">{t('csvExampleNote')}</p>

        {/* Excel SUM formula tip */}
        <div className="mt-2 bg-white border border-teal-100 rounded-lg px-3 py-2">
          <p className="text-xs text-slate-600 leading-relaxed">📋 {t('csvSumTip')}</p>
        </div>

        {/* Earlier dates tip */}
        <div className="bg-white border border-teal-100 rounded-lg px-3 py-2">
          <p className="text-xs text-slate-600 leading-relaxed">📅 {t('csvEarlierDatesTip')}</p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={downloadTemplate}
            className="text-sm text-teal-600 border border-teal-200 rounded-lg
                       px-3 py-1.5 hover:bg-white transition-colors"
          >
            {t('csvDownloadTemplate')}
          </button>
          <button
            onClick={downloadHourlyTemplate}
            className="text-sm text-slate-600 border border-slate-200 rounded-lg
                       px-3 py-1.5 hover:bg-white transition-colors"
          >
            {t('csvDownloadHourly')}
            <span className="ml-1.5 text-xs text-slate-400">{t('csvForRegisterExports')}</span>
          </button>
        </div>
      </div>

      {/* File picker */}
      <div
        className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center
                   hover:border-teal-400 transition-colors cursor-pointer"
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        <span className="text-3xl block mb-2">📂</span>
        {fileName
          ? <span className="text-slate-700 font-medium">{fileName}</span>
          : <span className="text-slate-400 text-sm">{t('csvChooseFile')}</span>
        }
      </div>

      {/* Parse errors / warnings */}
      {parseErrors.length > 0 && (
        <ul className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
          {parseErrors.map((msg, i) => <li key={i}>⚠ {msg}</li>)}
        </ul>
      )}

      {/* Auto-sum notice */}
      {hasAutoSummed && (
        <div className="text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-4 py-3">
          <strong>{t('csvAutoSumTitle')}</strong> {t('csvAutoSumDesc')}
        </div>
      )}

      {/* Date-ambiguity warning */}
      {hasAmbiguous && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          {t('csvAmbiguousWarning')}{' '}
          {t('csvAmbiguousCheck')}{' '}
          <span className="bg-amber-200 text-amber-800 px-1 rounded text-xs font-medium">?</span>{' '}
          {t('csvAmbiguousCheck2')}
        </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            {t('csvPreviewTitle', { n: String(preview.length) })}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="py-2 px-3">{t('csvColInFile')}</th>
                  <th className="py-2 px-3">{t('csvColReadAs')}</th>
                  <th className="py-2 px-3">{t('csvColCustomers')}</th>
                  {productList.map(p => (
                    <th key={p.id} className="py-2 px-3">{p.name} ({p.unit})</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-1.5 px-3 font-mono text-xs text-slate-500">{row.dateRaw}</td>
                    <td className="py-1.5 px-3 text-slate-700">
                      {row.dateDisplay}
                      {row.dateAmbiguous && (
                        <span className="ml-1.5 bg-amber-200 text-amber-800 text-xs font-medium px-1 rounded">?</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 font-semibold">
                      {row.customers}
                      {row.hourlyAutoSummed && (
                        <span className="ml-1 text-teal-600 text-xs" title="Auto-computed from hourly columns">★</span>
                      )}
                    </td>
                    {productList.map(p => (
                      <td key={p.id} className="py-1.5 px-3 text-slate-500">
                        {row.productUnits[p.name] ?? <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 10 && (
              <p className="text-xs text-slate-400 px-3 py-2 border-t border-slate-100">
                {t('csvMoreRows', { n: String(preview.length - 10) })}
              </p>
            )}
          </div>

          {/* Progress bar (visible during import) */}
          {importing && progress && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>{t('csvImportingLabel')}</span>
                <span>{progress.done} / {progress.total}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {!importing && (
            <button
              onClick={handleImport} disabled={importing}
              className="mt-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300
                         text-white font-medium py-2 px-5 rounded-lg transition-colors"
            >
              {t('csvImportBtn', { n: String(preview.length) })}
            </button>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`text-sm rounded-lg px-4 py-3 border ${
          result.skipped === 0
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : 'text-amber-700 bg-amber-50 border-amber-200'
        }`}>
          <p className="font-medium">
            {result.skipped === 0
              ? t('csvImportSuccess', { ok: String(result.ok), s: result.ok !== 1 ? 's' : '' })
              : t('csvImportPartial', { ok: String(result.ok), s: result.ok !== 1 ? 's' : '', skipped: String(result.skipped) })
            }
          </p>
          {result.failedDates.length > 0 && (
            <p className="mt-1 text-xs">
              {t('csvImportSkipped', { dates: result.failedDates.join(', ') })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
