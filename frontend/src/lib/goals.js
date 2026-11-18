import { apiFetch } from './api'
import { fetchAllPages } from './tasks'

export function fetchGoals() {
  return fetchAllPages('/api/goals/')
}

export function fetchGoal(id) {
  return apiFetch(`/api/goals/${id}/`)
}

export function createGoal({ name, description, targetDate }) {
  return apiFetch('/api/goals/', {
    method: 'POST',
    // undefined keys are dropped by JSON.stringify, so an unset
    // description/targetDate is simply omitted rather than sent as null.
    body: { name, description, targetDate },
  })
}

export function updateGoal(id, updates) {
  return apiFetch(`/api/goals/${id}/`, { method: 'PATCH', body: updates })
}

export function deleteGoal(id) {
  return apiFetch(`/api/goals/${id}/`, { method: 'DELETE' })
}

// ---------------------------------------------------------------- dates
//
// A goal's targetDate is a plain 'YYYY-MM-DD' calendar date (see
// backend Goal's own docstring), not an instant. `new Date('2026-03-01')`
// parses that as *UTC* midnight, which in any timezone west of UTC is
// still February 28 — so every conversion below builds the Date from its
// parts (local midnight) instead, and formats from local getters.

export function parseTargetDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// Date -> 'YYYY-MM-DD' in local time (the inverse of the above).
export function toDateInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatTargetDate(value) {
  const date = parseTargetDate(value)
  if (!date) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const DAY_MS = 24 * 60 * 60 * 1000

// Whole calendar days from `now`'s local today to the target date —
// negative once it has passed. Both sides are local midnights, so a DST
// change between them can't skew the rounding.
export function daysUntil(value, now = new Date()) {
  const target = parseTargetDate(value)
  if (!target) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / DAY_MS)
}

// "Today", "Tomorrow", "in 12 days", "in 3 months", "5 days ago" — the
// coarse, human way a long-term goal's deadline is actually talked
// about, so the exact date sits beside it rather than being the only
// thing shown.
export function describeTimeLeft(value, now = new Date()) {
  const days = daysUntil(value, now)
  if (days === null) return null
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${plural(-days, 'day')} ago`
  if (days < 60) return `in ${plural(days, 'day')}`
  if (days < 365) return `in ${plural(Math.round(days / 30), 'month')}`
  const years = Math.round((days / 365) * 2) / 2
  return `in ${years} ${years === 1 ? 'year' : 'years'}`
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

// Quick timeline choices for the goal form — "in 2 months" is how
// people actually phrase a goal's timeline, not as a calendar date.
export const TIMELINE_PRESETS = [
  { label: '1 month', months: 1 },
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
]

// `months` from today, clamped to the month's last day when it doesn't
// exist there (Jan 31 + 1 month is Feb 28/29, not Mar 3).
export function addMonths(months, now = new Date()) {
  const result = new Date(now.getFullYear(), now.getMonth() + months, 1)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(now.getDate(), lastDay))
  return result
}

// Soonest target first; goals with no target date go last (they have no
// urgency to rank by), newest first among themselves.
export function sortActiveGoals(goals) {
  return [...goals].sort((a, b) => {
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate)
    if (a.targetDate) return -1
    if (b.targetDate) return 1
    return new Date(b.dateCreated) - new Date(a.dateCreated)
  })
}

// Progress from a goal's own tasks. The detail page derives progress
// from the shared task store (the live copy, which updates as tasks are
// completed elsewhere) instead of the possibly-stale numbers the goals
// API returned; same rule as the backend's: 0 for no tasks.
export function computeGoalProgress(tasks) {
  const total = tasks.length
  const done = tasks.filter((t) => t.completed).length
  return { total, done, percent: total ? Math.round((100 * done) / total) : 0 }
}
