/**
 * No browser-only AbortSignal helpers in the phone app.
 *
 * React Native replaces the global AbortSignal with the `abort-controller`
 * polyfill, which has neither `AbortSignal.timeout` nor `AbortSignal.any`. Both
 * type-check — TypeScript reads the DOM lib — and both work in a browser, so the
 * web app and every laptop test were fine. On a phone the call threw before any
 * request was sent, and every screen sat on its loading spinner for ever.
 *
 * This is that failure, caught on a laptop.
 *
 * Run: npm test   (from mobile/ — node --test, no framework, no dependency)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const MISSING_ON_PHONE = /AbortSignal\s*\.\s*(timeout|any)\s*\(/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

test('no source file calls AbortSignal.timeout or AbortSignal.any', () => {
  const offenders = sourceFiles(SRC_DIR)
    .filter((file) => MISSING_ON_PHONE.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC_DIR, file))
  assert.deepEqual(offenders, [], `these call an AbortSignal helper the phone does not have: ${offenders.join(', ')}`)
})
