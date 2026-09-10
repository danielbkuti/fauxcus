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
export function AddTaskFabProvider({ children }) {
  const [open, setOpen] = useState(false)
  return <AddTaskFabContext.Provider value={{ open, setOpen }}>{children}</AddTaskFabContext.Provider>
}

export function useAddTaskFab() {
  const ctx = useContext(AddTaskFabContext)
  if (!ctx) {
    throw new Error('useAddTaskFab must be used within an AddTaskFabProvider')
  }
  return ctx
}
