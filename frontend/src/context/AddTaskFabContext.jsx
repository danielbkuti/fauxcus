import { createContext, useCallback, useContext, useState } from 'react'

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
  // Calendar items aren't part of the shared TaskStoreContext (they're
  // a separate resource — see lib/calendarItems.js), and CalendarPage
  // fetches its own range independently, so there's no automatic path
  // from "the FAB just created one" to "the calendar page's already-
  // fetched data includes it". This counter is that path: the FAB bumps
  // it after a successful create, CalendarPage's own fetch effect
  // depends on it too, so a create while already on the calendar page
  // triggers a real refetch of whatever range is on screen instead of
  // the new item only showing up after a manual reload. Living here
  // rather than a dedicated context is a bit of a stretch — this
  // provider's actual job is "is the FAB menu open" — but it's already
  // the one thing both the FAB and CalendarPage share, so reusing it
  // beats adding a third provider to the tree for a single counter.
  const [calendarItemsVersion, setCalendarItemsVersion] = useState(0)
  const bumpCalendarItemsVersion = useCallback(() => setCalendarItemsVersion((v) => v + 1), [])
  return (
    <AddTaskFabContext.Provider
      value={{ open, setOpen, prefillDate, setPrefillDate, calendarItemsVersion, bumpCalendarItemsVersion }}
    >
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
