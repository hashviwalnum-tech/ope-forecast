import { supabase } from '../lib/supabase'
import type {
  AccuracyResponse,
  BusinessRead,
  DayRecordCreate,
  HourlyAnalyticsResponse,
  HourlyBackfillSlot,
  HourlyBackfillResponse,
  MonthlyResponse,
  DayRecordRead,
  DayRecordUpdate,
  ForecastHistoryResponse,
  ForecastResponse,
  LiftResponse,
  OrderingResponse,
  OutlierListResponse,
  PeriodCreate,
  PeriodRead,
  ProductCreate,
  ProductForecastResponse,
  ProductRead,
  ProductUpdate,
  RecurringPatternCreate,
  RecurringPatternRead,
  RecurringPatternUpdate,
  RegularCreate,
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

// Extract a readable message from a failed response.
// FastAPI wraps errors as {"detail": "..."} — pull that out so the UI
// shows the plain-language message rather than raw JSON.
async function extractError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    if (typeof json.detail === 'string') return json.detail
  } catch { /* fall through */ }
  return text
}

async function GET<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json()
}

async function POST<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json()
}

async function PUT<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT', headers: await authHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json()
}

async function DELETE(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: await authHeaders() })
  if (!res.ok) throw new Error(await extractError(res))
}

async function PATCH<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await extractError(res))
  return res.json()
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
  }) => PATCH<BusinessRead>('/businesses/me/settings', settings),
  setTier: (tier: 'free' | 'premium') => PATCH<BusinessRead>('/businesses/me/tier', { tier }),
}

export const dayRecords = {
  list: ()                              => GET<DayRecordRead[]>('/day-records'),
  create: (body: DayRecordCreate)       => POST<DayRecordRead>('/day-records', body),
  update: (id: number, b: DayRecordUpdate) => PUT<DayRecordRead>(`/day-records/${id}`, b),
  resolveOutlier: (id: number, action: 'keep' | 'excluded' | 'event' | 'ad' | 'recurring') =>
    PATCH<DayRecordRead>(`/day-records/${id}/outlier`, { action }),
  delete: (id: number)                  => DELETE(`/day-records/${id}`),
}

export const outliers = {
  list: () => GET<OutlierListResponse>('/outliers'),
}

export const saleEvents = {
  tap:      (body: SaleEventCreate)  => POST<SaleEventRead>('/sale-events', body),
  today:    ()                       => GET<TodaySummaryResponse>('/sale-events/today'),
  undo:     (id: number)             => DELETE(`/sale-events/${id}`),
  backfillHourly: (date: string, hours: HourlyBackfillSlot[]) =>
    POST<HourlyBackfillResponse>('/sale-events/backfill-hourly', { date, hours }),
}

export const products = {
  list:   ()                                    => GET<ProductRead[]>('/products'),
  create: (body: ProductCreate)                 => POST<ProductRead>('/products', body),
  update: (id: number, body: ProductUpdate)     => PUT<ProductRead>(`/products/${id}`, body),
  delete: (id: number)                          => DELETE(`/products/${id}`),
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

export const regulars = {
  list:        ()                           => GET<RegularRead[]>('/regulars'),
  create:      (body: RegularCreate)        => POST<RegularRead>('/regulars', body),
  update:      (id: number, b: RegularUpdate) => PUT<RegularRead>(`/regulars/${id}`, b),
  delete:      (id: number)                 => DELETE(`/regulars/${id}`),
  recordVisit: (id: number, body?: RegularVisitBody) =>
    POST<RegularRead>(`/regulars/${id}/visit`, body ?? {}),
}
