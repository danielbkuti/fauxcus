import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SquarePlus, Target, Sparkles, Flame, ArrowRight } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { GoalProgressBar } from '@/components/GoalProgress'
import { useGoals } from '@/hooks/useGoals'
import { describeTimeLeft, formatTargetDate, sortActiveGoals } from '@/lib/goals'
import { PulseRing } from '@/components/PulseRing'
import { FIRE_PAD, StreakCard, StreakFire } from '@/components/StreakFire'
import { cn } from '@/lib/utils'
import { useDeadlineStatus } from '@/hooks/useDeadlineStatus'
import { updateTask, updateSubTask } from '@/lib/tasks'
import { useTaskStore } from '@/context/TaskStoreContext'
import { computeStats } from '@/lib/stats'
import { Starfield } from '@/components/Starfield'
import QuickStartCards from '@/components/QuickStartCards'

// Ticks slowly (same 30s "slow tick" interval useDeadlineStatus already
// uses for its own non-urgent case) — plenty for a clock that only
// displays minutes, no seconds.
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  return now
}

function formatNow(date) {
  const day = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

function formatDeadline(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Deadlines (and dateCompleted) come back as UTC instants — the rest of
// the dashboard already renders dates in UTC (see formatDeadline above),
// so "today" for the hero's counters means the same UTC calendar day,
// not the viewer's local one.
function isSameUTCDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

// A just-checked item stays in the list, checked and struck through,
// for this long before it's actually allowed to drop out — same idea
// (and duration) as the task list's own CELEBRATION_MS, so checking
// something off here doesn't just make it instantly vanish.
const CELEBRATION_MS = 1300

// One row in the "Upcoming" list — a task or a subtask, both shaped
// down to the same {kind, id, taskId, name, dateDeadline, completed,
// parentName} shape so they can share a sorted list and a single row
// renderer. `taskId` is always the *task's* id (itself, for a task row;
// its parent's, for a subtask row) since only tasks have their own
// detail page — same convention as OverdueBanner's item list.
function UpcomingRow({ item, celebrating, onToggle }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  // `item.completed` already folds in the celebration flag (see the
  // `upcoming` derivation below) — checked and struck through the
  // instant you tick it, not just once the server confirms.
  const { isOverdue, isUrgent, countdownDisplay } = useDeadlineStatus(item.dateDeadline, item.completed)

  async function handleToggle(checked) {
    setBusy(true)
    try {
      await onToggle(item, checked)
    } finally {
      setBusy(false)
    }
  }

  return (
    // A plain styled div rather than <Card> here — Card's own classes
    // (flex-col, gap/padding driven by a --card-spacing token) are
    // meant for its vertical header/content layout, and fighting that
    // with overrides for a one-line horizontal row isn't worth the risk
    // of a class not actually winning the merge. Clicking the row opens
    // the underlying task's detail page — same "whole row navigates,
    // interactive controls opt out with stopPropagation" convention as
    // TaskCard; the checkbox is the only control here. Every row gets the
    // gradient ring (matches the rest of the app's card treatment) — the
    // design handoff's "first row only" version read as inconsistent in
    // practice, so all rows keep it rather than singling one out.
    <div
      onClick={() => navigate(`/tasks/${item.taskId}`)}
      className="relative flex cursor-pointer items-center gap-[14px] rounded-[14px] bg-card px-[18px] py-[14px] text-sm ring-1 ring-foreground/10 transition-colors hover:bg-accent/50"
    >
      <span aria-hidden="true" className="task-ring" />
      <Checkbox
        checked={item.completed}
        onCheckedChange={handleToggle}
        onClick={(e) => e.stopPropagation()}
        disabled={busy || celebrating}
        className="shrink-0 data-checked:border-emerald-500 data-checked:bg-emerald-500"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-sm font-medium transition-colors duration-300',
            item.completed && 'text-muted-foreground line-through'
          )}
        >
          {item.name}
        </span>
        {item.kind === 'subtask' && (
          <span className="truncate text-xs text-muted-foreground">
            Part of {item.parentName}
          </span>
        )}
      </div>
      {/* Same three-state badge (overdue / due-within-a-day countdown /
          plain due date) as TaskCard's own due-date badge on the task
          list, not the separate neutral Badge component this used to
          be — under 24h out, this now ticks the same red "Due in:
          HH:MM:SS" the list shows instead of just a static date. */}
      <div className="relative shrink-0">
        {(isOverdue || isUrgent) && <PulseRing />}
        <span
          className={cn(
            'relative rounded-full px-2 py-0.5 text-[14px] font-medium whitespace-nowrap tabular-nums transition-colors',
            isOverdue
              ? 'bg-red-700 text-white'
              : isUrgent
                ? 'bg-red-50 text-red-700'
                : 'bg-[#f3e8ff] text-[#6b46a8]'
          )}
        >
          {isOverdue ? 'Overdue' : isUrgent ? `Due in: ${countdownDisplay}` : formatDeadline(item.dateDeadline)}
        </span>
      </div>
    </div>
  )
}

// How many in-progress goals the right rail previews before deferring to
// the full Goals page.
const GOALS_PREVIEW_COUNT = 3

// Right-rail "Goals in progress" card — the soonest-due active goals with
// their progress, or an invitation to set the first one. `activeGoals` is
// already sorted soonest-first by the caller.
function GoalsInProgressCard({ activeGoals, status }) {
  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2.5 rounded-[14px] bg-card px-[18px] py-4 ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-2/3 rounded-md" />
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (status === 'error') {
    return <p className="text-sm text-destructive">Couldn&apos;t load your goals. Try reloading.</p>
  }

  if (activeGoals.length === 0) {
    return (
      <Link
        to="/goals/new"
        className="group flex flex-col items-center gap-3 rounded-[14px] bg-card px-5 py-8 text-center ring-1 ring-foreground/10 transition-colors hover:bg-accent/50"
      >
        <div className="flex size-11 items-center justify-center rounded-full bg-[#7c5fb0]/10 text-[#7c5fb0] transition-transform duration-200 group-hover:scale-110">
          <Target className="size-5" />
        </div>
        <p className="text-sm font-medium">No goals yet</p>
        <p className="text-xs text-muted-foreground">
          Set a bigger target and track progress toward it over time.
        </p>
      </Link>
    )
  }

  const shown = activeGoals.slice(0, GOALS_PREVIEW_COUNT)
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((goal) => {
        const timeLeft = describeTimeLeft(goal.targetDate)
        return (
          <Link
            key={goal.id}
            to={`/goals/${goal.id}`}
            className="flex flex-col gap-2.5 rounded-[14px] bg-card px-[18px] py-4 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[15px] font-semibold">{goal.name}</span>
              {timeLeft && (
                <span className="shrink-0 rounded-full bg-[#f3e8ff] px-2.5 py-0.5 text-xs whitespace-nowrap text-[#6b46a8]">
                  {timeLeft}
                </span>
              )}
            </div>
            <GoalProgressBar percent={goal.progress} label={`${goal.name} progress`} />
          </Link>
        )
      })}
      <Link to="/goals" className="inline-flex items-center gap-1 self-start text-xs font-semibold text-[#6b46a8] hover:underline">
        {activeGoals.length > GOALS_PREVIEW_COUNT ? `View all ${activeGoals.length} goals` : 'View goals'}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  )
}

export function Dashboard({ firstName, username }) {
  const { tasks, status, refreshTasks } = useTaskStore()
  const { goals, status: goalsStatus } = useGoals()
  const activeGoals = useMemo(() => sortActiveGoals(goals.filter((g) => !g.completed)), [goals])
  // The soonest-due active goal, previewed on the Goal quick-start card.
  const topGoal = activeGoals[0] ?? null
  const displayName = firstName || username || 'there'
  const now = useClock()
  const { currentStreak } = computeStats(tasks).habits
  // The welcome-name fill replays every time the greeting is brought into
  // view — on page load or refresh, on navigating back to /home, and on
  // scrolling it back on screen after it had left. `nameFillKey` is the
  // replay trigger: the overlay is keyed on it, so bumping it remounts the
  // overlay and restarts its CSS animation from the first frame. 0 means
  // "not shown yet" (the plain name is all that's on screen until the
  // greeting is first seen).
  const welcomeRef = useRef(null)
  const [nameFillKey, setNameFillKey] = useState(0)
  useEffect(() => {
    const el = welcomeRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNameFillKey(1)
      return undefined
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNameFillKey((k) => k + 1)
      },
      { threshold: 0.6 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // Kind-prefixed ids (`task-3`, `subtask-9`) currently mid-celebration
  // — kept in the list (checked, struck through) even though they're
  // already `completed` server-side, until their timer clears. Same
  // idea as TaskList's own `celebratingIds`, just keyed by kind+id
  // since this list mixes tasks and subtasks together.
  const [celebratingIds, setCelebratingIds] = useState(() => new Set())

  function isCelebrating(kind, id) {
    return celebratingIds.has(`${kind}-${id}`)
  }

  // Flattens tasks + their subtasks into one list of not-yet-done items
  // that actually have a deadline, sorted soonest-first. A task whose
  // parent is already completed is skipped entirely — subtasks of a
  // finished task aren't "upcoming" anything — unless the task itself
  // is what's mid-celebration, in which case its subtasks stay visible
  // for the same window it does.
  const upcoming = tasks
    .filter((task) => !task.completed || isCelebrating('task', task.id))
    .flatMap((task) => {
      const items = []
      const taskCelebrating = isCelebrating('task', task.id)
      if (task.dateDeadline) {
        items.push({
          kind: 'task',
          id: task.id,
          taskId: task.id,
          name: task.name,
          dateDeadline: task.dateDeadline,
          completed: task.completed || taskCelebrating,
        })
      }
      for (const subtask of task.subtasks) {
        const subtaskCelebrating = isCelebrating('subtask', subtask.id)
        if (subtask.dateDeadline && (!subtask.completed || subtaskCelebrating)) {
          items.push({
            kind: 'subtask',
            id: subtask.id,
            taskId: task.id,
            name: subtask.name,
            dateDeadline: subtask.dateDeadline,
            completed: subtask.completed || subtaskCelebrating,
            parentName: task.name,
          })
        }
      }
      return items
    })
    .sort((a, b) => new Date(a.dateDeadline) - new Date(b.dateDeadline))
    .slice(0, 6)

  // Hero + Task-card counters — real numbers, not the design mockup's
  // fixtures. "Today" is the same UTC calendar day the rest of the
  // dashboard already renders deadlines in (see isSameUTCDay above).
  const { doneToday, dueToday, previewTasks } = useMemo(() => {
    let done = 0
    let due = 0
    for (const task of tasks) {
      if (task.completed && task.dateCompleted && isSameUTCDay(new Date(task.dateCompleted), now)) done += 1
      if (!task.completed && task.dateDeadline && isSameUTCDay(new Date(task.dateDeadline), now)) due += 1
      for (const subtask of task.subtasks) {
        if (subtask.completed && subtask.dateCompleted && isSameUTCDay(new Date(subtask.dateCompleted), now)) done += 1
        if (!task.completed && !subtask.completed && subtask.dateDeadline && isSameUTCDay(new Date(subtask.dateDeadline), now))
          due += 1
      }
    }
    // Feeds the Task quick-start card's mini checklist: the two open tasks
    // due soonest (these tick on hover) plus the most recently completed
    // one, if any, as a pre-done third row. Sorted here rather than taking
    // the API's order, which puts tasks without a deadline first; those
    // only fill in when fewer than two open tasks have a deadline.
    const open = tasks
      .filter((t) => !t.completed)
      .sort((a, b) => {
        if (!a.dateDeadline || !b.dateDeadline) return (a.dateDeadline ? 0 : 1) - (b.dateDeadline ? 0 : 1)
        return new Date(a.dateDeadline) - new Date(b.dateDeadline)
      })
      .slice(0, 2)
    const doneTask = [...tasks]
      .filter((t) => t.completed && t.dateCompleted)
      .sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted))[0]
    const rows = open.map((t) => ({ title: t.name, done: false }))
    if (doneTask) rows.push({ title: doneTask.name, done: true })
    return { doneToday: done, dueToday: due, previewTasks: rows.slice(0, 3) }
  }, [tasks, now])

  // Either kind of toggle can change a parent task's own `completed`
  // field server-side (completing a task directly, or completing the
  // last subtask of one) — re-fetching the whole list afterward is
  // simpler and more correct than patching two different shapes of
  // local state by hand. Marking complete (not reopening) also holds
  // the row in place, checked and struck through, for CELEBRATION_MS
  // before it's actually allowed to drop out of the list.
  async function handleToggle(item, checked) {
    const key = `${item.kind}-${item.id}`
    if (checked) {
      setCelebratingIds((current) => new Set(current).add(key))
      setTimeout(() => {
        setCelebratingIds((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }, CELEBRATION_MS)
    }
    if (item.kind === 'task') {
      await updateTask(item.id, { completed: checked })
    } else {
      await updateSubTask(item.id, { completed: checked })
    }
    await refreshTasks()
  }

  const heroSubtitle =
    dueToday > 0 ? `${dueToday} task${dueToday === 1 ? '' : 's'} due today.` : "Nothing due today — you're all caught up."

  return (
    <div className="mx-auto max-w-[1152px] px-6 py-8">
      {/* Hero — starfield banner replacing the old plain greeting.
          Same masked-gradient ring every other brand surface in the app
          uses (.gradient-ring, index.css), just sized up for the hero's
          own radius via `border-radius: inherit`. */}
      <div
        className="font-display relative isolate overflow-hidden rounded-[18px] bg-[#05060b] p-[30px] shadow-[0_18px_40px_-28px_rgba(37,37,37,.65)]"
      >
          <Starfield />
        <span aria-hidden="true" className="gradient-ring" style={{ zIndex: 3 }} />
        <div className="relative z-[2] flex flex-col gap-[26px]">
          <div className="flex items-start justify-between gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-bold uppercase tracking-[.12em] text-white/55">{formatNow(now)}</span>
              <h1 ref={welcomeRef} className="m-0 font-display text-[57px] font-bold leading-[1.05] text-white">
                Welcome back,{' '}
                {/* Overlay technique (base copy underneath for a11y + layout,
                    gradient-clipped copy on top, wiped in via clip-path) — same
                    two-layer idea Logo.jsx uses for its outline, just animated.
                    The overlay's key restarts the wipe on every replay. */}
                <span className="relative inline-block">
                  <span>{displayName}</span>
                  {nameFillKey > 0 && (
                    <span
                      key={nameFillKey}
                      aria-hidden="true"
                      className="welcome-name-gradient animate-welcome-name-fill absolute inset-0"
                    >
                      {displayName}
                    </span>
                  )}
                </span>
              </h1>
              {status === 'loading' ? (
                <Skeleton className="mt-0.5 h-[17px] w-56 max-w-full bg-white/15" />
              ) : (
                <p className="m-0 text-sm text-white/62">{heroSubtitle}</p>
              )}
            </div>
          </div>
          <div className="flex gap-3.5">
            <div className="flex flex-1 flex-col gap-[3px] rounded-xl bg-white/8 p-[14px_18px] outline outline-1 -outline-offset-1 outline-white/16 backdrop-blur-[6px]">
              {status === 'loading' ? (
                <Skeleton className="h-[26px] w-9 rounded-md bg-white/20" />
              ) : (
                <span className="font-display text-[34px] font-bold text-white tabular-nums">{doneToday}</span>
              )}
              <span className="text-[14px] font-bold uppercase tracking-[.07em] text-white/60">Done today</span>
            </div>
            <div className="flex flex-1 flex-col gap-[3px] rounded-xl bg-white/8 p-[14px_18px] outline outline-1 -outline-offset-1 outline-white/16 backdrop-blur-[6px]">
              {status === 'loading' ? (
                <Skeleton className="h-[26px] w-9 rounded-md bg-white/20" />
              ) : (
                <span className="font-display text-[34px] font-bold text-white tabular-nums">{dueToday}</span>
              )}
              <span className="text-[14px] font-bold uppercase tracking-[.07em] text-white/60">Due today</span>
            </div>
            <div className={cn('relative flex flex-1 flex-col gap-[3px] overflow-hidden rounded-xl bg-white/8 p-[14px_18px] outline outline-1 -outline-offset-1 outline-white/16 backdrop-blur-[6px]', status !== 'loading' && currentStreak > 0 && FIRE_PAD.tile)}>
              {status !== 'loading' && <StreakFire streak={currentStreak} size="tile" />}
              {status === 'loading' ? (
                <Skeleton className="h-[26px] w-9 rounded-md bg-white/20" />
              ) : (
                <span className="relative z-[2] flex items-center gap-1.5 font-display text-[34px] font-bold text-white tabular-nums">
                  {currentStreak}
                  {currentStreak > 0 && <Flame className="size-[18px] fill-orange-400 text-orange-400" />}
                </span>
              )}
              <span className="relative z-[2] text-[14px] font-bold uppercase tracking-[.07em] text-white/60">Day streak</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick start */}
      <div className="mt-9 mb-4 flex items-baseline justify-between">
        <h2 className="m-0 text-[23px] font-semibold text-foreground">Quick start</h2>
        <span className="text-xs text-[#a8a5a0]">Three ways in</span>
      </div>
      <QuickStartCards
        now={now}
        tasks={previewTasks}
        doneToday={doneToday}
        tasksLoading={status === 'loading'}
        goalsLoading={goalsStatus === 'loading'}
        activeGoals={goalsStatus === 'ready' ? activeGoals.length : null}
        goal={topGoal && {
          title: topGoal.name,
          pct: topGoal.progress,
          done: topGoal.completedTaskCount,
          total: topGoal.taskCount,
          endsLabel: formatTargetDate(topGoal.targetDate),
        }}
      />

      {/* Upcoming + Goals rail */}
      <div className="mt-9 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_336px]">
        <div>
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="m-0 text-[23px] font-semibold text-foreground">Upcoming</h2>
            <Link to="/tasks" className="text-xs font-medium text-sky-600 hover:underline">
              View all tasks →
            </Link>
          </div>

          {status === 'loading' && (
            <div className="flex flex-col gap-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-[14px] rounded-[14px] bg-card px-[18px] py-[14px] ring-1 ring-foreground/10">
                  <Skeleton className="size-4 shrink-0 rounded-[6px]" />
                  <Skeleton className="h-4 flex-1 rounded-full" />
                  <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {status === 'error' && (
            <p className="text-sm text-destructive">Couldn&apos;t load your tasks. Try reloading.</p>
          )}

          {status === 'ready' && upcoming.length === 0 && (
            <Link
              to="/tasks/new"
              className="group flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center transition-colors hover:border-[#56a456]/50 hover:bg-[#56a456]/5"
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-[#56a456]/10 text-[#56a456] transition-transform duration-200 group-hover:scale-110">
                <Sparkles className="size-5" />
              </div>
              <p className="text-sm font-medium">
                Let&apos;s start getting things done — add a new task or goal.
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#56a456] px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#56a456]/25 transition-transform duration-200 group-hover:scale-105">
                <SquarePlus className="size-3.5" />
                Add a new task
              </span>
            </Link>
          )}

          {status === 'ready' && upcoming.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {upcoming.map((item) => (
                <UpcomingRow
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  celebrating={isCelebrating(item.kind, item.id)}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          <h2 className="m-0 text-[23px] font-semibold text-foreground">Goals in progress</h2>
          <GoalsInProgressCard activeGoals={activeGoals} status={goalsStatus} />
          <StreakCard streak={currentStreak} dueToday={dueToday} />
        </div>
      </div>
    </div>
  )
}
