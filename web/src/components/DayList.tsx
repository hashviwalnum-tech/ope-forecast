import { useEffect, useState } from 'react'
import { dayRecords, products as productsApi, sales as salesApi } from '../api/client'
import type { DayRecordRead, ProductRead, SaleRead } from '../api/types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekdayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return WEEKDAYS[new Date(y, m - 1, d).getDay()]
}

interface Props { refreshKey: number }

export default function DayList({ refreshKey }: Props) {
  const [days, setDays]         = useState<DayRecordRead[]>([])
  const [allSales, setAllSales] = useState<SaleRead[]>([])
  const [productList, setProductList] = useState<ProductRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  // Edit state
  const [editId, setEditId]           = useState<number | null>(null)
  const [editCustomers, setEditCustomers] = useState('')
  const [editSales, setEditSales]     = useState<Record<number, string>>({})
  const [saving, setSaving]           = useState(false)
  const [editError, setEditError]     = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [d, s, p] = await Promise.all([
        dayRecords.list(),
        salesApi.list(),
        productsApi.list(),
      ])
      setDays([...d].reverse())   // most-recent first
      setAllSales(s)
      setProductList(p)
    } catch {
      setError('Failed to load data. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(day: DayRecordRead) {
    setEditId(day.id)
    setEditError(null)
    setEditCustomers(String(day.customers))
    const current: Record<number, string> = {}
    for (const s of allSales.filter(s => s.day_record_id === day.id)) {
      current[s.product_id] = String(s.units_sold)
    }
    setEditSales(current)
  }

  async function saveEdit(day: DayRecordRead) {
    setSaving(true)
    try {
      await dayRecords.update(day.id, { customers: parseInt(editCustomers) })

      for (const p of productList) {
        const val = parseFloat(editSales[p.id] ?? '')
        const existing = allSales.find(
          s => s.day_record_id === day.id && s.product_id === p.id
        )
        if (existing) {
          if (!isNaN(val) && val >= 0) {
            await salesApi.update(existing.id, { units_sold: val })
          }
        } else if (!isNaN(val) && val > 0) {
          await salesApi.create({ day_record_id: day.id, product_id: p.id, units_sold: val })
        }
      }

      setEditId(null)
      await load()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this day and its sales?')) return
    try {
      // Delete associated sales first (SQLite may not enforce FK cascade)
      for (const s of allSales.filter(s => s.day_record_id === id)) {
        await salesApi.delete(s.id)
      }
      await dayRecords.delete(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  if (loading) return <p className="text-teal-500 text-sm animate-pulse">Loading your days…</p>
  if (error)   return <p className="text-red-700 text-sm bg-red-50 rounded-xl p-3">{error}</p>
  if (!days.length) return (
    <div className="py-12 text-center">
      <div className="w-14 h-14 mb-4 mx-auto rounded-full bg-teal-50 flex items-center justify-center">
        <svg className="w-7 h-7 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="text-slate-500 text-sm max-w-xs mx-auto leading-relaxed">
        No days logged yet — and that's a fine place to start!
        Switch to <strong className="text-teal-600">Add Today</strong> to record your first day.
      </p>
    </div>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold
                         text-slate-500 uppercase tracking-wider">
            <th className="py-2 pr-4 whitespace-nowrap">Date</th>
            <th className="py-2 pr-4">Day</th>
            <th className="py-2 pr-4">Customers</th>
            {productList.map(p => (
              <th key={p.id} className="py-2 pr-4 whitespace-nowrap">
                {p.name} <span className="font-normal text-slate-400">({p.unit})</span>
              </th>
            ))}
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {days.map(day => {
            const daySales = allSales.filter(s => s.day_record_id === day.id)
            const isEditing = editId === day.id

            if (isEditing) {
              return (
                <tr key={day.id} className="border-b border-slate-100 bg-teal-50">
                  <td className="py-2 pr-4 text-slate-500 text-xs">{day.date}</td>
                  <td className="py-2 pr-4 text-slate-400">{weekdayLabel(day.date)}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="number" min="0"
                      value={editCustomers}
                      onChange={e => setEditCustomers(e.target.value)}
                      className="w-20 border border-slate-300 rounded px-2 py-0.5 text-sm"
                    />
                  </td>
                  {productList.map(p => (
                    <td key={p.id} className="py-2 pr-4">
                      <input
                        type="number" min="0" step="0.01"
                        value={editSales[p.id] ?? ''}
                        onChange={e => setEditSales(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-20 border border-slate-300 rounded px-2 py-0.5 text-sm"
                      />
                    </td>
                  ))}
                  <td className="py-2" colSpan={editError ? productList.length + 3 : 1}>
                    {editError ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200
                                      rounded-lg px-3 py-2 leading-relaxed max-w-xs">
                          {editError}
                        </p>
                        <button
                          onClick={() => { setEditId(null); setEditError(null) }}
                          className="text-xs text-slate-400 hover:underline text-left"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          onClick={() => saveEdit(day)} disabled={saving}
                          className="text-teal-600 hover:underline font-medium disabled:opacity-50"
                        >
                          {saving ? '…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditId(null); setEditError(null) }}
                          className="text-slate-400 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            }

            const isFlagged = day.outlier_status === 'flagged'
            return (
              <tr key={day.id}
                className={`border-b border-slate-100 group ${
                  isFlagged ? 'bg-amber-50/60' : 'hover:bg-slate-50'
                }`}
              >
                <td className="py-2 pr-4 text-slate-500 text-xs whitespace-nowrap">
                  {day.date}
                  {isFlagged && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                      unusual
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-slate-400">{weekdayLabel(day.date)}</td>
                <td className="py-2 pr-4 font-semibold text-slate-800">{day.customers}</td>
                {productList.map(p => {
                  const sale = daySales.find(s => s.product_id === p.id)
                  return (
                    <td key={p.id} className="py-2 pr-4 text-slate-600">
                      {sale != null ? sale.units_sold : <span className="text-slate-300">—</span>}
                    </td>
                  )
                })}
                <td className="py-2">
                  <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(day)}
                      className="text-teal-500 hover:text-teal-700 text-xs font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(day.id)}
                      className="text-slate-300 hover:text-red-500 text-xs"
                      aria-label="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 mt-3">{days.length} days total</p>
    </div>
  )
}
