import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import * as api from '../api/client'
import type { BusinessRead } from '../api/types'

interface BusinessContextValue {
  business: BusinessRead | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

const BusinessContext = createContext<BusinessContextValue>({
  business: null,
  loading: true,
  error: null,
  reload: async () => {},
})

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState<BusinessRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.businesses.list()
      if (list.length === 0) {
        setError('No business found. Set up your business on the web app first.')
        return
      }
      const biz = list[0]
      api.setActiveBusinessId(biz.id)
      setBusiness(biz)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load business.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <BusinessContext.Provider value={{ business, loading, error, reload: load }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useBusiness() {
  return useContext(BusinessContext)
}
