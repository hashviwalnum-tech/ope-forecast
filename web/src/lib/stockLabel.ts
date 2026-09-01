/**
 * How to describe a product's stock without overstating what we know.
 *
 * Three screens used to render `projected_stock ?? current_stock` under the
 * words "{qty} in stock". For a product whose owner last counted 1,375 and
 * whose projection stood at 393, that told them they had 393 — as a fact. The
 * projection is a good estimate (last count, minus what has sold, plus what has
 * arrived), but it is an estimate, and saying so is the difference between a
 * number an owner can check and one they simply have to believe.
 */

export interface StockRow {
  current_stock?: number | null
  projected_stock?: number | null
  stock_as_of_date?: string | null
  stock_untracked?: boolean
}

export type StockLabel =
  /** No baseline was ever set — we genuinely do not know, and must say so. */
  | { kind: 'untracked' }
  /** A figure the owner counted, with nothing since to change it. */
  | { kind: 'counted'; qty: number }
  /** Our estimate, alongside the count it was worked out from. */
  | { kind: 'estimated'; qty: number; counted: number; countedOn: string | null }

/** Round-trip tolerance: the API rounds whole-unit products, so 393 vs 393.4
 *  is the same number and must not be dressed up as an estimate. */
const SAME = 0.5

export function describeStock(row: StockRow): StockLabel {
  if (row.stock_untracked) return { kind: 'untracked' }

  const counted = row.current_stock
  const projected = row.projected_stock

  if (projected == null) {
    if (counted == null) return { kind: 'untracked' }
    return { kind: 'counted', qty: counted }
  }
  if (counted == null || Math.abs(projected - counted) < SAME) {
    return { kind: 'counted', qty: projected }
  }
  return {
    kind: 'estimated',
    qty: projected,
    counted,
    countedOn: row.stock_as_of_date ?? null,
  }
}

/**
 * Units already ordered and not yet arrived.
 *
 * The reorder advice is worked out from stock on the shelf, so a delivery still
 * in transit does not count towards it. That is defensible, but only if the
 * card says so — otherwise "order 2,107" beside "in transit: 2,961" just looks
 * wrong.
 */
export function pendingArrivalQty(
  orders: { status?: string; effective_status?: string; quantity: number }[] | null | undefined,
): number {
  if (!orders || orders.length === 0) return 0
  return orders
    // `effective_status` already accounts for the "assume orders arrive on
    // time" setting, so a shipment the app has auto-marked as landed is not
    // counted twice.
    .filter(o => (o.effective_status ?? o.status) === 'pending')
    .reduce((sum, o) => sum + (o.quantity || 0), 0)
}
