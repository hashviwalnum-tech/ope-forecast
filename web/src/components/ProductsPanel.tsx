import { useEffect, useRef, useState } from 'react'
import { products as productsApi } from '../api/client'
import type { ProductRead } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function parseOptionalNumber(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = parseFloat(t)
  return isNaN(n) ? null : n
}

// ── add-product form ──────────────────────────────────────────────────────────

type AddForm = {
  name: string
  unit: string
  unit_mode: 'whole' | 'decimal'
  price: string
  lead_time_days: string
  current_stock: string
  storage_capacity: string
  shelf_life_days: string
  holding_cost: string
  order_cost: string
  service_time_minutes: string
}

const EMPTY_ADD: AddForm = {
  name: '', unit: '', unit_mode: 'whole', price: '', lead_time_days: '1',
  current_stock: '', storage_capacity: '', shelf_life_days: '',
  holding_cost: '', order_cost: '', service_time_minutes: '',
}

function AddProductForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm]       = useState<AddForm>(EMPTY_ADD)
  const [showMore, setShowMore] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const nameRef               = useRef<HTMLInputElement>(null)

  function set(key: keyof AddForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    const unit = form.unit.trim()
    if (!name) { setError('Give this product a name.'); return }
    if (!unit) { setError('What unit do you sell it in? (e.g. kg, box, bottle)'); return }

    const lead_time_days = parseInt(form.lead_time_days)
    if (isNaN(lead_time_days) || lead_time_days < 1) {
      setError('Lead time must be at least 1 day.'); return
    }

    const price                = parseOptionalNumber(form.price)
    const current_stock        = parseOptionalNumber(form.current_stock)
    const storage_capacity     = parseOptionalNumber(form.storage_capacity)
    const shelf_life_days_n    = form.shelf_life_days.trim() === '' ? null : parseInt(form.shelf_life_days)
    const holding_cost         = parseOptionalNumber(form.holding_cost)
    const order_cost           = parseOptionalNumber(form.order_cost)
    const service_time_minutes = parseOptionalNumber(form.service_time_minutes)

    if (price                !== null && price                < 0) { setError('Price can\'t be negative.'); return }
    if (current_stock        !== null && current_stock        < 0) { setError('Stock on hand can\'t be negative.'); return }
    if (storage_capacity     !== null && storage_capacity     <= 0) { setError('Storage capacity must be greater than zero.'); return }
    if (shelf_life_days_n    !== null && (isNaN(shelf_life_days_n) || shelf_life_days_n < 1)) { setError('Shelf life must be at least 1 day.'); return }
    if (holding_cost         !== null && holding_cost         < 0) { setError('Holding cost can\'t be negative.'); return }
    if (order_cost           !== null && order_cost           < 0) { setError('Order cost can\'t be negative.'); return }
    if (service_time_minutes !== null && service_time_minutes <= 0) { setError('Serving time must be greater than zero.'); return }

    setSaving(true)
    setError(null)
    try {
      await productsApi.create({
        name, unit, unit_mode: form.unit_mode, lead_time_days,
        ...(price                !== null && { price }),
        ...(current_stock        !== null && { current_stock }),
        ...(storage_capacity     !== null && { storage_capacity }),
        ...(shelf_life_days_n    !== null && { shelf_life_days: shelf_life_days_n }),
        ...(holding_cost         !== null && { holding_cost }),
        ...(order_cost           !== null && { order_cost }),
        ...(service_time_minutes !== null && { service_time_minutes }),
      })
      setForm(EMPTY_ADD)
      setShowMore(false)
      nameRef.current?.focus()
      onCreated()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Name */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Product name <span className="text-red-400">*</span>
          </label>
          <input
            ref={nameRef}
            type="text"
            placeholder="e.g. Sourdough loaf, Large coffee, Haircut"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>

        {/* Unit */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Sold in <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. each, kg, litre, box"
            value={form.unit}
            onChange={e => set('unit', e.target.value)}
            className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>

        {/* Lead time */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            How many days to restock?
          </label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="1"
            value={form.lead_time_days}
            onChange={e => set('lead_time_days', e.target.value)}
            className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
          <p className="mt-1 text-xs text-slate-400">Days between ordering and receiving stock</p>
        </div>
      </div>

      {/* Unit mode */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          How do you count this product?
        </label>
        <div className="flex gap-3">
          {(['whole', 'decimal'] as const).map(m => (
            <label key={m} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="unit_mode_add"
                value={m}
                checked={form.unit_mode === m}
                onChange={() => set('unit_mode', m)}
                className="accent-teal-600"
              />
              <span className="text-sm text-slate-700">
                {m === 'whole' ? 'Whole units (e.g. bottles, loaves)' : 'Decimal (e.g. kg, litres)'}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">Controls whether quantities are whole numbers or allow decimals</p>
      </div>

      {/* Optional extra fields */}
      <button
        type="button"
        onClick={() => setShowMore(s => !s)}
        className="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
      >
        {showMore ? '▲ Hide optional details' : '▼ Add optional details (price, stock, limits, serving time)'}
      </button>

      {showMore && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Selling price (per unit)
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 4.50"
              value={form.price}
              onChange={e => set('price', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Stock on hand right now
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 40"
              value={form.current_stock}
              onChange={e => set('current_stock', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <p className="mt-1 text-xs text-slate-400">Tells us when to suggest reordering</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Storage capacity (max units)
            </label>
            <input
              type="number"
              min="0.1"
              step="any"
              placeholder="e.g. 200"
              value={form.storage_capacity}
              onChange={e => set('storage_capacity', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <p className="mt-1 text-xs text-slate-400">Order won't exceed what physically fits</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Shelf life (days before spoiling)
            </label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 3"
              value={form.shelf_life_days}
              onChange={e => set('shelf_life_days', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <p className="mt-1 text-xs text-slate-400">Won't order more than you can sell before it expires</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Minutes to serve one customer
            </label>
            <input
              type="number"
              min="0.1"
              step="any"
              placeholder="Blank = use your settings default"
              value={form.service_time_minutes}
              onChange={e => set('service_time_minutes', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <p className="mt-1 text-xs text-slate-400">Overrides the default in Settings for staffing calculations</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Cost to place one order
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 15"
              value={form.order_cost}
              onChange={e => set('order_cost', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <p className="mt-1 text-xs text-slate-400">Delivery fee, admin time, etc.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Cost to hold one unit/year
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 2"
              value={form.holding_cost}
              onChange={e => set('holding_cost', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            />
            <p className="mt-1 text-xs text-slate-400">Storage, spoilage, tied-up cash</p>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full sm:w-auto px-8 py-3 bg-teal-600 text-white text-base font-semibold
                   rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors shadow-sm"
      >
        {saving ? 'Saving…' : 'Add product'}
      </button>
    </form>
  )
}

// ── edit-product form (inline) ────────────────────────────────────────────────

type EditForm = {
  name: string
  unit: string
  unit_mode: 'whole' | 'decimal'
  price: string
  lead_time_days: string
  current_stock: string
  storage_capacity: string
  shelf_life_days: string
  holding_cost: string
  order_cost: string
  service_time_minutes: string
}

function productToEditForm(p: ProductRead): EditForm {
  return {
    name:                 p.name,
    unit:                 p.unit,
    unit_mode:            p.unit_mode ?? 'whole',
    price:                p.price               != null ? String(p.price)               : '',
    lead_time_days:       String(p.lead_time_days),
    current_stock:        p.current_stock        != null ? String(p.current_stock)        : '',
    storage_capacity:     p.storage_capacity     != null ? String(p.storage_capacity)     : '',
    shelf_life_days:      p.shelf_life_days      != null ? String(p.shelf_life_days)      : '',
    holding_cost:         p.holding_cost         != null ? String(p.holding_cost)         : '',
    order_cost:           p.order_cost           != null ? String(p.order_cost)           : '',
    service_time_minutes: p.service_time_minutes != null ? String(p.service_time_minutes) : '',
  }
}

function EditProductForm({
  product,
  onSaved,
  onCancel,
}: {
  product: ProductRead
  onSaved: () => void
  onCancel: () => void
}) {
  const [form, setForm]   = useState<EditForm>(productToEditForm(product))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  function set(key: keyof EditForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    const unit = form.unit.trim()
    if (!name) { setError('Name is required.'); return }
    if (!unit) { setError('Unit is required.'); return }

    const lead_time_days = parseInt(form.lead_time_days)
    if (isNaN(lead_time_days) || lead_time_days < 1) {
      setError('Lead time must be at least 1 day.'); return
    }

    setSaving(true)
    setError(null)
    try {
      const shelf = form.shelf_life_days.trim() === '' ? null : parseInt(form.shelf_life_days)
      await productsApi.update(product.id, {
        name, unit, unit_mode: form.unit_mode, lead_time_days,
        price:                parseOptionalNumber(form.price),
        current_stock:        parseOptionalNumber(form.current_stock),
        storage_capacity:     parseOptionalNumber(form.storage_capacity),
        shelf_life_days:      shelf,
        holding_cost:         parseOptionalNumber(form.holding_cost),
        order_cost:           parseOptionalNumber(form.order_cost),
        service_time_minutes: parseOptionalNumber(form.service_time_minutes) ?? undefined,
      })
      onSaved()
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="pt-3 pb-1 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Product name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Sold in</label>
          <input
            type="text"
            value={form.unit}
            onChange={e => set('unit', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Days to restock</label>
          <input
            type="number"
            min="1"
            step="1"
            value={form.lead_time_days}
            onChange={e => set('lead_time_days', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-2">How do you count this?</label>
          <div className="flex gap-4">
            {(['whole', 'decimal'] as const).map(m => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`unit_mode_edit_${product.id}`}
                  value={m}
                  checked={form.unit_mode === m}
                  onChange={() => set('unit_mode', m)}
                  className="accent-teal-600"
                />
                <span className="text-xs text-slate-700">
                  {m === 'whole' ? 'Whole units' : 'Decimal (kg, litres…)'}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Selling price</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="—"
            value={form.price}
            onChange={e => set('price', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Stock on hand</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="—"
            value={form.current_stock}
            onChange={e => set('current_stock', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Storage capacity (max units)</label>
          <input
            type="number"
            min="0.1"
            step="any"
            placeholder="—"
            value={form.storage_capacity}
            onChange={e => set('storage_capacity', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Shelf life (days)</label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="—"
            value={form.shelf_life_days}
            onChange={e => set('shelf_life_days', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Order cost</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="—"
            value={form.order_cost}
            onChange={e => set('order_cost', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Holding cost/unit/year</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="—"
            value={form.holding_cost}
            onChange={e => set('holding_cost', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Minutes to serve one customer
          </label>
          <input
            type="number"
            min="0.1"
            step="any"
            placeholder="Blank = use your settings default"
            value={form.service_time_minutes}
            onChange={e => set('service_time_minutes', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
          <p className="mt-1 text-xs text-slate-400">Overrides the default in Settings for staffing calculations</p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg
                     hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2 text-sm font-medium text-slate-600 bg-slate-100
                     rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── product row ───────────────────────────────────────────────────────────────

function ProductRow({
  product,
  onChanged,
}: {
  product: ProductRead
  onChanged: () => void
}) {
  const [editing, setEditing]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting]     = useState(false)

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await productsApi.delete(product.id)
      onChanged()
    } catch {
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (editing) {
    return (
      <div className="py-3 border-b border-slate-100 last:border-0">
        <EditProductForm
          product={product}
          onSaved={() => { setEditing(false); onChanged() }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-slate-100 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-slate-800">{product.name}</p>
        <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
          <span>Sold in: <strong className="text-slate-700">{product.unit}</strong></span>
          <span className="text-slate-400">{product.unit_mode === 'decimal' ? 'Decimal' : 'Whole units'}</span>
          <span>Restock time: <strong className="text-slate-700">{product.lead_time_days} day{product.lead_time_days !== 1 ? 's' : ''}</strong></span>
          {product.price != null && (
            <span>Price: <strong className="text-slate-700">{product.price}</strong></span>
          )}
          {product.current_stock != null && (
            <span>In stock: <strong className="text-slate-700">{product.current_stock} {product.unit}</strong></span>
          )}
          {product.storage_capacity != null && (
            <span>Max storage: <strong className="text-slate-700">{product.storage_capacity}</strong></span>
          )}
          {product.shelf_life_days != null && (
            <span>Shelf life: <strong className="text-slate-700">{product.shelf_life_days}d</strong></span>
          )}
          {product.service_time_minutes != null && (
            <span>Serve time: <strong className="text-slate-700">{product.service_time_minutes} min</strong></span>
          )}
          {product.order_cost != null && (
            <span>Order cost: <strong className="text-slate-700">{product.order_cost}</strong></span>
          )}
          {product.holding_cost != null && (
            <span>Holding cost: <strong className="text-slate-700">{product.holding_cost}/unit/yr</strong></span>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0 pt-0.5">
        <button
          onClick={() => { setEditing(true); setConfirming(false) }}
          className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-medium
                     rounded-lg hover:bg-slate-200 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            confirming
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {deleting ? '…' : confirming ? 'Confirm remove' : 'Remove'}
        </button>
      </div>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function ProductsPanel() {
  const [productList, setProductList] = useState<ProductRead[]>([])

  async function load() {
    try {
      setProductList(await productsApi.list())
    } catch {
      // non-critical; leave list empty
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-8">

      {/* ── add form ── */}
      <section className="bg-white rounded-2xl border border-teal-100 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Add a product</h2>
        <p className="text-xs text-slate-500 mb-5">
          Add anything you sell. Once it's here, we'll track how much you need and when to reorder.
        </p>
        <AddProductForm onCreated={load} />
      </section>

      {/* ── product list ── */}
      {productList.length > 0 ? (
        <section className="bg-white rounded-2xl border border-teal-100 px-6 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 mb-1">
            Your products
            <span className="ml-2 text-sm font-normal text-slate-400">({productList.length})</span>
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            Tap <strong>Edit</strong> to change a product, or <strong>Remove</strong> to delete it.
          </p>
          <div>
            {productList.map(p => (
              <ProductRow key={p.id} product={p} onChanged={load} />
            ))}
          </div>
        </section>
      ) : (
        <section className="bg-white rounded-2xl border border-teal-100 p-10 text-center shadow-sm">
          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
            You haven't added any products yet. Use the form above to get started —
            it only takes a name and a unit.
          </p>
        </section>
      )}
    </div>
  )
}
