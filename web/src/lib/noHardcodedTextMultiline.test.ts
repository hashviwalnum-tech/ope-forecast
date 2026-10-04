/**
 * The same check as noHardcodedText.test.ts, made to see two shapes that one
 * misses: text on its own line between tags, and text next to a {value}. The
 * phone app's copy of this found about ninety English strings the single-line
 * check could never have caught.
 *
 * Run with:  npm test       (from web/)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Names, not words: the same in every language. */
const ALLOWED = new Set(['Ope', 'Telegram', 'OPe', '/link'])  // '/link' is the bot command itself
/** An example an owner types literally, in any language. */
const ALLOWED_PROPS = new Set(['you@example.com', 'Ope'])

const LOOKS_LIKE_CODE = /[=<>&|?;`$]|\.\w|\(\)|\{|\}|^[(),\]]|:\s*\w+\)|\['|\w\)$|\bset[A-Z]\w*\(|\b(return|export|const|function|interface|import|from|if|case|else|try)\b/

/** Text between tags, or between a tag/expression and the next tag/expression. */
const JSX_TEXT = /(?:(?<![=-])>|\}(?=[^<>{}]*[A-Za-z]{2}[^<>{}]*<))([^<>{}]*[A-Za-z]{2}[^<>{}]*)(?=[<{])/g
const TEXT_PROPS = /\b(placeholder|title|aria-label|alt|label)="([^"]*[A-Za-z]{2}[^"]*)"/g

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full))
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Comments blanked out (newlines kept, so line numbers stay right). */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre: string) => pre + ' '.repeat(m.length - pre.length))
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length
}

test('no screen renders English directly, even across lines', () => {
  const offenders: string[] = []
  for (const file of tsxFiles(SRC)) {
    const src = withoutComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(JSX_TEXT)) {
      const text = m[1].replace(/\s+/g, ' ').trim()
      if (!text || ALLOWED.has(text) || LOOKS_LIKE_CODE.test(text)) continue
      offenders.push(`${relative(SRC, file)}:${lineOf(src, m.index!)}  ${text}`)
    }
    for (const m of src.matchAll(TEXT_PROPS)) {
      if (ALLOWED_PROPS.has(m[2])) continue
      offenders.push(`${relative(SRC, file)}:${lineOf(src, m.index!)}  ${m[1]}="${m[2]}"`)
    }
  }
  assert.deepEqual(offenders, [],
    'these show English instead of going through t():\n  ' + offenders.join('\n  '))
})
