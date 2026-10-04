import { defineConfig, devices } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * UX measurement — not a pass/fail suite. It records numbers.
 *
 * The UX review's measuring script was never committed, so its figures could
 * not be re-run. This is that measurement, kept: the real web app, against
 * two real backends, at phone and desktop sizes, in both themes and four
 * languages, writing every figure to docs/audit/ux/.
 *
 *   sim   — the simulated year-long business (backend/sim/sim.db, made by
 *           `python -m tests.simulation.run_year --to 365`), clock frozen at
 *           the end of the year. Any bearer token is that business's owner.
 *   fresh — an empty database and the a11y suite's real test account, so the
 *           app shows exactly what a brand-new owner sees.
 *
 * Needs the a11y suite to have run once (it saves the signed-in session).
 *
 * Run:  npx playwright test -c playwright.ux.config.ts      (from web/)
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = resolve(HERE, '..', 'backend')

try {
  for (const line of readFileSync(new URL('./.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on the shell environment */ }

const FRESH_DB = resolve(BACKEND_DIR, 'ux_fresh.db')
if (process.env.TEST_WORKER_INDEX === undefined) {
  for (const f of [FRESH_DB, `${FRESH_DB}-wal`, `${FRESH_DB}-shm`]) rmSync(f, { force: true })
}

const STATE = 'tests/a11y/.auth/state.json'

export default defineConfig({
  testDir: './tests/ux',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30 * 60_000,
  // No single click or wait may hang a run: a step that never comes is a finding.
  use: { actionTimeout: 20_000, navigationTimeout: 60_000 },
  expect: { timeout: 20_000 },
  projects: [
    {
      name: 'sim',
      testMatch: /measure\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173', storageState: STATE },
    },
    {
      name: 'fresh',
      testMatch: /first-run\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173', storageState: STATE },
    },
  ],
  webServer: [
    {
      command: process.env.UX_FRESH
        ? 'python -m uvicorn app.main:app --host 127.0.0.1 --port 8000'
        : 'python -m tests.simulation.serve_sim',
      cwd: BACKEND_DIR,
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: 'sqlite:///./ux_fresh.db',
        SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? '',
        ALLOWED_ORIGINS: 'http://localhost:5173',
      },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:8000' },
    },
  ],
})
