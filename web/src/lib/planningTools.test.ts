/**
 * Reading the numbers typed into the planning toolbox.
 *
 * Run with:  npm test       (from web/)
 *
 * The toolbox MATHS is no longer tested here — it moved to
 * backend/app/engine/planning.py, and its known-answer tests moved with it to
 * backend/tests/engine/test_planning.py. That the move changed no numbers is
 * proved by backend/tests/engine/parity/, which runs the frozen browser
 * implementation and the engine over 730 shared cases and diffs them.
 *
 * What is left here is the part that stayed in the client: reading a form field.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { num } from './planningTools.ts'

const close = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, msg ?? `expected ${b}, got ${a}`)

test('currency symbols and spaces are ignored, negatives are kept', () => {
  close(num('€1.50'), 1.5)
  close(num('  42 '), 42)
  close(num('-50'), -50)          // a worst case can be a loss
  close(num(''), 0)
  close(num('abc'), 0)
})

test('a pasted comma decimal is not silently multiplied by a hundred', () => {
  // An earlier version stripped the comma, so "12,50" became 1250 in a price field.
  close(num('12,50'), 12.5)
  close(num('0,5'), 0.5)
  close(num('€12,50'), 12.5)
})

test('an ordinary dot decimal is unaffected', () => {
  close(num('0.5'), 0.5)
  close(num('1234.56'), 1234.56)
  close(num('0'), 0)
})
