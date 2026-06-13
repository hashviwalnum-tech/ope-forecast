import { supabase } from '../lib/supabase'
import type {
  AccuracyResponse,
  BusinessRead,
  DayRecordCreate,
  DayRecordRead,
  DayRecordUpdate,
  ForecastResponse,
  HourlyAnalyticsResponse,
  LiftResponse,
  OrderingResponse,
  OrderRecordCreate,
  OrderRecordRead,
  OrderRecordUpdate,
  PeriodCreate,
  PeriodRead,
  ProductCreate,
  ProductForecastResponse,
  ProductRead,
  ProductUpdate,
  RegularCreate,
  RegularProfitabilityRead,
  RegularRead,
  RegularUpdate,
  RegularVisitBody,
  SaleCreate,
  SaleEventCreate,
  SaleEventRead,
  SaleRead,
  SaleUpdate,
  TelegramLinkCodeResponse,
  TelegramLinkStatus,
  TodaySummaryResponse,
  WeekdayHourlyResponse,
} from './types'

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

async function POST<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function PUT<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function PATCH<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json() as Promise<T>
}

async function DEL(path: string): Promise<void> {
  const res = await fetchWithRetry(`${BASE}${path}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(await extractError(res))
}

export const businesses = {
  list: () => GET<BusinessRead[]>('/businesses'),
  updateSettings: (settings: {
    opening_days?: number[]
    opening_hour?: number
    closing_hour?: number
    avg_service_time_minutes?: number
    staffing_max_wait_minutes?: number | null
    staffing_max_queue_length?: number | null
  }) => PATCH<BusinessRead>('/businesses/me/settings', settings),
  setTier: (tier: 'free' | 'premium') =>
    PATCH<BusinessRead>('/businesses/me/tier', { tier }),
}

export const analytics = {
  forecast: () => GET<ForecastResponse>('/forecast'),
  accuracy: () => GET<AccuracyResponse>('/accuracy'),
  ordering: () => GET<OrderingResponse>('/ordering'),
  hourlyAnalytics: () => GET<HourlyAnalyticsResponse>('/hourly-analytics'),
  hourlyByWeekday: () => GET<WeekdayHourlyResponse>('/hourly-by-weekday'),
  lift: () => GET<LiftResponse>('/lift'),
  productForecast: (productId?: number) =>
    GET<ProductForecastResponse>(
      productId != null ? `/product-forecast?product_id=${productId}` : '/product-forecast'
    ),
}

export const products = {
  list: () => GET<ProductRead[]>('/products'),
  create: (body: ProductCreate) => POST<ProductRead>('/products', body),
  update: (id: number, body: ProductUpdate) => PUT<ProductRead>(`/products/${id}`, body),
  delete: (id: number) => DEL(`/products/${id}`),
}

export const saleEvents = {
  create: (body: SaleEventCreate) => POST<SaleEventRead>('/sale-events', body),
  today: () => GET<TodaySummaryResponse>('/sale-events/today'),
  delete: (id: number) => DEL(`/sale-events/${id}`),
}

export const dayRecords = {
  list: () => GET<DayRecordRead[]>('/day-records'),
  create: (body: DayRecordCreate) => POST<DayRecordRead>('/day-records', body),
  update: (id: number, body: DayRecordUpdate) =>
    PUT<DayRecordRead>(`/day-records/${id}`, body),
  delete: (id: number) => DEL(`/day-records/${id}`),
}

export const sales = {
  list: (dayRecordId?: number) =>
    GET<SaleRead[]>(dayRecordId ? `/sales?day_record_id=${dayRecordId}` : '/sales'),
  create: (body: SaleCreate) => POST<SaleRead>('/sales', body),
  update: (id: number, body: SaleUpdate) => PUT<SaleRead>(`/sales/${id}`, body),
  delete: (id: number) => DEL(`/sales/${id}`),
}

export const regulars = {
  list: () => GET<RegularRead[]>('/regulars'),
  create: (body: RegularCreate) => POST<RegularRead>('/regulars', body),
  update: (id: number, body: RegularUpdate) => PUT<RegularRead>(`/regulars/${id}`, body),
  delete: (id: number) => DEL(`/regulars/${id}`),
  recordVisit: (id: number, body?: RegularVisitBody) =>
    POST<RegularRead>(`/regulars/${id}/visit`, body ?? {}),
  profitability: (id: number) =>
    GET<RegularProfitabilityRead>(`/regulars/${id}/profitability`),
}

export const telegram = {
  generateCode: () => POST<TelegramLinkCodeResponse>('/telegram/link-code', {}),
  getStatus: () => GET<TelegramLinkStatus>('/telegram/link'),
  revoke: () => DEL('/telegram/link'),
}

export const orders = {
  list: () => GET<OrderRecordRead[]>('/orders'),
  create: (body: OrderRecordCreate) => POST<OrderRecordRead>('/orders', body),
  update: (id: number, body: OrderRecordUpdate) =>
    PUT<OrderRecordRead>(`/orders/${id}`, body),
  cancel: (id: number) => DEL(`/orders/${id}`),
}

export const periods = {
  list: () => GET<PeriodRead[]>('/periods'),
  create: (body: PeriodCreate) => POST<PeriodRead>('/periods', body),
  delete: (id: number) => DEL(`/periods/${id}`),
}
