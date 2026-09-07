import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { translations, type Lang } from '../../src/i18n'

const HERE = dirname(fileURLToPath(import.meta.url))

/* ──────────────────────────────────────────────────────────────────────────
 * Accessibility suite
 *
 * Matrix: 12 main screens × {light, dark} × {en, he} × {phone, desktop}
 * (the two viewports are Playwright projects), each scanned with axe-core
 * against WCAG 2.0/2.1 A + AA. Plus hand-written checks the UX round asked to
 * be *verified working*, not just present:
 *   - focus order through the new bottom tab bar, and no keyboard trap in it
 *   - the Manage sheet and the guided tour: focus moves in, Escape closes,
 *     focus does not leak to the page behind an aria-modal
 *   - aria-live regions actually receive text when something loads / saves /
 *     fails validation (an empty live region announces nothing)
 * ────────────────────────────────────────────────────────────────────────── */

const META = JSON.parse(readFileSync(resolve(HERE, '.auth/meta.json'), 'utf8')) as {
  businessId: number
}

type Group = 'primary' | 'history' | 'manage' | 'gear'
interface Screen { id: string; navKey: keyof typeof translations['en']; titleKey: keyof typeof translations['en']; group: Group }

const SCREENS: Screen[] = [
  { id: 'home',             navKey: 'home',            titleKey: 'tabHome',        group: 'primary' },
  { id: 'predictions_home', navKey: 'predictions',     titleKey: 'tabPredictions', group: 'primary' },
  { id: 'insights',         navKey: 'insightsNavLabel', titleKey: 'tabInsights',   group: 'primary' },
  { id: 'trends',           navKey: 'monthlyTrends',   titleKey: 'tabTrends',      group: 'history' },
  { id: 'history',          navKey: 'pastDays',        titleKey: 'tabHistory',     group: 'history' },
  { id: 'products',         navKey: 'myProducts',      titleKey: 'tabProducts',    group: 'manage' },
  { id: 'stock',            navKey: 'stockStatusTab',  titleKey: 'tabStockStatus', group: 'manage' },
  { id: 'regulars',         navKey: 'myRegulars',      titleKey: 'tabRegulars',    group: 'manage' },
  { id: 'events',           navKey: 'promosEvents',    titleKey: 'tabEvents',      group: 'manage' },
  { id: 'toolbox',          navKey: 'advancedPlanning', titleKey: 'tabToolbox',    group: 'manage' },
  { id: 'premium',          navKey: 'premiumBilling',  titleKey: 'tabPremium',     group: 'manage' },
  { id: 'settings',         navKey: 'settings',        titleKey: 'tabSettings',    group: 'gear' },
]

const THEMES = ['light', 'dark'] as const
const LANGS: Lang[] = ['en', 'he']

function tr(lang: Lang, key: keyof typeof translations['en']): string {
  return (translations[lang] as Record<string, string>)[key] ?? (translations.en as Record<string, string>)[key]
}

/** Set language / theme / dismiss tour & simple-mode prompt before any script runs. */
async function primePage(page: Page, lang: Lang, theme: 'light' | 'dark') {
  await page.addInitScript(
    ([lang, theme, bizId]) => {
      try {
        localStorage.setItem('ope_language', lang as string)
        localStorage.setItem('ope_theme', theme as string)
        localStorage.setItem('ope_simple_mode', '0')
        localStorage.setItem(`ope_tour_done_${bizId}`, '1')
      } catch { /* ignore */ }
      // Freeze CSS transitions/animations so axe reads settled colours, not
      // mid-interpolation values (the flaw the UX measuring script hit). Also
      // pin animate-pulse to full opacity: frozen mid-pulse it can sit at ~0.5,
      // which drops otherwise-fine text below the contrast threshold — a real
      // but transient issue that would otherwise mask the persistent ones.
      const style = document.createElement('style')
      style.textContent =
        '*,*::before,*::after{transition:none!important;animation:none!important}' +
        '.animate-pulse{opacity:1!important}'
      document.documentElement.appendChild(style)
    },
    [lang, theme, META.businessId] as const,
  )
}

async function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 9999) < 1024
}

async function goHomeReady(page: Page) {
  await page.goto('/')
  // brand button carries t('a11yGoHome'); the main <h1> carries the tab title
  await page.locator('main h1').first().waitFor({ timeout: 45_000 })
  await page.waitForTimeout(400)
}

/** Navigate to a screen using the real nav for this viewport. */
async function gotoScreen(page: Page, s: Screen, lang: Lang) {
  const phone = await isPhone(page)

  if (phone) {
    const bottom = page.locator('nav.fixed.bottom-0')
    if (s.group === 'primary') {
      await bottom.getByRole('button', { name: tr(lang, s.navKey), exact: false }).click()
    } else {
      // Everything else lives behind the Manage slot → opens the sheet
      await bottom.getByRole('button', { name: tr(lang, 'manage'), exact: false }).click()
      const sheet = page.getByRole('dialog', { name: tr(lang, 'manage') })
      await sheet.waitFor()
      await sheet.getByRole('button', { name: tr(lang, s.navKey), exact: true }).click()
    }
  } else {
    if (s.group === 'primary') {
      await page.locator('header nav').getByRole('button', { name: tr(lang, s.navKey), exact: true }).click()
    } else if (s.group === 'gear') {
      await page.locator('header').getByRole('button', { name: tr(lang, 'settings') }).click()
    } else {
      const groupLabel = s.group === 'history' ? tr(lang, 'history') : tr(lang, 'manage')
      await page.locator('header nav').getByRole('button', { name: groupLabel, exact: true }).click()
      await page.getByRole('button', { name: tr(lang, s.navKey), exact: true }).click()
    }
  }

  await expect(page.locator('main h1')).toHaveText(tr(lang, s.titleKey), { timeout: 15_000 })

  // Let the panel finish its first fetch — scan the settled screen, not a
  // half-loaded one. Best-effort: some screens never show a spinner.
  await page.waitForTimeout(400)
  await page
    .locator('main [role="status"][aria-live="polite"]')
    .filter({ hasText: /^(Loading|Saving|טוען|שומר)/ })
    .first()
    .waitFor({ state: 'detached', timeout: 8_000 })
    .catch(() => {})
  await page.waitForTimeout(300)
}

async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
}

type Sev = 'critical' | 'serious' | 'moderate' | 'minor'
function summarise(violations: Awaited<ReturnType<typeof scan>>['violations']) {
  const bySev: Record<Sev, string[]> = { critical: [], serious: [], moderate: [], minor: [] }
  for (const v of violations) {
    const sev = (v.impact ?? 'minor') as Sev
    bySev[sev].push(`${v.id} (${v.nodes.length})`)
  }
  return bySev
}

// ── The matrix ────────────────────────────────────────────────────────────

for (const theme of THEMES) {
  for (const lang of LANGS) {
    test.describe(`axe — ${theme} / ${lang}`, () => {
      for (const s of SCREENS) {
        test(`${s.id}`, async ({ page }, testInfo) => {
          await primePage(page, lang, theme)
          await goHomeReady(page)
          await gotoScreen(page, s, lang)

          const { violations } = await scan(page)
          const bySev = summarise(violations)

          await testInfo.attach(`${s.id}-${theme}-${lang}-violations.json`, {
            body: JSON.stringify({ screen: s.id, theme, lang, project: testInfo.project.name, bySev, violations }, null, 2),
            contentType: 'application/json',
          })
          // Shown on pass too (Playwright lists annotations), so a screen with
          // only moderate/minor findings is not silently green. The full list at
          // every severity is in the attached JSON above.
          testInfo.annotations.push({ type: 'a11y', description: `${s.id} ${theme}/${lang}: ${JSON.stringify(bySev)}` })

          const serious = violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
          const detail = serious
            .map(v => `  [${v.impact}] ${v.id}: ${v.help}\n` +
              v.nodes.slice(0, 4).map(n => `      ${n.target.join(' ')}`).join('\n'))
            .join('\n')

          expect(serious, `serious/critical a11y violations on ${s.id} (${theme}/${lang}):\n${detail}\n` +
            `full breakdown: ${JSON.stringify(bySev)}`).toEqual([])
        })
      }
    })
  }
}

// ── Bottom tab bar: focus order + no keyboard trap (phone only) ────────────

test.describe('bottom tab bar', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'phone viewport only')

  test('tab order follows visual order and does not trap', async ({ page }) => {
    await primePage(page, 'en', 'light')
    await goHomeReady(page)

    const bottom = page.locator('nav.fixed.bottom-0')
    const btns = bottom.getByRole('button')
    await expect(btns).toHaveCount(4)
    const labels = await btns.allInnerTexts()

    // Focus the first bar button, then Tab through the rest — DOM/tab order must
    // match the left-to-right visual order (Home, Forecast, Insights, Manage).
    await btns.nth(0).focus()
    const seen: string[] = []
    for (let i = 0; i < 4; i++) {
      const txt = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
      seen.push(txt)
      await page.keyboard.press('Tab')
    }
    expect(seen).toEqual(labels.map(l => l.trim()))

    // One more Tab must move focus OUT of the nav (no trap that recycles within).
    const stillInNav = await page.evaluate(() =>
      !!document.activeElement?.closest('nav.fixed.bottom-0'))
    expect(stillInNav, 'focus should leave the bottom bar after its last button').toBe(false)

    // The active screen's tab is marked for assistive tech.
    await expect(bottom.locator('[aria-current="page"]')).toHaveCount(1)
  })

  test('whole page is keyboard-traversable end to end', async ({ page }) => {
    await primePage(page, 'en', 'light')
    await goHomeReady(page)
    await page.locator('body').press('Tab')

    const chain: string[] = []
    for (let i = 0; i < 60; i++) {
      const sig = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return 'BODY'
        return `${el.tagName}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}`
      })
      chain.push(sig)
      await page.keyboard.press('Tab')
    }
    // Reached the bottom bar (proof focus traversed the whole document) and
    // never got stuck (no element focused 5+ times running).
    expect(chain.some(c => /home|forecast|insights|manage/i.test(c))).toBe(true)
    const maxRun = chain.reduce((m, c, i) => {
      let run = 1
      while (chain[i - run] === c) run++
      return Math.max(m, run)
    }, 1)
    expect(maxRun, 'a focus loop would repeat one element many times').toBeLessThan(5)
  })
})

// ── Manage sheet: focus in, Escape out, no leak (phone only) ──────────────

test.describe('Manage sheet', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'phone viewport only')

  test('opens with focus inside, closes on Escape', async ({ page }) => {
    await primePage(page, 'en', 'light')
    await goHomeReady(page)

    await page.locator('nav.fixed.bottom-0').getByRole('button', { name: /manage/i }).click()
    const sheet = page.getByRole('dialog', { name: /manage/i })
    await expect(sheet).toBeVisible()

    const focusInside = await page.evaluate(() =>
      !!document.activeElement?.closest('[role="dialog"]'))
    expect(focusInside, 'opening the sheet should move focus into it').toBe(true)

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  test('focus does not leak to the page behind while open', async ({ page }, testInfo) => {
    await primePage(page, 'en', 'light')
    await goHomeReady(page)
    await page.locator('nav.fixed.bottom-0').getByRole('button', { name: /manage/i }).click()
    await expect(page.getByRole('dialog', { name: /manage/i })).toBeVisible()

    let leaked = false
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const outside = await page.evaluate(() => {
        const el = document.activeElement
        return !!el && el !== document.body && !el.closest('[role="dialog"]')
      })
      if (outside) { leaked = true; break }
    }
    testInfo.annotations.push({ type: 'note', text: leaked ? 'focus escaped the aria-modal sheet' : 'sheet contained focus' })
    expect(leaked, 'Tab reached the page behind an aria-modal="true" sheet').toBe(false)
  })
})

// ── Guided tour: modal focus behaviour ───────────────────────────────────

test('guided tour traps focus and closes on Escape', async ({ page }) => {
  // Do NOT mark the tour done for this one.
  await page.addInitScript(([bizId]) => {
    try {
      localStorage.setItem('ope_language', 'en')
      localStorage.setItem('ope_theme', 'light')
      localStorage.removeItem(`ope_tour_done_${bizId}`)
    } catch { /* ignore */ }
  }, [META.businessId] as const)

  await page.goto('/')
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 45_000 })

  const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
  expect(focusInside, 'the tour should move focus into its dialog on open').toBe(true)

  let leaked = false
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const outside = await page.evaluate(() => {
      const el = document.activeElement
      return !!el && el !== document.body && !el.closest('[role="dialog"]')
    })
    if (outside) { leaked = true; break }
  }
  expect(leaked, 'Tab reached the page behind the aria-modal tour').toBe(false)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

// ── aria-live regions actually carry text ────────────────────────────────

test('settings save announces success in an aria-live region', async ({ page }) => {
  await primePage(page, 'en', 'light')
  await goHomeReady(page)
  await gotoScreen(page, SCREENS.find(s => s.id === 'settings')!, 'en')

  // Any Save button on the settings screen; the schedule block's is first.
  const save = page.getByRole('button', { name: /save/i }).first()
  await save.click()

  const live = page.locator('[role="status"][aria-live="polite"]')
  await expect(live.first()).toBeVisible({ timeout: 15_000 })
  await expect(live.first()).not.toBeEmpty()
})

test('a form validation error is exposed as role="alert"', async ({ page }) => {
  await primePage(page, 'en', 'light')
  await goHomeReady(page)
  await gotoScreen(page, SCREENS.find(s => s.id === 'products')!, 'en')

  // The "add a product" form validates a blank name client-side and renders
  // the message in a role="alert" — an assistive tech user hears it at once.
  const reveal = page.getByRole('button', { name: /^add a product$|^add product$/i }).first()
  if (await reveal.count() && await reveal.isVisible()) await reveal.click().catch(() => {})

  const submit = page.getByRole('button', { name: /add product/i }).last()
  await submit.click()
  await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('[role="alert"]').first()).not.toBeEmpty()
})
