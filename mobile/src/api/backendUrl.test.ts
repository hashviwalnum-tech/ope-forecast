/**
 * Every copy of the backend's address must name the same host.
 *
 * The address lives in four places the phone build can read from: `.env` for a
 * local Expo run, both build profiles in `eas.json` for a real store build, and
 * the fallback compiled into `client.ts` when neither is present. When Render
 * moved the service, three of the four were still pointing at the old host, and
 * nothing failed — the app just could not reach anything, and only on a device.
 *
 * This is that failure, caught on a laptop.
 *
 * Run: npm test   (from mobile/ — node --test, no framework, no dependency)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MOBILE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function read(...parts: string[]): string {
  return readFileSync(join(MOBILE_DIR, ...parts), 'utf8')
}

/**
 * Every https:// host assigned to a named variable in a chunk of text.
 *
 * One matcher for both `.env` (`NAME=url`) and `eas.json` (`"NAME": "url"`),
 * because the point is that those two and the compiled-in fallback agree.
 */
function hostsFor(pattern: RegExp, text: string): string[] {
  const out: string[] = []
  const re = new RegExp(pattern.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1].replace(/\/$/, ''))
  return out
}

const API_URL = /EXPO_PUBLIC_API_BASE_URL["']?\s*[:=]\s*["']?(https:\/\/[^"'\s,}]+)/
const WEB_URL = /EXPO_PUBLIC_WEB_APP_URL["']?\s*[:=]\s*["']?(https:\/\/[^"'\s,}]+)/

const apiHosts = (text: string) => hostsFor(API_URL, text)
const webHosts = (text: string) => hostsFor(WEB_URL, text)

test('.env, eas.json and the client fallback all name one backend', () => {
  const fallback = read('src', 'api', 'client.ts').match(
    /EXPO_PUBLIC_API_BASE_URL\s*\?\?\s*'(https:\/\/[^']+)'/,
  )
  assert.ok(fallback, 'client.ts has no https fallback URL to check')

  const found = [
    ...apiHosts(read('.env')),
    ...apiHosts(read('eas.json')),
    fallback[1].replace(/\/$/, ''),
  ]

  assert.ok(found.length >= 4, `expected .env, both eas profiles and the fallback, got ${found.length}`)
  assert.equal(new Set(found).size, 1, `these disagree about the backend: ${[...new Set(found)].join(' vs ')}`)
})

test('.env, eas.json and the urls fallback agree on the web app', () => {
  // The phone sends people to the web app for one thing only — setting a new
  // password after a recovery link, which cannot usefully come back to a phone.
  // A wrong address here strands anyone who forgets their password.
  const fallback = read('src', 'lib', 'urls.ts').match(
    /EXPO_PUBLIC_WEB_APP_URL\s*\?\?\s*'(https:\/\/[^']+)'/,
  )
  assert.ok(fallback, 'urls.ts has no https fallback URL to check')

  const found = [
    ...webHosts(read('.env')),
    ...webHosts(read('eas.json')),
    fallback[1].replace(/\/$/, ''),
  ]

  assert.ok(found.length >= 4, `expected .env, both eas profiles and the fallback, got ${found.length}`)
  assert.equal(new Set(found).size, 1, `these disagree about the web app: ${[...new Set(found)].join(' vs ')}`)
})

test('no file still names the retired Render service', () => {
  for (const file of ['.env', '.env.example', 'eas.json', 'app.json'] as const) {
    let text: string
    try {
      text = read(file)
    } catch {
      continue                    // .env is not committed; skip it when absent
    }
    assert.ok(
      !text.includes('https://ope-forecast.onrender.com'),
      `${file} still points at the old backend host`,
    )
  }
  assert.ok(!read('src', 'api', 'client.ts').includes('https://ope-forecast.onrender.com'))
})
