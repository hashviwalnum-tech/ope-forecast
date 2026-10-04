/**
 * Server-written sentences reach the owner in the owner's language.
 * Run: npm test   (from mobile/)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeT, type Lang } from './i18n.ts'
import { outlierText, serverErrorText } from './serverText.ts'

const HEBREW = /[֐-׿]/

test('a Hebrew owner hitting a free-plan limit reads it in Hebrew', () => {
  const out = serverErrorText('ads_limit', { limit: 5 }, makeT('he'), 'he')
  assert.ok(out && HEBREW.test(out) && out.includes('5'), String(out))
})

test('every limit code has a sentence in every language, placeholders filled', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['history_cap', { cutoff: '2025-10-04', date: '2024-06-01' }],
    ['future_date', { date: '2027-01-01', today: '2026-10-04' }],
    ['day_not_started', { opening_hour: 9, closing_hour: 17 }],
    ['still_open', { closing_hour: 17 }],
    ['closed_day', { date: '2026-10-04' }],
    ['ads_limit', { limit: 5 }], ['events_limit', { limit: 10 }],
    ['locations_limit', { limit: 1 }], ['invalid_input', {}],
  ]
  const langs: Lang[] = ['en', 'he', 'zh', 'es', 'hi', 'ar', 'pt', 'ru', 'fr', 'bn', 'ur', 'id', 'de', 'ja', 'tr']
  for (const lang of langs) {
    for (const [code, params] of cases) {
      const out = serverErrorText(code, params, makeT(lang), lang)
      assert.ok(out, `${lang} ${code}`)
      assert.ok(!/\{\w+\}/.test(out!), `${lang} ${code} left a placeholder: ${out}`)
    }
  }
})

test('the unusual-day question is asked in Hebrew', () => {
  const he = outlierText({ date: '2026-10-04', customers: 3, weekday_median: 54, direction: 'low' }, makeT('he'), 'he')
  assert.ok(HEBREW.test(he), he)
})
