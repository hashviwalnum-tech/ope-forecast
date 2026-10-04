import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export interface Measurement {
  account: string
  viewport: string
  theme: string
  lang: string
  screen: string
  /** ms from clicking the nav until the screen's title showed and loading finished */
  loadMs: number
  /** axe WCAG 2.1 AA colour-contrast failures (elements) */
  contrastFails: number
  /** every other axe WCAG 2.1 AA failure (elements) */
  otherAxeFails: number
  otherAxeRules: string[]
  /** visible buttons/links/inputs smaller than 44×44 CSS px */
  smallTargets: number
  smallTargetSamples: string[]
  /** page wider than the viewport (sideways scroll), px */
  overflowX: number
  /** visible text smaller than 12px (elements) */
  tinyText: number
  smallestFontPx: number
  /** sticky header height, px */
  headerPx: number
  /** total page height in screens (1.0 = fits without scrolling) */
  screensTall: number
}

/** Freeze transitions so colours are read settled (the old script's known flaw). */
export async function prime(page: Page, lang: string, theme: string, bizId: number | null) {
  await page.addInitScript(([lang, theme, bizId]) => {
    try {
      localStorage.setItem('ope_language', String(lang))
      localStorage.setItem('ope_theme', String(theme))
      localStorage.setItem('ope_simple_mode', '0')
      if (bizId !== null) localStorage.setItem(`ope_tour_done_${bizId}`, '1')
    } catch { /* ignore */ }
    const style = document.createElement('style')
    style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}.animate-pulse{opacity:1!important}'
    document.documentElement.appendChild(style)
  }, [lang, theme, bizId] as const)
}

export async function settle(page: Page) {
  // Wait for every loading line to go, in any language — matching the word
  // "Loading" missed the German screens and measured them mid-load.
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse, main [aria-busy="true"]'),
    undefined, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

export async function measure(page: Page, base: Omit<Measurement,
  'contrastFails' | 'otherAxeFails' | 'otherAxeRules' | 'smallTargets' | 'smallTargetSamples' |
  'overflowX' | 'tinyText' | 'smallestFontPx' | 'headerPx' | 'screensTall'>): Promise<Measurement> {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const contrast = axe.violations.find(v => v.id === 'color-contrast')
  const others = axe.violations.filter(v => v.id !== 'color-contrast')

  const dom = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
        && !el.closest('.sr-only') && cs.clipPath !== 'inset(50%)'
    }
    const interactive = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]')]
      .filter(visible)
    const small = interactive.filter(el => {
      const r = el.getBoundingClientRect()
      // Inline links inside a sentence are exempt under WCAG 2.5.8, like the review treated them.
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false
      // A checkbox/radio whose label is the real target
      if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type) && el.closest('label')) {
        const lr = el.closest('label')!.getBoundingClientRect()
        return lr.width < 44 || lr.height < 44
      }
      return r.width < 43.5 || r.height < 43.5
    })
    const texts = [...document.querySelectorAll('body *')].filter(el =>
      visible(el) && [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1))
    const sizes = texts.map(el => parseFloat(getComputedStyle(el).fontSize))
    const header = document.querySelector('header')
    return {
      smallTargets: small.length,
      smallTargetSamples: small.slice(0, 5).map(el => {
        const r = el.getBoundingClientRect()
        const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)
        return `${label} ${Math.round(r.width)}×${Math.round(r.height)}`
      }),
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      tinyText: sizes.filter(s => s < 12).length,
      smallestFontPx: sizes.length ? Math.min(...sizes) : 0,
      headerPx: header ? Math.round(header.getBoundingClientRect().height) : 0,
      screensTall: Math.round((document.documentElement.scrollHeight / window.innerHeight) * 10) / 10,
    }
  })

  return {
    ...base,
    contrastFails: contrast?.nodes.length ?? 0,
    otherAxeFails: others.reduce((n, v) => n + v.nodes.length, 0),
    otherAxeRules: others.map(v => `${v.id}(${v.nodes.length})`),
    ...dom,
  }
}
