import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SquarePlus, Target, CalendarDays, Sparkles, Flame, ArrowRight, Hammer } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { PulseRing } from '@/components/PulseRing'
import { cn } from '@/lib/utils'
import { useDeadlineStatus } from '@/hooks/useDeadlineStatus'
import { updateTask, updateSubTask } from '@/lib/tasks'
import { useTaskStore } from '@/context/TaskStoreContext'
import { computeStats } from '@/lib/stats'

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

// Matches the design handoff's "respect prefers-reduced-motion: reduce
// by skipping the animation entirely" instruction — the hero and the
// three Quick start cards below all gate their looping keyframes on
// this rather than the more common transition-only reduction.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
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

// The three Quick start cards' shared "glass" shell — box, lustre,
// hover lift, eyebrow row and footer title+button are identical across
// all three; only the fills/copy/preview differ. `preview` is a render
// prop rather than plain children so the preview panel can read the
// same `hovered` flag the shell already tracks, instead of each card
// wiring up its own hover listeners.
function QuickStartCard({
  to,
  background,
  ink,
  accentShadow,
  eyebrowIcon: EyebrowIcon,
  eyebrowLabel,
  meta,
  previewBg,
  title,
  buttonLabel,
  buttonGradient,
  buttonTextColor,
  buttonShadow,
  preview,
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <Link
      to={to}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="relative flex h-[252px] flex-col justify-between rounded-[14px] p-5 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
      style={{
        background,
        color: ink,
        transform: hovered ? 'translateY(-4px)' : 'none',
        boxShadow: hovered
          ? `inset 0 1px 0 rgba(255,255,255,.85), inset 0 0 0 1px rgba(255,255,255,.45), inset 0 -18px 34px -22px rgba(0,0,0,.35), 0 26px 40px -22px ${accentShadow}`
          : `inset 0 1px 0 rgba(255,255,255,.75), inset 0 0 0 1px rgba(255,255,255,.35), inset 0 -18px 34px -22px rgba(0,0,0,.35), 0 16px 30px -20px ${accentShadow}`,
        transition: 'transform .18s, box-shadow .18s',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-[9px] text-xs font-bold tracking-[.02em]">
          <EyebrowIcon className="size-[17px]" strokeWidth={2} />
          {eyebrowLabel}
        </span>
        <span className="font-display text-xs font-semibold tabular-nums" style={{ opacity: 0.78 }}>
          {meta}
        </span>
      </div>

      <div className="flex flex-col gap-[9px] rounded-[10px] p-[14px]" style={{ background: previewBg }}>
        {preview(hovered)}
      </div>

      <div className="flex items-end justify-between gap-3">
        <h3 className="max-w-[150px] font-display text-[21px] font-semibold leading-[1.15] tracking-[-.025em]">
          {title}
        </h3>
        <span
          className="flex shrink-0 items-center rounded-[9px] px-[14px] py-[9px] text-[13px] font-bold backdrop-blur-[6px] transition-[gap] duration-[180ms]"
          style={{ background: buttonGradient, color: buttonTextColor, boxShadow: buttonShadow, gap: hovered ? '11px' : '7px' }}
        >
          {buttonLabel}
          <ArrowRight className="size-[15px]" strokeWidth={3} />
        </span>
      </div>
    </Link>
  )
}

// One checklist row inside the Task card's preview. `stage === 'done'`
// renders the permanently-completed third row (no animation, matching
// the design's "row 3 is pre-completed"); otherwise the row ticks and
// strikes on a 7s loop, staggered by `delayS`, running only while
// `hovered` and reset to frame 0 on hover-out (a fresh `key` per
// hover-state remounts the row, and a just-mounted paused animation
// always sits at its own 0% frame — the same "stop and reset" the
// design's own play-state/reflow trick produces).
function TaskPreviewRow({ label, stage, delayS = 0, hovered, reducedMotion }) {
  const animating = stage === 'pending' && !reducedMotion
  const playState = hovered ? 'running' : 'paused'

  if (stage === 'done') {
    return (
      <div className="flex items-center gap-[9px]">
        <span
          className="flex size-[14px] shrink-0 items-center justify-center rounded-[4px]"
          style={{ background: '#33224a', border: '1.5px solid #33224a', color: '#e0c3fc' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold line-through"
          style={{ color: 'rgba(51,34,74,.72)' }}
        >
          {label}
        </span>
      </div>
    )
  }

  return (
    <div key={hovered} className="flex items-center gap-[9px]">
      <span
        className="relative flex size-[14px] shrink-0 items-center justify-center overflow-hidden rounded-[4px]"
        style={{ background: 'rgba(51,34,74,.1)', border: '1.5px solid rgba(51,34,74,.45)' }}
      >
        <span
          className="absolute inset-0"
          style={{ background: '#33224a', opacity: 0, animation: animating ? `fxFill 7s ${delayS}s infinite` : 'none', animationPlayState: playState }}
        />
        <span
          className="relative flex"
          style={{ color: '#e0c3fc', opacity: 0, animation: animating ? `fxFill 7s ${delayS}s infinite` : 'none', animationPlayState: playState }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      </span>
      <span
        className="relative min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold"
        style={{ color: '#33224a', animation: animating ? `fxDim 7s ${delayS}s infinite` : 'none', animationPlayState: playState }}
      >
        <span className="relative inline-block max-w-full">
          {label}
          <span
            className="absolute left-0 top-1/2 h-[1.5px]"
            style={{ background: 'currentColor', animation: animating ? `fxStrike 7s ${delayS}s infinite` : 'none', animationPlayState: playState, width: animating ? undefined : 0 }}
          />
        </span>
      </span>
    </div>
  )
}

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
            'relative rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap tabular-nums transition-colors',
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

// Right-rail "Goals in progress" card while Goals itself doesn't exist
// yet — same tone/copy pattern as ComingSoonPage, sized to sit
// naturally alongside the Upcoming list rather than a full-page state.
function GoalsComingSoonCard() {
  return (
    <Link
      to="/goals"
      className="group flex flex-col items-center gap-3 rounded-[14px] bg-card px-5 py-8 text-center ring-1 ring-foreground/10 transition-colors hover:bg-accent/50"
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-[#7c5fb0]/10 text-[#7c5fb0] transition-transform duration-200 group-hover:scale-110">
        <Hammer className="size-5" />
      </div>
      <p className="text-sm font-medium">Goals is on the way</p>
      <p className="text-xs text-muted-foreground">
        Set a bigger target and track progress toward it over time.
      </p>
    </Link>
  )
}

export function Dashboard({ firstName, username, justLoggedIn, onWelcomeSeen }) {
  const { tasks, status, refreshTasks } = useTaskStore()
  const displayName = firstName || username || 'there'
  const now = useClock()
  const reducedMotion = usePrefersReducedMotion()
  const { currentStreak } = computeStats(tasks).habits
  // Captured once, on mount — whether *this* render of the dashboard
  // followed an actual login (not a later navigation back to /home in
  // the same session). Consuming the prop via onWelcomeSeen right away
  // means a later remount (e.g. logout/login again) can retrigger it,
  // but simply revisiting /home afterward can't.
  const [animateWelcome] = useState(() => Boolean(justLoggedIn))
  useEffect(() => {
    if (justLoggedIn) onWelcomeSeen?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Feeds the Task quick-start card's own mini checklist: up to two
    // real open tasks (ticking on hover) plus the most recently
    // completed one, if there is one, as the pre-done third row —
    // falls back to a plain placeholder pair when the account is empty.
    const open = tasks.filter((t) => !t.completed).slice(0, 2)
    const doneTask = [...tasks]
      .filter((t) => t.completed && t.dateCompleted)
      .sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted))[0]
    const rows = open.map((t) => ({ label: t.name, stage: 'pending' }))
    while (rows.length < 2) rows.push({ label: 'Nothing queued yet', stage: 'pending' })
    if (doneTask) rows.push({ label: doneTask.name, stage: 'done' })
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

  // This week's Mon–Sun row for the Calendar card's preview — a real
  // week (not a fixture), with today's own cell the only one that gets
  // the hover-gated pulse.
  const weekCells = useMemo(() => {
    const dow = now.getDay() // 0 = Sunday
    const mondayOffset = dow === 0 ? -6 : 1 - dow
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() + mondayOffset)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return { date: d.getDate(), isToday: d.toDateString() === now.toDateString() }
    })
  }, [now])

  return (
    <div className="mx-auto max-w-[1152px] px-6 py-8">
      {/* Hero — starfield banner replacing the old plain greeting.
          Same masked-gradient ring every other brand surface in the app
          uses (.gradient-ring, index.css), just sized up for the hero's
          own radius via `border-radius: inherit`. */}
      <div
        className="relative overflow-hidden rounded-[18px] bg-cover bg-center p-[30px] shadow-[0_18px_40px_-28px_rgba(37,37,37,.65)]"
        style={{ backgroundImage: 'url(/starfield-bg-wide.jpg)' }}
      >
        <span aria-hidden="true" className="gradient-ring" style={{ zIndex: 3 }} />
        <div className="relative z-[2] flex flex-col gap-[26px]">
          <div className="flex items-start justify-between gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[.12em] text-white/55">{formatNow(now)}</span>
              <h1 className="m-0 font-display text-[44px] font-bold leading-[1.05] tracking-[-.03em] text-white">
                Welcome back,{' '}
                {animateWelcome ? (
                  // Overlay technique (base copy underneath for a11y + layout,
                  // gradient-clipped copy on top, wiped in via clip-path) — same
                  // two-layer idea Logo.jsx uses for its outline, just animated
                  // once instead of static.
                  <span className="relative inline-block">
                    <span>{displayName}</span>
                    <span
                      aria-hidden="true"
                      className="welcome-name-gradient animate-welcome-name-fill absolute inset-0"
                    >
                      {displayName}
                    </span>
                  </span>
                ) : (
                  displayName
                )}
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
                <span className="font-display text-[26px] font-bold tracking-[-.02em] text-white tabular-nums">{doneToday}</span>
              )}
              <span className="text-[11px] font-bold uppercase tracking-[.07em] text-white/60">Done today</span>
            </div>
            <div className="flex flex-1 flex-col gap-[3px] rounded-xl bg-white/8 p-[14px_18px] outline outline-1 -outline-offset-1 outline-white/16 backdrop-blur-[6px]">
              {status === 'loading' ? (
                <Skeleton className="h-[26px] w-9 rounded-md bg-white/20" />
              ) : (
                <span className="font-display text-[26px] font-bold tracking-[-.02em] text-white tabular-nums">{dueToday}</span>
              )}
              <span className="text-[11px] font-bold uppercase tracking-[.07em] text-white/60">Due today</span>
            </div>
            <div className="flex flex-1 flex-col gap-[3px] rounded-xl bg-white/8 p-[14px_18px] outline outline-1 -outline-offset-1 outline-white/16 backdrop-blur-[6px]">
              {status === 'loading' ? (
                <Skeleton className="h-[26px] w-9 rounded-md bg-white/20" />
              ) : (
                <span className="flex items-center gap-1.5 font-display text-[26px] font-bold tracking-[-.02em] text-white tabular-nums">
                  {currentStreak}
                  {currentStreak > 0 && <Flame className="size-[18px] fill-orange-400 text-orange-400" />}
                </span>
              )}
              <span className="text-[11px] font-bold uppercase tracking-[.07em] text-white/60">Day streak</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick start */}
      <div className="mt-9 mb-4 flex items-baseline justify-between">
        <h2 className="m-0 font-display text-[15px] font-semibold tracking-[.02em] text-foreground">Quick start</h2>
        <span className="text-xs text-[#a8a5a0]">Three ways in</span>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <QuickStartCard
          to="/tasks/new"
          background="linear-gradient(160deg,#f2e6ff 0%,#e0c3fc 52%,#c9a5ee 100%)"
          ink="#33224a"
          accentShadow="rgba(124,95,176,.55)"
          eyebrowIcon={SquarePlus}
          eyebrowLabel="Task"
          meta={`${doneToday} done today`}
          previewBg="rgba(51,34,74,.09)"
          title="Start a new task"
          buttonLabel="New task"
          buttonGradient="linear-gradient(180deg,#4c3670 0%,#33224a 62%,#2b1c40 100%)"
          buttonTextColor="#fff"
          buttonShadow="inset 0 1px 0 rgba(255,255,255,.42), inset 0 -1px 0 rgba(0,0,0,.18), 0 8px 16px -10px rgba(51,34,74,.7)"
          preview={(hovered) => (
            <>
              {previewTasks.map((row, i) => (
                <TaskPreviewRow
                  key={i}
                  label={row.label}
                  stage={row.stage}
                  delayS={i === 1 ? 1.6 : 0}
                  hovered={hovered}
                  reducedMotion={reducedMotion}
                />
              ))}
            </>
          )}
        />
        <QuickStartCard
          to="/goals"
          background="linear-gradient(160deg,#9b7dcd 0%,#7c5fb0 52%,#684d99 100%)"
          ink="#fff"
          accentShadow="rgba(124,95,176,.6)"
          eyebrowIcon={Target}
          eyebrowLabel="Goal"
          meta="Coming soon"
          previewBg="rgba(0,0,0,.2)"
          title="Start a new goal"
          buttonLabel="New goal"
          buttonGradient="linear-gradient(180deg,#fff 0%,#f4eefc 62%,#e9dffa 100%)"
          buttonTextColor="#6f52a3"
          buttonShadow="inset 0 1px 0 #fff, inset 0 -1px 0 rgba(0,0,0,.18), 0 8px 16px -10px rgba(43,25,66,.65)"
          preview={(hovered) => {
            const animating = !reducedMotion
            const playState = hovered ? 'running' : 'paused'
            return (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-white">Ship v2</span>
                  <span className="font-display text-[15px] font-semibold text-white tabular-nums">82%</span>
                </div>
                <div key={hovered} className="h-2 overflow-hidden rounded-full bg-white/25">
                  <span
                    className="block h-full rounded-full bg-white"
                    style={{
                      width: animating ? undefined : '82%',
                      animation: animating ? 'fxBar 7s ease-in-out infinite' : 'none',
                      animationPlayState: playState,
                    }}
                  />
                </div>
                <span className="text-[11px] font-bold text-white/82">9 of 11 tasks · ends Sep 30</span>
              </>
            )
          }}
        />
        <QuickStartCard
          to="/calendar"
          background="linear-gradient(160deg,#bcdfff 0%,#8ec5fc 52%,#72b0ef 100%)"
          ink="#12314b"
          accentShadow="rgba(142,197,252,.75)"
          eyebrowIcon={CalendarDays}
          eyebrowLabel="Calendar"
          meta={now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          previewBg="rgba(18,49,75,.09)"
          title="View your calendar"
          buttonLabel="Open"
          buttonGradient="linear-gradient(180deg,#22496b 0%,#12314b 62%,#0d2740 100%)"
          buttonTextColor="#fff"
          buttonShadow="inset 0 1px 0 rgba(255,255,255,.42), inset 0 -1px 0 rgba(0,0,0,.18), 0 8px 16px -10px rgba(18,49,75,.7)"
          preview={(hovered) => {
            const animating = !reducedMotion
            const playState = hovered ? 'running' : 'paused'
            return (
              <>
                <div className="grid grid-cols-7 gap-[5px]">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                    <span key={i} className="text-center text-[9px] font-bold text-[#12314b]/75">
                      {d}
                    </span>
                  ))}
                  {weekCells.map((cell, i) =>
                    cell.isToday ? (
                      <span
                        key={`${hovered}-${i}`}
                        className="flex h-[22px] items-center justify-center rounded-[5px] text-[11px] font-bold"
                        style={{
                          background: '#12314b',
                          color: '#8ec5fc',
                          animation: animating ? 'fxToday 2.8s ease-out infinite' : 'none',
                          animationPlayState: playState,
                        }}
                      >
                        {cell.date}
                      </span>
                    ) : (
                      <span
                        key={i}
                        className="flex h-[22px] items-center justify-center rounded-[5px] bg-[#12314b]/10 text-[11px] font-bold text-[#12314b]"
                      >
                        {cell.date}
                      </span>
                    )
                  )}
                </div>
                <span className="text-[11px] font-bold text-[#12314b]/75">Full calendar view →</span>
              </>
            )
          }}
        />
      </div>

      {/* Upcoming + Goals rail */}
      <div className="mt-9 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_336px]">
        <div>
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="m-0 font-display text-[15px] font-semibold tracking-[.02em] text-foreground">Upcoming</h2>
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
          <h2 className="m-0 font-display text-[15px] font-semibold tracking-[.02em] text-foreground">Goals in progress</h2>
          <GoalsComingSoonCard />
          <div
            className="relative overflow-hidden rounded-[14px] bg-cover bg-center p-[18px] text-white"
            style={{ backgroundImage: 'url(/starfield-bg.jpg)' }}
          >
            <span aria-hidden="true" className="gradient-ring" style={{ zIndex: 3 }} />
            <div className="relative z-[2] flex flex-col gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[.09em] text-white/60">This week</span>
              <span className="font-display text-[20px] font-semibold tracking-[-.02em]">
                {currentStreak > 0
                  ? `You're on a ${currentStreak}-day streak.`
                  : "Check something off to start a streak."}
              </span>
              <span className="text-xs text-white/60">
                {dueToday > 0 ? `${dueToday} more due today — keep it going.` : 'A clean slate today. One task keeps it alive.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
