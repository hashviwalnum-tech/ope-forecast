import { supabase } from '../lib/supabase'
import type {
  AccuracyResponse,
  BookedCountRead,
  BookingModelRead,
  BusinessRead,
  CurrencyListResponse,
  SubscriptionRead,
  DayRecordCreate,
  DayRecordRead,
  DayRecordUpdate,
  ForecastResponse,
  HourlyAnalyticsResponse,
  InsightsResponse,
  LiftResponse,
  OrderingResponse,
  OrderRecordCreate,
  OrderRecordRead,
  OrderRecordUpdate,
  OutlierListResponse,
  PeriodCreate,
  PeriodRead,
  ProductCreate,
  ProductForecastResponse,
  ProductRead,
  ProductUpdate,
  RecurringPatternCreate,
  RecurringPatternRead,
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

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://ope-forecast-dj78.onrender.com'

// Render free tier sleeps after ~15 min. Retry up to 6× at 8-second intervals
// (~48 s total) to cover Render's ~45 s cold-start window.
const RETRY_MAX = 6
const RETRY_DELAY_MS = 8_000

/**
 * How long one attempt may hang before it counts as a failure.
 *
 * Without this, a backend that accepts the connection and then never answers
 * leaves the app loading for ever: `fetch` does not time out on its own, and
 * the retry below only fires on a network *error* — a hang is not an error.
 * That is exactly what a retired Render host does. Anything past ~30 s is a
 * dead backend rather than a slow one; the cold start is covered by retrying.
 */
const REQUEST_TIMEOUT_MS = 30_000

function isNetworkError(err: unknown): boolean {
  if (isTimeout(err)) return true
  return (
    err instanceof TypeError &&
    /failed to fetch|network request failed|networkerror/i.test((err as TypeError).message)
  )
}

/** A request abandoned by REQUEST_TIMEOUT_MS, not by the caller. */
function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      return await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
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

/** The ISO 4217 list the currency picker is built from. Static and public. */
export const currencies = {
  list: () => GET<CurrencyListResponse>('/currencies'),
}

export const businesses = {
  list: () => GET<BusinessRead[]>('/businesses'),
  create: (name: string) => POST<BusinessRead>('/businesses', { name }),
  updateSettings: (settings: {
    opening_days?: number[]
    opening_hour?: number
    closing_hour?: number
    timezone?: string
    avg_service_time_minutes?: number
    staffing_max_wait_minutes?: number | null
    staffing_max_queue_length?: number | null
    stock_management_enabled?: boolean
    assume_orders_arrive_on_time?: boolean
    nudges_enabled?: boolean
    /** The business takes appointments: booked counts feed the forecast. */
    appointment_based?: boolean
    /** ISO 4217 code, e.g. "ILS". Rejected by the API if it is not a real one. */
    currency?: string
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
  insights: () => GET<InsightsResponse>('/insights'),
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
  resolveOutlier: (
    id: number,
    action: 'keep' | 'excluded' | 'event' | 'ad' | 'recurring',
  ) => PATCH<DayRecordRead>(`/day-records/${id}/outlier`, { action }),
}

export const outliers = {
  list: () => GET<OutlierListResponse>('/outliers'),
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

export const recurringPatterns = {
  list:   ()                                        => GET<RecurringPatternRead[]>('/recurring-patterns'),
  create: (body: RecurringPatternCreate)            => POST<RecurringPatternRead>('/recurring-patterns', body),
  delete: (id: number)                              => DEL(`/recurring-patterns/${id}`),
}

/**
 * Booked appointments. `productId` selects one service; leaving it out means
 * the whole business, which is what a business with no service products has.
 */
export const bookedCounts = {
  list: (productId?: number) =>
    GET<BookedCountRead[]>(
      productId != null ? `/booked-counts?product_id=${productId}` : '/booked-counts'
    ),
  upsert: (date: string, count: number, productId?: number) =>
    PUT<BookedCountRead>(
      `/booked-counts/${date}${productId != null ? `?product_id=${productId}` : ''}`,
      { booked_count: count }
    ),
  delete: (date: string, productId?: number) =>
    DEL(`/booked-counts/${date}${productId != null ? `?product_id=${productId}` : ''}`),
  model: () => GET<BookingModelRead>('/booked-counts/model'),
}

export const subscription = {
  get: () => GET<SubscriptionRead>('/subscription'),
}

export interface AccountDeleted {
  businesses_deleted: number
  /** False when the data went but the Supabase sign-in did not. */
  login_deleted: boolean
  detail: string | null
}

export const account = {
  /** Irreversible. Uses its own fetch rather than `DEL`, which throws the
   *  response away — here the reply says whether the sign-in actually went. */
  remove: async (): Promise<AccountDeleted> => {
    const res = await fetchWithRetry(`${BASE}/account`, {
      method: 'DELETE',
      headers: await authHeaders(),
    })
    if (!res.ok) throw new Error(await extractError(res))
    return res.json() as Promise<AccountDeleted>
  },
}

export const feedback = {
  submit: (body: { name: string; business_name: string; message: string }) =>
    POST<{ ok: boolean }>('/feedback', body),
}
