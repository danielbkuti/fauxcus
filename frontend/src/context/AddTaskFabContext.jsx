import { createContext, useContext, useState } from 'react'

const AddTaskFabContext = createContext(null)

// Lets a routed page (e.g. CalendarPage's empty-day state) open the
// global AddTaskFab menu on demand, not just the FAB button itself.
// AddTaskFab is rendered once in AuthenticatedLayout, a sibling of
// <Outlet /> rather than a parent of it — a page has no direct way to
// reach a sibling's local state, so that "is the menu open" boolean
// lives here instead, one level up, same shared-state shape
// TaskStoreContext already uses for the same kind of problem (a page
// needing to act on state a shell component owns).
//
// `prefillDate` ('YYYY-MM-DD' | null) rides alongside `open` for the
// same reason: CalendarPage knows which day was clicked, but the FAB's
// "Add a new task" option is what actually navigates to /tasks/new —
// it needs that date at the moment it's clicked, not just at the
// moment the menu opened, so it lives here rather than being passed
// as a one-shot argument to setOpen.
export function AddTaskFabProvider({ children }) {
  const [open, setOpen] = useState(false)
  const [prefillDate, setPrefillDate] = useState(null)
  return (
    <AddTaskFabContext.Provider value={{ open, setOpen, prefillDate, setPrefillDate }}>
      {children}
    </AddTaskFabContext.Provider>
  )
}

export function useAddTaskFab() {
  const ctx = useContext(AddTaskFabContext)
  if (!ctx) {
    throw new Error('useAddTaskFab must be used within an AddTaskFabProvider')
  }
  return ctx
}
