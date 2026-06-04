import { useEffect, useRef, useState } from 'react'
import { products as productsApi } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
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
  service_time_minutes: string
}

const EMPTY_ADD: AddForm = {
  name: '', unit: '', unit_mode: 'whole', price: '', lead_time_days: '1',
  current_stock: '', storage_capacity: '', shelf_life_days: '',
  service_time_minutes: '',
}

function AddProductForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useLanguage()
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
    const service_time_minutes = parseOptionalNumber(form.service_time_minutes)

    if (price                !== null && price                < 0) { setError("Price can't be negative."); return }
    if (current_stock        !== null && current_stock        < 0) { setError("Stock on hand can't be negative."); return }
    if (storage_capacity     !== null && storage_capacity     <= 0) { setError('Storage capacity must be greater than zero.'); return }
    if (shelf_life_days_n    !== null && (isNaN(shelf_life_days_n) || shelf_life_days_n < 1)) { setError('Shelf life must be at least 1 day.'); return }
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
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {t('productNameLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            ref={nameRef}
            type="text"
            placeholder={t('productNamePlaceholder')}
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Unit */}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {t('soldInLabel')} <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            placeholder={t('soldInPlaceholder')}
            value={form.unit}
            onChange={e => set('unit', e.target.value)}
            className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Lead time */}
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {t('daysToRestock')}
          </label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="1"
            value={form.lead_time_days}
            onChange={e => set('lead_time_days', e.target.value)}
            className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
          <p className="mt-1 text-xs text-slate-400">{t('daysToRestockDesc')}</p>
        </div>
      </div>

      {/* Unit mode */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          {t('howDoYouCount')}
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
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {m === 'whole' ? t('wholeUnitsLabel') : t('decimalLabel')}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">{t('unitModeDesc')}</p>
      </div>

      {/* Optional extra fields */}
      <button
        type="button"
        onClick={() => setShowMore(s => !s)}
        className="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
      >
        {showMore ? t('optionalDetailsHide') : t('optionalDetailsShow')}
      </button>

      {showMore && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {t('sellingPrice')}
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 4.50"
              value={form.price}
              onChange={e => set('price', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                         text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {t('stockOnHand')}
            </label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 40"
              value={form.current_stock}
              onChange={e => set('current_stock', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                         text-slate-900 dark:text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-400">{t('stockDesc')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {t('storageCapacity')}
            </label>
            <input
              type="number"
              min="0.1"
              step="any"
              placeholder="e.g. 200"
              value={form.storage_capacity}
              onChange={e => set('storage_capacity', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                         text-slate-900 dark:text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-400">{t('storageDesc')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {t('shelfLifeLabel')}
            </label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 3"
              value={form.shelf_life_days}
              onChange={e => set('shelf_life_days', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                         text-slate-900 dark:text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-400">{t('shelfLifeDesc')}</p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {t('minutesToServe')}
            </label>
            <input
              type="number"
              min="0.1"
              step="any"
              placeholder="Blank = use your settings default"
              value={form.service_time_minutes}
              onChange={e => set('service_time_minutes', e.target.value)}
              className="w-full px-4 py-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                         text-slate-900 dark:text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-400">{t('serviceTimeDesc')}</p>
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
        {saving ? t('savingLabel') : t('addProductBtn')}
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
  const { t } = useLanguage()
  const [form, setForm]     = useState<EditForm>(productToEditForm(product))
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
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('productNameLabel')}</label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('soldInLabel')}</label>
          <input
            type="text"
            value={form.unit}
            onChange={e => set('unit', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('daysToRestock')}</label>
          <input
            type="number"
            min="1"
            step="1"
            value={form.lead_time_days}
            onChange={e => set('lead_time_days', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">{t('howDoYouCount')}</label>
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
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  {m === 'whole' ? t('wholeUnitsLabel') : t('decimalLabel')}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('sellingPrice')}</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="—"
            value={form.price}
            onChange={e => set('price', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('stockOnHand')}</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="—"
            value={form.current_stock}
            onChange={e => set('current_stock', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('storageCapacity')}</label>
          <input
            type="number"
            min="0.1"
            step="any"
            placeholder="—"
            value={form.storage_capacity}
            onChange={e => set('storage_capacity', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('shelfLifeLabel')}</label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="—"
            value={form.shelf_life_days}
            onChange={e => set('shelf_life_days', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {t('minutesToServe')}
          </label>
          <input
            type="number"
            min="0.1"
            step="any"
            placeholder="Blank = use your settings default"
            value={form.service_time_minutes}
            onChange={e => set('service_time_minutes', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white dark:bg-slate-700
                       text-slate-900 dark:text-slate-100"
          />
          <p className="mt-1 text-xs text-slate-400">{t('serviceTimeDesc')}</p>
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
          {saving ? t('savingLabel') : t('saveChangesBtn')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700
                     rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
        >
          {t('cancelBtn')}
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
  const { t } = useLanguage()
  const [editing, setEditing]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [deleteErr, setDeleteErr]   = useState<string | null>(null)

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    setDeleteErr(null)
    try {
      await productsApi.delete(product.id)
      onChanged()
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Delete failed')
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (editing) {
    return (
      <div className="py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
        <EditProductForm
          product={product}
          onSaved={() => { setEditing(false); onChanged() }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{product.name}</p>
        <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span>{t('soldInDisplay')}: <strong className="text-slate-700 dark:text-slate-200">{product.unit}</strong></span>
          <span className="text-slate-400 dark:text-slate-500">{product.unit_mode === 'decimal' ? t('decimalLabel') : t('wholeUnitsLabel')}</span>
          <span>{t('restockTime')}: <strong className="text-slate-700 dark:text-slate-200">{product.lead_time_days}d</strong></span>
          {product.price != null && (
            <span>{t('priceLbl')}: <strong className="text-slate-700 dark:text-slate-200">{product.price}</strong></span>
          )}
          {product.current_stock != null && (
            <span>{t('inStock')}: <strong className="text-slate-700 dark:text-slate-200">{product.current_stock} {product.unit}</strong></span>
          )}
          {product.storage_capacity != null && (
            <span>{t('maxStorage')}: <strong className="text-slate-700 dark:text-slate-200">{product.storage_capacity}</strong></span>
          )}
          {product.shelf_life_days != null && (
            <span>{t('shelfLifeLabel')}: <strong className="text-slate-700 dark:text-slate-200">{product.shelf_life_days}d</strong></span>
          )}
          {product.service_time_minutes != null && (
            <span>{t('serveTime')}: <strong className="text-slate-700 dark:text-slate-200">{product.service_time_minutes} min</strong></span>
          )}
        </div>
        {deleteErr && (
          <p className="text-xs text-red-600 mt-1">{deleteErr}</p>
        )}
      </div>
      <div className="flex gap-2 shrink-0 pt-0.5">
        <button
          onClick={() => { setEditing(true); setConfirming(false); setDeleteErr(null) }}
          className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium
                     rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
        >
          {t('editBtn')}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            confirming
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
          }`}
        >
          {deleting ? '…' : confirming ? t('confirmRemoveBtn') : t('removeBtn')}
        </button>
      </div>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function ProductsPanel() {
  const { t } = useLanguage()
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
      <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">{t('addAProduct')}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
          {t('productPanelDesc')}
        </p>
        <AddProductForm onCreated={load} />
      </section>

      {/* ── product list ── */}
      {productList.length > 0 ? (
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 px-6 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
            {t('yourProducts')}
            <span className="ml-2 text-sm font-normal text-slate-400">({productList.length})</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {t('tapEditRemove')}
          </p>
          <div>
            {productList.map(p => (
              <ProductRow key={p.id} product={p} onChanged={load} />
            ))}
          </div>
        </section>
      ) : (
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 p-10 text-center shadow-sm">
          <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed max-w-xs mx-auto">
            {t('noProductsYet')}
          </p>
        </section>
      )}
    </div>
  )
}
