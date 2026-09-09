import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchSubtasksDueBetween, fetchTasksDueBetween } from '@/lib/tasks'
import { cn, formatDeadline } from '@/lib/utils'
import { useDeadlineStatus } from '@/hooks/useDeadlineStatus'
import { useTaskStore } from '@/context/TaskStoreContext'

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

// A plain YYYY-MM-DD string in the *viewer's* local time zone — the
// same instant parsed from a UTC deadline lands on the right key here
// regardless of where in the world this is opened, since Date's plain
// (non-UTC) getters already report local values. Used both to bucket
// fetched items by day and to key/compare grid cells, so "today",
// "selected", and "has items due" all agree on what day something
// actually falls on.
function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Builds the 6-row, Monday-first grid for the month containing
// `anchor` — including the leading/trailing days from the adjacent
// months needed to fill the first and last week, same as any standard
// calendar UI. Always 42 cells (6*7) so the grid's height never jumps
// between months.
function buildMonthGrid(anchor) {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7 // Mon=0 ... Sun=6
  const gridStart = addDays(firstOfMonth, -firstWeekday)
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i)
    return { date, key: localDayKey(date), inMonth: date.getMonth() === anchor.getMonth() }
  })
}

// Flattens a page of tasks + a page of subtasks (each already
// filtered server-side to the visible range) into one list of
// {kind, id, taskId, name, dateDeadline, completed, parentName} items,
// same shape Dashboard's own Upcoming list uses — a subtask's own
// deadline counts as a due-date here in its own right, same convention
// as the overdue gate and the task list's due-date sort.
//
// `taskNameById` resolves a subtask's parent name — deliberately NOT
// looked up in the `tasks` array this function also receives: that
// array is filtered to tasks whose *own* deadline falls in the visible
// range, which routinely excludes a due subtask's parent (a different
// deadline, or none at all). taskNameById instead comes from the
// already-fully-loaded TaskStoreContext, so every parent resolves
// regardless of the parent's own deadline.
function flattenItems(tasks, subtasks, taskNameById) {
  const items = []
  for (const task of tasks) {
    if (task.dateDeadline) {
      items.push({
        kind: 'task',
        id: task.id,
        taskId: task.id,
        name: task.name,
        dateDeadline: task.dateDeadline,
        completed: task.completed,
      })
    }
  }
  for (const subtask of subtasks) {
    items.push({
      kind: 'subtask',
      id: subtask.id,
      taskId: subtask.task,
      name: subtask.name,
      dateDeadline: subtask.dateDeadline,
      completed: subtask.completed,
      parentName: taskNameById.get(subtask.task),
    })
  }
  return items
}

// Groups flattened items by local day key, and separately records
// which days have an overdue (incomplete, past-due) item — the two
// pieces of information each grid cell's dot needs.
function groupByDay(items) {
  const byDay = new Map()
  for (const item of items) {
    const key = localDayKey(new Date(item.dateDeadline))
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(item)
  }
  for (const dayItems of byDay.values()) {
    dayItems.sort((a, b) => new Date(a.dateDeadline) - new Date(b.dateDeadline))
  }
  return byDay
}

// Same red/purple/green state-color language TaskCard/UpcomingRow
// already use for overdue/on-track/done — a day's dot reflects the
// most urgent thing due that day: any overdue item wins, otherwise any
// incomplete item, otherwise (everything that day is done) green.
function dayDotClass(dayItems, now) {
  if (!dayItems || dayItems.length === 0) return null
  const hasOverdue = dayItems.some((i) => !i.completed && new Date(i.dateDeadline) < now)
  if (hasOverdue) return 'bg-red-600'
  const hasIncomplete = dayItems.some((i) => !i.completed)
  if (hasIncomplete) return 'bg-[#7c5fb0]'
  return 'bg-emerald-500'
}

function DueItemRow({ item }) {
  const navigate = useNavigate()
  const { isOverdue, isUrgent, countdownDisplay } = useDeadlineStatus(item.dateDeadline, item.completed)

  return (
    // Same "whole row navigates" convention as UpcomingRow/TaskCard —
    // read-only here (no checkbox, no delete): the calendar is a
    // find-it-then-go-there view, not another place to mutate a task
    // from. Clicking always opens the *task's* detail page, including
    // for a subtask row — subtasks don't have a page of their own.
    <div
      onClick={() => navigate(`/tasks/${item.taskId}`)}
      className="relative flex cursor-pointer items-center gap-3 rounded-[14px] bg-card px-4 py-3 text-sm ring-1 ring-foreground/10 transition-colors hover:bg-accent/50"
    >
      <span aria-hidden="true" className="task-ring" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-sm font-medium transition-colors',
            item.completed && 'text-muted-foreground line-through'
          )}
        >
          {item.name}
        </span>
        {item.kind === 'subtask' && item.parentName && (
          <span className="truncate text-xs text-muted-foreground">Part of {item.parentName}</span>
        )}
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap tabular-nums',
          item.completed
            ? 'bg-emerald-50 text-emerald-700'
            : isOverdue
              ? 'bg-red-700 text-white'
              : isUrgent
                ? 'bg-red-50 text-red-700'
                : 'bg-[#f3e8ff] text-[#6b46a8]'
        )}
      >
        {item.completed ? 'Done' : isOverdue ? 'Overdue' : isUrgent ? `Due in: ${countdownDisplay}` : formatDeadline(item.dateDeadline)}
      </span>
    </div>
  )
}

export function CalendarPage() {
  const { tasks } = useTaskStore()
  const taskNameById = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks])

  const now = useMemo(() => new Date(), [])
  const [anchorMonth, setAnchorMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedKey, setSelectedKey] = useState(() => localDayKey(now))
  // Raw fetch results, not the grouped-by-day form — grouping also
  // needs taskNameById (a subtask's parent name), which changes
  // independently of anchorMonth (any task mutation anywhere in the
  // app updates the shared store). Keeping the two separate means a
  // store update re-groups the already-fetched data in memory instead
  // of re-hitting the network for a range that hasn't actually changed.
  const [rawItems, setRawItems] = useState({ tasks: [], subtasks: [] })
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'

  const grid = useMemo(() => buildMonthGrid(anchorMonth), [anchorMonth])

  // Keeps the selected day in sync with whatever month is actually on
  // screen — without this, navigating away from the month the current
  // selection falls in leaves the side panel permanently stuck showing
  // that stale day (it's simply never in itemsByDay for a different
  // month, but the header label doesn't know that). Selects today if
  // today is in the newly-visible month, otherwise the 1st of it —
  // same convention most calendar UIs use rather than leaving nothing
  // selected.
  useEffect(() => {
    const todayInView = now.getFullYear() === anchorMonth.getFullYear() && now.getMonth() === anchorMonth.getMonth()
    setSelectedKey(todayInView ? localDayKey(now) : localDayKey(anchorMonth))
  }, [anchorMonth, now])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    const gridStart = grid[0].date
    const gridEnd = addDays(grid[grid.length - 1].date, 1) // exclusive end -> end of last cell's day

    Promise.all([
      fetchTasksDueBetween(gridStart.toISOString(), gridEnd.toISOString()),
      fetchSubtasksDueBetween(gridStart.toISOString(), gridEnd.toISOString()),
    ])
      .then(([tasksData, subtasksData]) => {
        if (cancelled) return
        setRawItems({ tasks: tasksData.results, subtasks: subtasksData.results })
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
    // grid is derived from anchorMonth alone — depending on it directly
    // would re-fetch on every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorMonth])

  const itemsByDay = useMemo(
    () => groupByDay(flattenItems(rawItems.tasks, rawItems.subtasks, taskNameById)),
    [rawItems, taskNameById]
  )

  const todayKey = localDayKey(now)
  const selectedItems = itemsByDay.get(selectedKey) ?? []
  const selectedDate = grid.find((c) => c.key === selectedKey)?.date ?? now

  function goToMonth(delta) {
    setAnchorMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Calendar</h1>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_336px]">
        {/* ---- month grid ---- */}
        <div className="relative rounded-[14px] bg-card p-5 ring-1 ring-foreground/10">
          <span aria-hidden="true" className="task-ring" />
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold tracking-tight">
              {anchorMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goToMonth(-1)}
                aria-label="Previous month"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setAnchorMonth(new Date(now.getFullYear(), now.getMonth(), 1))}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => goToMonth(1)}
                aria-label="Next month"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_LABELS.map((label, i) => (
              <span key={i} className="pb-1 text-center text-[11px] font-bold text-muted-foreground">
                {label}
              </span>
            ))}
            {grid.map((cell) => {
              const isToday = cell.key === todayKey
              const isSelected = cell.key === selectedKey
              const dotClass = dayDotClass(itemsByDay.get(cell.key), now)
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedKey(cell.key)}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center gap-1 rounded-[8px] text-xs font-medium transition-colors',
                    !cell.inMonth && 'text-muted-foreground/40',
                    cell.inMonth && !isToday && !isSelected && 'text-foreground hover:bg-accent',
                    isSelected && 'bg-foreground text-background',
                    isToday && !isSelected && 'bg-[#7c5fb0]/15 text-[#6b46a8]'
                  )}
                >
                  {cell.date.getDate()}
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 rounded-full', dotClass ?? 'bg-transparent')}
                  />
                </button>
              )
            })}
          </div>
        </div>

        {/* ---- selected day's due items ---- */}
        <div className="flex flex-col gap-3.5">
          <h2 className="m-0 font-display text-[15px] font-semibold tracking-[.02em] text-foreground">
            {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>

          {status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}

          {status === 'error' && (
            <p className="text-sm text-destructive">Couldn&apos;t load the calendar. Try reloading.</p>
          )}

          {status === 'ready' && selectedItems.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed py-10 text-center">
              <CalendarDays className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nothing due this day.</p>
            </div>
          )}

          {status === 'ready' && selectedItems.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {selectedItems.map((item) => (
                <DueItemRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
