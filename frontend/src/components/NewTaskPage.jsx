import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Flag } from 'lucide-react'
import { DeadlineEditor } from '@/components/DeadlineEditor'
import { Starfield } from '@/components/Starfield'
import { createTask } from '@/lib/tasks'
import { fetchGoal } from '@/lib/goals'
import { useTaskStore } from '@/context/TaskStoreContext'
import { cn, formatDeadline } from '@/lib/utils'
import { STATE_THEME } from '@/components/TaskDetailPage'

// Same shell/chrome as TaskDetailPage, but with NO left rail while the
// task is still a draft — nothing in it (dial, mark-complete, created
// date) means anything until the task exists. The deadline picker and
// Create button live in the form instead. On a successful create the
// starfield rail slides out from behind the shell's left edge and its
// dial traces one lap down to a 0% seed (see the `dial-trace` keyframes
// in index.css), then the page hands off to the real detail page —
// whose layout this end state matches, so the swap doesn't jump.
const theme = STATE_THEME.far

const RAIL_W = 246
const RAIL_SLIDE_MS = 560
const DIAL_DELAY_MS = 500 // after the slide starts
const ITEMS_DELAY_MS = 1450 // mark-complete / deadline / created stagger
const HANDOFF_MS = 2400 // navigate to the detail page after this
const CIRCUMFERENCE = 389.56

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function parseDateParam(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString()
}

export function NewTaskPage() {
  const navigate = useNavigate()
  const { mergeTask } = useTaskStore()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dateDeadline, setDateDeadline] = useState(() => parseDateParam(searchParams.get('date')))
  const [editingDeadline, setEditingDeadline] = useState(false)
  const deadlineAnchorRef = useRef(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [createdTask, setCreatedTask] = useState(null)
  const handoffTimerRef = useRef(null)

  useEffect(() => () => clearTimeout(handoffTimerRef.current), [])

  // Arriving from a goal's page ("Add task" there links here with
  // ?goal=<id>) makes this task a step of that goal. The goal is fetched
  // only to show its name; if that fails (or the id isn't a real goal of
  // this user) the page just falls back to a plain, goal-less task rather
  // than blocking creation.
  const goalParam = Number(searchParams.get('goal'))
  const hasGoalParam = Number.isInteger(goalParam) && goalParam > 0
  const [goal, setGoal] = useState(null)
  const [goalFailed, setGoalFailed] = useState(false)
  useEffect(() => {
    if (!hasGoalParam) return undefined
    let cancelled = false
    fetchGoal(goalParam)
      .then((data) => {
        if (!cancelled) setGoal(data)
      })
      .catch(() => {
        if (!cancelled) setGoalFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [goalParam, hasGoalParam])
  // Held back from submitting until the goal has resolved either way, so
  // a quick click can't create the task before its goal is known and
  // silently leave it unattached.
  const goalPending = hasGoalParam && !goal && !goalFailed

  function handlePickDeadline(iso) {
    setDateDeadline(iso)
    setEditingDeadline(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (createdTask) return
    setError(null)
    setSubmitting(true)
    try {
      const task = await createTask({
        name,
        description: description.trim() ? description.trim() : undefined,
        dateDeadline,
        goal: goal?.id,
      })
      // Fold the new task into the shared store before navigating —
      // otherwise the detail page it's about to land on would find
      // nothing under this id until the store's next full refresh.
      mergeTask(task)
      if (reducedMotion()) {
        navigate(`/tasks/${task.id}`, { replace: true })
        return
      }
      setCreatedTask(task)
      handoffTimerRef.current = setTimeout(() => navigate(`/tasks/${task.id}`, { replace: true }), HANDOFF_MS)
    } catch (err) {
      setError(err.data?.name?.[0] ?? err.data?.dateDeadline?.[0] ?? 'Could not create that task.')
      setSubmitting(false)
    }
  }

  const created = Boolean(createdTask)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <form onSubmit={handleSubmit}>
        <div className="relative overflow-hidden rounded-[30px]" style={{ background: theme.flood, boxShadow: theme.shadow }}>
          <span aria-hidden="true" className="task-detail-ring" style={{ '--task-accent': theme.border }} />

          <div
            className="relative z-[2] grid grid-cols-1 items-stretch md:grid-cols-[var(--rail-w)_minmax(0,1fr)]"
            style={{
              '--rail-w': `${created ? RAIL_W : 0}px`,
              transition: `grid-template-columns ${RAIL_SLIDE_MS}ms cubic-bezier(.2,.8,.2,1)`,
            }}
          >
            {/* ---------------------------------------------- Left rail (post-create) */}
            <div
              aria-hidden={!created}
              className={cn('relative overflow-hidden', created ? 'border-b md:border-r md:border-b-0' : 'hidden md:block')}
              style={{
                borderColor: theme.hairline,
                // A soft inner shadow on the trailing edge only while it's
                // still sliding, so the panel reads as emerging from under
                // the shell's edge rather than being painted in place.
                boxShadow: created ? 'inset -14px 0 18px -14px rgba(0,0,0,.5)' : 'none',
                transition: `box-shadow 200ms ease ${RAIL_SLIDE_MS - 120}ms`,
              }}
            >
              {created && <CreatedRail task={createdTask} />}
            </div>

            {/* ------------------------------------------------ Content column */}
            <div className="flex min-w-0 flex-col gap-5 px-6 pt-[22px] pb-6 md:min-h-[470px]">
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-2 transition-opacity duration-300"
                style={{ opacity: created ? 0 : 1 }}
              >
                <Link
                  to={goal ? `/goals/${goal.id}` : '/tasks'}
                  className="inline-flex items-center gap-1 text-xs font-bold"
                  style={{ color: theme.strong }}
                >
                  <ArrowLeft className="size-3.5" />
                  {goal ? 'Back to goal' : 'Back to tasks'}
                </Link>
                {goal && (
                  <span
                    className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-white px-3 py-1"
                    style={{ borderColor: theme.hairline }}
                  >
                    <Flag className="size-3.5 shrink-0" style={{ color: theme.strong }} aria-hidden="true" />
                    <span className="sr-only">Goal:</span>
                    <span className="min-w-0 truncate text-[14px] font-black" style={{ color: theme.title }}>
                      {goal.name}
                    </span>
                  </span>
                )}
              </div>

              <div
                className="overflow-hidden rounded-[16px] p-[3px] shadow-[0_10px_26px_-22px_rgba(0,0,0,.35)]"
                style={{ background: theme.border }}
              >
                <div className="rounded-[13px] bg-white/94 px-3 py-1">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Task name…"
                    aria-label="Task name"
                    autoFocus
                    required
                    readOnly={created}
                    className="w-full bg-transparent text-[35px] leading-[1.18] font-black outline-none placeholder:text-black/25"
                    style={{ color: theme.title }}
                  />
                </div>
              </div>

              <section className="flex flex-col gap-3">
                <SectionHeader label="Description" hairline={theme.hairline} strong={theme.strong} />
                <div
                  className="overflow-hidden rounded-[18px] p-[3px] shadow-[0_10px_26px_-22px_rgba(0,0,0,.35)]"
                  style={{ background: theme.border }}
                >
                  <div className="rounded-[15px] bg-white/94 px-[18px] py-4">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      readOnly={created}
                      placeholder="Add some context so this task still makes sense next week."
                      aria-label="Description"
                      className="w-full max-w-[62ch] resize-y bg-transparent text-[19px] leading-[1.72] outline-none placeholder:text-muted-foreground"
                      style={{ color: 'oklch(0.28 0 0)' }}
                    />
                  </div>
                </div>
              </section>

              {/* Form footer — deadline + actions. Collapses away as the
                  rail slides out, since the rail now owns both. */}
              <div
                className="flex flex-col gap-2 transition-[max-height,opacity] duration-300 ease-out"
                style={{ maxHeight: created ? 0 : 160, opacity: created ? 0 : 1, overflow: created ? 'hidden' : 'visible' }}
              >
                {error && <p className="text-[14px] text-destructive">{error}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <div ref={deadlineAnchorRef} className="relative">
                    {editingDeadline ? (
                      <DeadlineEditor
                        anchorRef={deadlineAnchorRef}
                        value={dateDeadline}
                        onSave={handlePickDeadline}
                        onCancel={() => setEditingDeadline(false)}
                        minDayOffset={0}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingDeadline(true)}
                        className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left"
                        style={{ borderColor: theme.hairline }}
                      >
                        <CalendarDays className="size-4 shrink-0" style={{ color: theme.strong }} aria-hidden="true" />
                        <span className="text-[15px] font-black" style={{ color: theme.title }}>
                          {dateDeadline ? formatDeadline(dateDeadline) : 'Set deadline (optional)'}
                        </span>
                      </button>
                    )}
                  </div>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    disabled={submitting}
                    className="rounded-full px-4 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-black/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || goalPending || !name.trim()}
                    className="rounded-full px-[26px] py-[11px] text-[18px] font-black text-white disabled:opacity-60"
                    style={{ background: theme.cta, boxShadow: theme.ctaShadow }}
                  >
                    {submitting && !created ? 'Creating…' : 'Create task'}
                  </button>
                </div>
              </div>

              {created && (
                <section className="animate-rail-fade-up flex flex-col gap-3" style={{ animationDelay: '800ms' }}>
                  <SectionHeader label="Subtasks" hairline={theme.hairline} strong={theme.strong} />
                  <p className="text-sm text-muted-foreground">Want to break this down into smaller chunks?</p>
                </section>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// The rail as it first appears: the same 246px starfield panel as the
// detail page, pinned to the right edge of its (growing) grid column so
// it slides out as a whole. Presentational only — the page navigates to
// the real, interactive detail page once the reveal finishes.
function CreatedRail({ task }) {
  const gradientId = useId()
  return (
    <div
      className="font-display isolate flex flex-col gap-5 overflow-hidden bg-[#05060b] px-5 py-[22px] md:absolute md:inset-y-0 md:right-0"
      style={{ width: RAIL_W, maxWidth: '100%' }}
    >
      <Starfield pixelSize={3} shooting={false} />
      <span className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: 'rgba(255,255,255,.85)' }}>
        <ArrowLeft className="size-3.5" />
        Back to tasks
      </span>

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
          <circle
            cx="75"
            cy="75"
            r="62"
            fill="none"
            stroke="rgba(255,255,255,.14)"
            strokeWidth="13"
            className="animate-dial-track-in"
            style={{ animationDelay: `${DIAL_DELAY_MS}ms` }}
          />
          <circle
            cx="75"
            cy="75"
            r="62"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`0.01 ${CIRCUMFERENCE * 2}`}
            className="animate-dial-trace"
            style={{ animationDelay: `${DIAL_DELAY_MS}ms` }}
          />
        </svg>
        <div
          className="animate-rail-fade-up absolute inset-0 flex flex-col items-center justify-center"
          style={{ animationDelay: `${DIAL_DELAY_MS + 800}ms` }}
        >
          <span className="text-[42px] leading-none font-black text-white">0%</span>
          <span className="mt-1.5 text-[14px] font-bold" style={{ color: 'rgba(255,255,255,.75)' }}>
            Task created
          </span>
        </div>
      </div>

      <span
        className="animate-rail-fade-up block w-full rounded-full px-[18px] py-[11px] text-center text-[18px] font-black text-white"
        style={{ background: theme.cta, boxShadow: theme.ctaShadow, animationDelay: `${ITEMS_DELAY_MS}ms` }}
      >
        Mark complete
      </span>

      <div className="animate-rail-fade-up" style={{ animationDelay: `${ITEMS_DELAY_MS + 90}ms` }}>
        <p className="text-[13px] font-black tracking-[.12em] uppercase" style={{ color: 'rgba(255,255,255,.6)' }}>
          Deadline
        </p>
        <div className="mt-1 rounded-xl border bg-white px-3 py-2" style={{ borderColor: theme.hairline }}>
          <p className="text-[17px] font-black" style={{ color: theme.title }}>
            {task.dateDeadline ? formatDeadline(task.dateDeadline) : 'Set deadline'}
          </p>
        </div>
      </div>

      <div className="animate-rail-fade-up" style={{ animationDelay: `${ITEMS_DELAY_MS + 180}ms` }}>
        <p className="text-[13px] font-black tracking-[.12em] uppercase" style={{ color: 'rgba(255,255,255,.6)' }}>
          Created
        </p>
        <p className="mt-1 text-[16px] font-bold" style={{ color: 'rgba(255,255,255,.9)' }}>
          Just now
        </p>
      </div>
    </div>
  )
}

function SectionHeader({ label, hairline, strong }) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="text-[14px] font-black tracking-[.12em] uppercase" style={{ color: strong }}>
        {label}
      </h2>
      <span className="h-px flex-1" style={{ background: `linear-gradient(90deg,${hairline},rgba(255,255,255,0))` }} />
    </div>
  )
}
