import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seed } from './seed'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = resolve(HERE, '.auth')
const STATE = resolve(AUTH_DIR, 'state.json')
const META = resolve(AUTH_DIR, 'meta.json')

export default async function globalSetup(config: FullConfig) {
  mkdirSync(AUTH_DIR, { recursive: true })

  // 1. Seed a business + a year of data through the API.
  const s = await seed()
  writeFileSync(META, JSON.stringify(s, null, 2))

  // 2. Log in through the real UI so supabase-js writes its own storage,
  //    then persist that storage for every spec to reuse.
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173'
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(baseURL)

  await page.getByLabel('Email').fill(s.email)
  await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: /sign in/i }).click()

  // The main content <h1> only renders once the session + business are loaded
  // and onboarding is marked done (it is, via the seed).
  await page.locator('main h1').first().waitFor({ timeout: 45_000 })
  await page.waitForTimeout(1500)

  await page.context().storageState({ path: STATE })
  await browser.close()

  writeFileSync(
    resolve(AUTH_DIR, 'ready'),
    `seeded ${s.email} business ${s.businessId} at ${new Date().toISOString()}\n`,
  )
}
