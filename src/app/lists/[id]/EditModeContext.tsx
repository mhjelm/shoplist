'use client'

import { createContext, useContext, useState } from 'react'

type EditModeContextValue = [boolean, (next: boolean) => void]

const EditModeContext = createContext<EditModeContextValue>([false, () => {}])

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false)
  return <EditModeContext.Provider value={[active, setActive]}>{children}</EditModeContext.Provider>
}

export function useEditMode(): EditModeContextValue {
  return useContext(EditModeContext)
}

export function EditModeToggle() {
  const [active, setActive] = useEditMode()
  return (
    <button
      onClick={() => setActive(!active)}
      className={`text-sm px-3 py-1 rounded-lg transition-colors ${
        active
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
          : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
      }`}
    >
      {active ? 'Klar' : 'Redigera'}
    </button>
  )
}
