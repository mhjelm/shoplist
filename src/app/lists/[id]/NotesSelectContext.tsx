'use client'

import { createContext, useContext, useState } from 'react'

// Shares "scrap select mode" between the header ⋯ menu (which turns it on) and
// NoteList (which renders the checkboxes / copy footer and turns it off). Both
// live in separate subtrees under the notes branch of page.tsx, so a tiny
// context is the simplest bridge — mirrors EditModeContext for shopping lists.
type NotesSelectValue = {
  selecting: boolean
  setSelecting: (next: boolean) => void
}

const NotesSelectContext = createContext<NotesSelectValue>({ selecting: false, setSelecting: () => {} })

export function NotesSelectProvider({ children }: { children: React.ReactNode }) {
  const [selecting, setSelecting] = useState(false)
  return (
    <NotesSelectContext.Provider value={{ selecting, setSelecting }}>
      {children}
    </NotesSelectContext.Provider>
  )
}

export function useNotesSelect(): NotesSelectValue {
  return useContext(NotesSelectContext)
}
