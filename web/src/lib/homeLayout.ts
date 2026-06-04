// Shared utility for the home card layout — avoids circular deps between
// HomeScreen and other components that offer "Add to home."

export type CardId = 'ordering' | 'forecast' | 'week' | 'hours' | 'accuracy' | 'trends'

const STORAGE_KEY = 'ope_home_layout_v2'

export function addCardToHome(id: CardId): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved: { id: CardId; label: string; visible: boolean }[] = JSON.parse(raw)
    const updated = saved.map(c => c.id === id ? { ...c, visible: true } : c)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
}
