/**
 * Seed one business with a year of realistic data through the running backend's
 * JSON API — the same calls the web app makes. Used by global-setup before the
 * accessibility specs run so the main screens render real content (forecasts,
 * ordering advice, regulars, history) rather than empty "not enough data" states.
 *
 * Everything is scoped to the signed-up test user; nothing here touches the DB
 * directly.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://nyktzxkkoworphvnurrp.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const API = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

export interface SeedResult {
  email: string
  password: string
  accessToken: string
  refreshToken: string
  businessId: number
}

async function sb(path: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`supabase ${path}: ${res.status} ${JSON.stringify(json)}`)
  return json
}

export async function seed(): Promise<SeedResult> {
  const email = `a11y+${Date.now()}@example.com`
  const password = 'Testpass123!'

  let auth: any
  try {
    auth = await sb('/signup', { email, password })
  } catch {
    auth = await sb('/token?grant_type=password', { email, password })
  }
  const token: string = auth.access_token
  const refresh: string = auth.refresh_token
  if (!token) throw new Error('no access token from supabase')

  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: H,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`)
    return text ? JSON.parse(text) : null
  }

  // ── Business + settings ────────────────────────────────────────────────
  const biz = await api('POST', '/businesses', { name: 'Brooklyn Burger Co' })
  const businessId: number = biz.id
  await api('PATCH', '/businesses/me/settings', {
    opening_days: [0, 1, 2, 3, 4, 5, 6],
    opening_hour: 9,
    closing_hour: 22,
    timezone: 'America/New_York',
    currency: 'USD',
    avg_service_time_minutes: 4,
    staffing_max_wait_minutes: 6,
    onboarding_done: true,
  })

  // ── Products (stocked, with the fields ordering advice needs) ──────────
  const products: Array<{ id: number; base: number; unit_mode: 'whole' | 'decimal' }> = []
  const productSpecs = [
    { name: 'Classic Burger', unit: 'unit', lead_time_days: 2, current_stock: 400, shelf_life_days: 5, base: 90, unit_mode: 'whole' as const, is_favorite: true },
    { name: 'Fries', unit: 'portion', lead_time_days: 3, current_stock: 250, storage_capacity: 600, base: 70, unit_mode: 'whole' as const },
    { name: 'Milkshake', unit: 'cup', lead_time_days: 4, current_stock: 60, shelf_life_days: 7, base: 35, unit_mode: 'whole' as const },
    { name: 'Cold Brew (L)', unit: 'L', lead_time_days: 3, current_stock: 40, base: 12, unit_mode: 'decimal' as const },
  ]
  for (const s of productSpecs) {
    const { base, ...create } = s
    const p = await api('POST', '/products', create)
    products.push({ id: p.id, base, unit_mode: s.unit_mode })
  }

  // ── ~130 days of history, day-of-week pattern + gentle upward trend ────
  const BASE_BY_WD = [80, 85, 92, 88, 108, 158, 132] // Mon..Sun
  const DAYS = 130
  const today = new Date()
  let rngState = 12345
  const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) % 4294967296
    return rngState / 4294967296
  }

  for (let i = DAYS; i >= 1; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const wd = (d.getDay() + 6) % 7 // 0=Mon
    const trend = 1 + (DAYS - i) * 0.0012 // ~+16% across the window
    const noise = 1 + (rand() - 0.5) * 0.22
    const customers = Math.max(1, Math.round(BASE_BY_WD[wd] * trend * noise))

    let day: any
    try {
      day = await api('POST', '/day-records', { date: iso, customers })
    } catch (e) {
      // A closed-day / duplicate rejection shouldn't abort the whole seed.
      continue
    }
    for (const p of products) {
      const units = Math.max(
        0,
        p.unit_mode === 'decimal'
          ? Math.round(customers * (p.base / 90) * (0.9 + rand() * 0.2) * 10) / 10
          : Math.round(customers * (p.base / 90) * (0.9 + rand() * 0.2)),
      )
      if (units > 0) await api('POST', '/sales', { day_record_id: day.id, product_id: p.id, units_sold: units })
    }
  }

  // ── A promotion in the recent past (for the Lift screen + Promos list) ─
  const pStart = new Date(today); pStart.setDate(pStart.getDate() - 20)
  const pEnd = new Date(today); pEnd.setDate(pEnd.getDate() - 16)
  try {
    await api('POST', '/periods', {
      start_date: pStart.toISOString().slice(0, 10),
      end_date: pEnd.toISOString().slice(0, 10),
      type: 'ad',
      label: 'Local radio spot',
    })
  } catch { /* ignore */ }

  // ── A recurring pattern (folded into the forecast, not flagged) ────────
  try {
    await api('POST', '/recurring-patterns', { label: 'Sunday league crowd', weekdays: [6], effect: 'higher' })
  } catch { /* ignore */ }

  // ── Regulars (so the Regulars screen isn't empty) ─────────────────────
  for (const name of ['Marcus', 'Dana', 'Priya', 'Sam']) {
    try {
      const first = new Date(today); first.setMonth(first.getMonth() - 8)
      await api('POST', '/regulars', {
        name,
        first_visit_date: first.toISOString().slice(0, 10),
        avg_spend_per_visit: 14 + Math.round(rand() * 20),
      })
    } catch { /* ignore */ }
  }

  // ── A few taps for "today" so the Log screen shows live counts ────────
  for (let i = 0; i < 6; i++) {
    try { await api('POST', '/sale-events', { product_id: null }) } catch { /* ignore */ }
  }
  for (const p of products.slice(0, 2)) {
    try { await api('POST', '/sale-events', { product_id: p.id }) } catch { /* ignore */ }
  }

  return { email, password, accessToken: token, refreshToken: refresh, businessId }
}
