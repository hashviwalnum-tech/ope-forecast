// Mirror of backend Pydantic schemas.  Keep in sync with app/schemas/*.py.

export interface BusinessRead {
  id: number
  name: string
  settings: Record<string, unknown>
  tier: string
}

// ── Analytics ──────────────────────────────────────────────────────────────

export interface ForecastDay {
  date: string
  weekday: string
  predicted_customers: number
  interval_low: number
  interval_high: number
  model_weights: Record<string, number>
}

export interface ForecastResponse {
  status: string
  message?: string
  days: ForecastDay[]
}

export interface AccuracyResponse {
  status: string
  n_observations: number
  mad?: number
  mse?: number
  mape?: number
  tracking_signal?: number
  bias_warning?: string
  message?: string
}

export interface WeekdayAvg {
  weekday: string
  weekday_idx: number
  avg_customers: number
  std_dev: number
  n_observations: number
}

export interface WeekdayAvgResponse {
  status: string
  message?: string
  weekdays: WeekdayAvg[]
}

export interface OrderingRow {
  product_id: number
  name: string
  unit: string
  avg_daily_demand: number
  lead_time_days: number
  safety_stock_units: number
  reorder_point: number
  current_stock?: number
  order_now: boolean
  eoq?: number
}

export interface OrderingResponse {
  status: string
  message?: string
  products: OrderingRow[]
}

export interface ForecastHistoryPoint {
  date: string
  weekday: string
  predicted: number
  actual: number
  interval_low: number
  interval_high: number
}

export interface ForecastHistoryResponse {
  status: string
  message?: string
  history: ForecastHistoryPoint[]
}

export interface PeriodLift {
  period_id: number
  label: string
  type: string
  start_date: string
  end_date: string
  total_actual: number
  total_baseline: number
  total_lift_customers: number
  pct_lift: number
  lift_per_cost?: number
}

export interface LiftResponse {
  status: string
  message?: string
  periods: PeriodLift[]
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export interface PeriodRead {
  id: number
  business_id: number
  start_date: string
  end_date: string
  type: string
  label: string
  cost: number | null
}

export interface PeriodCreate {
  start_date: string
  end_date: string
  type: 'event' | 'ad'
  label: string
  cost?: number
}

export interface DayRecordRead {
  id: number
  business_id: number
  date: string       // "YYYY-MM-DD"
  customers: number
  notes: string | null
  outlier_status: string | null   // null | 'flagged' | 'kept' | 'excluded' | 'event'
}

// ── Outlier flags ─────────────────────────────────────────────────────────

export interface OutlierFlag {
  day_record_id: number
  date: string
  weekday: string
  customers: number
  weekday_median: number
  direction: 'high' | 'low'
  message: string
}

export interface OutlierListResponse {
  status: string
  flags: OutlierFlag[]
}

export interface DayRecordCreate {
  date: string
  customers: number
  notes?: string
}

export interface DayRecordUpdate {
  customers?: number
  notes?: string
}

export interface ProductRead {
  id: number
  business_id: number
  name: string
  unit: string
  current_stock: number | null
  lead_time_days: number
  holding_cost: number | null
  order_cost: number | null
}

export interface ProductCreate {
  name: string
  unit: string
  lead_time_days: number
  current_stock?: number
  holding_cost?: number
  order_cost?: number
}

export interface ProductUpdate {
  name?: string
  unit?: string
  lead_time_days?: number
  current_stock?: number | null
  holding_cost?: number | null
  order_cost?: number | null
}

// ── Sale Events (live tap-to-record) ─────────────────────────────────────────

export interface SaleEventCreate {
  product_id?: number | null
  quantity?: number
  unit_price?: number
}

export interface SaleEventRead {
  id: number
  business_id: number
  product_id: number | null
  timestamp: string   // ISO datetime
  quantity: number
  unit_price: number | null
}

export interface ProductTap {
  product_id: number | null
  product_name: string | null
  units: number
}

export interface HourSlot {
  hour: number
  taps: number
  product_taps: ProductTap[]
}

export interface RecentTap {
  id: number
  product_name: string | null
  quantity: number
  timestamp: string   // ISO datetime
}

export interface TodaySummaryResponse {
  date: string
  total_taps: number
  product_totals: ProductTap[]
  hours: HourSlot[]
  recent_taps?: RecentTap[]
}

export interface SaleRead {
  id: number
  day_record_id: number
  product_id: number
  units_sold: number
}

export interface SaleCreate {
  day_record_id: number
  product_id: number
  units_sold: number
}

export interface SaleUpdate {
  units_sold: number
}
