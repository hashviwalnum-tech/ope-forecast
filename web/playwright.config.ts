import { defineConfig, devices } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = resolve(HERE, '..', 'backend')

// Vite reads .env.local; Node (this config, the global setup) does not. Load the
// VITE_* vars here so the seed can reach Supabase and the local backend.
try {
  for (const line of readFileSync(new URL('./.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on the shell environment */ }

/**
 * The suite runs entirely against its own throwaway stack.
 *
 * Port 8100, not 8000, so it can never reach a dev backend you have running —
 * and never, under any misconfiguration, the deployed one. `a11y.db` is deleted
 * here, before anything opens it, so every run starts from an empty database
 * and the seed is the only thing in it.
 */
const A11Y_DB = resolve(BACKEND_DIR, 'a11y.db')
const API_PORT = 8100
const API_URL = `http://127.0.0.1:${API_PORT}`

// Playwright re-evaluates this config in every worker process, by which time
// the backend has the database file open — and Windows refuses to unlink an
// open file (EPERM). Only the main process, which runs before any server is
// started, may reset it. TEST_WORKER_INDEX is set only in workers.
if (process.env.TEST_WORKER_INDEX === undefined) {
  for (const f of [A11Y_DB, `${A11Y_DB}-wal`, `${A11Y_DB}-shm`]) {
    try {
      rmSync(f, { force: true })
    } catch (e) {
      throw new Error(
        `Could not delete ${f} to start from an empty database: ${String(e)}
` +
        'Something still has it open — most likely a backend left running from ' +
        'a previous run. Stop it and try again.',
        { cause: e },
      )
    }
  }
}
process.env.VITE_API_BASE_URL = API_URL

if (!process.env.VITE_SUPABASE_URL) {
  throw new Error(
    'VITE_SUPABASE_URL is not set. Create web/.env.local with VITE_SUPABASE_URL and ' +
    'VITE_SUPABASE_ANON_KEY (see tests/a11y/README.md) — the suite still authenticates ' +
    'against the real Supabase project, with one fixed reusable test account.',
  )
}

/**
 * Accessibility suite only — this is not a general e2e config.
 *
 * It boots its own backend on a fresh SQLite file and its own Vite dev server
 * pointed at it, seeds one business with a year of data through the API, logs
 * in once, and reuses that storage state for every spec. The specs run axe-core
 * across the main screens in both themes, English + Hebrew, at a phone and a
 * desktop viewport, plus hand-written checks for focus order, keyboard traps
 * and the aria-live regions the UX round added.
 *
 * Run:  npx playwright test        (from web/ — starts everything it needs)
 */
export default defineConfig({
  testDir: './tests/a11y',
  globalSetup: './tests/a11y/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // results.json lives OUTSIDE playwright-report/ on purpose — the HTML
  // reporter wipes that folder when it writes, so anything put there by
  // another reporter disappears at the end of every run.
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }], ['html', { open: 'never' }]],
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
  webServer: [
    {
      // Never reuse an existing server here: a stray process on this port would
      // be running against some other database, and the seed would silently
      // land somewhere we did not intend.
      command: `python -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: BACKEND_DIR,
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: `sqlite:///./a11y.db`,
        SUPABASE_URL: process.env.VITE_SUPABASE_URL,
        ALLOWED_ORIGINS: 'http://localhost:5173',
      },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: API_URL },
    },
  ],
})
