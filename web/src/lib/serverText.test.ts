/**
 * Server-written sentences reach the owner in the owner's language.
 *
 * Run with:  npm test       (from web/)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { translations, type Lang, type TranslationKey } from '../i18n.ts'
import { nudgeText, outlierText, serverErrorText, sayHour } from './serverText.ts'

function tFor(lang: Lang) {
  return (key: TranslationKey, vars?: Record<string, string | number>) => {
    let s = (translations[lang] as Record<string, string>)[key]
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
}

const HEBREW = /[֐-׿]/

test('a Hebrew owner told to wait for closing time reads it in Hebrew', () => {
  const out = serverErrorText('still_open', { closing_hour: 17 }, tFor('he'), 'he')
  assert.ok(out && HEBREW.test(out), String(out))
  assert.ok(!out!.includes('{'), `a placeholder leaked: ${out}`)
  assert.ok(out!.includes(sayHour(17, 'he')))
})

test('every limit code has a sentence, with no placeholder left unfilled', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['history_cap', { cutoff: '2025-10-04', date: '2024-06-01' }],
    ['future_date', { date: '2027-01-01', today: '2026-10-04' }],
    ['day_not_started', { opening_hour: 9, closing_hour: 17 }],
    ['still_open', { closing_hour: 17 }],
    ['closed_day', { date: '2026-10-04' }],
    ['ads_limit', { limit: 5 }],
    ['events_limit', { limit: 10 }],
    ['locations_limit', { limit: 1 }],
    ['invalid_input', {}],
  ]
  for (const lang of ['en', 'he', 'ar', 'de', 'ja'] as Lang[]) {
    for (const [code, params] of cases) {
      const out = serverErrorText(code, params, tFor(lang), lang)
      assert.ok(out, `${lang} ${code} had no sentence`)
      assert.ok(!/\{\w+\}/.test(out!), `${lang} ${code} left a placeholder: ${out}`)
    }
  }
})

test('an unknown code falls back to the server, rather than inventing a message', () => {
  assert.equal(serverErrorText('something_new', {}, tFor('he'), 'he'), null)
  assert.equal(serverErrorText(undefined, {}, tFor('he'), 'he'), null)
})

test('the daily heads-up is said in the owner language, numbers intact', () => {
  const busy = nudgeText(
    { type: 'busy_tomorrow', message: 'English', params: { date: '2026-10-05', predicted: 60, usual: 47 } },
    tFor('he'), 'he')
  assert.ok(HEBREW.test(busy) && busy.includes('60') && busy.includes('47'), busy)

  const stock = nudgeText(
    { type: 'low_stock', message: 'English', params: { names: ['Milk', 'Beans'] } },
    tFor('en'), 'en')
  assert.equal(stock, "You're running low on Milk and Beans. Order now so you don't run out.")
})

test('a nudge from an older server, with no params, still shows its message', () => {
  assert.equal(nudgeText({ type: 'busy_tomorrow', message: 'As sent' }, tFor('he'), 'he'), 'As sent')
})

test('the unusual-day question is asked in the owner language', () => {
  const flag = { date: '2026-10-04', customers: 1500, weekday_median: 54.2, direction: 'high' }
  const he = outlierText(flag, tFor('he'), 'he')
  assert.ok(HEBREW.test(he), he)
  assert.ok(he.includes('54') && !he.includes('54.2'), 'the usual count is a whole number of people')
  const low = outlierText({ ...flag, customers: 3, direction: 'low' }, tFor('en'), 'en')
  assert.match(low, /unusually quiet/)
})
