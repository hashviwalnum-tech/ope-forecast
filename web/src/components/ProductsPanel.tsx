import { useEffect, useRef, useState } from 'react'
import { products as productsApi } from '../api/client'
import { useLanguage } from '../contexts/LanguageContext'
import type { ProductRead, ServiceConsumableCreate, ServiceConsumableRead } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function parseOptionalNumber(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = parseFloat(t)
  return isNaN(n) ? null : n
}

// ── consumables sub-component (used inside edit form for services) ─────────────

function ConsumablesSection({
  serviceId,
  allProducts,
}: {
  serviceId: number
  allProducts: ProductRead[]
}) {
  const { t } = useLanguage()
  const [consumables, setConsumables] = useState<ServiceConsumableRead[]>([])
  const [adding, setAdding] = useState(false)
  const [newConsumableId, setNewConsumableId] = useState('')
  const [newQty, setNewQty] = useState('')
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // Only stocked products can be consumables
  const stocked = allProducts.filter(p => (p.product_type ?? 'stocked') === 'stocked' && p.id !== serviceId)

  useEffect(() => {
    productsApi.listConsumables(serviceId)
      .then(setConsumables)
      .catch(() => setConsumables([]))
  }, [serviceId])

  async function handleAdd() {
    const cid = parseInt(newConsumableId)
    const qty = parseFloat(newQty)
    if (isNaN(cid) || cid < 1) { setSaveErr('Choose a product.'); return }
    if (isNaN(qty) || qty <= 0) { setSaveErr('Enter a quantity greater than 0.'); return }
    setAdding(true)
    setSaveErr(null)
    try {
      const body: ServiceConsumableCreate = { consumable_product_id: cid, qty_per_performance: qty }
      const created = await productsApi.addConsumable(serviceId, body)
      setConsumables(cs => [...cs, created])
      setNewConsumableId('')
      setNewQty('')
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to add.')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(linkId: number) {
    try {
      await productsApi.deleteConsumable(serviceId, linkId)
      setConsumables(cs => cs.filter(c => c.id !== linkId))
    } catch {
      // best-effort
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-0.5">{t('consumablesTitle')}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{t('consumablesDesc')}</p>

      {consumables.length > 0 && (
        <ul className="mb-3 space-y-1">
          {consumables.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300
                                      bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2">
              <span><strong>{c.consumable_name}</strong> — {c.qty_per_performance} {c.consumable_unit} per service</span>
              <button
                type="button"
                onClick={() => handleRemove(c.id)}
                className="text-red-500 hover:text-red-700 font-medium shrink-0"
              >
                {t('removeSupplyBtn')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {consumables.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{t('noConsumables')}</p>
      )}

      {stocked.length > 0 && (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-32">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('consumableProductLabel')}</label>
            <select
              value={newConsumableId}
              onChange={e => { setNewConsumableId(e.target.value); setSaveErr(null) }}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                         bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              <option value="">— select —</option>
              {stocked.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('qtyPerServiceLabel')}</label>
            <input
              type="number"
              min="0.01"
              step="any"
              placeholder="e.g. 20"
              value={newQty}
              onChange={e => { setNewQty(e.target.value); setSaveErr(null) }}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg
                         bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
          <button
            type="button"
            disabled={adding}
            onClick={handleAdd}
            className="px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg
                       hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {adding ? '…' : t('addSupplyBtn')}
          </button>
        </div>
      )}

      {saveErr && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{saveErr}</p>
      )}
    </div>
  )
}

// ── add-product form ──────────────────────────────────────────────────────────

type AddForm = {
  name: string
  unit: string
  product_type: 'stocked' | 'service'
  unit_mode: 'whole' | 'decimal'
  price: string
  lead_time_days: string
  current_stock: string
  storage_capacity: string
  shelf_life_days: string
  service_time_minutes: string
}

const EMPTY_ADD: AddForm = {
  name: '', unit: '', product_type: 'stocked', unit_mode: 'whole', price: '',
  lead_time_days: '1', current_stock: '', storage_capacity: '',
  shelf_life_days: '', service_time_minutes: '',
}

function AddProductForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useLanguage()
  const [form, setForm]       = useState<AddForm>(EMPTY_ADD)
  const [showMore, setShowMore] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const nameRef               = useRef<HTMLInputElement>(null)

  const isService = form.product_type === 'service'

  function set(key: keyof AddForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    const unit = form.unit.trim()
    if (!name) { setError(t('productNameRequired')); return }
    if (!unit) { setError(t('productUnitRequired')); return }

    const lead_time_days = isService ? 0 : parseInt(form.lead_time_days)
    if (!isService && (isNaN(lead_time_days) || lead_time_days < 1)) {
      setError(t('productLeadTimeMin')); return
    }

    const price                = parseOptionalNumber(form.price)
    const current_stock        = isService ? null : parseOptionalNumber(form.current_stock)
    const storage_capacity     = isService ? null : parseOptionalNumber(form.storage_capacity)
    const shelf_life_days_n    = isService || form.shelf_life_days.trim() === '' ? null : parseInt(form.shelf_life_days)
    const service_time_minutes = parseOptionalNumber(form.service_time_minutes)

    if (price                !== null && price                < 0) { setError(t('productPriceNeg')); return }
    if (current_stock        !== null && current_stock        < 0) { setError(t('productStockNeg')); return }
    if (storage_capacity     !== null && storage_capacity     <= 0) { setError(t('productCapacityPos')); return }
    if (shelf_life_days_n    !== null && (isNaN(shelf_life_days_n) || shelf_life_days_n < 1)) { setError(t('productShelfLifeMin')); return }
    if (service_time_minutes !== null && service_time_minutes <= 0) { setError(t('productServicePos')); return }

    setSaving(true)
    setError(null)
    try {
      await productsApi.create({
        name, unit, product_type: form.product_type, unit_mode: form.unit_mode, lead_time_days,
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

        {/* Lead time — hidden for services */}
        {!isService && (
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
        )}
      </div>

      {/* Product type */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          {t('productTypeLabel')}
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          {(['stocked', 'service'] as const).map(pt => (
            <label
              key={pt}
              className={`flex items-center gap-2 cursor-pointer px-4 py-3 rounded-xl border transition-colors
                ${form.product_type === pt
                  ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-300'}`}
            >
              <input
                type="radio"
                name="product_type_add"
                value={pt}
                checked={form.product_type === pt}
                onChange={() => set('product_type', pt)}
                className="accent-teal-600"
              />
              <span className="text-sm font-medium">
                {pt === 'stocked' ? t('stockedGoodLabel') : t('serviceProductLabel')}
              </span>
            </label>
          ))}
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

          {/* Stock fields only for physical goods */}
          {!isService && (
            <>
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
            </>
          )}

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {t('minutesToServe')}
            </label>
            <input
              type="number"
              min="0.1"
              step="any"
              placeholder={t('productServicePlaceholder')}
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

      {isService && showMore && (
        <div className="rounded-xl bg-teal-50/60 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-800 px-4 py-3">
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 mb-0.5">{t('consumablesTitle')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('consumableSavedNote')} {t('consumablesDesc')}</p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
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
  product_type: 'stocked' | 'service'
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
    product_type:         (p.product_type ?? 'stocked') as 'stocked' | 'service',
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
  allProducts,
  onSaved,
  onCancel,
}: {
  product: ProductRead
  allProducts: ProductRead[]
  onSaved: () => void
  onCancel: () => void
}) {
  const { t } = useLanguage()
  const [form, setForm]     = useState<EditForm>(productToEditForm(product))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const isService = form.product_type === 'service'

  function set(key: keyof EditForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    const unit = form.unit.trim()
    if (!name) { setError(t('productNameRequired')); return }
    if (!unit) { setError(t('productUnitRequired')); return }

    const lead_time_days = isService ? 0 : parseInt(form.lead_time_days)
    if (!isService && (isNaN(lead_time_days) || lead_time_days < 1)) {
      setError(t('productLeadTimeMin')); return
    }

    setSaving(true)
    setError(null)
    try {
      const shelf = isService || form.shelf_life_days.trim() === '' ? null : parseInt(form.shelf_life_days)
      await productsApi.update(product.id, {
        name, unit, product_type: form.product_type, unit_mode: form.unit_mode, lead_time_days,
        price:                parseOptionalNumber(form.price),
        current_stock:        isService ? null : parseOptionalNumber(form.current_stock),
        storage_capacity:     isService ? null : parseOptionalNumber(form.storage_capacity),
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
        {!isService && (
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
        )}

        {/* Product type */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t('productTypeLabel')}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            {(['stocked', 'service'] as const).map(pt => (
              <label
                key={pt}
                className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border text-xs transition-colors
                  ${form.product_type === pt
                    ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'
                    : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-300'}`}
              >
                <input
                  type="radio"
                  name={`product_type_edit_${product.id}`}
                  value={pt}
                  checked={form.product_type === pt}
                  onChange={() => set('product_type', pt)}
                  className="accent-teal-600"
                />
                {pt === 'stocked' ? t('stockedGoodLabel') : t('serviceProductLabel')}
              </label>
            ))}
          </div>
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

        {/* Stock/capacity/shelf life — only for physical goods */}
        {!isService && (
          <>
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
          </>
        )}

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {t('minutesToServe')}
          </label>
          <input
            type="number"
            min="0.1"
            step="any"
            placeholder={t('productServicePlaceholder')}
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
        <p className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
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

      {/* Consumables section — only for services, and only when editing (we have the product ID) */}
      {isService && (
        <ConsumablesSection serviceId={product.id} allProducts={allProducts} />
      )}
    </form>
  )
}

// ── product row ───────────────────────────────────────────────────────────────

function ProductRow({
  product,
  allProducts,
  onChanged,
  onToggleFavorite,
}: {
  product: ProductRead
  allProducts: ProductRead[]
  onChanged: () => void
  onToggleFavorite: () => void
}) {
  const { t } = useLanguage()
  const [editing, setEditing]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [deleteErr, setDeleteErr]   = useState<string | null>(null)

  const isService = (product.product_type ?? 'stocked') === 'service'

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
          allProducts={allProducts}
          onSaved={() => { setEditing(false); onChanged() }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {product.is_favorite && <span className="text-amber-400 mr-1">★</span>}
            {product.name}
          </p>
          {isService && (
            <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full
                             bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
              {t('serviceTypeBadge')}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span>{t('soldInDisplay')}: <strong className="text-slate-700 dark:text-slate-200">{product.unit}</strong></span>
          <span className="text-slate-400 dark:text-slate-500">{product.unit_mode === 'decimal' ? t('decimalLabel') : t('wholeUnitsLabel')}</span>
          {!isService && (
            <span>{t('restockTime')}: <strong className="text-slate-700 dark:text-slate-200">{product.lead_time_days}d</strong></span>
          )}
          {product.price != null && (
            <span>{t('priceLbl')}: <strong className="text-slate-700 dark:text-slate-200">{product.price}</strong></span>
          )}
          {!isService && product.current_stock != null && (
            <span>{t('inStock')}: <strong className="text-slate-700 dark:text-slate-200">{product.current_stock} {product.unit}</strong></span>
          )}
          {!isService && product.storage_capacity != null && (
            <span>{t('maxStorage')}: <strong className="text-slate-700 dark:text-slate-200">{product.storage_capacity}</strong></span>
          )}
          {!isService && product.shelf_life_days != null && (
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
      <div className="flex gap-2 shrink-0 pt-0.5 items-center">
        <StarButton isFavorite={product.is_favorite} onToggle={onToggleFavorite} />
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

function StarButton({ isFavorite, onToggle }: { isFavorite: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      onClick={onToggle}
      title={isFavorite ? t('unfavoriteLabel') : t('favoriteLabel')}
      className={`text-lg leading-none transition-colors ${isFavorite ? 'text-amber-400 hover:text-amber-500' : 'text-slate-300 dark:text-slate-600 hover:text-amber-300'}`}
    >
      ★
    </button>
  )
}

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

  async function toggleFavorite(p: ProductRead) {
    try {
      await productsApi.update(p.id, { is_favorite: !p.is_favorite })
      load()
    } catch { /* ignore */ }
  }

  useEffect(() => { load() }, [])

  // Sort: favorites first, then alphabetically
  const sorted = [...productList].sort((a, b) => {
    if (a.is_favorite === b.is_favorite) return a.name.localeCompare(b.name)
    return a.is_favorite ? -1 : 1
  })

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
      {sorted.length > 0 ? (
        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-100 dark:border-slate-700 px-6 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
            {t('yourProducts')}
            <span className="ml-2 text-sm font-normal text-slate-400">({sorted.length})</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            {t('tapEditRemove')}
          </p>
          <div>
            {sorted.map(p => (
              <ProductRow
                key={p.id}
                product={p}
                allProducts={productList}
                onChanged={load}
                onToggleFavorite={() => toggleFavorite(p)}
              />
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
