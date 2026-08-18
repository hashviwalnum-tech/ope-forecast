/**
 * Money formatting and reading.
 *
 * Run with:  npm test       (from web/)
 *
 * The two things these pin down:
 *   - the currency comes from the BUSINESS, never a constant;
 *   - the decimal places come from the CURRENCY, never a hardcoded 2.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  amountStep, currencySymbol, formatAmount, formatMoney, formatSignedMoney,
  minorUnits, parseLocaleNumber, separatorsFor,
} from './money.ts'

/** Compare ignoring which space character the runtime chose — Intl uses a
 *  non-breaking or narrow no-break space for grouping in several locales. */
// No regex and no escape sequences here on purpose: an invisible character in
// source gets mangled by editors, and an escaped one gets collapsed by the
// formatter. String.prototype.trim() already treats every space character as
// whitespace, non-breaking ones included.
const norm = (s: string) => [...s].map(ch => (ch.trim() === '' ? ' ' : ch)).join('')
const same = (a: string, b: string) => norm(a) === norm(b)
/** Swap a marker for a real non-breaking space, so no invisible character
 *  has to survive in this file's source. */
const nbsp = (s: string) => s.replace('_', String.fromCharCode(160))

// ── decimal places come from the currency ──────────────────────────────────

test('a currency with no subunit is written with no decimal places', () => {
  assert.equal(minorUnits('JPY'), 0)
  assert.equal(minorUnits('KRW'), 0)
  assert.equal(minorUnits('VND'), 0)
})

test('a currency with three decimal places gets three', () => {
  assert.equal(minorUnits('KWD'), 3)
  assert.equal(minorUnits('BHD'), 3)
  assert.equal(minorUnits('OMR'), 3)
})

test('ordinary currencies get two', () => {
  for (const c of ['USD', 'EUR', 'ILS', 'GBP', 'INR']) {
    assert.equal(minorUnits(c), 2, c)
  }
})

test('yen is never shown with a fake .00', () => {
  const out = formatMoney(1200, 'JPY', 'en')
  assert.ok(!out.includes('.00'), `got ${out}`)
  assert.ok(out.includes('1,200'), `got ${out}`)
})

test('a dinar keeps all three of its places', () => {
  const out = formatMoney(1.234, 'KWD', 'en')
  assert.ok(out.includes('1.234'), `got ${out}`)
})

test('a dollar amount still gets its two', () => {
  assert.ok(formatMoney(1200, 'USD', 'en').includes('1,200.00'))
})

// ── the currency comes from the business ───────────────────────────────────

test('the same amount is shown in whichever currency it is given', () => {
  const shekels = formatMoney(120, 'ILS', 'en')
  const dollars = formatMoney(120, 'USD', 'en')
  const yen = formatMoney(120, 'JPY', 'en')
  assert.notEqual(shekels, dollars)
  assert.notEqual(dollars, yen)
  assert.ok(shekels.includes('₪'), `expected a shekel mark, got ${shekels}`)
})

test('the symbol follows the currency, not the machine', () => {
  assert.equal(currencySymbol('ILS', 'en'), '₪')
  assert.equal(currencySymbol('JPY', 'en'), '¥')
  assert.equal(currencySymbol('EUR', 'en'), '€')
  assert.equal(currencySymbol('GBP', 'en'), '£')
})

test('an unknown currency degrades to something readable, never a crash', () => {
  const out = formatMoney(12.5, 'ZZZ', 'en')
  assert.ok(out.includes('12.5'), `got ${out}`)
  assert.equal(currencySymbol('ZZZ', 'en'), 'ZZZ')
  assert.equal(minorUnits('ZZZ'), 2)
})

// ── the language comes from the owner's choice in Ope ──────────────────────

test('the number is grouped the way the owner\'s language groups it', () => {
  // German writes 1.234,50 where English writes 1,234.50.
  const en = formatMoney(1234.5, 'EUR', 'en')
  const de = formatMoney(1234.5, 'EUR', 'de')
  assert.notEqual(en, de)
  assert.ok(de.includes('1.234,50'), `got ${de}`)
})

test('right-to-left languages format without throwing', () => {
  for (const lang of ['he', 'ar', 'ur']) {
    const out = formatMoney(120, 'ILS', lang)
    assert.ok(out.length > 0, lang)
  }
})

test('an odd language tag falls back instead of blanking the screen', () => {
  const out = formatMoney(12.5, 'USD', 'not-a-locale')
  assert.ok(out.length > 0 && out.includes('12'), `got ${out}`)
})

// ── signed figures ─────────────────────────────────────────────────────────

test('a profit is marked as one and a loss as one', () => {
  assert.ok(formatSignedMoney(125, 'USD', 'en').startsWith('+'))
  assert.ok(formatSignedMoney(-175, 'USD', 'en').startsWith('−'))
})

test('zero carries no sign', () => {
  const out = formatSignedMoney(0, 'USD', 'en')
  assert.ok(!out.startsWith('+') && !out.startsWith('−'), `got ${out}`)
})

test('a signed yen figure still has no decimal places', () => {
  assert.ok(!formatSignedMoney(1200, 'JPY', 'en').includes('.00'))
})

// ── bare amounts, for columns already headed with a currency ───────────────

test('a bare amount carries no currency mark but keeps the right precision', () => {
  assert.ok(same(formatAmount(1200, 'JPY', 'en'), '1,200'))
  assert.ok(same(formatAmount(1200, 'USD', 'en'), '1,200.00'))
  assert.ok(same(formatAmount(1.2345, 'KWD', 'en'), '1.235'))   // rounded, not truncated
})

// ── input steps ────────────────────────────────────────────────────────────

test('a money input steps by the currency\'s smallest unit', () => {
  // Hardcoding 0.01 would let someone type ¥1200.50, which does not exist.
  assert.equal(amountStep('JPY'), 1)
  assert.equal(amountStep('USD'), 0.01)
  assert.equal(amountStep('KWD'), 0.001)
})

// ── reading what a person typed ────────────────────────────────────────────

test('a plain number reads the same in every language', () => {
  for (const lang of ['en', 'de', 'fr', 'he']) {
    assert.equal(parseLocaleNumber('42', lang), 42, lang)
  }
})

test('a comma decimal is read as a decimal, not thrown away', () => {
  // parseFloat('0,5') returns 0 — a silently wrong price, not a rejected one.
  assert.equal(parseLocaleNumber('0,5', 'de'), 0.5)
  assert.equal(parseLocaleNumber('12,75', 'fr'), 12.75)
  assert.equal(parseLocaleNumber('0,5', 'es'), 0.5)
})

test('a dot decimal still works for languages that use a dot', () => {
  assert.equal(parseLocaleNumber('0.5', 'en'), 0.5)
  assert.equal(parseLocaleNumber('12.75', 'en'), 12.75)
})

test('grouped thousands are read, not truncated', () => {
  assert.equal(parseLocaleNumber('1,234.5', 'en'), 1234.5)   // English
  assert.equal(parseLocaleNumber('1.234,5', 'de'), 1234.5)   // German
  assert.equal(parseLocaleNumber('1 234,5', 'fr'), 1234.5)   // French, space
  assert.equal(parseLocaleNumber(nbsp('1_234,5'), 'fr'), 1234.5)  // non-breaking space
})

test('repeated separators are grouping, never decimals', () => {
  assert.equal(parseLocaleNumber('1.234.567', 'de'), 1234567)
  assert.equal(parseLocaleNumber('1,234,567', 'en'), 1234567)
})

test('the genuinely ambiguous case is decided by the owner\'s language', () => {
  // "1,234" is one thousand in English and 1.234 in German. Nothing in the
  // string can settle it — only the language can.
  assert.equal(parseLocaleNumber('1,234', 'en'), 1234)
  assert.equal(parseLocaleNumber('1,234', 'de'), 1.234)
  assert.equal(parseLocaleNumber('1.234', 'de'), 1234)
  assert.equal(parseLocaleNumber('1.234', 'en'), 1.234)
})

test('a currency mark typed into the field is ignored', () => {
  assert.equal(parseLocaleNumber('₪120', 'he'), 120)
  assert.equal(parseLocaleNumber('$12.50', 'en'), 12.5)
  assert.equal(parseLocaleNumber('12,50 €', 'de'), 12.5)
})

test('negatives survive', () => {
  assert.equal(parseLocaleNumber('-50', 'en'), -50)
  assert.equal(parseLocaleNumber('-12,5', 'de'), -12.5)
})

test('empty and nonsense are null, which is not the same as zero', () => {
  // The old helper returned 0 for junk, so a mistyped price silently became free.
  assert.equal(parseLocaleNumber('', 'en'), null)
  assert.equal(parseLocaleNumber('   ', 'en'), null)
  assert.equal(parseLocaleNumber('abc', 'en'), null)
  assert.equal(parseLocaleNumber('0', 'en'), 0)
})

test('the separators reported for a language are the ones it really uses', () => {
  assert.deepEqual(separatorsFor('en'), { decimal: '.', group: ',' })
  assert.deepEqual(separatorsFor('de'), { decimal: ',', group: '.' })
})
