import { apiFetch } from './api'
import { fetchAllPages } from './tasks'

// A calendar item is time-anchored ("this happens at/between these
// times"), not deadline-anchored like a Task — no `completed`, no
// subtasks. See backend/tasks/models.py's CalendarItem docstring for
// the full reasoning. Kept as its own small API module rather than
// folded into lib/tasks.js since it's a genuinely separate resource
// with a different shape, even though the calendar page consumes both
// side by side.

// Same range-fetch shape as fetchTasksDueBetween/fetchSubtasksDueBetween
// — `start`/`end` must already be UTC ISO strings; the caller (not this
// function) is responsible for turning the viewer's local day/month
// boundaries into them. See lib/tasks.js's own comment for why.
export function fetchCalendarItemsDueBetween(start, end) {
  const params = new URLSearchParams({ dateStart__gte: start, dateStart__lte: end })
  return fetchAllPages(`/api/calendar-items/?${params}`)
}

export function createCalendarItem({ name, dateStart, dateEnd, location }) {
  return apiFetch('/api/calendar-items/', {
    method: 'POST',
    // dateEnd/location land as `undefined` when the caller doesn't pass
    // them (both are optional) — JSON.stringify drops undefined keys,
    // so the request just omits them rather than sending an explicit
    // null.
    body: { name, dateStart, dateEnd, location },
  })
}

export function deleteCalendarItem(id) {
  return apiFetch(`/api/calendar-items/${id}/`, { method: 'DELETE' })
}
