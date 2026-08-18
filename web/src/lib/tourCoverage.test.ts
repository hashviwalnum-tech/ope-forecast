/**
 * The guided tour has to cover every settings option (spec §4.5: it goes
 * "INTO each section and explains every feature within it ... including ALL
 * settings options").
 *
 * That is a promise nobody can keep by remembering. Adding the currency
 * setting is exactly how it breaks: the `data-tour` hook went in and the tour
 * step did not, so the tour walked straight past a new option.
 *
 * Run with:  npm test       (from web/)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const componentsDir = join(import.meta.dirname, '..', 'components')
const read = (name: string) => readFileSync(join(componentsDir, name), 'utf8')

/** Every `data-tour="…"` marker placed in a file. */
function markersIn(file: string): Set<string> {
  const src = read(file)
  return new Set([...src.matchAll(/data-tour="([^"]+)"/g)].map(m => m[1]))
}

/** Every target the tour actually visits. */
function tourTargets(): Set<string> {
  const src = read('GuidedTour.tsx')
  return new Set(
    [...src.matchAll(/target:\s*'\[data-tour="([^"]+)"\]'/g)].map(m => m[1]),
  )
}

test('every settings option the tour could point at, it does', () => {
  const settings = [...markersIn('BusinessSettings.tsx')].filter(m => m.startsWith('settings-'))
  assert.ok(settings.length > 3, 'expected several settings markers; did the attribute change?')

  const visited = tourTargets()
  const missed = settings.filter(m => !visited.has(m))

  assert.deepEqual(missed, [],
    'these settings options exist but the tour never explains them:\n  ' + missed.join('\n  '))
})

// NOT CHECKED HERE: whether every tour target still exists. Markers are not
// always literal attributes — the nav ones are built as `data-tour={`nav-${id}`}`
// and by a ternary — so a source scan reports four healthy targets as dangling.
// A guard that cries wolf is worse than none, because people learn to ignore
// it; proving that properly needs the app rendered, which belongs with the
// deferred Playwright work.

test('the currency setting in particular is explained', () => {
  // The one that prompted this file.
  assert.ok(markersIn('BusinessSettings.tsx').has('settings-currency'),
    'the currency setting lost its tour marker')
  assert.ok(tourTargets().has('settings-currency'),
    'the tour no longer explains how to choose a currency')
})
