import { supabase } from '../lib/supabase'
import type {
  AccuracyResponse,
  BookedCountRead,
  BusinessRead,
  CheckoutResponse,
  CurrencyListResponse,
  SubscriptionRead,
  TelegramLinkCodeResponse,
  TelegramLinkStatus,
  DayRecordCreate,
  HourlyAnalyticsResponse,
  HourlyBackfillSlot,
  BackfillPreviewResponse,
  HourlyBackfillResponse,
  InsightsResponse,
  MonthlyResponse,
  DayRecordRead,
  DayRecordUpdate,
  ForecastHistoryResponse,
  ForecastResponse,
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
  ServiceConsumableCreate,
  ServiceConsumableRead,
  RecurringPatternCreate,
  RecurringPatternRead,
  RecurringPatternUpdate,
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
  TodaySummaryResponse,
  WeekdayAvgResponse,
  WeekdayHourlyResponse,
} from './types'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

// Render free tier sleeps after ~15 min. On cold start, CORS preflights get
// reset immediately, causing "TypeError: Failed to fetch". We retry up to 6×
// at 8-second intervals (~48 s total) which covers Render's ~45 s cold start.
const RETRY_MAX = 6
const RETRY_DELAY_MS = 8_000

let _wakingUpListener: ((waking: boolean) => void) | null = null
export function setWakingUpListener(fn: ((waking: boolean) => void) | null): void {
  _wakingUpListener = fn
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /failed to fetch|network request failed|networkerror/i.test((err as TypeError).message)
}

async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      const res = await fetch(input, init)
      if (attempt > 0) _wakingUpListener?.(false)
      return res
    } catch (err) {
      if (!isNetworkError(err) || attempt === RETRY_MAX) throw err
      if (attempt === 0) _wakingUpListener?.(true)
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  throw new TypeError('Network unavailable')
}

let _activeBusinessId: number | null = null
export function setActiveBusinessId(id: number | null): void {
  _activeBusinessId = id
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  if (_activeBusinessId !== null) {
    headers['X-Business-Id'] = String(_activeBusinessId)
  }
  return headers
}

/**
 * A failed request, carrying the HTTP status alongside the message.
 *
 * Callers that need to tell one failure from another — CSV import has to
 * distinguish "this day is already recorded" (409, expected and harmless)
 * from "the server broke" (500) — cannot do it from the message text alone.
 * Extends Error, so anything that just reads `.message` is unaffected.
 */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** True when `err` is a failed request that came back with `status`. */
export function isApiError(err: unknown, status?: number): err is ApiError {
  return err instanceof ApiError && (status === undefined || err.status === status)
}

// Extract a readable message from a failed response.
// FastAPI wraps errors as {"detail": "..."} — pull that out so the UI
// shows the plain-language message rather than raw JSON.
async function extractError(res: Response): Promise<ApiError> {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    if (typeof json.detail === 'string') return new ApiError(res.status, json.detail)
  } catch { /* fall through */ }
  return new ApiError(res.status, text)
}

async function GET<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, { headers: await authHeaders() })
  if (!res.ok) throw await extractError(res)
  return res.json()
}

async function POST<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) throw await extractError(res)
  return res.json()
}

async function PUT<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, {
    method: 'PUT', headers: await authHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) throw await extractError(res)
  return res.json()
}

async function DELETE(path: string): Promise<void> {
  const res = await fetchWithRetry(`${BASE}${path}`, { method: 'DELETE', headers: await authHeaders() })
  if (!res.ok) throw await extractError(res)
}

async function PATCH<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${BASE}${path}`, {
    method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) throw await extractError(res)
  return res.json()
}

/** The ISO 4217 list the currency pickers are built from. Static and public,
 *  so it needs no auth and can be fetched before a business exists. */
export const currencies = {
  list: () => GET<CurrencyListResponse>('/currencies'),
}

export const businesses = {
  list:   ()             => GET<BusinessRead[]>('/businesses'),
  me:     ()             => GET<BusinessRead>('/businesses/me'),
  create: (name: string) => POST<BusinessRead>('/businesses', { name }),
  copyFrom: (sourceId: number, name: string) =>
    POST<BusinessRead>(`/businesses/${sourceId}/copy`, { name }),
  updateSettings: (settings: {
    opening_days?: number[]
    opening_hour?: number
    closing_hour?: number
    avg_service_time_minutes?: number
    staffing_max_wait_minutes?: number | null
    staffing_max_queue_length?: number | null
    stock_management_enabled?: boolean
    onboarding_done?: boolean
    nudges_enabled?: boolean
    nudge_frequency_hours?: number
    appointment_based?: boolean
    /** ISO 4217 code, e.g. "ILS". Rejected by the API if it is not a real one. */
    currency?: string
  }) => PATCH<BusinessRead>('/businesses/me/settings', settings),
  setTier: (tier: 'free' | 'premium') => PATCH<BusinessRead>('/businesses/me/tier', { tier }),
  delete: (id: number) => DELETE(`/businesses/${id}`),
}

export const dayRecords = {
  list: ()                              => GET<DayRecordRead[]>('/day-records'),
  create: (body: DayRecordCreate)       => POST<DayRecordRead>('/day-records', body),
  update: (id: number, b: DayRecordUpdate) => PUT<DayRecordRead>(`/day-records/${id}`, b),
  undo: (id: number)                    => POST<DayRecordRead>(`/day-records/${id}/undo`, {}),
  resolveOutlier: (id: number, action: 'keep' | 'excluded' | 'event' | 'ad' | 'recurring') =>
    PATCH<DayRecordRead>(`/day-records/${id}/outlier`, { action }),
  delete: (id: number)                  => DELETE(`/day-records/${id}`),
}

export const orders = {
  list:   ()                                    => GET<OrderRecordRead[]>('/orders'),
  create: (body: OrderRecordCreate)             => POST<OrderRecordRead>('/orders', body),
  update: (id: number, body: OrderRecordUpdate) => PUT<OrderRecordRead>(`/orders/${id}`, body),
  cancel: (id: number)                          => DELETE(`/orders/${id}`),
}

export const outliers = {
  list: () => GET<OutlierListResponse>('/outliers'),
}

export const saleEvents = {
  tap:      (body: SaleEventCreate)  => POST<SaleEventRead>('/sale-events', body),
  today:    ()                       => GET<TodaySummaryResponse>('/sale-events/today'),
  undo:     (id: number)             => DELETE(`/sale-events/${id}`),
  backfillHourly: (date: string, hours: HourlyBackfillSlot[], products?: { product_id: number; units: number }[]) =>
    POST<HourlyBackfillResponse>('/sale-events/backfill-hourly',
      products ? { date, hours, products } : { date, hours }),
  // What is already stored for a date, so the owner can be shown what a save
  // will replace and what it will leave alone.
  backfillPreview: (day: string) =>
    GET<BackfillPreviewResponse>(`/sale-events/backfill-preview?day=${encodeURIComponent(day)}`),
}

export const products = {
  list:   ()                                    => GET<ProductRead[]>('/products'),
  create: (body: ProductCreate)                 => POST<ProductRead>('/products', body),
  update: (id: number, body: ProductUpdate)     => PUT<ProductRead>(`/products/${id}`, body),
  delete: (id: number)                          => DELETE(`/products/${id}`),
  listConsumables: (id: number)                 => GET<ServiceConsumableRead[]>(`/products/${id}/consumables`),
  addConsumable:   (id: number, body: ServiceConsumableCreate) => POST<ServiceConsumableRead>(`/products/${id}/consumables`, body),
  deleteConsumable:(id: number, linkId: number) => DELETE(`/products/${id}/consumables/${linkId}`),
}

export const sales = {
  list:   (dayRecordId?: number) =>
    GET<SaleRead[]>(dayRecordId ? `/sales?day_record_id=${dayRecordId}` : '/sales'),
  create: (body: SaleCreate)           => POST<SaleRead>('/sales', body),
  update: (id: number, b: SaleUpdate)  => PUT<SaleRead>(`/sales/${id}`, b),
  delete: (id: number)                 => DELETE(`/sales/${id}`),
}

export const analytics = {
  forecast:         () => GET<ForecastResponse>('/forecast'),
  accuracy:         () => GET<AccuracyResponse>('/accuracy'),
  weekdayAverages:  () => GET<WeekdayAvgResponse>('/weekday-averages'),
  ordering:         () => GET<OrderingResponse>('/ordering'),
  forecastHistory:  () => GET<ForecastHistoryResponse>('/forecast-history'),
  lift:             () => GET<LiftResponse>('/lift'),
  hourlyAnalytics:  () => GET<HourlyAnalyticsResponse>('/hourly-analytics'),
  monthlySummary:   () => GET<MonthlyResponse>('/monthly-summary'),
  productForecast:  (productId?: number) =>
    GET<ProductForecastResponse>(
      productId != null ? `/product-forecast?product_id=${productId}` : '/product-forecast'
    ),
  hourlyByWeekday:  () => GET<WeekdayHourlyResponse>('/hourly-by-weekday'),
  insights:         () => GET<InsightsResponse>('/insights'),
}

export const periods = {
  list:   ()                          => GET<PeriodRead[]>('/periods'),
  create: (body: PeriodCreate)        => POST<PeriodRead>('/periods', body),
  delete: (id: number)                => DELETE(`/periods/${id}`),
}

export const recurringPatterns = {
  list:   ()                                  => GET<RecurringPatternRead[]>('/recurring-patterns'),
  create: (body: RecurringPatternCreate)      => POST<RecurringPatternRead>('/recurring-patterns', body),
  update: (id: number, b: RecurringPatternUpdate) => PUT<RecurringPatternRead>(`/recurring-patterns/${id}`, b),
  delete: (id: number)                        => DELETE(`/recurring-patterns/${id}`),
}

export const bookedCounts = {
  list: (productId?: number) =>
    GET<BookedCountRead[]>(productId != null ? `/booked-counts?product_id=${productId}` : '/booked-counts'),
  upsert: (date: string, count: number, productId?: number) =>
    PUT<BookedCountRead>(
      `/booked-counts/${date}${productId != null ? `?product_id=${productId}` : ''}`,
      { booked_count: count }
    ),
  delete: (date: string, productId?: number) =>
    DELETE(`/booked-counts/${date}${productId != null ? `?product_id=${productId}` : ''}`),
}

export const regulars = {
  list:        ()                           => GET<RegularRead[]>('/regulars'),
  create:      (body: RegularCreate)        => POST<RegularRead>('/regulars', body),
  update:      (id: number, b: RegularUpdate) => PUT<RegularRead>(`/regulars/${id}`, b),
  delete:      (id: number)                 => DELETE(`/regulars/${id}`),
  recordVisit: (id: number, body?: RegularVisitBody) =>
    POST<RegularRead>(`/regulars/${id}/visit`, body ?? {}),
  profitability: (id: number) => GET<RegularProfitabilityRead>(`/regulars/${id}/profitability`),
}

export const telegram = {
  generateCode: ()               => POST<TelegramLinkCodeResponse>('/telegram/link-code', {}),
  getStatus:    ()               => GET<TelegramLinkStatus>('/telegram/link'),
  revoke:       ()               => DELETE('/telegram/link'),
}

export const subscription = {
  get: () => GET<SubscriptionRead>('/subscription'),
  startCheckout: (plan: 'monthly' | 'annual', success_url: string, cancel_url: string) =>
    POST<CheckoutResponse>('/subscription/checkout', { plan, success_url, cancel_url }),
  cancel: () => POST<SubscriptionRead>('/subscription/cancel', {}),
}

export const feedback = {
  submit: (body: { name: string; business_name: string; message: string }) =>
    POST<{ ok: boolean }>('/feedback', body),
}

export interface NudgeItem {
  type: string
  message: string
  priority: number
}
export interface NudgesResponse {
  enabled: boolean
  nudge: NudgeItem | null
}

export const nudges = {
  get: () => GET<NudgesResponse>('/nudges'),
  sendTelegram: () => POST<{ sent: boolean; message: string | null; reason: string | null }>('/nudges/send-telegram', {}),
}

export const dev = {
  /**
   * Fire-and-forget catch-up trigger. Silently no-ops in production (returns
   * 403 when DEV_CATCHUP_ENABLED is absent). Caller should ignore all errors.
   */
  catchupAuto: async (): Promise<{ days_generated: number } | null> => {
    try {
      const res = await fetch(`${BASE}/dev/catchup/auto`, { method: 'POST' })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  },
}
