/**
 * "What day is it for this business?"
 *
 * Run with:  npm test       (from web/)
 *
 * The bug these pin down: the client used to read the day off the device — six
 * places via `new Date().toISOString()`, which is UTC — while the backend read
 * it off the business's own timezone. Near midnight the two disagreed, and a
 * sale was filed under the wrong day. Every case below is a real moment where
 * the device answer and the business answer differ.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  hourIn, isNonWorkingDay, isoDateIn, isValidTimeZone, minutesIntoDay,
  resolveTimeZone, shiftIso, weekdayMon0,
} from './businessTime.ts'

const NY = 'America/New_York'
const IL = 'Asia/Jerusalem'

// ── the day comes from the business's zone, not from UTC ───────────────────

test('New York at 8pm is still today, though UTC has already rolled over', () => {
  // 2026-08-31 20:30 New York (EDT, UTC-4) = 2026-09-01 00:30 UTC
  const now = new Date('2026-09-01T00:30:00Z')
  assert.equal(now.toISOString().slice(0, 10), '2026-09-01')   // what the old code said
  assert.equal(isoDateIn(now, NY), '2026-08-31')               // what the shop says
  assert.equal(hourIn(now, NY), 20)
})

test('Jerusalem at 1am is already tomorrow, though UTC is still on yesterday', () => {
  // 2026-08-31 01:00 Jerusalem (IDT, UTC+3) = 2026-08-30 22:00 UTC
  const now = new Date('2026-08-30T22:00:00Z')
  assert.equal(now.toISOString().slice(0, 10), '2026-08-30')
  assert.equal(isoDateIn(now, IL), '2026-08-31')
  assert.equal(hourIn(now, IL), 1)
})

test('midnight exactly reads as hour 0 of the new day, not hour 24 of the old', () => {
  const now = new Date('2026-08-31T04:00:00Z')   // 00:00 New York
  assert.equal(isoDateIn(now, NY), '2026-08-31')
  assert.equal(hourIn(now, NY), 0)
  assert.equal(minutesIntoDay(now, NY), 0)
})

test('one minute before closing and one minute after are different hours', () => {
  const before = new Date('2026-08-31T20:59:00Z')   // 16:59 New York
  const after = new Date('2026-08-31T21:01:00Z')    // 17:01 New York
  assert.equal(hourIn(before, NY), 16)
  assert.equal(hourIn(after, NY), 17)
  assert.equal(minutesIntoDay(before, NY), 16 * 60 + 59)
})

test('a zone that crosses a date line either way still agrees with itself', () => {
  const now = new Date('2026-01-15T12:00:00Z')
  assert.equal(isoDateIn(now, 'Pacific/Auckland'), '2026-01-16')   // UTC+13
  assert.equal(isoDateIn(now, 'Pacific/Honolulu'), '2026-01-15')   // UTC-10
  assert.equal(isoDateIn(now, 'UTC'), '2026-01-15')
})

test('a daylight-saving switch does not shift the date', () => {
  // US DST ended 2026-11-01 at 02:00 local. 05:30 UTC is 01:30 EDT, still the 1st.
  const now = new Date('2026-11-01T05:30:00Z')
  assert.equal(isoDateIn(now, NY), '2026-11-01')
  assert.equal(hourIn(now, NY), 1)
})

// ── falling back ────────────────────────────────────────────────────────────

test('an unset timezone falls back to the device, never silently to UTC', () => {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone
  assert.equal(resolveTimeZone({}), device)
  assert.equal(resolveTimeZone(null), device)
  assert.equal(resolveTimeZone({ timezone: '' }), device)
  assert.equal(resolveTimeZone({ timezone: 'Not/AZone' }), device)
})

test('a configured timezone is used as given', () => {
  assert.equal(resolveTimeZone({ timezone: IL }), IL)
  assert.equal(resolveTimeZone({ timezone: '  America/New_York  ' }), NY)
})

test('an unknown zone never throws its way onto the screen', () => {
  const now = new Date('2026-08-31T12:00:00Z')
  assert.equal(isoDateIn(now, 'Middle/Earth'), '2026-08-31')
  assert.equal(isValidTimeZone('Middle/Earth'), false)
  assert.equal(isValidTimeZone(IL), true)
})

// ── date arithmetic stays clear of timezones entirely ──────────────────────

test('shifting a date by days crosses months and years without drifting', () => {
  assert.equal(shiftIso('2026-08-31', -1), '2026-08-30')
  assert.equal(shiftIso('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftIso('2024-03-01', -1), '2024-02-29')      // leap year
  assert.equal(shiftIso('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftIso('2026-12-31', 1), '2027-01-01')
})

test('a date lands on the same weekday whatever the device zone', () => {
  assert.equal(weekdayMon0('2026-08-31'), 0)   // Monday
  assert.equal(weekdayMon0('2026-09-06'), 6)   // Sunday
})

test('closed days are recognised from the date alone', () => {
  const openMonToFri = { opening_days: [0, 1, 2, 3, 4] }
  assert.equal(isNonWorkingDay('2026-08-31', openMonToFri), false)   // Monday
  assert.equal(isNonWorkingDay('2026-09-05', openMonToFri), true)    // Saturday
  // No configured days means we cannot claim a day is closed.
  assert.equal(isNonWorkingDay('2026-09-05', {}), false)
  assert.equal(isNonWorkingDay('2026-09-05', { opening_days: [] }), false)
})
