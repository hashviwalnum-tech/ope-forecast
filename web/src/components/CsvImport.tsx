import { useEffect, useRef, useState } from 'react'
import { dayRecords, products as productsApi, sales as salesApi, saleEvents } from '../api/client'
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

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (!lines.length) return { headers: [], rows: [] }
  return {
    headers: lines[0].split(',').map(h => h.trim()),
    rows:    lines.slice(1).map(l => l.split(',').map(v => v.trim())),
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
}

interface Props { onImported: () => void }

export default function CsvImport({ onImported }: Props) {
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [preview, setPreview]         = useState<CsvRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [fileName, setFileName]       = useState('')
  const [importing, setImporting]     = useState(false)
  const [result, setResult]           = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { productsApi.list().then(setProductList).catch(() => {}) }, [])

  function downloadTemplate() {
    const headers = ['date', 'customers', ...productList.map(p => p.name)]
    const example = ['2024-01-15', '95', ...productList.map(() => '0')]
    const csv = [headers, example].map(r => r.join(',')).join('\n')
    triggerDownload(csv, 'ope-template.csv')
  }

  function downloadHourlyTemplate() {
    const hourCols = Array.from({ length: 24 }, (_, i) => `h${String(i).padStart(2, '0')}`)
    const headers  = ['date', 'customers', ...productList.map(p => p.name), ...hourCols]
    const example  = ['2024-01-15', '95', ...productList.map(() => '0'), ...Array(24).fill('')]
    const note     = `# Optional hourly columns h00–h23: customers per hour (leave blank if unknown)`
    const csv      = [note, headers.join(','), example.join(',')].join('\n')
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
    setResult('')
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
        if (h.startsWith('#')) continue   // comment columns (hourly template note row)
        const prod = productList.find(p => p.name.toLowerCase() === h.toLowerCase())
        if (prod) {
          productCols.push({ idx: i, product: prod })
        } else {
          errors.push(`Column "${h}" doesn't match any of your products — it will be skipped.`)
        }
      }

      rows.forEach((row, ri) => {
        if (row[0]?.trim().startsWith('#')) return   // skip comment rows
        const line = ri + 2
        const rawDate = row[0] ?? ''
        const cust    = parseInt(row[1] ?? '')

        const dateParsed = parseDate(rawDate)
        if (!dateParsed) {
          errors.push(`Row ${line}: can't read date "${rawDate}" — use YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY`)
          return
        }
        if (isNaN(cust) || cust < 0) {
          errors.push(`Row ${line}: invalid customer count "${row[1]}"`)
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

        parsed.push({
          date:          dateParsed.iso,
          dateRaw:       rawDate,
          dateDisplay:   dateParsed.display,
          dateAmbiguous: dateParsed.ambiguous,
          customers:     cust,
          productUnits,
          hourlyCustomers,
        })
      })

      setParseErrors(errors)
      setPreview(parsed)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setImporting(true)
    let ok = 0, skipped = 0
    for (const row of preview) {
      try {
        const day = await dayRecords.create({ date: row.date, customers: row.customers })
        for (const [name, units] of Object.entries(row.productUnits)) {
          const prod = productList.find(p => p.name === name)
          if (prod) {
            await salesApi.create({ day_record_id: day.id, product_id: prod.id, units_sold: units })
          }
        }
        if (row.hourlyCustomers.length > 0) {
          await saleEvents.backfillHourly(row.date, row.hourlyCustomers)
        }
        ok++
      } catch {
        skipped++
      }
    }
    setImporting(false)
    setResult(`Done: ${ok} rows imported, ${skipped} skipped (duplicates or errors).`)
    setPreview([])
    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
    if (ok > 0) onImported()
  }

  const hasAmbiguous = preview.some(r => r.dateAmbiguous)

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Format guidance + template */}
      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 space-y-2">
        <p className="text-sm text-slate-700 font-medium">Expected format</p>
        <p className="text-sm text-slate-600">
          The <strong>date</strong> column accepts <code className="bg-white px-1 rounded">YYYY-MM-DD</code> (e.g.{' '}
          <code className="bg-white px-1 rounded">2024-01-15</code>), <code className="bg-white px-1 rounded">DD/MM/YYYY</code>,
          or <code className="bg-white px-1 rounded">MM/DD/YYYY</code>. The preview always shows how we read your
          dates — check it before saving.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadTemplate}
            className="text-sm text-teal-600 border border-teal-200 rounded-lg
                       px-3 py-1.5 hover:bg-white transition-colors"
          >
            Download blank template
          </button>
          <button
            onClick={downloadHourlyTemplate}
            className="text-sm text-slate-600 border border-slate-200 rounded-lg
                       px-3 py-1.5 hover:bg-white transition-colors"
          >
            Download hourly template
            <span className="ml-1.5 text-xs text-slate-400">(for register exports)</span>
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
          : <span className="text-slate-400 text-sm">Click to choose a CSV file</span>
        }
      </div>

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <ul className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
          {parseErrors.map((msg, i) => <li key={i}>⚠ {msg}</li>)}
        </ul>
      )}

      {/* Date-ambiguity warning */}
      {hasAmbiguous && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <strong>Some dates could be DD/MM or MM/DD</strong> — we assumed DD/MM for those. Check the{' '}
          <strong>Read as</strong> column below and make sure the dates look right before importing.
          Rows with a <span className="bg-amber-200 text-amber-800 px-1 rounded text-xs font-medium">?</span>{' '}
          badge are the ones to double-check.
        </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            Preview — {preview.length} rows ready to import
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="py-2 px-3">In your file</th>
                  <th className="py-2 px-3">Read as</th>
                  <th className="py-2 px-3">Customers</th>
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
                    <td className="py-1.5 px-3 font-semibold">{row.customers}</td>
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
                …and {preview.length - 10} more rows
              </p>
            )}
          </div>

          <button
            onClick={handleImport} disabled={importing}
            className="mt-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300
                       text-white font-medium py-2 px-5 rounded-lg transition-colors"
          >
            {importing ? 'Importing…' : `Import ${preview.length} rows`}
          </button>
        </div>
      )}

      {result && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          {result}
        </p>
      )}
    </div>
  )
}
