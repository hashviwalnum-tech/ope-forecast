/**
 * No screen renders English directly — everything goes through t().
 *
 * The web app has had this check for a while; the phone never did, and the
 * final pre-launch audit found about ninety English strings across Products,
 * Past days, Orders, Regulars, Telegram and Settings — a Hebrew-speaking owner
 * met English on the screens they use every day. This also catches the two
 * shapes the web check misses: text on its own line between tags, and text
 * sitting next to a {value} ("How much did {name} spend today?").
 *
 * Run: npm test   (from mobile/)
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
const ALLOWED_PROPS = new Set(['you@example.com'])

const LOOKS_LIKE_CODE = /[=<>&|?;`$]|\.\w|\(\)|\{|\}|^[(),\]]|:\s*\w+\)|\b(return|export|const|function|interface|import|from|if|case|else)\b/

/** Text between tags, or between a tag/expression and the next tag/expression. */
const JSX_TEXT = /(?:(?<![=-])>|\}(?=[^<>{}]*[A-Za-z]{2}[^<>{}]*<))([^<>{}]*[A-Za-z]{2}[^<>{}]*)(?=[<{])/g
const TEXT_PROPS = /\b(placeholder|title|accessibilityLabel|accessibilityHint|alt|label)="([^"]*[A-Za-z]{2}[^"]*)"/g

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

test('no screen renders English directly', () => {
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

test('no source file carries text garbled by a wrong encoding', () => {
  // UTF-8 punctuation once decoded as Hebrew Windows-1255 and saved that way:
  // an ellipsis became three unrelated characters starting with a Hebrew gimel,
  // a middle dot two starting with a Hebrew point, and the phone showed gibberish.
  // Built from char codes so this file cannot contain what it looks for.
  const ch = (n: number) => String.fromCharCode(n)
  const garbled = new RegExp(
    `${ch(0x05d2)}${ch(0x20ac)}.|${ch(0x05b2)}[${ch(0xa0)}-${ch(0xff)}]|${ch(0x05d2)}${ch(0x2020)}.`)
  const offenders = tsxFiles(SRC)
    .concat(readdirSync(join(SRC, 'lib')).filter(f => f.endsWith('.ts')).map(f => join(SRC, 'lib', f)))
    .filter(f => garbled.test(readFileSync(f, 'utf8')))
    .map(f => relative(SRC, f))
  assert.deepEqual(offenders, [])
})
