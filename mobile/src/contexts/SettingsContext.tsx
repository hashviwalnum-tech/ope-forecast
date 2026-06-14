import { createContext, useContext, useState } from 'react'

interface SettingsContextValue {
  openSettings: () => void
  settingsOpen: boolean
  closeSettings: () => void
}

const SettingsContext = createContext<SettingsContextValue>({
  openSettings: () => {},
  settingsOpen: false,
  closeSettings: () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <SettingsContext.Provider
      value={{
        openSettings: () => setSettingsOpen(true),
        settingsOpen,
        closeSettings: () => setSettingsOpen(false),
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettingsSheet() {
  return useContext(SettingsContext)
}
