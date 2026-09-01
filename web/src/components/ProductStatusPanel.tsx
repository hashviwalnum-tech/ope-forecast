import { useEffect, useMemo, useState, useId } from 'react'
import { analytics, orders as ordersApi, products as productsApi } from '../api/client'
import { useBusinessTime } from '../contexts/BusinessTimeContext'
import LoadError from './LoadError'
import { describeStock } from '../lib/stockLabel'
import { useLanguage } from '../contexts/LanguageContext'
import type { OrderingResponse, OrderRecordRead, OrderingRow, ProductRead } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtQtyVal(n: number, unitMode: string) {
  return unitMode === 'whole' ? String(Math.round(n)) : n.toFixed(2)
}

// ── inline order form ─────────────────────────────────────────────────────────

function InlineOrderForm({
  productId, unit, unitMode, suggestedQty, existingOrder, today, onChanged,
}: {
  productId: number; unit: string; unitMode: string; suggestedQty: number
  existingOrder: OrderRecordRead | null; today: string; onChanged: () => void
}) {
  const fieldId = useId()
  const { t } = useLanguage()
  const isWhole = unitMode === 'whole'
  const [showForm, setShowForm] = useState(false)
  const [qty, setQty] = useState(
    isWhole ? String(Math.round(suggestedQty || 1)) : String(suggestedQty || 1)
  )
  const [saving, setSaving] = useState(false)
  const [arriving, setArriving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function place() {
    let q = parseFloat(qty)
    if (isNaN(q) || q <= 0) { setErr('Enter a valid quantity'); return }
    if (isWhole) q = Math.round(q)
    setSaving(true); setErr(null)
    try {
      await ordersApi.create({ product_id: productId, ordered_date: today, quantity: q })
      setShowForm(false); onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  async function markArrived() {
    if (!existingOrder) return
    setArriving(true)
    try { await ordersApi.update(existingOrder.id, { status: 'arrived' }); onChanged() }
    catch { /* best-effort */ } finally { setArriving(false) }
  }

  if (existingOrder) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
          ✓ {t('orderedTodayInfo', { qty: String(existingOrder.quantity), unit, date: existingOrder.expected_arrival_date })}
        </span>
        {existingOrder.expected_arrival_date <= today && (
          <button
            onClick={markArrived} disabled={arriving}
            className="text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700
                       rounded-xl px-3 min-h-11 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            {arriving ? '…' : t('confirmArrived')}
          </button>
        )}
      </div>
    )
  }

  if (!showForm) {
    return (
      <button
        onClick={() => { setShowForm(true); setQty(isWhole ? String(Math.round(suggestedQty || 1)) : String(suggestedQty || 1)) }}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-300
                   border border-teal-200 dark:border-teal-700 rounded-lg px-3 py-1.5
                   hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
      >
        📦 {t('iOrderedThis')}
      </button>
    )
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-slate-600 dark:text-slate-400 shrink-0" htmlFor={`${fieldId}-f1`}>{t('quantityOrdered')}</label>
        <input id={`${fieldId}-f1`}
          type="number"
          min={isWhole ? '1' : '0.01'}
          step={isWhole ? '1' : '0.01'}
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-20 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-sm
                     bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        />
        <span className="text-xs text-slate-600 shrink-0 dark:text-slate-300">{unit}</span>
        <button
          onClick={place} disabled={saving}
          className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700
                     disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
        >{saving ? '…' : t('confirmOrder')}</button>
        <button
          onClick={() => { setShowForm(false); setErr(null) }}
          className="text-sm text-slate-700 dark:text-slate-200 hover:underline min-h-11 px-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >{t('cancelBtn')}</button>
      </div>
      {err && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{err}</p>}
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────────

export default function ProductStatusPanel() {
  const { t } = useLanguage()
  const [products, setProducts] = useState<ProductRead[]>([])
  const [ordering, setOrdering] = useState<OrderingResponse | null>(null)
  const [allOrders, setAllOrders] = useState<OrderRecordRead[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)

  const { today } = useBusinessTime()

  async function load() {
    setLoadError(null)
    try {
      const [prods, ord, orders] = await Promise.all([
        productsApi.list(),
        analytics.ordering(),
        ordersApi.list(),
      ])
      setProducts(prods)
      setOrdering(ord)
      setAllOrders(orders.filter(o => o.status !== 'cancelled'))
    } catch (e) {
      setLoadError(e)
    }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Build stock info map from ordering response
  const orderingMap = useMemo(() => {
    const m = new Map<number, OrderingRow>()
    for (const p of (ordering?.products ?? [])) m.set(p.product_id, p)
    return m
  }, [ordering])

  // Build active orders map
  const ordersByProduct = useMemo(() => {
    const m = new Map<number, OrderRecordRead>()
    for (const o of allOrders) {
      if (o.status === 'pending' && !m.has(o.product_id)) m.set(o.product_id, o)
    }
    return m
  }, [allOrders])

  // Stocked products only (services don't have stock), sorted: favorites first
  const stockedProducts = [...products.filter(p => (p.product_type ?? 'stocked') === 'stocked')]
    .sort((a, b) => {
      if (a.is_favorite === b.is_favorite) return a.name.localeCompare(b.name)
      return a.is_favorite ? -1 : 1
    })

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <p role="status" aria-live="polite" className="text-sm text-slate-600 dark:text-slate-400 animate-pulse">{t('loadingLabel')}</p>
      </div>
    )
  }

  if (loadError) return <LoadError error={loadError} onRetry={load} />

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">{t('allProductsTitle')}</h2>
      <p className="text-xs text-slate-600 dark:text-slate-400 mb-5">{t('stockStatusDesc')}</p>

      {stockedProducts.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('stockStatusEmpty')}</p>
      ) : (
        <div className="space-y-3">
          {stockedProducts.map(prod => {
            const ord = orderingMap.get(prod.id)
            // Counted or estimated — labelled as whichever it is.
            const stock = describeStock({
              current_stock: prod.current_stock,
              projected_stock: ord?.projected_stock,
              stock_as_of_date: prod.stock_as_of_date,
              stock_untracked: ord?.stock_untracked ?? prod.current_stock == null,
            })
            const displayStock = stock.kind === 'untracked' ? null : stock.qty
            const stockUntracked = stock.kind === 'untracked'
            const uMode = prod.unit_mode ?? 'whole'
            const activeOrder = ordersByProduct.get(prod.id) ?? null

            const statusBadge = ord?.order_now
              ? <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full text-xs font-semibold">{t('orderNowLabel')}</span>
              : ord?.approaching_reorder
                ? <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full text-xs font-semibold">⚠ {t('reorderWhenBelow')}</span>
                : displayStock != null && !stockUntracked
                  ? <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-semibold">{t('youreGood')}</span>
                  : <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-full text-xs">{t('noStockTracked')}</span>

            return (
              <div
                key={prod.id}
                className={`rounded-xl border p-4 ${
                  ord?.order_now ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-900/10'
                    : ord?.approaching_reorder ? 'border-amber-200 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10'
                    : 'border-slate-100 dark:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {prod.is_favorite && <span className="text-amber-700 mr-1 dark:text-amber-300">★</span>}
                      {prod.name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                      {stock.kind === 'counted' && (
                        <span>{t('inStock')}: <strong className="text-slate-700 dark:text-slate-200">{fmtQtyVal(stock.qty, uMode)} {prod.unit}</strong></span>
                      )}
                      {stock.kind === 'estimated' && (
                        <span title={stock.countedOn
                          ? t('lastCountedOn', { qty: `${fmtQtyVal(stock.counted, uMode)} ${prod.unit}`, date: stock.countedOn })
                          : t('lastCountedNoDate', { qty: `${fmtQtyVal(stock.counted, uMode)} ${prod.unit}` })}>
                          {t('estimatedLeftNow', { qty: `${fmtQtyVal(stock.qty, uMode)} ${prod.unit}` })}
                        </span>
                      )}
                      {stockUntracked && (
                        <span className="text-slate-600 dark:text-slate-400 italic">{t('setStartingStockHint')}</span>
                      )}
                      {ord && (p => p.n_days_data != null && p.n_days_data > 0)(ord) && (
                        <>
                          <span>{t('reorderBelowColon')} <strong className="text-slate-600 dark:text-slate-300">{fmtQtyVal(ord.reorder_point, uMode)} {prod.unit}</strong></span>
                          <span>{t('safetyBufferColon')} <strong className="text-slate-600 dark:text-slate-300">{fmtQtyVal(ord.safety_stock_units, uMode)} {prod.unit}</strong></span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">{statusBadge}</div>
                </div>

                <InlineOrderForm
                  productId={prod.id}
                  unit={prod.unit}
                  unitMode={uMode}
                  suggestedQty={ord?.suggested_order_qty ?? 1}
                  existingOrder={activeOrder}
                  today={today}
                  onChanged={load}
                />
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
