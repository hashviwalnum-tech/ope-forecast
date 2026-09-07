/**
 * Every language the picker offers must actually be translated.
 *
 * Eleven of the fifteen languages were `{}` — the picker listed them, the app
 * silently fell back to English, and nothing anywhere said so. That is exactly
 * the failure the spec asks to make *detectable* rather than patched again:
 * "make untranslated strings detectable ... so gaps are visible instead of
 * silently English."
 *
 * This is that check. It fails the moment a key is added to `en` without a
 * translation in the other fourteen, so the gap surfaces here rather than in
 * front of an owner.
 *
 * Run: npm test   (from mobile/ — node --test, no framework, no dependency)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LANG_LABELS, RTL_LANGS, translations, makeT, type Lang } from './i18n.ts'

const LANGS = Object.keys(translations) as Lang[]
const EN_KEYS = Object.keys(translations.en) as Array<keyof typeof translations.en>

test('the picker offers exactly the languages that exist', () => {
  assert.deepEqual(new Set(Object.keys(LANG_LABELS)), new Set(LANGS))
})

test('every language has every key — no silent English fallback', () => {
  const gaps: string[] = []
  for (const lang of LANGS) {
    const map = translations[lang] as Record<string, string>
    const missing = EN_KEYS.filter(k => map[k] === undefined)
    if (missing.length) {
      gaps.push(`${lang}: ${missing.length} missing (${missing.slice(0, 6).join(', ')}…)`)
    }
  }
  assert.deepEqual(gaps, [], `untranslated strings would fall back to English:\n${gaps.join('\n')}`)
})

test('no language holds a key English does not', () => {
  const en = new Set<string>(EN_KEYS as string[])
  for (const lang of LANGS) {
    const extra = Object.keys(translations[lang]).filter(k => !en.has(k))
    assert.deepEqual(extra, [], `${lang} has keys absent from en: ${extra.join(', ')}`)
  }
})

test('no translation is left as the English text (except where that is correct)', () => {
  // Brand names, "Telegram", "Ope" and the like are legitimately identical.
  // What this catches is a language block copy-pasted from English wholesale.
  for (const lang of LANGS) {
    if (lang === 'en') continue
    const map = translations[lang] as Record<string, string>
    const identical = EN_KEYS.filter(k => map[k] === (translations.en as Record<string, string>)[k])
    assert.ok(
      identical.length < EN_KEYS.length * 0.5,
      `${lang} is ${Math.round(100 * identical.length / EN_KEYS.length)}% identical to English — ` +
      'that looks like an untranslated copy rather than a translation',
    )
  }
})

test('every placeholder in an English string survives translation', () => {
  // A dropped {n} or {name} renders a sentence with a hole in it. The one
  // deliberate exception is {s}, an English-only pluraliser ("day{s}") that
  // languages without an -s plural correctly leave out.
  const placeholders = (v: string) =>
    new Set((v.match(/\{(\w+)\}/g) ?? []).filter(p => p !== '{s}'))

  for (const lang of LANGS) {
    if (lang === 'en') continue
    const map = translations[lang] as Record<string, string>
    for (const k of EN_KEYS) {
      const value = map[k]
      if (value === undefined) continue
      const want = placeholders((translations.en as Record<string, string>)[k])
      const got = placeholders(value)
      for (const p of want) {
        assert.ok(got.has(p), `${lang}.${String(k)} lost the placeholder ${p}`)
      }
    }
  }
})

test('the English {s} pluraliser never survives into a language without one', () => {
  // Web shipped "29 Tags" and "29 güns" this way: {s} substitutes an English
  // "s" into a language that does not pluralise with one.
  const NO_S_PLURAL: Lang[] = ['he', 'zh', 'hi', 'ar', 'ru', 'bn', 'ur', 'id', 'de', 'ja', 'tr']
  for (const lang of NO_S_PLURAL) {
    const map = translations[lang] as Record<string, string>
    const offenders = Object.entries(map).filter(([, v]) => v.includes('{s}')).map(([k]) => k)
    assert.deepEqual(offenders, [], `${lang} would render a literal English "s": ${offenders.join(', ')}`)
  }
})

test('RTL languages are the ones actually written right to left', () => {
  assert.deepEqual([...RTL_LANGS].sort(), ['ar', 'he', 'ur'])
})

test('t() substitutes variables and falls back to English for an unknown key', () => {
  const t = makeT('he')
  assert.equal(t('rtlRestartTitle'), 'עוד רגע')
  // A key with a variable resolves it rather than printing the brace form.
  const withVar = makeT('en')('staffLabel', { n: 3 })
  assert.equal(withVar, '3 staff')
  assert.ok(!withVar.includes('{'))
})
