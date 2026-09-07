import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Vite reads .env.local; Node (this config, the global setup) does not. Load the
// VITE_* vars here so the seed can reach Supabase and the local backend.
try {
  for (const line of readFileSync(new URL('./.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on the shell environment */ }

/**
 * Accessibility suite only — this is not a general e2e config.
 *
 * It boots the Vite dev server (pointed at a LOCAL backend via .env.local),
 * seeds one business with a year of data through the API, logs in once, and
 * reuses that storage state for every spec. The specs run axe-core across the
 * main screens in both themes, English + Hebrew, at a phone and a desktop
 * viewport, plus hand-written checks for focus order, keyboard traps and the
 * aria-live regions the UX round added.
 *
 * Run:  npx playwright test        (from web/, with a local backend on :8000)
 */
export default defineConfig({
  testDir: './tests/a11y',
  globalSetup: './tests/a11y/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    storageState: 'tests/a11y/.auth/state.json',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // 390x844 — a standard phone, below the lg: (1024px) breakpoint, so the
      // bottom tab bar + Manage sheet are the navigation.
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      // 1280x800 — the wrapped top nav with its History / Manage dropdowns.
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
