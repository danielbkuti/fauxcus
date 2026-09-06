// Pure aggregation over the shared task store — every number here is
// derived client-side from the same `tasks` array TaskList/ProgressPage
// already have (each task carries its own subtasks), rather than a
// dedicated backend endpoint. At personal-task-manager scale (one
// user, realistically low thousands of rows) that's plenty fast and
// keeps this in one place instead of a route + view + serializer for
// numbers that are cheap to fold over an array already in memory. If
// this ever needs to scale past that, the aggregation logic here is
// exactly what would move server-side into a /api/stats/ view running
// the equivalent Django `aggregate()`/`annotate()` queries, with the
// functions below becoming the spec for what that endpoint returns.

const DAY_MS = 24 * 60 * 60 * 1000

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Every completed task and every completed subtask, flattened into one
// list of {date: Date, taskLike} — the habit stats (streaks, best day,
// best time of day) care about "when did *something* get finished",
// not just top-level tasks.
function allCompletions(tasks) {
  const out = []
  for (const task of tasks) {
    if (task.completed && task.dateCompleted) out.push({ date: new Date(task.dateCompleted) })
    for (const sub of task.subtasks) {
      if (sub.completed && sub.dateCompleted) out.push({ date: new Date(sub.dateCompleted) })
    }
  }
  return out
}

function formatDuration(ms) {
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  const days = Math.floor(abs / DAY_MS)
  const hours = Math.floor((abs % DAY_MS) / (60 * 60 * 1000))
  if (days > 0) return `${sign}${days}d ${hours}h`
  const minutes = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000))
  if (hours > 0) return `${sign}${hours}h ${minutes}m`
  return `${sign}${minutes}m`
}

function formatPercent(n) {
  return `${Math.round(n)}%`
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIME_BUCKETS = [
  { label: 'Night (12–5am)', short: 'Night', test: (h) => h < 5 },
  { label: 'Morning (5–11am)', short: 'Morning', test: (h) => h >= 5 && h < 12 },
  { label: 'Afternoon (12–5pm)', short: 'Afternoon', test: (h) => h >= 12 && h < 17 },
  { label: 'Evening (5–9pm)', short: 'Evening', test: (h) => h >= 17 && h < 21 },
  { label: 'Late night (9pm–12am)', short: 'Late night', test: (h) => h >= 21 },
]

function computeStreaks(completions) {
  const dayKeys = new Set(completions.map((c) => localDateKey(c.date)))
  if (dayKeys.size === 0) return { currentStreak: 0, longestStreak: 0 }

  const today = startOfDay(new Date())
  const yesterday = new Date(today.getTime() - DAY_MS)

  let currentStreak = 0
  let cursor = null
  if (dayKeys.has(localDateKey(today))) cursor = today
  else if (dayKeys.has(localDateKey(yesterday))) cursor = yesterday

  while (cursor && dayKeys.has(localDateKey(cursor))) {
    currentStreak += 1
    cursor = new Date(cursor.getTime() - DAY_MS)
  }

  const sortedDays = [...dayKeys].sort()
  let longestStreak = 0
  let run = 0
  let prevTime = null
  for (const key of sortedDays) {
    const t = new Date(key).getTime()
    run = prevTime !== null && t - prevTime === DAY_MS ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    prevTime = t
  }

  return { currentStreak, longestStreak }
}

// Returns both the single "best" (for the plain-text stat row) and the
// full 7-bucket distribution (for the bar chart) — one pass over
// `completions` instead of computing the breakdown twice.
function computeBestDay(completions) {
  const counts = new Array(7).fill(0)
  for (const c of completions) counts[c.date.getDay()] += 1
  const distribution = counts.map((count, i) => ({ label: WEEKDAY_SHORT[i], count }))
  if (completions.length === 0) return { best: null, distribution }
  const bestIndex = counts.reduce((bi, c, i) => (c > counts[bi] ? i : bi), 0)
  if (counts[bestIndex] === 0) return { best: null, distribution }
  return { best: { day: WEEKDAY_LABELS[bestIndex], count: counts[bestIndex] }, distribution }
}

function computeBestTimeOfDay(completions) {
  const counts = TIME_BUCKETS.map(() => 0)
  for (const c of completions) {
    const hour = c.date.getHours()
    const idx = TIME_BUCKETS.findIndex((b) => b.test(hour))
    counts[idx] += 1
  }
  const distribution = counts.map((count, i) => ({ label: TIME_BUCKETS[i].short, count }))
  if (completions.length === 0) return { best: null, distribution }
  const bestIndex = counts.reduce((bi, c, i) => (c > counts[bi] ? i : bi), 0)
  if (counts[bestIndex] === 0) return { best: null, distribution }
  return { best: { label: TIME_BUCKETS[bestIndex].label, count: counts[bestIndex] }, distribution }
}

// Daily completion counts for the last `days` calendar days (today
// inclusive), oldest first — backs the GitHub-style activity heatmap.
// Deliberately walks calendar days rather than just the sparse
// `dayKeys` a streak needs, so empty days render as real zero-count
// cells instead of being skipped.
function computeDailyActivity(completions, days = 84) {
  const countByDay = new Map()
  for (const c of completions) {
    const key = localDateKey(c.date)
    countByDay.set(key, (countByDay.get(key) ?? 0) + 1)
  }

  const today = startOfDay(new Date())
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * DAY_MS)
    const key = localDateKey(date)
    out.push({ date, count: countByDay.get(key) ?? 0 })
  }
  return out
}

// Monday-start weeks, oldest to newest, `weekCount` of them ending on
// the current week — each bucket counts tasks *created* and tasks
// *completed* within that week (top-level tasks only; subtasks don't
// have their own "created vs completed" narrative worth a weekly row).
function computeWeeklyActivity(tasks, weekCount = 4) {
  const today = startOfDay(new Date())
  const dayOfWeek = (today.getDay() + 6) % 7 // 0 = Monday
  const thisWeekStart = new Date(today.getTime() - dayOfWeek * DAY_MS)

  const weeks = []
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = new Date(thisWeekStart.getTime() - i * 7 * DAY_MS)
    const end = new Date(start.getTime() + 7 * DAY_MS)
    weeks.push({ start, end, created: 0, completed: 0 })
  }

  for (const task of tasks) {
    const created = new Date(task.dateCreated)
    const completedAt = task.completed && task.dateCompleted ? new Date(task.dateCompleted) : null
    for (const w of weeks) {
      if (created >= w.start && created < w.end) w.created += 1
      if (completedAt && completedAt >= w.start && completedAt < w.end) w.completed += 1
    }
  }

  return weeks.map((w) => ({
    label: w.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    created: w.created,
    completed: w.completed,
  }))
}

export function computeStats(tasks) {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((t) => t.completed)
  const openTasks = tasks.filter((t) => !t.completed)
  const overdueCount = openTasks.filter(
    (t) => t.dateDeadline && new Date(t.dateDeadline).getTime() < Date.now()
  ).length

  const allSubtasks = tasks.flatMap((t) => t.subtasks)
  const completedSubtasks = allSubtasks.filter((s) => s.completed)

  // Time to complete a task: dateCompleted - dateCreated, averaged over
  // every completed task that actually has both (always true once
  // completed, guarded anyway in case of odd data).
  const completionDurations = completedTasks
    .filter((t) => t.dateCreated && t.dateCompleted)
    .map((t) => new Date(t.dateCompleted) - new Date(t.dateCreated))
  const avgCompletionMs =
    completionDurations.length > 0
      ? completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length
      : null

  // Only tasks that had a deadline to be judged against. `leadMs` is
  // deadline - completedAt: positive means finished ahead of the
  // deadline, negative means finished after it (still "completed", by
  // definition, just late).
  const datedCompletions = completedTasks
    .filter((t) => t.dateDeadline && t.dateCompleted)
    .map((t) => new Date(t.dateDeadline) - new Date(t.dateCompleted))
  const onTimeRate =
    datedCompletions.length > 0
      ? (datedCompletions.filter((lead) => lead >= 0).length / datedCompletions.length) * 100
      : null
  const avgLeadMs =
    datedCompletions.length > 0 ? datedCompletions.reduce((a, b) => a + b, 0) / datedCompletions.length : null

  const now = Date.now()
  const completions = allCompletions(tasks)
  const last7 = completions.filter((c) => now - c.date.getTime() <= 7 * DAY_MS).length
  const last30 = completions.filter((c) => now - c.date.getTime() <= 30 * DAY_MS).length

  const { currentStreak, longestStreak } = computeStreaks(completions)

  return {
    overview: {
      totalTasks,
      completedCount: completedTasks.length,
      openCount: openTasks.length,
      completionRate: totalTasks > 0 ? (completedTasks.length / totalTasks) * 100 : 0,
      overdueCount,
      subtaskTotal: allSubtasks.length,
      subtaskCompleted: completedSubtasks.length,
      subtaskCompletionRate: allSubtasks.length > 0 ? (completedSubtasks.length / allSubtasks.length) * 100 : null,
    },
    timing: {
      avgCompletionMs,
      onTimeRate,
      avgLeadMs,
      datedCompletionCount: datedCompletions.length,
    },
    rolling: { last7, last30 },
    weekly: computeWeeklyActivity(tasks),
    habits: (() => {
      const day = computeBestDay(completions)
      const time = computeBestTimeOfDay(completions)
      return {
        currentStreak,
        longestStreak,
        bestDay: day.best,
        bestDayDistribution: day.distribution,
        bestTimeOfDay: time.best,
        bestTimeDistribution: time.distribution,
        dailyActivity: computeDailyActivity(completions),
      }
    })(),
  }
}

// The Progress page's 30/90/all-time toggle — the one windowed view
// onto this data (see design_handoff_progress_page/README.md). Kept as
// a separate function from computeStats rather than a `{ since }`
// param threaded through it: only three figures move with the period
// (completion rate, on-time rate, typical turnaround) while overview
// totals, streaks, distributions, weekly and dailyActivity all stay on
// the full history regardless of which pill is selected, so the two
// concerns don't need to share one signature.
//
// `windowDays` null means "all time" (no lower bound on `since`).
//
// The completion-rate denominator is *not* totalTasks — a 30-day
// window judged against every task ever created would read as
// artificially low and get lower still the longer the app's been used.
// Instead it's "of what had activity in this window" — tasks created
// in it, or completed in it (a task can be both, or neither, and still
// not count) — a currently-open task only counts against a period once
// something happens to it (created) *in* that period, not just because
// it happens to still be open today. That's what makes "all time"
// collapse to exactly totalTasks: with since = the beginning of time,
// every task was "created in it".
export function computePeriodStats(tasks, windowDays = null) {
  const sinceMs = windowDays == null ? -Infinity : Date.now() - windowDays * DAY_MS

  const completedInPeriod = tasks.filter(
    (t) => t.completed && t.dateCompleted && new Date(t.dateCompleted).getTime() >= sinceMs
  )
  const eligible = tasks.filter((t) => {
    const createdInPeriod = new Date(t.dateCreated).getTime() >= sinceMs
    const completedInIt = t.completed && t.dateCompleted && new Date(t.dateCompleted).getTime() >= sinceMs
    return createdInPeriod || completedInIt
  })

  const completionRate = eligible.length > 0 ? (completedInPeriod.length / eligible.length) * 100 : null

  const datedCompletions = completedInPeriod
    .filter((t) => t.dateDeadline && t.dateCompleted)
    .map((t) => new Date(t.dateDeadline) - new Date(t.dateCompleted))
  const onTimeRate =
    datedCompletions.length > 0
      ? (datedCompletions.filter((lead) => lead >= 0).length / datedCompletions.length) * 100
      : null
  const avgLeadMs =
    datedCompletions.length > 0 ? datedCompletions.reduce((a, b) => a + b, 0) / datedCompletions.length : null

  const completionDurations = completedInPeriod
    .filter((t) => t.dateCreated && t.dateCompleted)
    .map((t) => new Date(t.dateCompleted) - new Date(t.dateCreated))
  const avgCompletionMs =
    completionDurations.length > 0
      ? completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length
      : null

  return {
    completionRate,
    completedCount: completedInPeriod.length,
    eligibleCount: eligible.length,
    onTimeRate,
    datedCompletionCount: datedCompletions.length,
    avgLeadMs,
    avgCompletionMs,
  }
}

export { formatDuration, formatPercent }
