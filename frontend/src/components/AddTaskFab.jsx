import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X, SquarePlus, Target, CalendarDays, ListPlus, CalendarClock, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { updateTask } from '@/lib/tasks'
import { createCalendarItem } from '@/lib/calendarItems'
import { useTaskStore } from '@/context/TaskStoreContext'
import { useAddTaskFab } from '@/context/AddTaskFabContext'
import { cn } from '@/lib/utils'

const EMPTY_CALENDAR_DRAFT = { name: '', dateStart: '', dateEnd: '', location: '' }

const TASK_DETAIL_PATH = /^\/tasks\/(\d+)$/

const GRADIENT = 'bg-gradient-to-br from-[#e0c3fc] via-[#7c5fb0] to-[#8ec5fc]'

// Press-transition tokens — see fab-motion-handoff.md. One 420ms beat
// drives four synchronised changes (glyph rotation, glyph stroke
// crossfade, field crossfade, ring draw), all sharing this exact
// duration/easing so nothing reads as staggered. `fabTransition` itself
// is built per-render, inside the component (its duration depends on
// prefers-reduced-motion).
const FAB_DUR = 420
const FAB_EASE = 'cubic-bezier(.34,1.16,.34,1)'
// 2π × 26.75, the ring's own radius (below) — dasharray/circumference
// must be recomputed together if the FAB's size ever changes.
const FAB_RING_CIRCUMFERENCE = 168
const PLUS_PATH = 'M12 5v14M5 12h14'

// Same per-concept colors as the home dashboard's own three cards
// (Dashboard.jsx's ActionCard accents) — task/goal/calendar options
// here mean the same thing those cards do, so they're given the same
// color rather than inventing a second palette. Subtask borrows the
// calendar's blue (no home-card equivalent of its own); deadline
// matches the amber already used for due-date badges everywhere else
// in the app; description keeps the plain purple every icon used to
// be before this split.
const COLOR_TASK = '#56a456'
const COLOR_GOAL = '#7c5fb0'
const COLOR_CALENDAR = '#4f9fdb'
const COLOR_SUBTASK = '#4f9fdb'
const COLOR_DEADLINE = '#b45309'
const COLOR_DESCRIPTION = '#7c5fb0'

// One option in the stack — a small card in its own right (icon badge
// + label), not a grid cell, since these now hang above the FAB as a
// vertical stack rather than sitting inside one bigger dialog card.
// `riseDelay` staggers each card's entrance so the stack reads as
// rising up from the button one after another, closest card first.
// The icon badge color is inline style rather than a Tailwind class —
// `accent` is a runtime value, and Tailwind's JIT compiler only picks
// up class names it can see literally in source, not ones assembled
// from a variable — same reasoning Dashboard.jsx's ActionCard already
// follows for its own per-card accent.
function OptionCard({ icon: Icon, label, onClick, riseDelay, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animation: `fab-card-rise 220ms ease-out ${riseDelay}ms both` }}
      className="flex w-60 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-lg transition-colors hover:bg-muted/50"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        <Icon className="size-4.5" />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}

// The bigger card an option expands into once picked — same rise-in
// entrance as the option cards, same anchor point, just roomier since
// it's holding an actual form instead of a single line.
function ActionCard({ children, as: Tag = 'div', ...props }) {
  return (
    <Tag
      style={{ animation: 'fab-card-rise 200ms ease-out both' }}
      className="w-72 rounded-xl border bg-card p-4 shadow-lg"
      {...props}
    >
      {children}
    </Tag>
  )
}

// Global quick-add entry point, fixed bottom-right on every
// authenticated page. What it offers changes with where you are: a
// task detail page gets options scoped to *that* task (subtask,
// deadline, description); everywhere else gets the same three
// top-level "start something new" options. Goals doesn't have a data
// model yet (see ComingSoonPage), so that option still just navigates
// there; "Add a calendar item" expands into its own inline form (see
// the 'calendar' activeAction below) the same way "description" does.
//
// The subtask and deadline options used to open their own inline
// mini-editor floating above the FAB (a second copy of AddSubtaskForm/
// DeadlineEditor, separate from the ones already on the task detail
// page itself). They now just navigate to the detail page instead —
// `?action=subtask` / `?action=deadline` — and TaskDetailPage opens
// its own real editor in response (see the `action` query-param effect
// there). One editor per concept instead of two: the page's own
// "Add subtasks"/due-date-badge controls are what actually run, the
// FAB just points at them. Description doesn't have an equivalent on
// the page yet (there's nowhere there to display or edit it — see the
// backlog note on that), so it keeps its own inline form here for now.
//
// The menu itself — option stack or whichever form it expands into —
// still floats directly above the FAB rather than in a
// centered dialog, so it visibly originates from the button that
// opened it. Its own full-screen blurred backdrop still blocks the rest
// of the page while it's open — unlike OverdueBanner, this one really is
// a modal interaction (a form being filled in), not an ambient summary.
export function AddTaskFab() {
  // Shared with the rest of the authenticated shell (AddTaskFabContext)
  // rather than local state — so a page like CalendarPage's empty-day
  // state can open this same menu itself, not just the button below.
  // `prefillDate` is set the same way, by whatever opened the menu with
  // a specific day already in mind — only the 'task' option below reads
  // it (see defaultOptions), since /goals and /calendar don't take a
  // date.
  const { open, setOpen, prefillDate, setPrefillDate, bumpCalendarItemsVersion } = useAddTaskFab()
  // Reduced motion drops the whole press-transition's duration to 0 —
  // per fab-motion-handoff.md's own suggested shortcut, rather than
  // special-casing the rotation and ring separately. At 0ms, `rotate`
  // still jumps straight to 360deg, but that's indistinguishable from
  // 0deg (a plus is radially symmetric) and the dash-offset snaps
  // instead of drawing — no perceivable motion either way, while the
  // color crossfades still happen (just instantly, not animated).
  const fabDur = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : FAB_DUR
  const fabTransition = (prop) => `${prop} ${fabDur}ms ${FAB_EASE}`
  // null | 'description' | 'calendar' — the options that expand in
  // place rather than navigating.
  const [activeAction, setActiveAction] = useState(null)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [descriptionDraftDirty, setDescriptionDraftDirty] = useState(false)
  const [calendarDraft, setCalendarDraft] = useState(EMPTY_CALENDAR_DRAFT)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { tasks, refreshTask } = useTaskStore()

  const detailMatch = location.pathname.match(TASK_DETAIL_PATH)
  const taskId = detailMatch ? detailMatch[1] : null
  // Read straight from the shared store instead of this component
  // fetching its own independent copy — TaskDetailPage is showing this
  // same task (that's the only way `taskId` is set at all), so the
  // store already has it loaded.
  const currentTask = taskId ? (tasks.find((t) => t.id === Number(taskId)) ?? null) : null
  // The textarea needs its own draft state (it's edited before saving),
  // seeded from the task the first time the description action opens
  // for it — not resynced on every store update after that, or typing
  // would get clobbered by a stray re-render.
  const descriptionValue = descriptionDraftDirty ? descriptionDraft : (currentTask?.description ?? '')

  function closeMenu() {
    setOpen(false)
    setActiveAction(null)
    setError(null)
    setDescriptionDraftDirty(false)
    setCalendarDraft(EMPTY_CALENDAR_DRAFT)
    setPrefillDate(null)
  }

  // Mutates through the same shared store TaskDetailPage reads from —
  // re-fetching just this one task and folding it back in is enough to
  // make the change show up there immediately, no reload needed.
  async function closeAndRefresh() {
    setOpen(false)
    setActiveAction(null)
    setDescriptionDraftDirty(false)
    await refreshTask(taskId)
  }

  function goTo(path) {
    closeMenu()
    navigate(path)
  }

  async function handleSaveDescription(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await updateTask(taskId, { description: descriptionValue })
      await closeAndRefresh()
    } catch (err) {
      setError(err.data?.description?.[0] ?? 'Could not save that description.')
      setSubmitting(false)
    }
  }

  // A plain native <input type="datetime-local"> pair (start/end)
  // rather than the app's own wheel-picker DeadlineEditor — that
  // component is built around a single Task deadline and a portal-
  // positioned popover anchored to a trigger button, neither of which
  // fits this menu's own small, already-expanding inline card. Trades
  // a bit of visual polish for staying genuinely small; nothing stops a
  // later pass from swapping this for something fancier.
  async function handleCreateCalendarItem(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await createCalendarItem({
        name: calendarDraft.name,
        // <input type="datetime-local">'s value has no timezone info at
        // all — it's local wall-clock time by construction — so `new
        // Date(...)` interpreting it as local (not UTC) before
        // converting to a real ISO instant is exactly right, same
        // assumption DeadlineEditor's own value already relies on.
        dateStart: new Date(calendarDraft.dateStart).toISOString(),
        dateEnd: calendarDraft.dateEnd ? new Date(calendarDraft.dateEnd).toISOString() : undefined,
        location: calendarDraft.location.trim() ? calendarDraft.location.trim() : undefined,
      })
      // CalendarPage has no automatic way to see this — it's not part
      // of the shared TaskStoreContext, see this context's own comment
      // on calendarItemsVersion.
      bumpCalendarItemsVersion()
      closeMenu()
    } catch (err) {
      setError(
        err.data?.dateStart?.[0] ??
          err.data?.dateEnd?.[0] ??
          err.data?.non_field_errors?.[0] ??
          err.data?.name?.[0] ??
          'Could not create that calendar item.'
      )
      setSubmitting(false)
    }
  }

  const defaultOptions = [
    {
      key: 'task',
      label: 'Add a new task',
      icon: SquarePlus,
      accent: COLOR_TASK,
      // CalendarPage sets prefillDate before opening the menu when
      // this was reached by clicking a specific day (an empty cell, or
      // the rail's "Add task on this day" button) — carries that date
      // through as a query param so NewTaskPage can seed the deadline
      // with it instead of the form opening blank.
      onClick: () => goTo(prefillDate ? `/tasks/new?date=${prefillDate}` : '/tasks/new'),
    },
    { key: 'goal', label: 'Add a new goal', icon: Target, accent: COLOR_GOAL, onClick: () => goTo('/goals') },
    {
      key: 'calendar',
      label: 'Add a calendar item',
      icon: CalendarDays,
      accent: COLOR_CALENDAR,
      // Same prefillDate the 'task' option above reads — seeds a
      // default 9am start on that day instead of opening blank, when
      // this was reached by clicking a specific day on the calendar.
      onClick: () => {
        setCalendarDraft({ ...EMPTY_CALENDAR_DRAFT, dateStart: prefillDate ? `${prefillDate}T09:00` : '' })
        setActiveAction('calendar')
      },
    },
  ]

  const detailOptions = [
    { key: 'subtask', label: 'Add a new subtask', icon: ListPlus, accent: COLOR_SUBTASK, onClick: () => goTo(`/tasks/${taskId}?action=subtask`) },
    { key: 'task', label: 'Add a new task', icon: SquarePlus, accent: COLOR_TASK, onClick: () => goTo('/tasks/new') },
    { key: 'deadline', label: 'Set/Edit deadline', icon: CalendarClock, accent: COLOR_DEADLINE, onClick: () => goTo(`/tasks/${taskId}?action=deadline`) },
    { key: 'description', label: 'Add a task description', icon: FileText, accent: COLOR_DESCRIPTION, onClick: () => setActiveAction('description') },
  ]

  const options = taskId ? detailOptions : defaultOptions

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm" onClick={closeMenu}>
          {/* flex-col-reverse: the first option in the array lands at
              the bottom of the stack, right above the FAB, with later
              ones stacking upward above it — matching the rise
              animation's own stagger order. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col-reverse items-center gap-2.5 sm:left-auto sm:right-6 sm:translate-x-0 sm:items-end"
          >
            {activeAction === null &&
              options.map((option, index) => (
                <OptionCard
                  key={option.key}
                  icon={option.icon}
                  label={option.label}
                  onClick={option.onClick}
                  riseDelay={index * 40}
                  accent={option.accent}
                />
              ))}

            {activeAction === 'description' && (
              <ActionCard as="form" onSubmit={handleSaveDescription}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">Add a description</h2>
                    {currentTask && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        For &quot;{currentTask.name}&quot;
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeMenu}
                    aria-label="Close"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <textarea
                  value={descriptionValue}
                  onChange={(e) => {
                    setDescriptionDraft(e.target.value)
                    setDescriptionDraftDirty(true)
                  }}
                  rows={4}
                  autoFocus
                  placeholder="What's this task about?"
                  aria-label="Description"
                  className="mt-3 w-full rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setActiveAction(null)
                      setDescriptionDraftDirty(false)
                    }}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </ActionCard>
            )}

            {activeAction === 'calendar' && (
              <ActionCard as="form" onSubmit={handleCreateCalendarItem}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold">Add a calendar item</h2>
                  <button
                    type="button"
                    onClick={closeMenu}
                    aria-label="Close"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-2.5">
                  <input
                    value={calendarDraft.name}
                    onChange={(e) => setCalendarDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="What is it?"
                    aria-label="Event name"
                    autoFocus
                    required
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Starts
                    <input
                      type="datetime-local"
                      value={calendarDraft.dateStart}
                      onChange={(e) => setCalendarDraft((d) => ({ ...d, dateStart: e.target.value }))}
                      required
                      className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Ends (optional)
                    <input
                      type="datetime-local"
                      value={calendarDraft.dateEnd}
                      onChange={(e) => setCalendarDraft((d) => ({ ...d, dateEnd: e.target.value }))}
                      className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  </label>
                  <input
                    value={calendarDraft.location}
                    onChange={(e) => setCalendarDraft((d) => ({ ...d, location: e.target.value }))}
                    placeholder="Location (optional)"
                    aria-label="Location (optional)"
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
                {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={closeMenu} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={submitting}>
                    {submitting ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              </ActionCard>
            )}
          </div>
        </div>
      )}

      {/* Centered on narrow viewports (below the `sm:grid-cols-3` breakpoint
          Dashboard's own Quick-start cards use) rather than pinned to the
          same bottom-right corner those cards' own right-aligned CTA pill
          sits in — on a single-column mobile layout the two collide right
          at initial scroll position, not just while scrolling past. */}
      <div className="fixed bottom-6 left-1/2 z-[101] -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0">
        {/* Radial glow — always mounted (with its pulse animation always
            running) rather than conditionally rendered, so its opacity
            can crossfade on the same 420ms beat as everything else
            instead of just snapping in/out with the rest of the style
            object. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-3 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(224,195,252,0.6), rgba(124,95,176,0.35) 45%, transparent 75%)',
            filter: 'blur(6px)',
            animation: 'fab-glow-pulse 1.8s ease-in-out infinite',
            opacity: open ? 1 : 0,
            transition: fabTransition('opacity'),
          }}
        />

        {/* Gradient defs, rendered once alongside the button — see
            fab-motion-handoff.md's "two SVG gotchas". A gradient paint
            server is dropped on any element whose bounding box is zero
            in one dimension, which either straight-line stroke of a
            plus is on its own — that's why the glyph below is one
            combined `<path>` ("M12 5v14M5 12h14") rather than two
            separate ones, since the union of both strokes' bounding
            boxes is a proper non-degenerate square. `fabGrad` still
            specifies `userSpaceOnUse` (coordinates in the glyph's own
            24×24 viewBox) on top of that, rather than relying on the
            now-fixed bbox — belt and suspenders. `ringGrad` stays on
            the default objectBoundingBox — a circle's bbox is never
            degenerate. */}
        <svg width="0" height="0" aria-hidden="true" className="absolute">
          <defs>
            <linearGradient id="fabGrad" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="20" y2="20">
              <stop offset="0%" stopColor="#e0c3fc" />
              <stop offset="50%" stopColor="#7c5fb0" />
              <stop offset="100%" stopColor="#8ec5fc" />
            </linearGradient>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#e0c3fc" />
              <stop offset="50%" stopColor="#7c5fb0" />
              <stop offset="100%" stopColor="#8ec5fc" />
            </linearGradient>
          </defs>
        </svg>

        <button
          type="button"
          onClick={() => {
            if (open) closeMenu()
            else setOpen(true)
          }}
          aria-label="Add"
          aria-expanded={open}
          title="Add"
          // Hover scale stays a plain Tailwind `hover:scale-105`, but
          // off the general `transition-transform` utility — that
          // shares its duration with nothing else here, and 420ms would
          // make hovering feel sluggish. Its own short inline transition
          // instead; doesn't conflict with the glyph's 420ms rotation
          // since that's a transform on a different element.
          className="relative grid size-14 place-items-center overflow-hidden rounded-full fab-starfield shadow-lg hover:scale-105"
          style={{ transition: 'transform 150ms ease-out' }}
        >
          {/* 1. Gradient field — the closed-state look. `fab-starfield`
              (index.css) is the base layer underneath, always present;
              this crossfades out on open to reveal it, since a
              background-image change can't itself be transitioned. */}
          <span
            aria-hidden="true"
            className={cn(GRADIENT, 'absolute inset-0 rounded-full')}
            style={{ opacity: open ? 0 : 1, transition: fabTransition('opacity') }}
          />

          {/* 2. Gradient ring — draws clockwise from 12 o'clock as the
              button opens, via stroke-dashoffset (168 → 0); the `-90deg`
              rotation is what moves its start point from 3 o'clock,
              where stroke-dasharray circles start by default, to 12. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 56 56"
            className="pointer-events-none absolute inset-0 -rotate-90"
            fill="none"
          >
            <circle
              cx="28"
              cy="28"
              r="26.75"
              stroke="url(#ringGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={FAB_RING_CIRCUMFERENCE}
              strokeDashoffset={open ? 0 : FAB_RING_CIRCUMFERENCE}
              style={{ transition: fabTransition('stroke-dashoffset') }}
            />
          </svg>

          {/* 3. The glyph itself — one wrapper carries the rotation so
              both stacked strokes turn together; each stroke crossfades
              independently (a `stroke` color change can't transition
              any more than a background-image can), white fading out as
              the gradient one fades in. */}
          <span
            aria-hidden="true"
            className="relative block size-6"
            style={{ transform: `rotate(${open ? 360 : 0}deg)`, transition: fabTransition('transform') }}
          >
            <svg
              viewBox="0 0 24 24"
              className="absolute inset-0 size-6"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinecap="round"
              style={{ opacity: open ? 0 : 1, transition: fabTransition('opacity') }}
            >
              <path d={PLUS_PATH} />
            </svg>
            <svg
              viewBox="0 0 24 24"
              className="absolute inset-0 size-6"
              fill="none"
              stroke="url(#fabGrad)"
              strokeWidth="2.2"
              strokeLinecap="round"
              style={{ opacity: open ? 1 : 0, transition: fabTransition('opacity') }}
            >
              <path d={PLUS_PATH} />
            </svg>
          </span>
        </button>
      </div>
    </>
  )
}
