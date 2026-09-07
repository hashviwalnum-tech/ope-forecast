import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import * as api from '../api/client'
import type { BusinessRead } from '../api/types'

interface BusinessContextValue {
  business: BusinessRead | null
  loading: boolean
  error: string | null
  noBusiness: boolean
  reload: () => Promise<void>
  setBusiness: (biz: BusinessRead) => void
}

const BusinessContext = createContext<BusinessContextValue>({
  business: null,
  loading: true,
  error: null,
  noBusiness: false,
  reload: async () => {},
  setBusiness: () => {},
})

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState<BusinessRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noBusiness, setNoBusiness] = useState(false)

  const setBusinessAndId = (biz: BusinessRead) => {
    api.setActiveBusinessId(biz.id)
    setBusiness(biz)
    setNoBusiness(false)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    setNoBusiness(false)
    try {
      const list = await api.businesses.list()
      if (list.length === 0) {
        setNoBusiness(true)
        return
      }
      const biz = list[0]
      api.setActiveBusinessId(biz.id)
      setBusiness(biz)

      // A business with no timezone makes the backend fall back to UTC for
      // every "today" and entry-timing check — which, east of London, rejects
      // the evening's numbers as "you're still open" and buckets a post-midnight
      // tap onto the wrong day. Businesses created on the web never had a zone
      // set; on a phone the device zone is the right answer, so adopt it once.
      if (!(biz.settings as Record<string, unknown> | undefined)?.timezone) {
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
          if (tz) {
            const updated = await api.businesses.updateSettings({ timezone: tz })
            setBusiness(updated)
          }
        } catch { /* non-blocking — correctable in Settings */ }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load business.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <BusinessContext.Provider value={{ business, loading, error, noBusiness, reload: load, setBusiness: setBusinessAndId }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useBusiness() {
  return useContext(BusinessContext)
}
