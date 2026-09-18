import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Check, CircleCheckBig, Clock, Hourglass, Pencil, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { updateTask, deleteTask, createSubTask, updateSubTask, deleteSubTask } from '@/lib/tasks'
import { cn, formatDeadline, calculateProgress, isDeadlineUrgent } from '@/lib/utils'
import { useDeadlineStatus } from '@/hooks/useDeadlineStatus'
import { useTaskStore } from '@/context/TaskStoreContext'
import { DeadlineEditor } from '@/components/DeadlineEditor'
import { useExclusiveDeadlineEditor } from '@/hooks/useExclusiveDeadlineEditor'
import { AddSubtaskForm } from '@/components/AddSubtaskForm'
import { TaskFireworks, SubtaskConfetti, CompletionWash } from '@/components/TaskDetailCelebrations'
import { Skeleton } from '@/components/ui/skeleton'

// How long a just-checked subtask stays in place (checkbox filled
// green, name struck through) before it's actually allowed to resort
// into the completed group — same idea as the cascade on the task
// card, so checking one off here doesn't just instantly relocate it.
const SUBTASK_CELEBRATION_MS = 1400
// Separate, longer window for the row's own confetti overlay (see
// `handoff 2/Celebrations-5c.md` §2) — decoupled from the resort delay
// above so a slow-finishing burst never gets cut off mid-flight just
// because the row itself already settled into the completed group.
const SUBTASK_CONFETTI_MS = 2000
// Task-level completion wash + fireworks run once per toggle; the
// fireworks total run is ~2.5s (five staggered shells, see
// TaskDetailCelebrations.jsx), so the overlay is torn down a little
// after the slowest spark actually finishes.
const FIREWORKS_MS = 2700
const WASH_MS = 950
// How long the "due soon, consider extending" bubble stays up before
// fading — it's a one-time heads-up on opening the page, not a
// persistent banner.
const DEADLINE_HINT_MS = 5000
// How many activity-log rows show before a "View more" reveals the
// next batch — client-side only, `task.activityLog` already arrives in
// full (see backend/tasks/api/serializers.py), there's no pagination
// to ask the server for.
const ACTIVITY_PAGE_SIZE = 10

// One state object drives every chrome value on the page — the
// deadline owns the palette (`handoff 2/TaskDetailPage-5b.md` §3).
// `far` and `overdue` are this page's own derivation: `far`'s exact
// hex values aren't given verbatim in the handoff (only its banner
// gradient, borrowed from `handoff/Card-states.md`'s "in progress"
// state, and its family — "lilac→blue, progress-gradient family" —
// are), so they're built from the app's existing default progress
// gradient (`#e0c3fc → #7c5fb0 → #8ec5fc`, the same stops
// `PROGRESS_GRADIENT`/`.task-ring`'s default use elsewhere) rather than
// invented from scratch. `overdue` reuses the red set named in the
// handoff (`hairline`/`soft`/`strong`/`title`/ring stops/banner/pulse)
// verbatim; its `flood`/`shadow`/`cta`/`ctaShadow`/`windowFill` follow
// the same formula the handoff spells out in full for `due-soon` and
// `completed`, just with the red stops in place of ember/emerald ones.
// Exported so NewTaskPage can borrow the calm 'far' palette for its own
// shell — a task being created has no deadline/overdue/completed state
// yet, so it only ever needs this one entry, not the whole map's logic.
export const STATE_THEME = {
  far: {
    flood:
      'linear-gradient(152deg,rgba(255,255,255,.94) 0%,rgba(224,195,252,.4) 24%,rgba(255,255,255,0) 62%),' +
      'linear-gradient(300deg,rgba(142,197,252,.1) 0%,rgba(255,255,255,0) 46%), #fbfaff',
    shadow: '0 16px 40px -26px rgba(124,95,176,.35), 0 1px 2px rgba(37,37,37,.05)',
    pulseClass: null,
    border: 'linear-gradient(135deg,#e0c3fc 0%,#7c5fb0 50%,#8ec5fc 100%)',
    banner: 'linear-gradient(90deg,#6b46a8,#4f7fd4)',
    hairline: '#e0c3fc',
    soft: '#f3e8ff',
    strong: '#6b46a8',
    title: '#4c3575',
    ring: ['#e0c3fc', '#7c5fb0 55%', '#4f7fd4'],
    cta: 'linear-gradient(90deg,#e0c3fc,#7c5fb0 55%,#4f7fd4)',
    ctaShadow: '0 10px 24px -14px rgba(107,70,168,.6)',
    windowFill: 'linear-gradient(90deg,#e0c3fc,#7c5fb0)',
    glyph: null,
    // Activity spine (ActivityLog-6b.md §3/§8): the gradient's top stop
    // and the rail's own muted tone — both new keys this state didn't
    // need before the spine existed.
    spineTop: '#4f8ef7',
    muted: 'oklch(0.556 0 0)',
  },
  'due-soon': {
    flood:
      'linear-gradient(152deg,rgba(255,255,255,.94) 0%,rgba(254,205,190,.4) 24%,rgba(255,255,255,0) 62%),' +
      'linear-gradient(300deg,rgba(234,88,12,.1) 0%,rgba(255,255,255,0) 46%), #fffaf8',
    shadow: '0 16px 40px -26px rgba(154,52,18,.38), 0 1px 2px rgba(37,37,37,.05)',
    pulseClass: 'animate-pulse-ember',
    border: 'linear-gradient(135deg,#fb7c50,#e0562f 60%,#9a3412)',
    banner: 'linear-gradient(90deg,#9a3412,#d4451c)',
    hairline: '#fcd0bd',
    soft: '#ffe8e0',
    strong: '#9a3412',
    title: '#7c2d12',
    ring: ['#fbbf24', '#e0562f 55%', '#9a3412'],
    cta: 'linear-gradient(90deg,#fbbf24,#e0562f 55%,#9a3412)',
    ctaShadow: '0 10px 24px -14px rgba(154,52,18,.85)',
    windowFill: 'linear-gradient(90deg,#fbbf24,#b45309)',
    glyph: Hourglass,
    glyphDurationMs: 2400,
    spineTop: '#e0562f',
    muted: '#a86a45',
  },
  overdue: {
    flood:
      'linear-gradient(152deg,rgba(255,255,255,.92) 0%,rgba(254,202,202,.55) 24%,rgba(255,255,255,0) 62%),' +
      'linear-gradient(300deg,rgba(239,68,68,.14) 0%,rgba(255,255,255,0) 44%), #fffafa',
    shadow: '0 16px 40px -26px rgba(185,28,28,.42), 0 1px 2px rgba(37,37,37,.05)',
    pulseClass: 'animate-pulse-red',
    border: 'linear-gradient(135deg,#f87171,#b91c1c 60%,#7f1d1d)',
    banner: 'linear-gradient(90deg,#b91c1c,#dc2626)',
    hairline: '#fca5a5',
    soft: '#fee2e2',
    strong: '#b91c1c',
    title: '#7f1d1d',
    ring: ['#f87171', '#b91c1c 55%', '#7f1d1d'],
    cta: 'linear-gradient(90deg,#f87171,#b91c1c 55%,#7f1d1d)',
    ctaShadow: '0 10px 24px -14px rgba(185,28,28,.85)',
    windowFill: 'linear-gradient(90deg,#f87171,#7f1d1d)',
    glyph: TriangleAlert,
    glyphDurationMs: 1800,
    spineTop: '#dc2626',
    muted: '#a15c5c',
  },
  completed: {
    flood:
      'linear-gradient(152deg,rgba(255,255,255,.94) 0%,rgba(167,243,208,.45) 24%,rgba(255,255,255,0) 62%),' +
      'linear-gradient(300deg,rgba(16,185,129,.12) 0%,rgba(255,255,255,0) 46%), #f8fffb',
    shadow: '0 16px 40px -26px rgba(5,150,105,.42), 0 1px 2px rgba(37,37,37,.05)',
    pulseClass: null,
    border: 'linear-gradient(135deg,#6ee7b7,#059669 60%,#065f46)',
    banner: 'linear-gradient(90deg,#047857,#059669)',
    hairline: '#a7f3d0',
    soft: '#d1fae5',
    strong: '#047857',
    title: '#065f46',
    ring: ['#6ee7b7', '#10b981 55%', '#047857'],
    cta: 'linear-gradient(90deg,#34d399,#059669)',
    ctaShadow: '0 10px 24px -14px rgba(5,150,105,.85)',
    windowFill: 'linear-gradient(90deg,#6ee7b7,#047857)',
    glyph: CircleCheckBig,
    spineTop: '#059669',
    muted: '#5f8a76',
  },
}

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Coarse "in N days/hours" for the meta stack's deadline line when
// nothing about it is urgent yet — deliberately not a live tick
// (useDeadlineStatus's fast interval only kicks in once a deadline is
// actually within URGENT_WINDOW_MS or overdue), so this is read once
// per render rather than ticking every second for no reason.
function formatRoughRemaining(ms) {
  const clamped = Math.max(0, ms)
  const days = Math.floor(clamped / 86400000)
  if (days >= 1) return `in ${pluralize(days, 'day')}`
  const hours = Math.floor(clamped / 3600000)
  if (hours >= 1) return `in ${pluralize(hours, 'hour')}`
  const minutes = Math.max(1, Math.floor(clamped / 60000))
  return `in ${pluralize(minutes, 'minute')}`
}

// Coarse "Nd"/"Nh"/"Nm" for the completed banner's "finished with X to
// spare/late" clause — same reasoning, a one-time computed duration,
// not a tick.
function formatDurationRough(ms) {
  const clamped = Math.max(0, ms)
  const minutes = Math.round(clamped / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The clause after "Completed {when} —" (see `handoff/Card-states.md`
// §4.2, which this borrows the variants from: ahead of deadline, on
// the deadline, late, or — no deadline at all — no clause). Reused by
// both the banner copy and the rail's completed deadline box.
function deadlineOutcomeClause(task) {
  if (!task.dateDeadline || !task.dateCompleted) return null
  const diff = new Date(task.dateDeadline).getTime() - new Date(task.dateCompleted).getTime()
  if (Math.abs(diff) < 60000) return 'right on the deadline'
  if (diff > 0) return `finished with ${formatDurationRough(diff)} to spare`
  return `finished ${formatDurationRough(-diff)} late`
}

function completionBannerCopy(task) {
  const when = formatDeadline(task.dateCompleted ?? task.dateCreated)
  const clause = deadlineOutcomeClause(task)
  return clause ? `Completed ${when} — ${clause}` : `Completed ${when}`
}

// The "View more" destination from a task card's subtask stack — the
// first real single-task view. A rounded shell that *is* the page (not
// a page containing a card), coloured entirely by the deadline's own
// state — see STATE_THEME above. Completed subtasks move into their
// own group ordered by when each was actually finished (most recent
// first, right after the still-open ones) rather than always dropping
// to the very bottom of the whole list.
export function TaskDetailPage() {
  const { id } = useParams()
  const numericId = Number(id)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Reads the task straight out of the shared store rather than
  // keeping its own independent copy — this is what makes the FAB's
  // detail-page actions (add subtask, set deadline, add description)
  // show up here without a full page reload: the FAB mutates through
  // the same store, so this page just re-renders. `status` mirrors the
  // store's own loading/error state; a task genuinely missing from an
  // already-`ready` store (deleted elsewhere, wrong id, not yours) is
  // handled separately below, not as a loading state.
  const { tasks, status, mergeTask, removeTask, refreshTask } = useTaskStore()
  const task = tasks.find((t) => t.id === numericId) ?? null
  const [busyIds, setBusyIds] = useState(() => new Set())
  // Subtask ids mid-celebration — kept sorted as "not yet done" until
  // their timer clears, so checking one off doesn't instantly jump it.
  const [celebratingIds, setCelebratingIds] = useState(() => new Set())
  // Separate, slightly longer-lived set gating each row's confetti
  // overlay — see SUBTASK_CONFETTI_MS above for why it's not the same
  // timer as celebratingIds.
  const [confettiIds, setConfettiIds] = useState(() => new Set())
  const [activeWash, setActiveWash] = useState(null) // { seq, kind: 'complete' | 'reopen' }
  const [activeFireworks, setActiveFireworks] = useState(null) // seq number or null
  const washTimerRef = useRef(null)
  const fireworksTimerRef = useRef(null)
  const [showDeadlineHint, setShowDeadlineHint] = useState(false)
  const [deadlineHintMounted, setDeadlineHintMounted] = useState(false)
  const hintCheckedRef = useRef(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [editingDeadline, openDeadlineEditor, closeDeadlineEditor] = useExclusiveDeadlineEditor()
  const [addingSubtask, setAddingSubtask] = useState(false)
  const deadlineSectionRef = useRef(null)
  const deadlineAnchorRef = useRef(null)
  const subtaskSectionRef = useRef(null)
  // Safe to call unconditionally with an as-yet-null task (dateDeadline
  // undefined just means "no deadline", same as the loaded case) —
  // has to run before the loading/error early returns below since
  // hooks can't be conditional. `liveOverdue` matches the subtask
  // rows on this page: this is the one place the app shows a genuinely
  // ticking "how overdue" duration, in days once it runs past 24h.
  const deadlineStatus = useDeadlineStatus(task?.dateDeadline, task?.completed, { liveOverdue: true })

  useEffect(() => {
    return () => {
      clearTimeout(washTimerRef.current)
      clearTimeout(fireworksTimerRef.current)
    }
  }, [])

  // Opens this page's own subtask/deadline editor in response to
  // `?action=subtask` / `?action=deadline` on the URL — what
  // AddTaskFab's matching detail-page options now do instead of
  // floating a second, separate copy of the same editor next to the
  // FAB itself. Scrolls the opened section into view too, since the
  // subtask one in particular can land below the fold on a task that
  // already has several. Strips the param right after (replace, so
  // back/refresh doesn't re-trigger it) — this is a one-time "open
  // this" signal, not persistent page state.
  useEffect(() => {
    const action = searchParams.get('action')
    if (!action || !task) return
    if (action === 'subtask') {
      // Mutual exclusion with the task's own deadline editor — see
      // openAddSubtask's comment below for why.
      closeDeadlineEditor()
      setAddingSubtask(true)
      subtaskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (action === 'deadline') {
      setAddingSubtask(false)
      openDeadlineEditor()
      deadlineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('action')
        return next
      },
      { replace: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, task])

  // One-time check, the moment the task first loads: if the task or any
  // of its still-open subtasks is close to its deadline, briefly nudge
  // toward extending it. Guarded by a ref (not just `status`) so later
  // refetches — e.g. after checking a subtask off — don't re-trigger it.
  useEffect(() => {
    if (status !== 'ready' || !task || hintCheckedRef.current) return
    hintCheckedRef.current = true

    const anyUrgent =
      isDeadlineUrgent(task.dateDeadline, task.completed) ||
      task.subtasks.some((s) => isDeadlineUrgent(s.dateDeadline, s.completed))

    if (anyUrgent) {
      setDeadlineHintMounted(true)
      setShowDeadlineHint(true)
    }
  }, [status, task])

  // Deliberately a separate effect from the one-time check above rather
  // than starting the timer in there directly: that effect is guarded
  // by a ref so it only ever *decides* to show the hint once, but
  // StrictMode double-invokes effects in development (mount -> cleanup
  // -> mount) to catch exactly this kind of bug — a timer armed and
  // torn down inside a ref-guarded effect never gets re-armed on the
  // second invocation, since the guard blocks it. Keyed on
  // showDeadlineHint instead, this one has no such guard, so it
  // correctly re-arms after StrictMode's cleanup.
  useEffect(() => {
    if (!showDeadlineHint) return
    const timer = setTimeout(() => setShowDeadlineHint(false), DEADLINE_HINT_MS)
    return () => clearTimeout(timer)
  }, [showDeadlineHint])

  // Same "create then re-fetch" pattern as the toggle handler below —
  // this page had no way to add a subtask at all before, only the
  // /tasks list's cascade could.
  async function handleAddSubtask(name, dateDeadline) {
    await createSubTask({ task: id, name, dateDeadline })
    await refreshTask(id)
  }

  // The add-subtask form grows its own deadline picker directly
  // underneath it once open — at the same time as the task's own
  // deadline editor (above, near the title), the two floating
  // DeadlineEditor popovers can land close enough to overlap. Only
  // one deadline editor open on the page at a time.
  function openAddSubtask() {
    closeDeadlineEditor()
    setAddingSubtask(true)
  }

  // Rename the task or a subtask — neither was possible anywhere in
  // the app until now, only creating and (for the task) deleting.
  async function handleRenameTask(name) {
    const updated = await updateTask(id, { name })
    mergeTask({ ...task, ...updated })
  }

  async function handleRenameSubtask(subtask, name) {
    await updateSubTask(subtask.id, { name })
    await refreshTask(id)
  }

  async function handleDeleteSubtask(subtask) {
    await deleteSubTask(subtask.id)
    await refreshTask(id)
  }

  // Same shape as handleRenameSubtask — this page (and the app as a
  // whole, per HANDOFF.md's Known gaps) had no way to set a subtask's
  // deadline once it already existed without one, only at creation
  // time via AddSubtaskForm.
  async function handleSetSubtaskDeadline(subtask, dateDeadline) {
    await updateSubTask(subtask.id, { dateDeadline })
    await refreshTask(id)
  }

  // The task's `description` field has existed on the backend and
  // been settable (creation page, the FAB's own action) for a while,
  // but had no display or edit path anywhere on the task itself — see
  // HANDOFF.md's "Known gaps". Same `updateTask` call the FAB already
  // uses, just with a new call site.
  async function handleSaveDescription(description) {
    const updated = await updateTask(id, { description })
    mergeTask({ ...task, ...updated })
  }

  function fireWash(kind) {
    clearTimeout(washTimerRef.current)
    setActiveWash((prev) => ({ seq: (prev?.seq ?? 0) + 1, kind }))
    washTimerRef.current = setTimeout(() => setActiveWash(null), WASH_MS)
  }

  function fireFireworks() {
    clearTimeout(fireworksTimerRef.current)
    setActiveFireworks((prev) => (prev ?? 0) + 1)
    fireworksTimerRef.current = setTimeout(() => setActiveFireworks(null), FIREWORKS_MS)
  }

  // This is the one place completing a task with open subtasks is
  // actually allowed — the list's own TaskCard stays gated (blocked
  // until every subtask is already done, never auto-completing them);
  // choosing to complete from here instead cascades, closing out
  // whatever's still open first. Reopening doesn't reverse that — the
  // subtasks stay completed, same as the existing "reopening never
  // un-completes subtasks" rule elsewhere. Every toggle also fires the
  // one-shot completion wash (`handoff 2/Celebrations-5c.md` §4); only
  // completing (not reopening) additionally fires the page fireworks,
  // and never a per-subtask confetti burst for the cascade — two
  // celebrations inside the same beat would read as a glitch.
  async function handleToggleTaskComplete() {
    const next = !task.completed
    fireWash(next ? 'complete' : 'reopen')
    if (next) {
      fireFireworks()
      const incomplete = task.subtasks.filter((s) => !s.completed)
      if (incomplete.length > 0) {
        await Promise.all(incomplete.map((s) => updateSubTask(s.id, { completed: true })))
      }
    }
    await updateTask(id, { completed: next })
    await refreshTask(id)
  }

  async function handleDeleteConfirm() {
    setDeleteError(null)
    setDeleting(true)
    try {
      await deleteTask(id)
      removeTask(numericId)
      navigate('/tasks')
    } catch (err) {
      setDeleteError(err.data?.detail ?? 'Could not delete this task.')
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  // Fires the row-scale confetti burst on check only, never on uncheck
  // — same rule the page-level fireworks follows.
  async function handleToggleSubtask(subtask, checked) {
    setBusyIds((current) => new Set(current).add(subtask.id))
    if (checked) {
      setCelebratingIds((current) => new Set(current).add(subtask.id))
      setConfettiIds((current) => new Set(current).add(subtask.id))
      setTimeout(() => {
        setCelebratingIds((current) => {
          const next = new Set(current)
          next.delete(subtask.id)
          return next
        })
      }, SUBTASK_CELEBRATION_MS)
      setTimeout(() => {
        setConfettiIds((current) => {
          const next = new Set(current)
          next.delete(subtask.id)
          return next
        })
      }, SUBTASK_CONFETTI_MS)
    }

    try {
      await updateSubTask(subtask.id, { completed: checked })
      // Re-fetches the whole task rather than patching subtasks locally
      // — completing/reopening a subtask can flip the parent task's own
      // `completed` field server-side (Task.update_completion_status),
      // which this page also displays, so the authoritative task is
      // worth pulling back down instead of guessing at the side effect
      // here.
      await refreshTask(id)
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(subtask.id)
        return next
      })
    }
  }

  // Same shape as TaskCard's own deadline editor — this page just
  // couldn't edit the deadline at all before, only display it read-only
  // via the list. Merges the server's response into local state rather
  // than assuming the optimistic input round-trips unchanged.
  async function handleDeadlineSave(dateDeadline) {
    const updated = await updateTask(id, { dateDeadline })
    mergeTask({ ...task, ...updated })
    closeDeadlineEditor()
  }

  if (status === 'loading') {
    // Same rounded-[30px] / 246px-rail + content shell the real page
    // (and NewTaskPage's own borrowed copy of it) renders into, in the
    // calm 'far' palette — so the page doesn't jump in size once the
    // real theme (chosen by the task's actual deadline state) replaces
    // this placeholder.
    const theme = STATE_THEME.far
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="relative overflow-hidden rounded-[30px]" style={{ background: theme.flood, boxShadow: theme.shadow }}>
          <span aria-hidden="true" className="task-detail-ring" style={{ '--task-accent': theme.border }} />
          <div className="relative z-[2] grid grid-cols-1 items-start md:grid-cols-[246px_1fr]">
            <div
              className="flex flex-col gap-5 self-stretch border-b px-5 py-[22px] md:border-r md:border-b-0"
              style={{
                background: 'linear-gradient(180deg,rgba(255,255,255,.82),rgba(255,255,255,.5))',
                borderColor: theme.hairline,
              }}
            >
              <Skeleton className="h-3.5 w-24 rounded-full" style={{ backgroundColor: theme.strong, opacity: 0.35 }} />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-2.5 w-16 rounded-full" style={{ backgroundColor: theme.strong, opacity: 0.35 }} />
                <Skeleton className="h-9 w-full rounded-xl" style={{ backgroundColor: theme.strong, opacity: 0.15 }} />
              </div>
              <div className="mt-auto flex flex-col gap-2 pt-2">
                <Skeleton className="h-9 w-full rounded-full" style={{ backgroundColor: theme.strong, opacity: 0.25 }} />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-5 px-6 pt-[22px] pb-6">
              <Skeleton className="h-9 w-3/4 rounded-2xl" style={{ backgroundColor: theme.strong, opacity: 0.15 }} />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-28 rounded-full" style={{ backgroundColor: theme.strong, opacity: 0.35 }} />
                <Skeleton className="h-24 w-full rounded-2xl" style={{ backgroundColor: theme.strong, opacity: 0.12 }} />
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-20 rounded-full" style={{ backgroundColor: theme.strong, opacity: 0.35 }} />
                <Skeleton className="h-14 w-full rounded-2xl" style={{ backgroundColor: theme.strong, opacity: 0.12 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <p className="text-sm text-destructive">Couldn&apos;t load this task.</p>
        <Link to="/tasks" className="mt-2 inline-block text-sm text-sky-600 hover:underline">
          Back to tasks
        </Link>
      </div>
    )
  }

  // The store has loaded but this id isn't in it — deleted from
  // another tab/page, or just a bad id. Same shape as the error state
  // above rather than getting stuck on "Loading…" forever.
  if (!task) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <p className="text-sm text-destructive">Couldn&apos;t find this task.</p>
        <Link to="/tasks" className="mt-2 inline-block text-sm text-sky-600 hover:underline">
          Back to tasks
        </Link>
      </div>
    )
  }

  // The deadline owns the palette — completed always wins, then
  // overdue, then due-soon (inside URGENT_WINDOW_MS), then the calm
  // "far" default. See STATE_THEME above.
  const stateKey = task.completed
    ? 'completed'
    : deadlineStatus.isOverdue
      ? 'overdue'
      : deadlineStatus.isUrgent
        ? 'due-soon'
        : 'far'
  const theme = STATE_THEME[stateKey]
  const Glyph = theme.glyph

  const progress = calculateProgress(task)
  const totalItems = task.subtasks.length + 1
  const completedItems = task.subtasks.filter((s) => s.completed).length + (task.completed ? 1 : 0)

  // Incomplete (or still-celebrating) subtasks first, in their existing
  // relative order. Completed ones follow as their own group, ordered
  // by dateCompleted descending — the most recently finished one lands
  // right at the top of that group (i.e. right after the open ones),
  // not at the very bottom of the page. Every completed subtask renders
  // inline here — no cap, no "view more" out to /progress — the page
  // just grows to fit; unlike the main task list (many tasks competing
  // for space), this page is already about one task.
  const openSubtasks = task.subtasks.filter((s) => !s.completed || celebratingIds.has(s.id))
  const completedSubtasks = task.subtasks
    .filter((s) => s.completed && !celebratingIds.has(s.id))
    .sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted))
  const visibleCompletedSubtasks = completedSubtasks
  const sortedSubtasks = [...openSubtasks, ...visibleCompletedSubtasks]

  const hasSubtasks = task.subtasks.length > 0
  const openCount = openSubtasks.length

  // A subtask can be overdue/due-soon on its own even when the task's
  // own deadline (if it even has one) says otherwise — "Demo: cascade
  // with 5 subtasks" has no deadline of its own (always 'far') but can
  // easily have an overdue subtask buried in its list, with nothing on
  // the page ever saying so. Excludes celebrating (just-checked) ones —
  // those are effectively done, same as everywhere else on this page.
  const stillOpenSubtasks = task.subtasks.filter((s) => !s.completed && !celebratingIds.has(s.id))
  const overdueSubtasks = stillOpenSubtasks.filter((s) => s.dateDeadline && new Date(s.dateDeadline).getTime() <= Date.now())
  const dueSoonSubtasks = stillOpenSubtasks.filter((s) => isDeadlineUrgent(s.dateDeadline, false))

  // Banner copy per state — "far" gets no banner at all, *unless* a
  // subtask needs attention the task's own state doesn't already
  // cover (below). A subtask alert never overrides the task's own
  // overdue/due-soon banner (that's already the more urgent fact) but
  // does take priority over the calm default and, since an overdue
  // subtask is worse than the task merely being due soon, over the
  // task's own due-soon banner too. Deliberately not tinted by
  // STATE_THEME — these are fixed colours distinct from the page's own
  // true state, so neither gets confused for that state's own real
  // deadline. Two different fixed colours, not one: overdue stays the
  // established purple "something inside needs a look" alert, but a
  // merely-due-soon subtask gets its own amber — same amber hue
  // (#b45309) every other "set a deadline"-adjacent control in the app
  // already uses, distinct from both the purple overdue-subtask alert
  // and STATE_THEME['due-soon']'s own ember/red-orange (that one's for
  // the *task's own* deadline, not a subtask's).
  const SUBTASK_ALERT_BANNER = 'linear-gradient(90deg,#6b46a8,#4f7fd4)'
  const SUBTASK_DUE_SOON_BANNER = 'linear-gradient(90deg,#b45309,#f59e0b)'
  let bannerCopy = null
  let bannerAction = null
  let bannerBackground = theme.banner
  let BannerGlyph = Glyph
  let bannerGlyphDurationMs = theme.glyphDurationMs
  if (stateKey === 'overdue') {
    bannerCopy = `Overdue by ${deadlineStatus.overdueDisplay ?? '—'} — was due ${formatDeadline(task.dateDeadline)}`
    bannerAction = { label: 'Reschedule', onClick: () => openAddDeadlineEditor() }
  } else if (overdueSubtasks.length > 0) {
    bannerCopy =
      overdueSubtasks.length === 1
        ? `"${overdueSubtasks[0].name}" is overdue`
        : `${pluralize(overdueSubtasks.length, 'subtask')} are overdue`
    bannerBackground = SUBTASK_ALERT_BANNER
    BannerGlyph = TriangleAlert
    bannerGlyphDurationMs = 1800
  } else if (stateKey === 'due-soon') {
    const base = `Due today in ${deadlineStatus.countdownDisplay}`
    bannerCopy = openCount > 0 ? `${base} — ${pluralize(openCount, 'subtask')} still open` : base
    bannerAction = { label: 'Reschedule', onClick: () => openAddDeadlineEditor() }
  } else if (dueSoonSubtasks.length > 0) {
    bannerCopy =
      dueSoonSubtasks.length === 1
        ? `"${dueSoonSubtasks[0].name}" is due soon`
        : `${pluralize(dueSoonSubtasks.length, 'subtask')} are due soon`
    bannerBackground = SUBTASK_DUE_SOON_BANNER
    BannerGlyph = Hourglass
    bannerGlyphDurationMs = 2400
  } else if (stateKey === 'completed') {
    bannerCopy = completionBannerCopy(task)
    bannerAction = { label: 'Reopen', onClick: handleToggleTaskComplete }
  }

  function openAddDeadlineEditor() {
    setAddingSubtask(false)
    openDeadlineEditor()
    deadlineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Time-window bar: how much of the created→deadline span has
  // elapsed. Frozen at the completion time once the task is done,
  // otherwise a plain `Date.now()` read each render — this page
  // already re-renders on every tick useDeadlineStatus produces while
  // urgent/overdue, and a slower-moving bar the rest of the time is
  // fine for something this coarse.
  const createdMs = new Date(task.dateCreated).getTime()
  const deadlineMs = task.dateDeadline ? new Date(task.dateDeadline).getTime() : null
  const referenceNowMs = task.completed && task.dateCompleted ? new Date(task.dateCompleted).getTime() : Date.now()
  const windowFraction =
    deadlineMs !== null && deadlineMs > createdMs
      ? Math.min(1, Math.max(0, (referenceNowMs - createdMs) / (deadlineMs - createdMs)))
      : null

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div
        className={cn('relative overflow-hidden rounded-[30px]', theme.pulseClass)}
        style={{
          background: theme.flood,
          boxShadow: theme.pulseClass ? undefined : theme.shadow,
          transition: 'background 700ms ease',
        }}
      >
        <span aria-hidden="true" className="task-detail-ring" style={{ '--task-accent': theme.border }} />
        {activeWash && <CompletionWash key={activeWash.seq} kind={activeWash.kind} />}
        {activeFireworks && <TaskFireworks key={activeFireworks} />}

        {bannerCopy && (
          <div
            className="relative z-[2] flex items-center gap-2.5 py-2.5 pr-[22px] pl-5 text-white"
            style={{ background: bannerBackground, transition: 'background 700ms ease' }}
          >
            {BannerGlyph && (
              <BannerGlyph
                aria-hidden="true"
                strokeWidth={2.4}
                className={cn('size-[15px] shrink-0', stateKey !== 'completed' && 'animate-glyph-beat')}
                style={bannerGlyphDurationMs ? { animationDuration: `${bannerGlyphDurationMs}ms` } : undefined}
              />
            )}
            <p className="flex-1 text-[12.5px] font-black tracking-[.01em] tabular-nums">{bannerCopy}</p>
            {bannerAction && (
              <button
                type="button"
                onClick={bannerAction.onClick}
                className="rounded-full border px-[13px] py-1 text-[11.5px] font-bold text-white transition-colors hover:bg-white"
                style={{ borderColor: 'rgba(255,255,255,.55)', background: 'rgba(255,255,255,.14)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = theme.strong)}
                onMouseLeave={(e) => (e.currentTarget.style.color = '')}
              >
                {bannerAction.label}
              </button>
            )}
          </div>
        )}

        <div className="relative z-[2] grid grid-cols-1 items-start md:grid-cols-[246px_1fr]">
          {/* ---------------------------------------------------------- Left rail */}
          <div
            className="flex flex-col gap-5 self-stretch border-b px-5 py-[22px] md:border-r md:border-b-0"
            style={{
              background: 'linear-gradient(180deg,rgba(255,255,255,.82),rgba(255,255,255,.5))',
              borderColor: theme.hairline,
            }}
          >
            <Link
              to="/tasks"
              className="inline-flex items-center gap-1 text-xs font-bold"
              style={{ color: theme.strong }}
            >
              <ArrowLeft className="size-3.5" />
              Back to tasks
            </Link>

            <ProgressDial pct={progress} k={completedItems} n={totalItems} theme={theme} />

            <div className="flex flex-col items-center gap-1.5">
              <PrimaryActionButton task={task} theme={theme} onClick={handleToggleTaskComplete} />
              {!task.completed && hasSubtasks && (
                <p className="text-center text-[10.5px]" style={{ color: theme.strong }}>
                  {openCount > 0
                    ? `Completing from here closes ${pluralize(openCount, 'open subtask')}.`
                    : 'Every subtask is already done.'}
                </p>
              )}
            </div>

            <div ref={deadlineSectionRef} className="flex flex-col gap-2.5">
              {task.completed ? (
                <div>
                  <p className="text-[10px] font-black tracking-[.12em] uppercase" style={{ color: theme.strong }}>
                    Deadline
                  </p>
                  <div className="mt-1 rounded-xl border bg-white px-3 py-2" style={{ borderColor: theme.hairline }}>
                    <p className="text-[13px] font-black" style={{ color: theme.title }}>
                      {task.dateDeadline ? formatDeadline(task.dateDeadline) : 'None set'}
                    </p>
                    {task.dateDeadline && (
                      <p className="mt-0.5 text-[10.5px] font-bold capitalize" style={{ color: theme.strong }}>
                        {deadlineOutcomeClause(task) ?? 'Deadline passed'}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div ref={deadlineAnchorRef} className="relative">
                  <p className="text-[10px] font-black tracking-[.12em] uppercase" style={{ color: theme.strong }}>
                    Deadline
                  </p>
                  {editingDeadline && (
                    <DeadlineEditor
                      anchorRef={deadlineAnchorRef}
                      value={task.dateDeadline}
                      onSave={handleDeadlineSave}
                      onCancel={closeDeadlineEditor}
                      minDayOffset={0}
                    />
                  )}
                  {!editingDeadline && (
                    <button
                      type="button"
                      onClick={openAddDeadlineEditor}
                      className="group mt-1 flex w-full items-center justify-between rounded-xl border bg-white px-3 py-2 text-left"
                      style={{ borderColor: theme.hairline }}
                    >
                      <span>
                        <span className="block text-[13px] font-black" style={{ color: theme.title }}>
                          {task.dateDeadline ? formatDeadline(task.dateDeadline) : 'Set deadline'}
                        </span>
                        {task.dateDeadline && (
                          <span className="mt-0.5 block text-[10.5px] font-bold tabular-nums" style={{ color: theme.strong }}>
                            {deadlineStatus.isOverdue
                              ? `${deadlineStatus.overdueDisplay} overdue`
                              : deadlineStatus.isUrgent
                                ? `Due in ${deadlineStatus.countdownDisplay}`
                                : formatRoughRemaining(deadlineMs - Date.now())}
                          </span>
                        )}
                      </span>
                      <Pencil className="size-3.5 shrink-0" style={{ color: theme.strong }} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              <div>
                <p className="text-[10px] font-black tracking-[.12em] uppercase" style={{ color: 'oklch(0.556 0 0)' }}>
                  Created
                </p>
                <p className="mt-1 text-[12.5px] font-bold" style={{ color: 'oklch(0.35 0 0)' }}>
                  {formatDeadline(task.dateCreated)}
                </p>
              </div>

              {windowFraction !== null && (
                <div>
                  <p className="text-[10px] font-black tracking-[.12em] uppercase" style={{ color: theme.strong }}>
                    Time window
                  </p>
                  <div className="mt-1.5 h-[5px] w-full overflow-hidden rounded-full" style={{ background: theme.soft }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${Math.round(windowFraction * 100)}%`, background: theme.windowFill }}
                    />
                  </div>
                  <p className="mt-1 text-[10.5px] font-bold" style={{ color: theme.strong }}>
                    {Math.round(windowFraction * 100)}% of the window used
                  </p>
                </div>
              )}
            </div>

            <div className="mt-auto pt-2">
              {confirmingDelete ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-2.5">
                  <p className="text-[11px] text-red-800">Are you sure you want to delete this task?</p>
                  <div className="mt-2 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                      className="text-[11px] text-muted-foreground hover:underline"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteConfirm}
                      disabled={deleting}
                      className="text-[11px] font-bold text-red-700 hover:underline"
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                  {deleteError && <p className="mt-1 text-[11px] text-red-700">{deleteError}</p>}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-red-100 hover:text-red-700"
                >
                  <Trash2 className="size-3.5" />
                  Delete task
                </button>
              )}
            </div>
          </div>

          {/* ------------------------------------------------------ Content column */}
          <div className="flex min-w-0 flex-col gap-5 px-6 pt-[22px] pb-6">
            <TitleEditor value={task.name} onSave={handleRenameTask} completed={task.completed} titleColor={theme.title} />

            <section className="flex flex-col gap-3">
              <SectionHeader label="Description" hairline={theme.hairline} strong={theme.strong} />
              <DescriptionPanel description={task.description} onSave={handleSaveDescription} border={theme.border} strong={theme.strong} />
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Subtasks" hairline={theme.hairline} strong={theme.strong}>
                {hasSubtasks && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-black"
                    style={{ background: theme.soft, color: theme.strong }}
                  >
                    {openCount > 0
                      ? `${pluralize(openCount, 'open')} · ${completedSubtasks.length} done`
                      : `All ${task.subtasks.length} done`}
                  </span>
                )}
                <button
                  type="button"
                  onClick={openAddSubtask}
                  className="rounded-full px-3 py-1 text-[11.5px] font-bold text-white"
                  style={{ background: theme.title }}
                >
                  + Add subtask
                </button>
              </SectionHeader>

              {hasSubtasks ? (
                <SubtaskFlipList subtasks={sortedSubtasks}>
                  {(subtask, index) => {
                    const checked = subtask.completed || celebratingIds.has(subtask.id)
                    return (
                      <DetailSubtaskRow
                        index={index + 1}
                        subtask={subtask}
                        checked={checked}
                        confetti={confettiIds.has(subtask.id)}
                        busy={busyIds.has(subtask.id)}
                        theme={theme}
                        onToggle={(value) => handleToggleSubtask(subtask, value)}
                        onRename={(name) => handleRenameSubtask(subtask, name)}
                        onDelete={() => handleDeleteSubtask(subtask)}
                        onSetDeadline={(dateDeadline) => handleSetSubtaskDeadline(subtask, dateDeadline)}
                      />
                    )
                  }}
                </SubtaskFlipList>
              ) : (
                <p className="text-sm text-muted-foreground">No subtasks yet.</p>
              )}

              <div ref={subtaskSectionRef}>
                {addingSubtask ? (
                  <AddSubtaskForm onAdd={handleAddSubtask} onCancel={() => setAddingSubtask(false)} theme={theme} />
                ) : !hasSubtasks ? (
                  <p className="text-sm text-muted-foreground">
                    Want to break this down into smaller chunks?{' '}
                    <button type="button" onClick={openAddSubtask} className="font-bold hover:underline" style={{ color: theme.strong }}>
                      Add subtasks
                    </button>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={openAddSubtask}
                    className="text-xs font-bold hover:underline"
                    style={{ color: theme.strong }}
                  >
                    + Add another subtask
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <ActivityLog entries={task.activityLog} theme={theme} />

      {deadlineHintMounted && (
        <div
          className={cn(
            'pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg transition-opacity duration-500',
            showDeadlineHint ? 'opacity-100' : 'opacity-0'
          )}
        >
          Something here is due soon — consider extending the deadline.
        </div>
      )}
    </div>
  )
}

// Full-width pill in the rail — replaces the list's Pending/Complete
// status-chip look on purpose (`handoff 2/TaskDetailPage-5b.md` §2.3):
// on a page about one task, the main action shouldn't read as a status
// badge. Completing here is never blocked (unlike TaskCard's own
// button) — it cascades any still-open subtasks — so there's no
// disabled state to design for, just complete <-> undo.
//
// Same hover-fill-bar preview mechanic as the list's own
// PendingCompleteButton (TaskCard.jsx): hovering for HOVER_FILL_MS
// sweeps a highlight across the pill and flips the label, previewing
// what a click would do, before the click itself — a click is always
// live immediately regardless of hover progress, this is purely a
// preview. Adapted rather than reused outright since this pill is
// already the state's full `cta` gradient at rest (the card's version
// fills *into* colour from a muted `bg-secondary`) — here the sweep is
// a light overlay instead, and it fills from the left when marking
// complete, from the right when undoing, mirroring the card's two
// directions.
const HOVER_FILL_MS = 350

function PrimaryActionButton({ task, theme, onClick }) {
  const [pending, setPending] = useState(false)
  const [hoverPreview, setHoverPreview] = useState(false)
  const timerRef = useRef(null)

  function handleMouseEnter() {
    timerRef.current = setTimeout(() => setHoverPreview(true), HOVER_FILL_MS)
  }

  function handleMouseLeave() {
    clearTimeout(timerRef.current)
    setHoverPreview(false)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  async function handleClick() {
    // Same reasoning as PendingCompleteButton's own click handler:
    // reset the preview immediately rather than leaving it showing
    // through the async completion round-trip, so the real new state
    // (task.completed flips once the request lands) doesn't collide
    // with a stale hover preview a moment later.
    clearTimeout(timerRef.current)
    setHoverPreview(false)
    setPending(true)
    try {
      await onClick()
    } finally {
      setPending(false)
    }
  }

  const label = task.completed ? (hoverPreview ? 'Undo' : 'Completed') : hoverPreview ? 'Complete' : 'Mark complete'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="group relative w-full overflow-hidden rounded-full border-none px-[18px] py-[11px] text-[13.5px] font-black text-white disabled:opacity-70"
      style={{ background: theme.cta, boxShadow: theme.ctaShadow }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 scale-x-0 bg-white/25 transition-transform ease-linear group-hover:scale-x-100',
          task.completed ? 'origin-right' : 'origin-left'
        )}
        style={{ transitionDuration: `${HOVER_FILL_MS}ms` }}
      />
      <span className="relative">{pending ? 'Saving…' : label}</span>
    </button>
  )
}

// 150x150 SVG dial, rotated so the fill starts at 12 o'clock. Track is
// the state's `soft` colour; the fill is a per-instance gradient (a
// stable id via useId, since more than one dial could theoretically
// exist in the DOM at once and gradient ids are global).
function ProgressDial({ pct, k, n, theme }) {
  const gradientId = useId()
  const radius = 62
  const circumference = 389 // 2*pi*62, spelled out verbatim per the handoff
  const offset = circumference - circumference * (pct / 100)

  return (
    <div className="relative mx-auto size-[150px]">
      <svg viewBox="0 0 150 150" className="size-[150px] -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {theme.ring.map((stop, i) => {
              const [color, offsetPct] = stop.split(' ')
              return <stop key={i} offset={offsetPct ?? `${(i / (theme.ring.length - 1)) * 100}%`} stopColor={color} />
            })}
          </linearGradient>
        </defs>
        <circle cx="75" cy="75" r={radius} fill="none" stroke={theme.soft} strokeWidth="13" />
        <circle
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[32px] leading-none font-black tracking-[-0.03em]" style={{ color: theme.title }}>
          {pct}%
        </span>
        <span className="mt-1.5 text-[11px] font-bold" style={{ color: theme.strong }}>
          {k} of {n} done
        </span>
      </div>
    </div>
  )
}

// Always-visible title editor (unlike the shared InlineEditableName's
// hover-reveal pencil elsewhere in the app) — the whole line is the
// edit affordance here, per the handoff.
function TitleEditor({ value, onSave, completed, titleColor }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (err) {
      setError(err.data?.name?.[0] ?? 'Could not save that name.')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-lg border border-input bg-white px-2.5 py-1 text-[27px] leading-[1.18] font-black tracking-[-0.025em] outline-none focus-visible:border-ring"
            style={{ color: titleColor }}
          />
          <button type="submit" disabled={saving} className="text-xs font-bold text-emerald-700 hover:underline">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setDraft(value)
              setError(null)
            }}
            disabled={saving}
            className="text-xs text-muted-foreground hover:underline"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="-ml-2 inline-flex min-w-0 items-center gap-1.5 rounded-[10px] px-2 py-0.5 text-left transition-colors hover:bg-white/75"
    >
      <span
        className="truncate text-[27px] leading-[1.18] font-black tracking-[-0.025em]"
        style={{
          color: titleColor,
          textWrap: 'pretty',
          textDecorationLine: completed ? 'line-through' : 'none',
          textDecorationColor: completed ? 'rgba(4,120,87,.45)' : undefined,
        }}
      >
        {value}
      </span>
      <Pencil className="size-[15px] shrink-0" style={{ opacity: 0.6, color: titleColor }} aria-hidden="true" />
    </button>
  )
}

function SectionHeader({ label, hairline, strong, children }) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="text-[11px] font-black tracking-[.12em] uppercase" style={{ color: strong }}>
        {label}
      </h2>
      <span
        className="h-px flex-1"
        style={{ background: `linear-gradient(90deg,${hairline},rgba(255,255,255,0))` }}
      />
      {children}
    </div>
  )
}

// Fully framed description panel — same 3px gradient border as the
// page shell, so it reads as a sibling of the shell rather than a
// nested card. Closes a long-standing gap: the task's `description`
// field could be set (creation page, the FAB) but never displayed or
// edited anywhere on the task itself.
function DescriptionPanel({ description, onSave, border, strong }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function startEditing() {
    setDraft(description ?? '')
    setError(null)
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft.trim() ? draft.trim() : null)
      setEditing(false)
    } catch (err) {
      setError(err.data?.description?.[0] ?? 'Could not save that description.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-[18px] p-[3px] shadow-[0_10px_26px_-22px_rgba(0,0,0,.35)]" style={{ background: border }}>
      <div className="rounded-[15px] bg-white/94 px-[18px] py-4">
        {editing ? (
          // The textarea *is* the panel here — no separate bordered
          // box nested inside it (a "box in a box" against the
          // panel's own frame) — same font size/line-height/max-width
          // as the read view below, so switching into edit mode
          // doesn't visually jump.
          <div className="flex flex-col gap-2.5">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              className="w-full max-w-[62ch] resize-y bg-transparent text-[14.5px] leading-[1.72] outline-none"
              style={{ color: 'oklch(0.28 0 0)' }}
              placeholder="Add some context so this task still makes sense next week."
            />
            <div className="flex items-center gap-3 border-t border-black/[.06] pt-2.5">
              <button type="button" onClick={handleSave} disabled={saving} className="text-xs font-bold text-emerald-700 hover:underline">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                }}
                disabled={saving}
                className="text-xs text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : description ? (
          <div className="group/desc relative pr-6">
            <button
              type="button"
              onClick={startEditing}
              aria-label="Edit description"
              className="absolute top-0 right-0 opacity-60 transition-opacity hover:opacity-100"
            >
              <Pencil className="size-[15px]" aria-hidden="true" />
            </button>
            <p
              className="max-w-[62ch] text-[14.5px] leading-[1.72] whitespace-pre-wrap"
              style={{ color: 'oklch(0.28 0 0)', textWrap: 'pretty' }}
            >
              {description}
            </p>
          </div>
        ) : (
          // The whole empty-state line is the click target now, not
          // just the "Add some context" words — a blank box with only
          // a few words of it actually clickable read as broken.
          <button type="button" onClick={startEditing} className="block w-full text-left text-sm" style={{ color: 'oklch(0.556 0 0)' }}>
            No description yet.{' '}
            <span className="font-bold" style={{ color: strong }}>
              Add some context
            </span>{' '}
            so this task still makes sense next week.
          </button>
        )}
      </div>
    </div>
  )
}

// One numbered subtask row. Its own component (rather than inline in
// the SubtaskFlipList callback) because it needs a live-ticking
// useDeadlineStatus for the overdue case — that's a hook call, and the
// list it's rendered from can grow or shrink, so it has to live inside
// something that mounts/unmounts per-item rather than a bare loop
// inside TaskDetailPage's own render. This is the one place in the app
// that opts into `liveOverdue`: unlike the list cards (a static
// "Overdue" badge + the plain due date is enough there), the detail
// page is where someone's actually looking at one task, so the "how
// overdue" duration ticks for real, in days once it runs past 24h.
//
// Completed rows stay emerald in every page state — green is the
// completion signal at row level; if it took the page hue you'd lose
// the ability to see which rows are done on an overdue page.
function DetailSubtaskRow({ index, subtask, checked, confetti, busy, theme, onToggle, onRename, onDelete, onSetDeadline }) {
  const status = useDeadlineStatus(subtask.dateDeadline, checked, { liveOverdue: true })
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(subtask.name)
  const [renameError, setRenameError] = useState(null)
  const deleteRef = useRef(null)
  // Was previously nowhere on this page — a subtask with no deadline
  // yet had no "set one" control at all here (see HANDOFF.md's Known
  // gaps), only ever settable from the add-subtask form at creation
  // time. Same exclusive-popover coordination every other deadline
  // trigger in the app uses.
  const [editingDeadline, openDeadlineEditor, closeDeadlineEditor] = useExclusiveDeadlineEditor()
  const deadlineAnchorRef = useRef(null)

  useEffect(() => {
    if (!renaming) setDraft(subtask.name)
  }, [subtask.name, renaming])

  // Same "click outside closes it" behavior as the list view's own
  // subtask delete confirm (SubtaskStackCard) — this was the one place
  // in the app that still had no delete-subtask UI at all.
  useEffect(() => {
    if (!confirmingDelete) return
    function handleOutsideClick(e) {
      if (deleteRef.current && !deleteRef.current.contains(e.target)) {
        setConfirmingDelete(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [confirmingDelete])

  async function handleDeleteConfirm() {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  async function handleRenameSubmit(e) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) return
    setRenameError(null)
    try {
      await onRename(trimmed)
      setRenaming(false)
    } catch (err) {
      setRenameError(err.data?.name?.[0] ?? 'Could not save that name.')
    }
  }

  async function handleDeadlineSave(dateDeadline) {
    await onSetDeadline(dateDeadline)
    closeDeadlineEditor()
  }

  // A row borrows its OWN urgency's palette rather than the page's —
  // same principle as completed rows always being emerald regardless
  // of page state (§3/§5 of the original handoff), extended to cover
  // overdue/due-soon too: an overdue subtask reads as overdue (red)
  // even sitting on an otherwise-calm 'far' page, and a due-soon one
  // reads amber the same way. Only a row with no urgency of its own
  // falls back to the page's theme.
  const rowPalette = status.isOverdue ? STATE_THEME.overdue : status.isUrgent ? STATE_THEME['due-soon'] : theme

  const indexColor = checked ? '#047857' : rowPalette.strong
  const rowBg = checked ? 'bg-[rgba(240,253,246,0.75)] hover:bg-[rgba(240,253,246,0.9)]' : 'bg-transparent hover:bg-white/80'

  // Done badge is a plain, non-interactive span (editing a completed
  // subtask's deadline isn't a thing anywhere else in the app either).
  // Every other case — overdue/urgent/plain-future *and* no-deadline-yet
  // — is a real button that opens the same DeadlineEditor popover, so a
  // subtask that already has a deadline can actually have it changed
  // from this page; before this it was only ever settable once, from
  // nothing, never editable again afterward.
  let badgeContent, badgeClassName, badgeStyle
  if (checked) {
    badgeContent = subtask.dateCompleted ? `Done ${formatShortDate(subtask.dateCompleted)}` : 'Done'
    badgeClassName = 'rounded-full bg-[#d1fae5] px-2 py-0.5 text-[11px] font-black text-[#047857] tabular-nums'
  } else if (subtask.dateDeadline && status.isOverdue) {
    // Fixed red, not the page's own theme — same reasoning as
    // rowPalette above — plus a pulse, so an overdue subtask can't get
    // lost in the row the way a plain badge would.
    badgeContent = status.overdueDisplay ? `${status.overdueDisplay} overdue` : 'Overdue'
    badgeClassName =
      'animate-badge-pulse-red rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums transition-[filter] hover:brightness-95'
    badgeStyle = { background: STATE_THEME.overdue.soft, color: STATE_THEME.overdue.strong }
  } else if (subtask.dateDeadline && status.isUrgent) {
    badgeContent = `Due in ${status.countdownDisplay}`
    badgeClassName =
      'animate-badge-pulse-ember rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums transition-[filter] hover:brightness-95'
    badgeStyle = { background: STATE_THEME['due-soon'].soft, color: STATE_THEME['due-soon'].strong }
  } else if (subtask.dateDeadline) {
    badgeContent = `Due ${formatDeadline(subtask.dateDeadline)}`
    badgeClassName = 'rounded-full bg-[#f3e8ff] px-2 py-0.5 text-[11px] font-black text-[#6b46a8] tabular-nums transition-colors hover:bg-[#e9d5ff]'
  } else {
    // No deadline yet — soft purple, same pair as every other "set a
    // deadline" trigger in the app now uses (AddSubtaskForm's own
    // included, and the list view's own equivalent on TaskCard) —
    // used to be amber here, same as those, before this pass.
    badgeContent = 'Set deadline'
    badgeClassName = 'rounded-full bg-[#f3e8ff] px-2 py-0.5 text-[11px] font-black text-[#6b46a8] transition-colors hover:bg-[#e9d5ff]'
  }

  const badge = checked ? (
    <span className={badgeClassName}>{badgeContent}</span>
  ) : (
    <div ref={deadlineAnchorRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (editingDeadline ? closeDeadlineEditor() : openDeadlineEditor())}
        className={badgeClassName}
        style={badgeStyle}
      >
        {badgeContent}
      </button>
      {editingDeadline && (
        <DeadlineEditor anchorRef={deadlineAnchorRef} value={subtask.dateDeadline} onSave={handleDeadlineSave} onCancel={closeDeadlineEditor} />
      )}
    </div>
  )

  return (
    <div
      className={cn('relative flex items-center gap-[13px] border-t px-3.5 py-[13px] transition-colors duration-500', rowBg)}
      style={{ borderColor: rowPalette.hairline }}
    >
      {confetti && <SubtaskConfetti />}
      <button
        type="button"
        onClick={() => onToggle(!checked)}
        disabled={busy}
        aria-label={checked ? 'Mark subtask incomplete' : 'Mark subtask complete'}
        className={cn(
          'flex size-[19px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] transition-colors',
          checked ? 'border-emerald-500 bg-emerald-500' : 'bg-white'
        )}
        style={!checked ? { borderColor: rowPalette.strong } : undefined}
      >
        {checked && <Check className="size-[11px] text-white" strokeWidth={3} aria-hidden="true" />}
      </button>

      <span className="w-[22px] shrink-0 text-[11px] font-black tabular-nums" style={{ color: indexColor }}>
        {index}
      </span>

      {renaming ? (
        <form onSubmit={handleRenameSubmit} className="flex flex-1 items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-md border border-input bg-white px-2 py-1 text-sm outline-none focus-visible:border-ring"
          />
          <button type="submit" className="text-xs font-bold text-emerald-700 hover:underline">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false)
              setDraft(subtask.name)
              setRenameError(null)
            }}
            className="text-xs text-muted-foreground hover:underline"
          >
            Cancel
          </button>
          {renameError && <p className="text-xs text-destructive">{renameError}</p>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          className="min-w-0 flex-1 truncate text-left text-sm font-bold"
          style={{ color: checked ? 'oklch(0.556 0 0)' : rowPalette.title, textDecoration: checked ? 'line-through' : 'none' }}
        >
          {subtask.name}
        </button>
      )}

      {badge}

      <div className="relative shrink-0" ref={deleteRef}>
        {confirmingDelete ? (
          <div className="absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border bg-card p-2.5 text-left shadow-lg">
            <p className="text-[11px] text-muted-foreground">Are you sure you want to delete this subtask?</p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="text-[11px] text-muted-foreground hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="text-[11px] font-bold text-destructive hover:underline"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete subtask"
            className="flex size-[28px] items-center justify-center rounded-full transition-colors hover:bg-black/5"
            style={{ color: indexColor }}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// Renders the subtask list and slides each row from its previous
// position to its new one whenever the order changes (the FLIP
// technique: measure before, measure after, animate the difference).
// Plain flow-layout reordering otherwise just jumps instantly — there's
// no CSS property to transition when an element's position in the DOM
// changes. Deliberately basic: no animation library, just one
// requestAnimationFrame and a transform reset.
function SubtaskFlipList({ subtasks, children }) {
  const nodeRefs = useRef(new Map())
  const prevRects = useRef(new Map())
  // One in-flight FLIP animation's teardown per subtask id — the actual
  // bug behind "a row stays stuck offset forever": `subtasks` is a fresh
  // array every render (the parent derives it via filter/sort), so this
  // effect re-runs far more often than just "the order actually
  // changed" — including, in dev, StrictMode invoking it twice back to
  // back for the same commit. If a *second* animation starts on a row
  // while the *first* one's single `requestAnimationFrame` reset is
  // still pending, both eventually fire and both try to zero the
  // transform — usually harmless, but the two also fight over
  // `el.style.transition`, and losing that race can leave the reset
  // never actually applied. Tracking (and cancelling) whichever cycle
  // was already running before starting a new one removes the race
  // instead of hoping it resolves in the right order.
  const inFlightRef = useRef(new Map())

  useLayoutEffect(() => {
    // Clearing before every measurement means this always reads the
    // *true* laid-out position, not one still offset by a previous
    // cycle's transform — and self-heals the stuck-forever symptom the
    // moment anything re-renders this list, even if the animation that
    // caused it never cleaned up after itself.
    nodeRefs.current.forEach((el) => {
      if (el) el.style.transform = ''
    })

    const newRects = new Map()
    nodeRefs.current.forEach((el, id) => {
      // + window.scrollY makes this document-relative rather than
      // viewport-relative — getBoundingClientRect().top alone shifts by
      // the scroll distance on every scroll, even though nothing
      // actually reordered, so a re-render that lands mid-scroll (e.g.
      // a live-ticking countdown elsewhere) would compute a huge fake
      // "delta" for every row and fly them all across the screen trying
      // to animate a move that never happened.
      if (el) newRects.set(id, el.getBoundingClientRect().top + window.scrollY)
    })

    nodeRefs.current.forEach((el, id) => {
      if (!el) return
      const prevTop = prevRects.current.get(id)
      const newTop = newRects.get(id)
      if (prevTop === undefined || newTop === undefined) return
      const delta = prevTop - newTop
      // Sub-pixel deltas (a neighbouring row's live-ticking countdown
      // text nudging layout by a fraction of a px) aren't worth
      // animating and, left unfiltered, can retrigger this every tick.
      if (Math.abs(delta) < 1) return

      // Cancel whatever cycle was already running for this row before
      // starting a new one, rather than letting two race.
      inFlightRef.current.get(id)?.()

      el.style.transition = 'none'
      el.style.transform = `translateY(${delta}px)`
      // Forces the browser to apply the transform above before the
      // transition below is added, otherwise it'd animate from 0 too.
      el.getBoundingClientRect()

      let settled = false
      function settle() {
        if (settled) return
        settled = true
        el.style.transition = ''
        el.style.transform = ''
        el.removeEventListener('transitionend', settle)
        clearTimeout(safetyTimer)
        inFlightRef.current.delete(id)
      }

      const rafId = requestAnimationFrame(() => {
        el.style.transition = 'transform 300ms ease-out'
        el.style.transform = ''
      })
      // `transitionend` is the authoritative "actually done" signal;
      // the timeout is a safety net in case it never fires (interrupted
      // transition, zero-duration edge case) — either way this row
      // isn't left stuck.
      el.addEventListener('transitionend', settle)
      const safetyTimer = setTimeout(settle, 500)

      inFlightRef.current.set(id, () => {
        cancelAnimationFrame(rafId)
        el.removeEventListener('transitionend', settle)
        clearTimeout(safetyTimer)
        settled = true
      })
    })

    prevRects.current = newRects
  }, [subtasks])

  return (
    <div className="flex flex-col">
      {subtasks.map((subtask, index) => (
        <div key={subtask.id} ref={(el) => nodeRefs.current.set(subtask.id, el)}>
          {children(subtask, index)}
        </div>
      ))}
    </div>
  )
}

// Consecutive same-kind events fold into one row, summing a count into
// line 1 (ActivityLog-6b.md §6) — only for the three kinds that
// realistically burst (a subtask checked/added/removed in a run).
// Renames, deadline changes, and completion are never collapsed, even
// back to back — each one is its own fact worth its own line.
const COLLAPSE_WINDOW_MS = 5 * 60 * 1000
const COLLAPSIBLE_KINDS = new Set(['check', 'add', 'remove'])

function collapsedLabel(kind, count) {
  if (kind === 'check') return `${pluralize(count, 'subtask')} checked`
  if (kind === 'add') return `${pluralize(count, 'subtask')} added`
  return `${pluralize(count, 'subtask')} removed`
}

// Classifies a precomputed log message into a spine node's kind/icon/
// fill (ActivityLog-6b.md §5) purely by pattern-matching its text —
// the backend only ever wrote a plain sentence (see
// backend/tasks/models.py's _log_task_changes/_log_subtask_changes),
// no structured event type, and per the handoff's own scope ("no
// changes to how events are fetched, ordered, or written") that stays
// true here too. `hollow` nodes (renames) get a white fill + coloured
// ring instead of a solid fill, per the handoff's "filled = something
// changed the task, hollow = something changed its text" rule —
// extended from just "description edited" (not yet its own logged
// event) to cover subtask/task renames, the other text-only change
// this app actually logs today.
function classifyActivity(message) {
  // Every message the backend writes follows a fixed template with the
  // task/subtask's own (arbitrary, user-chosen) name quoted in the
  // middle — `Subtask "X" removed`, never `removed` itself inside the
  // name. Matching on the message's actual *tail* (or, for the two
  // deadline-value variants, a fixed multi-word phrase) rather than a
  // bare `includes()` on the whole string is what keeps a subtask
  // literally named e.g. "Verify set-deadline" from misclassifying its
  // own "added"/"removed" events as a deadline change just because the
  // word "deadline" happens to appear in its name.
  if (message.endsWith('marked complete')) {
    return message.startsWith('Task')
      ? { kind: 'complete', Icon: CircleCheckBig, fill: '#047857' }
      : { kind: 'check', Icon: Check, fill: '#10b981' }
  }
  if (message.endsWith('reopened')) {
    return { kind: 'reopen', Icon: RotateCcw, fill: '#64748b' }
  }
  if (message.includes('" renamed to "')) {
    return { kind: 'rename', Icon: Pencil, hollow: true, ring: '#4f8ef7' }
  }
  if (
    message.endsWith('deadline cleared') ||
    message.includes('deadline set to ') ||
    message.includes('deadline changed to ')
  ) {
    return { kind: 'deadline', Icon: Clock, fill: '#b45309' }
  }
  if (message.endsWith('removed')) {
    return { kind: 'remove', Icon: Trash2, fill: '#7c5fb0' }
  }
  // Covers both "Task created" and "Subtask ... added".
  return { kind: 'add', Icon: Plus, fill: '#7c5fb0' }
}

// `entries` arrive oldest-first (see TaskActivitySerializer's
// ordering); this walks them in that order so "consecutive" and "the
// group's newest timestamp" both mean the right thing, then the caller
// reverses the result for newest-first display.
function collapseActivity(entries) {
  const rows = []
  for (const entry of entries) {
    const info = classifyActivity(entry.message)
    const last = rows[rows.length - 1]
    const withinWindow =
      last && new Date(entry.dateCreated) - new Date(last.dateCreated) <= COLLAPSE_WINDOW_MS
    if (COLLAPSIBLE_KINDS.has(info.kind) && last?.kind === info.kind && withinWindow) {
      last.count += 1
      last.dateCreated = entry.dateCreated
    } else {
      rows.push({ ...info, id: entry.id, message: entry.message, dateCreated: entry.dateCreated, count: 1 })
    }
  }
  return rows
}

// Relative under 24h, absolute beyond — same rule the due-date badges
// elsewhere already follow (ActivityLog-6b.md §4).
function formatActivityTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return formatDeadline(iso)
}

// Full-width, below the page shell — the original placement/sizing
// this page's activity log always had, just with `ActivityLog-6b.md`'s
// spine/node visual language grafted on (bigger throughout than the
// handoff's own rail-digest sizing, since there's a full content
// column of room here instead of 246px). Shows *every* event, no
// four-row cap and no "Full history →" link — there's nowhere else in
// this app that full history would even go yet, and this was explicit
// in the request that drove this version: everything belongs on the
// one screen. No actor line either (`You · ...` dropped) — every event
// on this page is the same one account, so naming the actor adds
// nothing.
function ActivityLog({ entries, theme }) {
  // Reveals ACTIVITY_PAGE_SIZE more rows per click rather than the
  // usual "hidden count → link out" pattern elsewhere on this page —
  // there's nowhere else for activity to go (no per-task history view
  // exists), so "View more" has to grow this same list in place until
  // everything's shown.
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_PAGE_SIZE)

  if (!entries || entries.length === 0) return null

  // Oldest-first is what §6's collapsing wants to walk; reversed only
  // for display, since the spine itself reads newest-at-top.
  const allRows = [...collapseActivity(entries)].reverse()
  const rows = allRows.slice(0, visibleCount)
  const remaining = allRows.length - rows.length

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2.5">
        <h2 className="text-[11px] font-black tracking-[.12em] uppercase" style={{ color: theme.strong }}>
          Activity
        </h2>
        <span className="h-px flex-1" style={{ background: `linear-gradient(90deg,${theme.hairline},rgba(255,255,255,0))` }} />
        <span className="text-xs font-bold tabular-nums" style={{ color: theme.muted }}>
          {entries.length}
        </span>
      </div>

      <div className="relative mt-4 flex flex-col gap-4 pl-8">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute w-[3px] rounded-full opacity-70"
          style={{
            left: '9.5px',
            top: '10px',
            bottom: '14px',
            background: `linear-gradient(180deg,${theme.spineTop} 0%,#7c5fb0 52%,#8ec5fc 100%)`,
          }}
        />
        {rows.map((row) => (
          <div key={row.id} className="relative flex flex-col gap-1">
            <span
              aria-hidden="true"
              className="absolute flex size-5 items-center justify-center rounded-full"
              style={{
                left: '-32px',
                top: '0px',
                background: row.hollow ? '#fff' : row.fill,
                boxShadow: row.hollow
                  ? `0 0 0 2.5px ${row.ring}, 0 0 0 5.5px rgba(255,255,255,.95)`
                  : '0 0 0 3px rgba(255,255,255,.95)',
              }}
            >
              <row.Icon
                className="size-3"
                strokeWidth={row.kind === 'check' ? 3.6 : 3}
                style={{ color: row.hollow ? row.ring : '#fff' }}
                aria-hidden="true"
              />
            </span>
            <p className="text-sm leading-[1.4] font-bold" style={{ color: 'oklch(0.28 0 0)' }}>
              {row.count > 1 ? collapsedLabel(row.kind, row.count) : row.message}
            </p>
            <p className="text-xs font-bold" style={{ color: theme.muted }}>
              {formatActivityTime(row.dateCreated)}
            </p>
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + ACTIVITY_PAGE_SIZE)}
          className="mt-3 ml-8 text-xs font-bold hover:underline"
          style={{ color: theme.strong }}
        >
          View {Math.min(remaining, ACTIVITY_PAGE_SIZE)} more
        </button>
      )}
    </div>
  )
}
