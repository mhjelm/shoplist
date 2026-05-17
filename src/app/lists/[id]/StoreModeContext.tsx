'use client'

import { createContext, useContext, useState } from 'react'

type StoreModeContextValue = [boolean, (next: boolean) => void]

const StoreModeContext = createContext<StoreModeContextValue>([false, () => {}])

export function StoreModeProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false)
  return <StoreModeContext.Provider value={[active, setActive]}>{children}</StoreModeContext.Provider>
}

export function useStoreMode(): StoreModeContextValue {
  return useContext(StoreModeContext)
}
