// CSV parsing for the import screen.
//
// Pulled out of the component so it can be tested directly — the old version
// was `text.split('\n')` then `line.split(',')`, which is fine for the template
// we generate and wrong for almost any file a real spreadsheet produces:
//
//   * a quoted field containing a comma ("Burger, Deluxe") split into two
//     columns, shifting every column after it — the same silent misalignment
//     that produced the original "70 customers imported as 89" report;
//   * a file where Excel quoted every value imported nothing at all, because
//     `"2026-01-05"` (with the quotes kept) is not a date;
//   * a semicolon-delimited file — which is what Excel writes by default in
//     Hebrew and most European locales, i.e. the target market — failed on
//     every single row;
//   * short and long rows were accepted silently, so a missing column meant a
//     product quietly went unimported.
//
// This is a small RFC 4180 reader: quotes, doubled quotes inside quotes,
// delimiters and newlines inside quoted fields, and delimiter auto-detection.
//
// Issues are returned as CODES, not sentences. Every message the owner reads
// has to exist in all 15 languages, and a parser that returns English prose
// cannot be translated — that is how the untranslated-string problem in the
// spec keeps coming back. The component maps each code through t().

// Type-only, so it vanishes at runtime and this file still runs under plain
// Node for its tests. Typing `code` as a real translation key means forgetting
// to add a message fails the type-check instead of shipping raw English.
import type { TranslationKey } from '../i18n'

export interface ParsedDate {
  iso: string
  display: string
  ambiguous: boolean
}

/** A problem worth telling the owner about, in a form the UI can translate. */
export interface CsvIssue {
  code: TranslationKey
  params?: Record<string, string>
}

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  /** Delimiter actually used, so the UI can say what it assumed. */
  delimiter: string
  issues: CsvIssue[]
}

const DELIMITERS = [',', ';', '\t', '|'] as const

// Built from char codes rather than written literally: both are invisible in
// an editor, and an invisible byte in source is exactly what gets mangled by a
// copy-paste or a well-meaning "strip odd characters" pass.
/** U+FEFF, the byte-order mark a spreadsheet puts at the start of a UTF-8 CSV. */
const BOM = String.fromCharCode(0xfeff)
/** U+FFFD, what a byte that is not valid UTF-8 decodes to. */
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd)

/** Pick the delimiter that yields the most consistent column count. */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .slice(0, 10)
  if (!lines.length) return ','

  let best = ','
  let bestScore = -1
  for (const d of DELIMITERS) {
    const counts = lines.map(l => splitLine(l, d).length)
    const first = counts[0]
    if (first < 2) continue                       // didn't split anything
    const consistent = counts.filter(c => c === first).length
    // Prefer consistency first, then more columns.
    const score = consistent * 100 + first
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/**
 * How to show a delimiter to the owner. The symbol itself is used rather than
 * a word, so the notice reads the same in every language and matches exactly
 * what they would see in their file.
 */
export function delimiterLabel(d: string): string {
  return d === '\t' ? '⇥' : d
}

/** Split one line on `delim`, honouring quotes. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }   // "" is a literal quote
        else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map(v => v.trim())
}

/**
 * Split the whole document into logical lines, keeping newlines that sit
 * inside a quoted field with their row (a note typed into a cell, for example).
 */
function splitRecords(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { cur += '""'; i++; continue }
      inQuotes = !inQuotes
      cur += ch
      continue
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

export function parseCSV(text: string): ParsedCsv {
  const issues: CsvIssue[] = []

  // A UTF-8 BOM survives as U+FEFF; String.trim() removes it, but strip it
  // explicitly so the behaviour does not depend on that.
  const cleaned = text.startsWith(BOM) ? text.slice(BOM.length) : text

  // The file is decoded as UTF-8. A Windows-1255 (Hebrew) or Latin-1 export
  // decodes to U+FFFD replacement characters, which would then silently fail
  // to match any product name — so say so rather than quietly importing
  // nothing.
  if (cleaned.includes(REPLACEMENT_CHAR)) {
    issues.push({ code: 'csvIssueEncoding' })
  }

  const records = splitRecords(cleaned).filter(l => l.trim())
  if (!records.length) return { headers: [], rows: [], delimiter: ',', issues }

  const delimiter = detectDelimiter(cleaned)
  // Say what was assumed whenever it is not the ordinary comma, so an owner
  // whose spreadsheet writes semicolons can see the file was understood.
  if (delimiter !== ',') {
    issues.push({ code: 'csvIssueDelimiter', params: { delimiter: delimiterLabel(delimiter) } })
  }

  const headerIdx = records.findIndex(l => !l.trim().startsWith('#'))
  if (headerIdx === -1) return { headers: [], rows: [], delimiter, issues }

  const headers = splitLine(records[headerIdx], delimiter)
  const rows: string[][] = []

  records.slice(headerIdx + 1).forEach((line, i) => {
    if (line.trim().startsWith('#')) return
    const cells = splitLine(line, delimiter)
    // A row with the wrong number of cells is how columns silently shift and
    // the wrong number lands against the wrong product. Flag it, keep the row
    // (padded) so the owner can still see it in the preview.
    if (cells.length !== headers.length) {
      issues.push({
        code: 'csvIssueRaggedRow',
        params: {
          line: String(headerIdx + i + 2),
          got: String(cells.length),
          want: String(headers.length),
        },
      })
      while (cells.length < headers.length) cells.push('')
    }
    rows.push(cells)
  })

  return { headers, rows, delimiter, issues }
}

// ── dates ───────────────────────────────────────────────────────────────────

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function displayDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function parseDate(raw: string): ParsedDate | null {
  // Strip any stray quotes a spreadsheet wrapped the value in.
  const s = raw.trim().replace(/^"(.*)"$/, '$1').trim()

  // YYYY-MM-DD — canonical, never ambiguous
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00')
    if (isNaN(d.getTime())) return null
    const [y, m, dd] = s.split('-').map(Number)
    // Guard against JS rolling over (2026-02-31 becomes 3 March)
    if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) return null
    return { iso: s, display: displayDate(d), ambiguous: false }
  }

  // D/M/YYYY  DD/MM/YYYY  MM/DD/YYYY  (separator can be / - .)
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
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
    if (isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return { iso: toISO(y, month, day), display: displayDate(date), ambiguous }
  }

  return null
}

// ── duplicate dates within one file ─────────────────────────────────────────

/**
 * Keep the LAST row for any date that appears more than once.
 *
 * Without this the rows raced: the importer sends four at a time, so two rows
 * for the same date went out concurrently, the first to land created the day
 * and the second came back as a duplicate — so which number was stored
 * depended on network timing. Last-wins is the same rule the rest of the app
 * uses for a corrected re-entry, and it is at least deterministic.
 */
export function dedupeByDate<T extends { date: string; dateDisplay: string }>(
  rows: T[],
): { rows: T[]; issues: CsvIssue[] } {
  const counts = new Map<string, number>()
  const lastIndex = new Map<string, number>()
  rows.forEach((r, i) => {
    counts.set(r.date, (counts.get(r.date) ?? 0) + 1)
    lastIndex.set(r.date, i)
  })

  const issues: CsvIssue[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.date)) continue
    seen.add(r.date)
    const n = counts.get(r.date) ?? 1
    if (n > 1) {
      issues.push({
        code: 'csvIssueDuplicateDate',
        params: { date: r.dateDisplay, n: String(n) },
      })
    }
  }
  return { rows: rows.filter((_r, i) => lastIndex.get(rows[i].date) === i), issues }
}
