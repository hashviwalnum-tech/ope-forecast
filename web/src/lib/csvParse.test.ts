/**
 * Tests for the CSV import parser.
 *
 * Run with:  npm run test:csv       (from web/)
 *
 * These use node:test and node:assert and are executed by Node directly —
 * Node 24 strips the TypeScript types itself, so this needs no test framework
 * and no extra dependency.
 *
 * Every case below is a file a real spreadsheet can produce and the previous
 * `split('\n')` / `split(',')` parser got wrong. Each one either dropped data
 * or, worse, imported a different number than the file contained — the same
 * class of fault as the original "70 customers imported as 89" report.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCSV, parseDate, detectDelimiter, dedupeByDate } from './csvParse.ts'

const codes = (issues: { code: string }[]) => issues.map(i => i.code)

// ── quoting ────────────────────────────────────────────────────────────────

test('a comma inside a quoted product name does not shift every later column', () => {
  // The old parser produced 5 headers against 4 values, so Fries' number
  // landed under a different product and nobody was told.
  const r = parseCSV('date,customers,"Burger, Deluxe",Fries\n2026-01-05,120,40,18')
  assert.deepEqual(r.headers, ['date', 'customers', 'Burger, Deluxe', 'Fries'])
  assert.deepEqual(r.rows[0], ['2026-01-05', '120', '40', '18'])
  assert.equal(r.issues.length, 0)
})

test('a file where the spreadsheet quoted every value still imports', () => {
  // Previously `"2026-01-05"` kept its quotes, failed to parse as a date, and
  // every single row was rejected.
  const r = parseCSV('"date","customers"\n"2026-01-05","120"')
  assert.deepEqual(r.rows[0], ['2026-01-05', '120'])
  assert.equal(parseDate(r.rows[0][0])?.iso, '2026-01-05')
})

test('a doubled quote inside a quoted field is one literal quote', () => {
  const r = parseCSV('date,name\n2026-01-05,"6"" sub"')
  assert.equal(r.rows[0][1], '6" sub')
})

test('a newline typed inside a cell does not split the row in two', () => {
  const r = parseCSV('date,customers,notes\n2026-01-05,120,"busy\nday"')
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0][2], 'busy\nday')
})

// ── delimiters ─────────────────────────────────────────────────────────────

test('semicolons are detected — Excel writes these in Hebrew and EU locales', () => {
  const r = parseCSV('date;customers;Fries\n2026-01-05;120;18')
  assert.equal(r.delimiter, ';')
  assert.deepEqual(r.rows[0], ['2026-01-05', '120', '18'])
  // and the owner is told what was assumed, rather than it being silent
  assert.ok(codes(r.issues).includes('csvIssueDelimiter'))
})

test('tab-separated files are detected', () => {
  const r = parseCSV('date\tcustomers\n2026-01-05\t120')
  assert.equal(r.delimiter, '\t')
  assert.deepEqual(r.rows[0], ['2026-01-05', '120'])
})

test('a plain comma file is not announced as an assumption', () => {
  const r = parseCSV('date,customers\n2026-01-05,120')
  assert.equal(r.delimiter, ',')
  assert.equal(r.issues.length, 0)
})

test('a comma inside a quoted field does not make the file look semicolon-separated', () => {
  assert.equal(detectDelimiter('date,customers,"a; b"\n2026-01-05,120,1'), ',')
})

// ── ragged rows ────────────────────────────────────────────────────────────

test('a short row is reported, not silently left with a missing product', () => {
  const r = parseCSV('date,customers,Fries\n2026-01-05,120\n2026-01-06,130,18')
  const ragged = r.issues.filter(i => i.code === 'csvIssueRaggedRow')
  assert.equal(ragged.length, 1)
  assert.equal(ragged[0].params?.line, '2')     // the file line, for the owner
  assert.equal(ragged[0].params?.got, '2')
  assert.equal(ragged[0].params?.want, '3')
  // still previewable, padded rather than dropped
  assert.equal(r.rows[0].length, 3)
})

test('a long row is reported too', () => {
  const r = parseCSV('date,customers\n2026-01-05,120,99')
  assert.deepEqual(codes(r.issues), ['csvIssueRaggedRow'])
})

// ── encoding ───────────────────────────────────────────────────────────────

test('a non-UTF-8 file is called out instead of importing mojibake', () => {
  // A Windows-1255 Hebrew export read as UTF-8 becomes replacement characters,
  // which then match no product name — products were dropped in silence.
  const r = parseCSV('date,customers\n2026-01-05,120\n��,1')
  assert.ok(codes(r.issues).includes('csvIssueEncoding'))
})

test('a UTF-8 BOM does not become part of the first header', () => {
  assert.equal(parseCSV('﻿date,customers\n2026-01-05,120').headers[0], 'date')
})

test('CRLF line endings work', () => {
  assert.equal(parseCSV('date,customers\r\n2026-01-05,120\r\n').rows[0][1], '120')
})

test('leading comment lines are skipped when finding the header row', () => {
  const r = parseCSV('# note from the hourly template\ndate,customers\n2026-01-05,120')
  assert.equal(r.headers[0], 'date')
  assert.equal(r.rows.length, 1)
})

test('an empty file yields nothing rather than throwing', () => {
  const r = parseCSV('')
  assert.deepEqual(r.rows, [])
  assert.deepEqual(r.headers, [])
})

// ── dates ──────────────────────────────────────────────────────────────────

test('ISO dates are read exactly and never flagged ambiguous', () => {
  const d = parseDate('2026-01-05')
  assert.equal(d?.iso, '2026-01-05')
  assert.equal(d?.ambiguous, false)
})

test('an unambiguous MM/DD date is read as MM/DD', () => {
  assert.equal(parseDate('01/25/2026')?.iso, '2026-01-25')
})

test('an unambiguous DD/MM date is read as DD/MM', () => {
  assert.equal(parseDate('25/01/2026')?.iso, '2026-01-25')
})

test('a date that could be either is read as DD/MM and flagged for the owner', () => {
  const d = parseDate('05/01/2026')
  assert.equal(d?.iso, '2026-01-05')
  assert.equal(d?.ambiguous, true)
})

test('a quoted date parses', () => {
  assert.equal(parseDate('"2026-01-05"')?.iso, '2026-01-05')
})

test('impossible dates are rejected rather than rolled over into the next month', () => {
  assert.equal(parseDate('31/02/2026'), null)   // would have become 3 March
  assert.equal(parseDate('2026-02-31'), null)   // same, via the ISO path
  assert.equal(parseDate('2026-13-01'), null)
})

test('junk in the date column is rejected', () => {
  assert.equal(parseDate('not a date'), null)
  assert.equal(parseDate(''), null)
  assert.equal(parseDate('2026'), null)
})

// ── duplicate dates in one file ────────────────────────────────────────────

test('a date repeated in the file resolves to the last row, not to whichever request won', () => {
  // The importer sends four rows at a time. Before this, two rows for the same
  // date went out together and the stored number depended on network timing.
  const rows = [
    { date: '2026-01-05', dateDisplay: 'Mon 5 Jan 2026', customers: 100 },
    { date: '2026-01-06', dateDisplay: 'Tue 6 Jan 2026', customers: 110 },
    { date: '2026-01-05', dateDisplay: 'Mon 5 Jan 2026', customers: 999 },
  ]
  const r = dedupeByDate(rows)
  assert.equal(r.rows.length, 2)
  assert.equal(r.rows.find(x => x.date === '2026-01-05')?.customers, 999)
  assert.deepEqual(codes(r.issues), ['csvIssueDuplicateDate'])
  assert.equal(r.issues[0].params?.n, '2')
})

test('order is preserved and unique dates raise nothing', () => {
  const rows = [
    { date: '2026-01-05', dateDisplay: 'a', customers: 1 },
    { date: '2026-01-06', dateDisplay: 'b', customers: 2 },
  ]
  const r = dedupeByDate(rows)
  assert.deepEqual(r.rows.map(x => x.date), ['2026-01-05', '2026-01-06'])
  assert.deepEqual(r.issues, [])
})

// ── the whole path, on a file a real spreadsheet would write ────────────────

test('a realistic Excel export lands every value under the right column', () => {
  const file = [
    '"date";"customers";"Burger, Deluxe";"Fries"',
    '"05/01/2026";"120";"40";"18"',
    '"06/01/2026";"131";"44";"20"',
  ].join('\r\n')

  const r = parseCSV(file)
  assert.equal(r.delimiter, ';')
  assert.deepEqual(r.headers, ['date', 'customers', 'Burger, Deluxe', 'Fries'])
  assert.deepEqual(r.rows, [
    ['05/01/2026', '120', '40', '18'],
    ['06/01/2026', '131', '44', '20'],
  ])
  assert.equal(parseDate(r.rows[0][0])?.iso, '2026-01-05')
  // No ragged rows: the quoted comma did not create a phantom column.
  assert.equal(r.issues.filter(i => i.code === 'csvIssueRaggedRow').length, 0)
})

// ── the guarantee that matters most ────────────────────────────────────────

test('no cell is ever changed into a different number', () => {
  // The original report was a 70 that imported as 89. Whatever else the parser
  // does, a value must arrive exactly as typed.
  const file = 'date,customers,Fries\n2026-01-05,70,18\n2026-01-06,89,20'
  const r = parseCSV(file)
  assert.equal(r.rows[0][1], '70')
  assert.equal(r.rows[1][1], '89')
})
