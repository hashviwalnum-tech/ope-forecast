/**
 * What a brand-new owner sees, step by step, and how many taps it takes.
 * Run against an empty database (UX_FRESH=1 — see playwright.ux.config.ts).
 * Writes docs/audit/ux/ux-first-run-<lang>.json.
 */
import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

import { translations, type Lang } from '../../src/i18n'
import { measure, prime, type Measurement } from './measureLib'

type K = keyof typeof translations['en']
const tr = (lang: Lang, key: K) =>
  (translations[lang] as Record<string, string>)[key] ?? (translations.en as Record<string, string>)[key]

interface Step { what: string; taps: number; ms: number; text: string; m?: Measurement }

async function visibleText(page: Page) {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600)
}

for (const lang of ['en', 'he'] as Lang[]) {
  test(`first run, ${lang}`, async ({ browser }) => {
    test.skip(!process.env.UX_FRESH, 'needs the empty backend: UX_FRESH=1')
    const ctx = await browser.newContext({
      storageState: 'tests/a11y/.auth/state.json', viewport: { width: 390, height: 844 },
    })
    const page = await ctx.newPage()
    await prime(page, lang, 'light', null)
    const steps: Step[] = []
    const base = (screen: string, loadMs: number) =>
      ({ account: 'fresh', viewport: 'phone', theme: 'light', lang, screen, loadMs })

    let t0 = Date.now()
    await page.goto('/')
    // A second language run finds the business the first one made.
    const welcome = page.getByText(tr(lang, 'welcomeTitle'))
    const already = await welcome.waitFor({ timeout: 60_000 }).then(() => false).catch(() => true)
    if (already) {
      steps.push({ what: 'account already set up by the previous run', taps: 0, ms: Date.now() - t0, text: await visibleText(page) })
    } else {
      steps.push({ what: 'welcome / name your business', taps: 0, ms: Date.now() - t0,
        text: await visibleText(page), m: await measure(page, base('setup', Date.now() - t0)) })

      await page.getByPlaceholder(tr(lang, 'businessNamePlaceholder')).fill(lang === 'he' ? 'הקפה של דנה' : 'Corner Cafe')
      t0 = Date.now()
      await page.getByRole('button', { name: tr(lang, 'getStartedBtn') }).click()
      await page.getByRole('button', { name: tr(lang, 'onboardingContinue') }).waitFor({ timeout: 60_000 })
      steps.push({ what: 'wizard 1: hours, days, currency', taps: 1, ms: Date.now() - t0,
        text: await visibleText(page), m: await measure(page, base('wizard-hours', Date.now() - t0)) })

      t0 = Date.now()
      await page.getByRole('button', { name: tr(lang, 'onboardingContinue') }).click()
      await page.getByRole('button', { name: tr(lang, 'onboardingProductsLater') }).waitFor()
      steps.push({ what: 'wizard 2: products', taps: 1, ms: Date.now() - t0,
        text: await visibleText(page), m: await measure(page, base('wizard-products', Date.now() - t0)) })

      await page.getByRole('button', { name: tr(lang, 'onboardingProductsLater') }).click()
      await page.getByRole('button', { name: tr(lang, 'onboardingDone') }).waitFor()
      steps.push({ what: 'wizard 3: how to log', taps: 1, ms: 0,
        text: await visibleText(page), m: await measure(page, base('wizard-log', 0)) })
      await page.getByRole('button', { name: tr(lang, 'onboardingDone') }).click()
    }

    // The guided tour, if it opens: count its steps.
    let tourSteps = 0
    const next = page.getByRole('button', { name: new RegExp(`^(${tr(lang, 'tourNext')}|${tr(lang, 'tourFinish')})`) })
    if (await next.first().waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) {
      steps.push({ what: 'tour opens', taps: 0, ms: 0, text: await visibleText(page),
        m: await measure(page, base('tour', 0)) })
      while (tourSteps < 200 && await next.first().isVisible().catch(() => false)) {
        await next.first().click()
        tourSteps++
        await page.waitForTimeout(150)
      }
    }
    steps.push({ what: `tour finished after ${tourSteps} taps on Next`, taps: tourSteps, ms: 0, text: '' })
    steps.push({ what: 'home, day one', taps: 0, ms: 0, text: await visibleText(page),
      m: await measure(page, base('home-day-one', 0)) })

    mkdirSync('../docs/audit/ux', { recursive: true })
    writeFileSync(`../docs/audit/ux/ux-first-run-${lang}.json`, JSON.stringify(steps, null, 1))
    await ctx.close()
  })
}
