import { useEffect, useRef, useState } from 'react'
import { dayRecords, isApiError, products as productsApi, sales as salesApi, saleEvents } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { HourlyBackfillSlot, ProductRead } from '../api/types'
import { type CsvIssue, dedupeByDate, parseCSV, parseDate } from '../lib/csvParse'

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

/**
 * What actually happened, told apart rather than lumped into "skipped".
 *
 * Before this, any failure counted as skipped — so a day that was already in
 * the app (a harmless, expected 409 when re-importing an overlapping file)
 * read exactly like a server error, and a row that created the day but failed
 * on its product sales was reported as "skipped" while the day existed. The
 * owner would then retry, hit the duplicate error forever, and never learn
 * that some days had gone in with no product detail.
 */
interface ImportResult {
  ok: number
  /** Days already recorded in the app — left untouched, nothing lost. */
  alreadyHad: string[]
  /** The day went in but its products or hours did not — needs attention. */
  partial: string[]
  /** Nothing was written for these. */
  failed: string[]
  /**
   * Days stored with a different customer total than the file gave.
   *
   * This happens when sales were already tapped for that date: the app treats
   * the hour-by-hour taps as the better record and keeps the larger number
   * (spec §9). That is correct — but the preview cannot know about it, because
   * it only ever sees the file. Rather than let the preview quietly be wrong,
   * the stored number is compared to what was sent and any difference is
   * reported here.
   */
  adjusted: { date: string; from: number; to: number }[]
}

interface Props { onImported: () => void }

export default function CsvImport({ onImported }: Props) {
  const { t } = useLanguage()
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [preview, setPreview]         = useState<CsvRow[]>([])
  const [parseErrors, setParseErrors] = useState<CsvIssue[]>([])
  const [fileName, setFileName]       = useState('')
  const [importing, setImporting]     = useState(false)
  const [progress, setProgress]       = useState<{ done: number; total: number } | null>(null)
  const [result, setResult]           = useState<ImportResult | null>(null)
  // Product column confirmation: detected columns wait for explicit user sign-off
  const [detectedProductCols, setDetectedProductCols] = useState<ProductRead[]>([])
  const [confirmedProductIds, setConfirmedProductIds] = useState<Set<number>>(new Set())
  const [productColsConfirmed, setProductColsConfirmed] = useState(false)
  // Hold raw rows until the user has confirmed which product columns to include
  const [pendingRawRows, setPendingRawRows] = useState<string[][] | null>(null)
  const [pendingProductColMap, setPendingProductColMap] = useState<{ idx: number; product: ProductRead }[]>([])
  const [pendingHourlyCols, setPendingHourlyCols] = useState<{ idx: number; hour: number }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { productsApi.list().then(setProductList).catch(() => {}) }, [])

  function downloadTemplate() {
    const headers = ['date', 'customers', ...productList.map(p => p.name)]
    const example = ['# EXAMPLE — delete this row before importing: 2026-01-01', '95', ...productList.map(() => '0')]
    const csv = [headers, example].map(r => r.join(',')).join('\n')
    triggerDownload(csv, 'ope-template.csv')
  }

  function downloadHourlyTemplate() {
    const hourCols = Array.from({ length: 24 }, (_, i) => `h${String(i).padStart(2, '0')}`)
    const headers  = ['date', 'customers', ...productList.map(p => p.name), ...hourCols]
    const note     = `# Optional hourly columns h00–h23: customers per hour (leave blank if unknown). When hourly data is present, the daily total is auto-computed if customers column is 0.`
    const exampleCells = ['# EXAMPLE — delete this row before importing: 2026-01-01', '0', ...productList.map(() => '0'), ...Array(24).fill('')]
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

  function buildPreview(
    rows: string[][],
    productCols: { idx: number; product: ProductRead }[],
    hourlyCols: { idx: number; hour: number }[],
    existingErrors: CsvIssue[],
  ) {
    const errors = [...existingErrors]
    const parsed: CsvRow[] = []

    rows.forEach((row, ri) => {
      if (row[0]?.trim().startsWith('#')) return
      const line = ri + 2
      const rawDate = row[0] ?? ''
      const custRaw = parseInt(row[1] ?? '')

      const dateParsed = parseDate(rawDate)
      if (!dateParsed) {
        errors.push({ code: 'csvIssueBadDate', params: { line: String(line), value: rawDate } })
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

      const hourlySum = hourlyCustomers.reduce((s, h) => s + h.customers, 0)
      let customers = custRaw
      let hourlyAutoSummed = false

      if (hourlySum > 0) {
        if (isNaN(custRaw) || custRaw <= 0) {
          // No explicit daily total — derive from hourly (spec §9 case 2)
          customers = hourlySum
          hourlyAutoSummed = true
        } else if (hourlySum > custRaw) {
          // Hourly data is more granular and sums to MORE than the manual entry
          // → hourly wins (spec §9 case 1: "hours sum > manual total → hours win")
          customers = hourlySum
          hourlyAutoSummed = true
        }
        // else: hourlySum <= custRaw → keep manual total (spec §9 case 3)
      }

      if (isNaN(customers) || customers < 0) {
        errors.push({ code: 'csvIssueBadCustomers', params: { line: String(line), value: row[1] ?? '' } })
        return
      }

      parsed.push({
        date: dateParsed.iso,
        dateRaw: rawDate,
        dateDisplay: dateParsed.display,
        dateAmbiguous: dateParsed.ambiguous,
        customers,
        productUnits,
        hourlyCustomers,
        hourlyAutoSummed,
      })
    })

    // Resolve any date the file lists twice BEFORE sending anything. The
    // importer posts four rows at a time, so two rows for the same date used
    // to go out together and whichever landed first won — the stored number
    // depended on network timing. Last row wins, and the owner is told.
    const deduped = dedupeByDate(parsed)

    setParseErrors([...errors, ...deduped.issues])
    setPreview(deduped.rows)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setPreview([])
    setParseErrors([])
    setProductColsConfirmed(false)
    setDetectedProductCols([])
    setConfirmedProductIds(new Set())
    setPendingRawRows(null)

    const reader = new FileReader()
    reader.onload = evt => {
      const { headers, rows, issues } = parseCSV((evt.target?.result ?? '') as string)
      // Structural problems the parser found (encoding, ragged rows, an
      // unusual delimiter) travel with the column problems found below.
      const detectionErrors: CsvIssue[] = [...issues]

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
        if (h.startsWith('#')) continue
        const prod = productList.find(p => p.name.toLowerCase() === h.toLowerCase())
        if (prod) {
          productCols.push({ idx: i, product: prod })
        } else {
          detectionErrors.push({ code: 'csvIssueUnknownColumn', params: { name: h } })
        }
      }

      if (productCols.length > 0) {
        // Require explicit confirmation before including any product columns
        setPendingRawRows(rows)
        setPendingProductColMap(productCols)
        setPendingHourlyCols(hourlyCols)
        setDetectedProductCols(productCols.map(c => c.product))
        setConfirmedProductIds(new Set())
        setProductColsConfirmed(false)
        setParseErrors(detectionErrors)
      } else {
        // No product columns: proceed straight to preview (date+customers+hourly only)
        buildPreview(rows, [], hourlyCols, detectionErrors)
        setProductColsConfirmed(true)
      }
    }
    reader.readAsText(file)
  }

  function confirmProductCols() {
    if (!pendingRawRows) return
    const confirmedCols = pendingProductColMap.filter(c => confirmedProductIds.has(c.product.id))
    buildPreview(pendingRawRows, confirmedCols, pendingHourlyCols, parseErrors)
    setProductColsConfirmed(true)
  }

  function toggleProduct(id: number) {
    setConfirmedProductIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleImport() {
    setImporting(true)
    setProgress({ done: 0, total: preview.length })

    let ok = 0
    const alreadyHad: string[] = []
    const partial: string[] = []
    const failed: string[] = []
    const adjusted: ImportResult['adjusted'] = []

    const BATCH = 4
    for (let i = 0; i < preview.length; i += BATCH) {
      const batch = preview.slice(i, i + BATCH)
      await Promise.all(batch.map(async row => {
        // Step 1 — the day itself. A 409 means the app already has this date,
        // which is what happens on an overlapping re-import. Nothing is
        // written and nothing is lost, so it is not a failure.
        let dayId: number
        try {
          const day = await dayRecords.create({ date: row.date, customers: row.customers })
          dayId = day.id
          // Trust what came back, not what was sent.
          if (day.customers !== row.customers) {
            adjusted.push({ date: row.dateDisplay, from: row.customers, to: day.customers })
          }
        } catch (err) {
          if (isApiError(err, 409)) alreadyHad.push(row.dateDisplay)
          else failed.push(row.dateDisplay)
          return
        }

        // Step 2 — products and hours. The day now EXISTS, so a failure here
        // leaves it stored without its detail. That has to be reported as
        // partly-imported, never as "skipped" — the old code called it skipped,
        // which sent the owner off to retry a date that could only 409.
        try {
          await Promise.all([
            ...Object.entries(row.productUnits).map(([name, units]) => {
              const prod = productList.find(p => p.name === name)
              return prod ? salesApi.create({ day_record_id: dayId, product_id: prod.id, units_sold: units }) : Promise.resolve()
            }),
            row.hourlyCustomers.length > 0
              ? saleEvents.backfillHourly(row.date, row.hourlyCustomers)
              : Promise.resolve(),
          ])
          ok++
        } catch {
          partial.push(row.dateDisplay)
        }
      }))
      setProgress({ done: Math.min(i + BATCH, preview.length), total: preview.length })
    }

    setImporting(false)
    setProgress(null)
    setResult({ ok, alreadyHad, partial, failed, adjusted })
    setPreview([])
    setFileName('')
    setProductColsConfirmed(false)
    setDetectedProductCols([])
    setPendingRawRows(null)
    if (fileRef.current) fileRef.current.value = ''
    if (ok > 0 || partial.length > 0) onImported()
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
        <div className="mt-2 bg-white border border-teal-100 rounded-lg px-3 py-2">
          <p className="text-xs text-slate-600 leading-relaxed">📋 {t('csvSumTip')}</p>
        </div>
        <div className="bg-white border border-teal-100 rounded-lg px-3 py-2">
          <p className="text-xs text-slate-600 leading-relaxed">📅 {t('csvEarlierDatesTip')}</p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={downloadTemplate}
            className="text-sm text-teal-600 border border-teal-200 rounded-lg px-3 py-1.5 hover:bg-white transition-colors">
            {t('csvDownloadTemplate')}
          </button>
          <button onClick={downloadHourlyTemplate}
            className="text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-white transition-colors">
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

      {/* Parse errors / warnings — every message goes through t() so it is
          translated and lays out correctly right-to-left. */}
      {parseErrors.length > 0 && (
        <ul className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
          {parseErrors.map((issue, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true">⚠</span>
              <span>{t(issue.code, issue.params)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Product column confirmation step ────────────────────────────────── */}
      {detectedProductCols.length > 0 && !productColsConfirmed && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <p className="text-sm font-semibold text-slate-700">
            {t('csvConfirmProductColsTitle')}
          </p>
          <p className="text-xs text-slate-500">
            {t('csvConfirmProductColsDesc')}
          </p>
          <div className="space-y-2">
            {detectedProductCols.map(prod => (
              <label key={prod.id} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={confirmedProductIds.has(prod.id)}
                  onChange={() => toggleProduct(prod.id)}
                  className="w-4 h-4 accent-teal-600"
                />
                <span className="text-sm text-slate-700 group-hover:text-teal-700">
                  {prod.name}
                  <span className="ml-1.5 text-xs text-slate-400">({prod.unit})</span>
                </span>
              </label>
            ))}
          </div>
          {confirmedProductIds.size === 0 && (
            <p className="text-xs text-slate-400">
              {t('csvNoProductsSelectedNote')}
            </p>
          )}
          {/* Say plainly that a file WITH product columns replaces product
              sales for those days — unlike an hours-only save, which never
              touches them (F-006). */}
          {confirmedProductIds.size > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-900/15 px-3 py-2.5 space-y-1">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{t('bfChangeTitle')}</p>
              <p className="text-xs text-amber-700/90 dark:text-amber-200/80 leading-relaxed">{t('bfHoursReplaced')}</p>
              <p className="text-xs text-amber-700/90 dark:text-amber-200/80 leading-relaxed">{t('bfProductsReplaced')}</p>
            </div>
          )}
          <button
            onClick={confirmProductCols}
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium
                       px-4 py-2 rounded-lg transition-colors"
          >
            {t('csvConfirmProductColsBtn', { n: String(confirmedProductIds.size), s: confirmedProductIds.size !== 1 ? 's' : '' })}
          </button>
        </div>
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
                  {productList
                    .filter(p => confirmedProductIds.has(p.id))
                    .map(p => (
                      <th key={p.id} className="py-2 px-3">{p.name} ({p.unit})</th>
                    ))
                  }
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
                        <span className="ml-1 text-teal-600 text-xs" title={t('csvAutoSumTooltip')}>★</span>
                      )}
                    </td>
                    {productList
                      .filter(p => confirmedProductIds.has(p.id))
                      .map(p => (
                        <td key={p.id} className="py-1.5 px-3 text-slate-500">
                          {row.productUnits[p.name] ?? <span className="text-slate-300">—</span>}
                        </td>
                      ))
                    }
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

      {/* Result — each outcome named for what it actually was. A day the app
          already had is not a failure; a day whose products didn't save is
          not a skip. Lumping them together is what sent owners retrying
          imports that could never succeed. */}
      {result && (() => {
        const trouble = result.partial.length + result.failed.length
        return (
          <div className={`text-sm rounded-lg px-4 py-3 border space-y-1 ${
            trouble === 0
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : 'text-amber-700 bg-amber-50 border-amber-200'
          }`}>
            <p className="font-medium">
              {t('csvImportSuccess', { ok: String(result.ok), s: result.ok !== 1 ? 's' : '' })}
            </p>
            {result.alreadyHad.length > 0 && (
              <p className="text-xs">
                {t('csvImportAlreadyHad', {
                  n: String(result.alreadyHad.length),
                  dates: result.alreadyHad.join(', '),
                })}
              </p>
            )}
            {result.partial.length > 0 && (
              <p className="text-xs font-medium">
                {t('csvImportPartialDays', {
                  n: String(result.partial.length),
                  dates: result.partial.join(', '),
                })}
              </p>
            )}
            {result.failed.length > 0 && (
              <p className="text-xs">
                {t('csvImportFailedDays', {
                  n: String(result.failed.length),
                  dates: result.failed.join(', '),
                })}
              </p>
            )}
            {result.adjusted.length > 0 && (
              <p className="text-xs">
                {t('csvImportAdjusted', {
                  n: String(result.adjusted.length),
                  detail: result.adjusted
                    .map(a => `${a.date}: ${a.from} → ${a.to}`)
                    .join(', '),
                })}
              </p>
            )}
          </div>
        )
      })()}
    </div>
  )
}
