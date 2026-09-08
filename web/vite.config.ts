import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Backends this app must never be built against.
 *
 * Vite bakes `VITE_API_BASE_URL` into the bundle at build time, so changing it
 * in Vercel's dashboard does nothing until the site is rebuilt — and a build
 * carrying a dead address fails in a peculiarly bad way. The retired Render
 * host neither answers nor refuses: every request hangs, so nothing errors,
 * nothing retries, and the owner sits on "Loading…" indefinitely with no clue
 * why. That shipped, and the only way to find it was to open the live site.
 *
 * Failing the build is the cheap moment to catch it.
 */
const RETIRED_BACKENDS = ['ope-forecast.onrender.com']

export default defineConfig(({ mode }) => {
  const apiBase = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL ?? ''
  const retired = RETIRED_BACKENDS.find(host => apiBase.includes(host))
  if (retired) {
    throw new Error(
      `VITE_API_BASE_URL points at ${retired}, which no longer exists.\n` +
      'That host hangs rather than failing, so the built app would sit on ' +
      '"Loading…" for ever.\nSet VITE_API_BASE_URL to the current backend ' +
      '(Vercel → Settings → Environment Variables) and redeploy.'
    )
  }

  return { plugins: [react(), tailwindcss()] }
})
