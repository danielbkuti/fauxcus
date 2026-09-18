import { apiFetch } from './api'

// GET /api/tasks/ (and /api/subtasks/) are paginated server-side
// (PAGE_SIZE=10). The app has no "page 2" concept anywhere in its UI —
// /tasks shows one continuous list split into Active/Completed
// sections, the dashboard just wants a preview slice, and the calendar
// wants everything due in a range — so rather than bolt on
// page-number controls, this walks every page and hands callers the
// full combined result set for whatever `path` (with whatever query
// string) they started from. `next` comes back as an absolute URL
// (DRF's PageNumberPagination builds it from the request); strip the
// origin so it can be replayed through apiFetch, which prepends
// API_BASE_URL itself.
// Exported so lib/calendarItems.js (a separate resource, but the same
// "walk every page, no page-number UI anywhere" need) can reuse this
// instead of a second copy of the same loop.
export async function fetchAllPages(path) {
  let results = []
  let count = 0

  while (path) {
    const data = await apiFetch(path)
    results = results.concat(data.results)
    count = data.count
    path = data.next ? data.next.replace(/^https?:\/\/[^/]+/, '') : null
  }

  return { results, count }
}

export function fetchTasks() {
  return fetchAllPages('/api/tasks/')
}

// Powers the calendar view — everything with a deadline in [start, end]
// (inclusive), tasks and subtasks separately since they're separate API
// resources. `start`/`end` must already be UTC ISO strings; dateDeadline
// is stored in UTC, and "which calendar day is this due on" is a
// local-timezone question, so the caller (not this function, and not
// the backend — see backend/tasks/api/views.py's own comment on why)
// is responsible for turning the viewer's local day/month boundaries
// into the UTC instants passed in here.
export function fetchTasksDueBetween(start, end) {
  const params = new URLSearchParams({ dateDeadline__gte: start, dateDeadline__lte: end })
  return fetchAllPages(`/api/tasks/?${params}`)
}

export function fetchSubtasksDueBetween(start, end) {
  const params = new URLSearchParams({ dateDeadline__gte: start, dateDeadline__lte: end })
  return fetchAllPages(`/api/subtasks/?${params}`)
}

export function createTask({ name, description, dateDeadline, status = 'pending', completed = false }) {
  return apiFetch('/api/tasks/', {
    method: 'POST',
    // description/dateDeadline land as `undefined` when the caller
    // doesn't pass them (e.g. the FAB's quick options) — JSON.stringify
    // drops undefined keys entirely, so the request just omits them
    // rather than sending an explicit null.
    body: { name, description, dateDeadline, status, completed },
  })
}

export function updateTask(id, updates) {
  return apiFetch(`/api/tasks/${id}/`, {
    method: 'PATCH',
    body: updates,
  })
}

export function deleteTask(id) {
  return apiFetch(`/api/tasks/${id}/`, { method: 'DELETE' })
}

// Used to pull a single task back down after a subtask mutation —
// creating/completing a subtask can flip the parent's own `completed`
// field server-side (Task.update_completion_status), so re-fetching the
// task is simpler and more correct than re-deriving that logic here.
export function fetchTask(id) {
  return apiFetch(`/api/tasks/${id}/`)
}

export function createSubTask({ task, name, dateDeadline }) {
  return apiFetch('/api/subtasks/', {
    method: 'POST',
    // `dateDeadline` lands as `undefined` when the caller doesn't pass
    // one (most creation flows don't) — JSON.stringify drops undefined
    // keys, so the request just omits it rather than sending an
    // explicit null.
    body: { task, name, dateDeadline },
  })
}

export function updateSubTask(id, updates) {
  return apiFetch(`/api/subtasks/${id}/`, {
    method: 'PATCH',
    body: updates,
  })
}

export function deleteSubTask(id) {
  return apiFetch(`/api/subtasks/${id}/`, { method: 'DELETE' })
}
