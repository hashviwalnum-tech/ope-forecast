/**
 * Every main screen of the year-long business, measured. See playwright.ux.config.ts.
 * Writes test-results/ux-sim.json.
 */
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

import { translations, type Lang } from '../../src/i18n'
import { measure, prime, settle, type Measurement } from './measureLib'

type K = keyof typeof translations['en']
type Group = 'primary' | 'history' | 'manage' | 'gear'
const SCREENS: { id: string; nav: K; title: K; group: Group }[] = [
  { id: 'home', nav: 'home', title: 'tabHome', group: 'primary' },
  { id: 'predictions_home', nav: 'predictions', title: 'tabPredictions', group: 'primary' },
  { id: 'insights', nav: 'insightsNavLabel', title: 'tabInsights', group: 'primary' },
  { id: 'trends', nav: 'monthlyTrends', title: 'tabTrends', group: 'history' },
  { id: 'history', nav: 'pastDays', title: 'tabHistory', group: 'history' },
  { id: 'products', nav: 'myProducts', title: 'tabProducts', group: 'manage' },
  { id: 'stock', nav: 'stockStatusTab', title: 'tabStockStatus', group: 'manage' },
  { id: 'regulars', nav: 'myRegulars', title: 'tabRegulars', group: 'manage' },
  { id: 'events', nav: 'promosEvents', title: 'tabEvents', group: 'manage' },
  { id: 'toolbox', nav: 'advancedPlanning', title: 'tabToolbox', group: 'manage' },
  { id: 'premium', nav: 'premiumBilling', title: 'tabPremium', group: 'manage' },
  { id: 'settings', nav: 'settings', title: 'tabSettings', group: 'gear' },
]

// Both themes in English and Hebrew; one more RTL language and one with long words.
const COMBOS: [Lang, 'light' | 'dark'][] = [
  ['en', 'light'], ['en', 'dark'], ['he', 'light'], ['he', 'dark'], ['ar', 'light'], ['de', 'light'],
]
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }]

const tr = (lang: Lang, key: K) =>
  (translations[lang] as Record<string, string>)[key] ?? (translations.en as Record<string, string>)[key]

async function goTo(page: Page, s: (typeof SCREENS)[number], lang: Lang) {
  const phone = (page.viewportSize()?.width ?? 9999) < 1024
  if (s.id === 'home') {
    await page.goto('/')
  } else if (phone) {
    const bottom = page.locator('nav.fixed.bottom-0')
    if (s.group === 'primary') {
      await bottom.getByRole('button', { name: tr(lang, s.nav), exact: false }).click()
    } else {
      await bottom.getByRole('button', { name: tr(lang, 'manage'), exact: false }).click()
      const sheet = page.getByRole('dialog', { name: tr(lang, 'manage') })
      await sheet.waitFor()
      await sheet.getByRole('button', { name: tr(lang, s.nav), exact: true }).click()
    }
  } else if (s.group === 'primary') {
    await page.locator('header nav').getByRole('button', { name: tr(lang, s.nav), exact: true }).click()
  } else if (s.group === 'gear') {
    await page.locator('header').getByRole('button', { name: tr(lang, 'settings') }).click()
  } else {
    await page.locator('header nav').getByRole('button', { name: s.group === 'history' ? tr(lang, 'history') : tr(lang, 'manage'), exact: true }).click()
    await page.getByRole('button', { name: tr(lang, s.nav), exact: true }).click()
  }
  await expect(page.locator('main h1')).toHaveText(tr(lang, s.title), { timeout: 60_000 })
  await settle(page)
}

test('measure every screen of the year-long business', async ({ browser }) => {
  const results: Measurement[] = []
  const bizId = 1   // the simulation's only business
  for (const vp of VIEWPORTS) {
    for (const [lang, theme] of COMBOS) {
      const ctx = await browser.newContext({ storageState: 'tests/a11y/.auth/state.json', viewport: { width: vp.width, height: vp.height } })
      const page = await ctx.newPage()
      await prime(page, lang, theme, bizId)
      for (const s of SCREENS) {
        const t0 = Date.now()
        try {
          await goTo(page, s, lang)
        } catch (e) {
          console.log(`could not reach ${s.id} (${vp.name} ${lang} ${theme}): ${String(e).slice(0, 120)}`)
          continue
        }
        const loadMs = Date.now() - t0
        results.push(await measure(page, { account: 'sim', viewport: vp.name, theme, lang, screen: s.id, loadMs }))
      }
      await ctx.close()
    }
  }
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/ux-sim.json', JSON.stringify(results, null, 1))
  console.log(`measured ${results.length} screen states`)
})
