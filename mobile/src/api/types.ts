// Subset of web/src/api/types.ts — only what the mobile app uses in Phase 4 Step 1.

export interface BusinessRead {
  id: number
  name: string
  settings: Record<string, unknown>
  tier: string
}

export interface ForecastDay {
  date: string          // "YYYY-MM-DD"
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
