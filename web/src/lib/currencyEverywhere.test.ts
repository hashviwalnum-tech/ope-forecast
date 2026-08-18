/**
 * A business set to a non-default currency sees THAT currency everywhere.
 *
 * Run with:  npm test       (from web/)
 *
 * The screens themselves are thin: each one calls the formatters below through
 * `useCurrency()`, which binds them to the business's setting. So the thing
 * worth pinning down is that every formatter a screen can reach honours the
 * currency it is given, and that none of them has a fixed two decimal places
 * hiding in it.
 *
 * The list of call sites is checked structurally at the bottom — a new screen
 * that formats money with a hardcoded symbol fails this file rather than
 * shipping.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  amountStep, currencySymbol, formatAmount, formatMoney, formatSignedMoney,
  minorUnits, parseLocaleNumber,
} from './money.ts'
import { num } from './planningTools.ts'

/** Every formatter a screen can reach, in the order a screen would use them. */
const ALL_FORMATTERS = [formatMoney, formatSignedMoney] as const

// ── the setting reaches every formatter ────────────────────────────────────

test('a business set to shekels sees shekels from every formatter', () => {
  for (const f of ALL_FORMATTERS) {
    const out = f(120, 'ILS', 'he')
    assert.ok(out.includes('₪'), `${f.name} gave ${out}`)
    assert.ok(!out.includes('$'), `${f.name} leaked a dollar sign: ${out}`)
    assert.ok(!out.includes('€'), `${f.name} leaked a euro sign: ${out}`)
  }
  assert.equal(currencySymbol('ILS', 'he'), '₪')
})

test('a business set to yen never sees a decimal point', () => {
  // Yen has no subunit. Anything forcing two places invents precision.
  for (const f of ALL_FORMATTERS) {
    const out = f(1200, 'JPY', 'ja')
    assert.ok(!out.includes('.'), `${f.name} gave ${out}`)
  }
  assert.ok(!formatAmount(1200, 'JPY', 'ja').includes('.'))
  assert.equal(amountStep('JPY'), 1)
  assert.equal(minorUnits('JPY'), 0)
})

test('a business set to Kuwaiti dinars keeps three places everywhere', () => {
  assert.ok(formatMoney(1.234, 'KWD', 'ar').includes('1.234')
         || formatMoney(1.234, 'KWD', 'ar').includes('١'), 'expected 3 places')
  assert.equal(formatAmount(2, 'KWD', 'en'), '2.000')
  assert.equal(amountStep('KWD'), 0.001)
})

test('two businesses on one machine each see their own currency', () => {
  // The currency comes from the business, so the same helper called with two
  // different settings must give two different answers — no module-level state.
  const a = formatMoney(100, 'ILS', 'en')
  const b = formatMoney(100, 'JPY', 'en')
  assert.notEqual(a, b)
  assert.equal(formatMoney(100, 'ILS', 'en'), a, 'formatting must be stateless')
})

// ── the planning toolbox ───────────────────────────────────────────────────

test('the toolbox formats backend figures in the business currency', () => {
  // The toolbox maths now runs in backend/app/engine/planning.py and comes
  // back as plain numbers — deliberately currency-free, because a figure with
  // a currency baked in could not be shown correctly to anyone else. What the
  // client does with them is format, and that follows the business setting.
  const fromApi = { total_earn: 100, more_downside: -175 }
  assert.ok(formatMoney(fromApi.total_earn, 'ILS', 'he').includes('₪'))
  assert.ok(!formatMoney(fromApi.total_earn, 'JPY', 'ja').includes('.'))
  assert.ok(formatSignedMoney(fromApi.more_downside, 'USD', 'en').startsWith('−'))
})

test('no planning maths is left in the client', () => {
  // The whole point of the move: mobile inherits the engine instead of
  // reimplementing it. A calculation creeping back into the browser would
  // start that drift again.
  const src = readFileSync(join(import.meta.dirname, 'planningTools.ts'), 'utf8')
  for (const gone of ['scoreOption', 'findInvertedOptions', 'frameOrder', 'planBudget']) {
    assert.ok(!new RegExp(`export function ${gone}\b`).test(src),
      `${gone} is back in the browser — it belongs in the engine`)
  }
})

test('the toolbox reads a pasted amount in either decimal convention', () => {
  assert.equal(num('12.50'), 12.5)
  assert.equal(num('12,50'), 12.5)
})

// ── CSV import ─────────────────────────────────────────────────────────────

test('a CSV written in a comma-decimal locale imports the number in the file', () => {
  // This is the corruption case: parseFloat('0,5') is 0, so half a litre
  // imported as nothing at all, with no error shown.
  assert.equal(parseLocaleNumber('0,5', 'de'), 0.5)
  assert.equal(parseLocaleNumber('0,5', 'fr'), 0.5)
  assert.equal(parseLocaleNumber('0,5', 'es'), 0.5)
  assert.equal(parseLocaleNumber('0,5', 'tr'), 0.5)
  assert.equal(parseLocaleNumber('0,5', 'id'), 0.5)
})

test('a CSV customer count with grouped thousands is not truncated', () => {
  // parseInt('1 234') is 1 — a busy day imported as a nearly empty one.
  assert.equal(parseLocaleNumber('1,234', 'en'), 1234)
  assert.equal(parseLocaleNumber('1.234', 'de'), 1234)
  assert.equal(parseLocaleNumber('1234', 'fr'), 1234)
})

test('the CSV template carries no money column, so it needs no currency', () => {
  // If a price column is ever added to the template, this fails and whoever
  // adds it has to decide how the currency is carried.
  const src = readFileSync(join(import.meta.dirname, '..', 'components', 'CsvImport.tsx'), 'utf8')
  const headerLines = src.split('\n').filter(l => l.includes("const headers"))
  assert.ok(headerLines.length > 0, 'could not find the template headers')
  for (const line of headerLines) {
    assert.ok(!/price|cost|amount|spend|revenue/i.test(line),
      `the CSV template now has a money column and must carry a currency: ${line.trim()}`)
  }
})

// ── nothing formats money on its own any more ──────────────────────────────

test('no screen formats money with a hardcoded currency', () => {
  // The regulars screen used to hardcode US dollars and the planning toolbox a
  // euro sign, which is how one owner saw two different currencies. Money now
  // goes through useCurrency() everywhere, and this stops the next one.
  const root = join(import.meta.dirname, '..')
  const offenders: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (entry.name.endsWith('.test.ts')) continue
      // money.ts is the one place allowed to name a currency: it is the
      // fallback for a business that has not chosen yet.
      if (full.endsWith(join('lib', 'money.ts'))) continue

      const src = readFileSync(full, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
        // A currency code passed to Intl as a literal, or a bare currency
        // mark sitting in JSX text. `${...}` is template interpolation, not a
        // dollar sign, so the JSX check requires a real text node.
        if (/currency:\s*['"][A-Z]{3}['"]/.test(line)
            || />\s*[$€₪£¥]\s*</.test(line)) {
          offenders.push(`${full.slice(root.length + 1)}:${i + 1}  ${line.trim()}`)
        }
      })
    }
  }
  walk(root)

  assert.deepEqual(offenders, [],
    'these format money without the business currency:\n' + offenders.join('\n'))
})
