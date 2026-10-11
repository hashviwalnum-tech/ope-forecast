/**
 * A picked day must come back as the same day — never one off.
 * Run: npm test   (from mobile/)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dateToIso, isoToDate } from './isoDate.ts'

test('every day of a year survives the round trip, DST changes included', () => {
  for (let i = 0; i < 366; i++) {
    const d = new Date(2026, 0, 1 + i, 12)
    const iso = dateToIso(d)
    assert.equal(dateToIso(isoToDate(iso)!), iso)
  }
})

test('a calendar pick late at night is still that day', () => {
  assert.equal(dateToIso(new Date(2026, 2, 27, 23, 59)), '2026-03-27')
  assert.equal(dateToIso(new Date(2026, 2, 28, 0, 1)), '2026-03-28')
})

test('anything that is not a date reads as no date', () => {
  for (const bad of ['', '15/01/2026', '2026-1-5', 'tomorrow', '2026-13-45']) {
    assert.equal(isoToDate(bad), null, bad)
  }
})
