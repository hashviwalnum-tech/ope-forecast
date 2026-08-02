// Mirror of backend Pydantic schemas.  Keep in sync with app/schemas/*.py.

// ── Telegram ──────────────────────────────────────────────────────────────────

export interface TelegramLinkCodeResponse {
  code: string
  expires_in_minutes: number
}

export interface TelegramLinkStatus {
  linked: boolean
  chat_id: string | null
  has_pending_code: boolean
}

// ── RecurringPattern ──────────────────────────────────────────────────────────

export interface RecurringPatternRead {
  id: number
  business_id: number
  label: string
  weekdays: number[]       // 0=Mon … 6=Sun
  hour_start: number | null
  hour_end: number | null
  effect: string           // "higher" | "lower" | "expected"
}

export interface RecurringPatternCreate {
  label: string
  weekdays: number[]
  hour_start?: number
  hour_end?: number
  effect?: string
}

export interface RecurringPatternUpdate {
  label?: string
  weekdays?: number[]
  hour_start?: number | null
  hour_end?: number | null
  effect?: string
}

// ── Regular (named repeat customer) ──────────────────────────────────────────

export interface RegularRead {
  id: number
  business_id: number
  name: string
  visit_frequency_per_week: number
  avg_spend: number
  expected_lifespan_years: number
  notes: string | null
  is_favorite: boolean
  visit_count: number
  first_visit_date: string | null   // "YYYY-MM-DD"
  last_visit_date: string | null    // "YYYY-MM-DD"
  clv: number                       // auto-computed
  today_amount: number | null
}

export interface RegularCreate {
  name: string
  visit_frequency_per_week: number
  avg_spend: number
  expected_lifespan_years?: number
  notes?: string
  is_favorite?: boolean
  first_visit_date?: string | null
}

export interface RegularVisitBody {
  amount_paid?: number
}

export interface MonthlyVisits {
  year: number
  month: number
  visits: number
  total_spend: number
}

export interface RegularProfitabilityRead {
  regular_id: number
  name: string
  first_visit_date: string | null
  this_month: number
  this_year: number
  all_time: number
  monthly_visits: MonthlyVisits[]
}

export interface RegularUpdate {
  name?: string
  visit_frequency_per_week?: number
  avg_spend?: number
  expected_lifespan_years?: number
  notes?: string
  is_favorite?: boolean
  first_visit_date?: string | null
}

export interface BusinessRead {
  id: number
  name: string
  settings: Record<string, unknown>
  tier: string
}

export interface SubscriptionRead {
  user_id: string
  tier: string              // "trial" | "premium" | "free"
  effective_tier: string    // "premium" | "free"
  trial_started_at: string | null
  trial_ends_at: string | null
  trial_days_remaining: number | null
  subscription_status: string  // "none" | "active" | "cancelled" | "expired"
  subscription_provider: string | null
  renewal_at: string | null
}

export interface CheckoutResponse {
  checkout_url: string
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
  unit_mode?: string
  is_favorite?: boolean
  avg_daily_demand: number
  lead_time_days: number
  safety_stock_units: number
  reorder_point: number
  current_stock?: number
  projected_stock?: number | null
  stock_untracked?: boolean
  approaching_reorder?: boolean
  order_now: boolean
  eoq?: number
  suggested_order_qty?: number
  n_days_data?: number
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
  target_product_id?: number | null
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
  target_product_id?: number | null
}

export interface PeriodCreate {
  start_date: string
  end_date: string
  type: 'event' | 'ad'
  label: string
  cost?: number
  target_product_id?: number
}

export interface DayRecordRead {
  id: number
  business_id: number
  date: string       // "YYYY-MM-DD"
  customers: number
  notes: string | null
  outlier_status: string | null   // null | 'flagged' | 'kept' | 'excluded' | 'event'
  warning: string | null          // non-blocking data-consistency note (hours vs total)
  prev_customers: number | null   // non-null when one-step undo is available
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
  product_type: 'stocked' | 'service'
  unit_mode: 'whole' | 'decimal'
  is_favorite: boolean
  price: number | null
  current_stock: number | null
  stock_as_of_date: string | null   // "YYYY-MM-DD"
  lead_time_days: number
  service_time_minutes: number | null
  storage_capacity: number | null
  shelf_life_days: number | null
}

export interface ProductCreate {
  name: string
  unit: string
  product_type?: 'stocked' | 'service'
  unit_mode?: 'whole' | 'decimal'
  is_favorite?: boolean
  price?: number
  lead_time_days: number
  current_stock?: number
  service_time_minutes?: number
  storage_capacity?: number
  shelf_life_days?: number
}

export interface ProductUpdate {
  name?: string
  unit?: string
  product_type?: 'stocked' | 'service' | null
  unit_mode?: 'whole' | 'decimal'
  is_favorite?: boolean
  price?: number | null
  lead_time_days?: number
  current_stock?: number | null
  service_time_minutes?: number | null
  storage_capacity?: number | null
  shelf_life_days?: number | null
}

export interface ServiceConsumableRead {
  id: number
  service_product_id: number
  consumable_product_id: number
  qty_per_performance: number
  consumable_name: string
  consumable_unit: string
}

export interface ServiceConsumableCreate {
  consumable_product_id: number
  qty_per_performance: number
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
  timezone: string   // IANA name (or "UTC") — the business tz "today" and recent_taps are bucketed in
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

// ── hourly analytics & staffing ───────────────────────────────────────────────

export interface HourlySlotAvg {
  hour: number
  avg_taps: number
  n_days: number
  recommended_staff: number
  label: string
  expected_wait_minutes: number
  queue_length: number
  marginal_note: string
  wait_if_add: number | null
  wait_if_remove: number | null
}

export interface HourlyAnalyticsResponse {
  status: string
  message?: string
  n_days_data: number
  avg_service_time_minutes: number
  hours: HourlySlotAvg[]
}

// ── monthly / longer history ──────────────────────────────────────────────────

export interface HistoryPoint {
  date: string        // "YYYY-MM-DD"
  customers: number   // effective value (outlier-replaced)
}

export interface MonthSummary {
  year: number
  month: number
  month_label: string          // "Jan 2024"
  total_customers: number
  logged_days: number
  avg_daily_customers: number
  mom_pct_change: number | null  // null for first month
}

export interface MonthlyResponse {
  status: string
  message?: string
  n_total_days: number
  months: MonthSummary[]
  history_points: HistoryPoint[]
}

// ── hourly backfill ───────────────────────────────────────────────────────────

export interface HourlyBackfillSlot {
  hour: number        // 0–23
  customers: number
}

export interface HourlyBackfillResponse {
  inserted: number
}

// ── per-weekday hourly profiles ───────────────────────────────────────────────

export interface WeekdayHourlySlot {
  hour: number
  avg_taps: number
  recommended_staff: number
  label: string
  expected_wait_minutes: number
  marginal_note?: string
  wait_if_add?: number | null
  wait_if_remove?: number | null
}

export interface WeekdayHourlyEntry {
  weekday: string
  weekday_idx: number        // 0=Mon … 6=Sun
  peak_hour: number
  peak_avg_taps: number
  n_days_data: number
  hours: WeekdayHourlySlot[]
}

export interface WeekdayHourlyResponse {
  status: string
  message?: string
  weekdays: WeekdayHourlyEntry[]
  overall_fallback: WeekdayHourlySlot[]
  n_days_total: number
}

// ── per-product demand forecast ───────────────────────────────────────────────

export interface ProductForecastDay {
  date: string          // "YYYY-MM-DD"
  weekday: string
  predicted_units: number
  interval_low: number
  interval_high: number
}

export interface ProductForecastItem {
  product_id: number
  name: string
  unit: string
  unit_mode: 'whole' | 'decimal'
  is_favorite?: boolean
  status: string        // "ok" | "not_enough_data"
  message?: string
  days: ProductForecastDay[]
  avg_daily_demand: number
  forecast_demand_over_lead_time: number
  lead_time_days: number
  safety_stock_units: number
  reorder_point: number
  suggested_order_qty: number
  current_stock?: number | null
  projected_stock?: number | null      // dynamically computed; null when untracked
  stock_untracked?: boolean            // true = no baseline set; can't track
  approaching_reorder?: boolean        // heads-up before hitting the reorder point
  order_now: boolean
  eoq?: number
  n_days_data: number
  constraint_notes: string[]
  projected_runout_warning: boolean
}

// ── Order records (ordering lifecycle) ───────────────────────────────────────

export interface OrderRecordRead {
  id: number
  business_id: number
  product_id: number
  ordered_date: string         // "YYYY-MM-DD"
  quantity: number
  expected_arrival_date: string  // "YYYY-MM-DD"
  status: 'pending' | 'arrived' | 'cancelled'
}

export interface OrderRecordCreate {
  product_id: number
  ordered_date: string
  quantity: number
}

export interface OrderRecordUpdate {
  quantity?: number
  status?: 'pending' | 'arrived' | 'cancelled'
}

export interface ProductForecastResponse {
  status: string
  message?: string
  products: ProductForecastItem[]
}

// ── business insights ─────────────────────────────────────────────────────────

export interface InsightsDayPattern {
  weekday: string
  avg_customers: number
  pct_vs_mean: number
}

export interface InsightsHourPattern {
  hour: number
  label: string
  avg_taps: number
}

export interface InsightsWeekdayTrend {
  weekday: string
  pct_change: number
  direction: 'growing' | 'declining'
  recent_avg: number
  prior_avg: number
}

export interface InsightsSeasonalAlert {
  month_name: string
  last_year_avg: number
  current_pace: number
  pct_difference: number
  direction: 'busier' | 'quieter'
  weeks_away: number
}

export interface InsightsDecliningRegular {
  name: string
  days_since_visit: number
  usual_gap_days: number
}

export interface InsightsResponse {
  status: string
  message?: string
  n_days_logged?: number
  n_months_logged?: number
  first_date?: string
  last_date?: string
  busiest_day?: InsightsDayPattern
  slowest_day?: InsightsDayPattern
  pct_diff_busiest_slowest?: number
  peak_hour?: InsightsHourPattern
  quietest_hour?: InsightsHourPattern
  yoy_growth_pct?: number
  yoy_prev_period_label?: string
  yoy_curr_period_label?: string
  forecast_accuracy_mape?: number
  accuracy_early_mape?: number
  accuracy_recent_mape?: number
  accuracy_improved?: boolean
  weekday_trends: InsightsWeekdayTrend[]
  seasonal_alerts: InsightsSeasonalAlert[]
  declining_regulars: InsightsDecliningRegular[]
}
