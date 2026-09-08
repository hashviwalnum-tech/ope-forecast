/**
 * No component may render English text that never went through `t()`.
 *
 * The spec asks for untranslated strings to be made *detectable* rather than
 * patched each time one is noticed, because the piecemeal approach had already
 * failed several times. This is that check for the plainest case: literal text
 * sitting between JSX tags.
 *
 * It found two real ones on the day it was written — the whole sign-in screen,
 * which is the first thing every owner sees, and both "Back" buttons in the
 * onboarding wizard, which sat in English inside an otherwise Russian page.
 *
 * What it does NOT cover, and what still needs a human eye: text passed as a
 * prop (`placeholder`, `aria-label`, `title`), strings built in JavaScript, and
 * Recharts label/series props. Those are the stubborn ones named in the spec.
 * This catches the easiest third reliably, which is better than catching all of
 * it unreliably.
 *
 * Run: npm test   (from web/)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Text that is legitimately the same in every language, or is not language.
 *
 * Keep this list short and specific. Anything vague enough to swallow a real
 * sentence defeats the test.
 */
const ALLOWED = new Set([
  'Ope',        // the product name
  'Telegram',   // a product name
  'OPe',        // the logo's wordmark
])

/** Characters that make a fragment code rather than prose. */
const LOOKS_LIKE_CODE = /[=<>&|?;]|\.\w|\(\)|\{|\}/

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full))
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Literal text between JSX tags, e.g. `<p>Hello</p>`.
 *
 * `{...}` is excluded from the match, so anything interpolated — which is where
 * `t('key')` lives — is never reported. The lookbehind rules out an arrow
 * function's `>`, which otherwise makes every `=> Promise<T>` look like text.
 */
const JSX_TEXT = /(?<![=-])>([^<>{}\n]*[A-Za-z]{2}[^<>{}\n]*)</g

test('no component renders literal English between its tags', () => {
  const offenders: string[] = []

  for (const file of tsxFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return

      for (const match of line.matchAll(JSX_TEXT)) {
        const text = match[1].trim()
        if (!text || ALLOWED.has(text)) continue
        // A TypeScript generic (`Promise<void>`) or a comparison inside an
        // expression looks like JSX text to a regex. Real UI copy does not
        // contain these.
        if (LOOKS_LIKE_CODE.test(text)) continue
        // Needs two consecutive letters to be a word rather than punctuation.
        if (!/[A-Za-z]{2}/.test(text)) continue
        offenders.push(`${relative(SRC, file)}:${i + 1}  ${text}`)
      }
    })
  }

  assert.deepEqual(
    offenders, [],
    'these render English directly instead of through t():\n  ' + offenders.join('\n  '),
  )
})
