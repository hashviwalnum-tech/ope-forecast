// Shared utility for the home card layout — avoids circular deps between
// HomeScreen and other components that offer "Add to home."

export type CardId = 'ordering' | 'forecast' | 'hours' | 'accuracy' | 'trends'

export interface CardDef {
  id: CardId
  labelKey: string
  visible: boolean
}

export const ALL_CARD_DEFS: CardDef[] = [
  { id: 'ordering',  labelKey: 'cardOrdering',  visible: true  },
  { id: 'forecast',  labelKey: 'cardForecast',  visible: true  },
  { id: 'hours',     labelKey: 'cardHours',     visible: true  },
  { id: 'accuracy',  labelKey: 'cardAccuracy',  visible: false },
  { id: 'trends',    labelKey: 'cardTrends',    visible: false },
]

const STORAGE_KEY = 'ope_home_layout_v3'

export function isCardOnHome(id: CardId): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return ALL_CARD_DEFS.find(c => c.id === id)?.visible ?? false
    }
    const saved: CardDef[] = JSON.parse(raw)
    const entry = saved.find(c => c.id === id)
    if (!entry) return ALL_CARD_DEFS.find(c => c.id === id)?.visible ?? false
    return entry.visible
  } catch { return false }
}

export function addCardToHome(id: CardId): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved: CardDef[] = JSON.parse(raw)
    const updated = saved.map(c => c.id === id ? { ...c, visible: true } : c)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
}

export function removeCardFromHome(id: CardId): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved: CardDef[] = JSON.parse(raw)
    const updated = saved.map(c => c.id === id ? { ...c, visible: false } : c)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
}
