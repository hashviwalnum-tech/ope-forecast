import { supabase } from '../lib/supabase'
import type { BusinessRead, ForecastResponse } from './types'

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://ope-forecast.onrender.com'

// Render free tier sleeps after ~15 min. Retry up to 6× at 8-second intervals
// (~48 s total) to cover Render's ~45 s cold-start window.
const RETRY_MAX = 6
const RETRY_DELAY_MS = 8_000

function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|network request failed|networkerror/i.test((err as TypeError).message)
  )
}

async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      return await fetch(input, init)
    } catch (err) {
      if (!isNetworkError(err) || attempt === RETRY_MAX) throw err
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  throw new TypeError('Network unavailable')
}

let _activeBusinessId: number | null = null
export function setActiveBusinessId(id: number | null): void {
  _activeBusinessId = id
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  if (_activeBusinessId !== null) {
    headers['X-Business-Id'] = String(_activeBusinessId)
  }
  return headers
}

async function extractError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    if (typeof json.detail === 'string') return json.detail
  } catch {
    /* fall through */
  }
  return text
}

async function GET<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

export const businesses = {
  list: () => GET<BusinessRead[]>('/businesses'),
}

export const analytics = {
  forecast: () => GET<ForecastResponse>('/forecast'),
}
