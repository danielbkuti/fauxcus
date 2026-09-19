import { useRef, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { DeadlineEditor } from '@/components/DeadlineEditor'
import { createTask } from '@/lib/tasks'
import { useTaskStore } from '@/context/TaskStoreContext'
import { formatDeadline } from '@/lib/utils'
import { STATE_THEME } from '@/components/TaskDetailPage'

// Remodeled to match TaskDetailPage's own shell/chrome (rounded flood
// card, gradient ring, 246px left rail + content column) rather than
// the plain form it used to be — a task doesn't exist yet at this
// point, so it always wears the calm 'far' palette (no deadline to be
// overdue/urgent against, nothing to mark complete). Deliberately
// leaves out what only makes sense for a task that already exists:
// the progress dial, the mark-complete pill, and the activity spine.
const theme = STATE_THEME.far

// A plain 'YYYY-MM-DD' query param (CalendarPage links here with one
// when you add a task from a specific day) becomes local midnight of
// that day, matching DeadlineEditor's own "unchecked ⇒ local midnight"
// convention for a date with no time of day picked yet. Ignored (falls
// back to no deadline) if missing or malformed, rather than throwing.
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

  // DeadlineEditor normally commits straight to the server the moment
  // its own Save is clicked (see TaskCard/TaskDetailPage) — here there
  // isn't a task to save to yet, so this just holds the picked value
  // in local form state instead; the real create() call below is what
  // actually sends it, together with everything else on the form.
  function handlePickDeadline(iso) {
    setDateDeadline(iso)
    setEditingDeadline(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const task = await createTask({
        name,
        description: description.trim() ? description.trim() : undefined,
        dateDeadline,
      })
      // Fold the new task into the shared store before navigating —
      // otherwise the detail page it's about to land on would find
      // nothing under this id until the store's next full refresh.
      mergeTask(task)
      navigate(`/tasks/${task.id}`)
    } catch (err) {
      setError(err.data?.name?.[0] ?? err.data?.dateDeadline?.[0] ?? 'Could not create that task.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <form onSubmit={handleSubmit}>
        <div className="relative overflow-hidden rounded-[30px]" style={{ background: theme.flood, boxShadow: theme.shadow }}>
          <span aria-hidden="true" className="task-detail-ring" style={{ '--task-accent': theme.border }} />

          <div className="relative z-[2] grid grid-cols-1 items-start md:grid-cols-[246px_1fr]">
            {/* ---------------------------------------------------- Left rail */}
            <div
              className="flex flex-col gap-5 self-stretch border-b px-5 py-[22px] md:border-r md:border-b-0"
              style={{
                background: 'linear-gradient(180deg,rgba(255,255,255,.82),rgba(255,255,255,.5))',
                borderColor: theme.hairline,
              }}
            >
              <Link to="/tasks" className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: theme.strong }}>
                <ArrowLeft className="size-3.5" />
                Back to tasks
              </Link>

              <div ref={deadlineAnchorRef} className="relative">
                <p className="text-[10px] font-black tracking-[.12em] uppercase" style={{ color: theme.strong }}>
                  Deadline
                </p>
                {editingDeadline && (
                  <DeadlineEditor
                    anchorRef={deadlineAnchorRef}
                    value={dateDeadline}
                    onSave={handlePickDeadline}
                    onCancel={() => setEditingDeadline(false)}
                    minDayOffset={0}
                  />
                )}
                {!editingDeadline && (
                  <button
                    type="button"
                    onClick={() => setEditingDeadline(true)}
                    className="group mt-1 flex w-full items-center justify-between rounded-xl border bg-white px-3 py-2 text-left"
                    style={{ borderColor: theme.hairline }}
                  >
                    <span className="text-[13px] font-black" style={{ color: theme.title }}>
                      {dateDeadline ? formatDeadline(dateDeadline) : 'Set deadline (optional)'}
                    </span>
                    <Pencil className="size-3.5 shrink-0" style={{ color: theme.strong }} aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="mt-auto flex flex-col gap-2 pt-2">
                {error && <p className="text-[11px] text-destructive">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="w-full rounded-full px-[18px] py-[11px] text-[13.5px] font-black text-white disabled:opacity-60"
                  style={{ background: theme.cta, boxShadow: theme.ctaShadow }}
                >
                  {submitting ? 'Creating…' : 'Create task'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  disabled={submitting}
                  className="w-full rounded-full px-4 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-black/5"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* ------------------------------------------------ Content column */}
            <div className="flex min-w-0 flex-col gap-5 px-6 pt-[22px] pb-6">
              <div className="flex flex-col gap-1.5">
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
                      className="w-full bg-transparent text-[27px] leading-[1.18] font-black tracking-[-0.025em] outline-none placeholder:text-black/25"
                      style={{ color: theme.title }}
                    />
                  </div>
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
                      placeholder="Add some context so this task still makes sense next week."
                      aria-label="Description"
                      className="w-full max-w-[62ch] resize-y bg-transparent text-[14.5px] leading-[1.72] outline-none placeholder:text-muted-foreground"
                      style={{ color: 'oklch(0.28 0 0)' }}
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// Same as TaskDetailPage's own SectionHeader — duplicated rather than
// imported since that one isn't exported (it's a small, page-scoped
// building block there); keeping this page's copy in sync with the
// detail page's if that one's style ever changes is a reasonable ask,
// but not worth a shared-component extraction for four lines of markup.
function SectionHeader({ label, hairline, strong }) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="text-[11px] font-black tracking-[.12em] uppercase" style={{ color: strong }}>
        {label}
      </h2>
      <span className="h-px flex-1" style={{ background: `linear-gradient(90deg,${hairline},rgba(255,255,255,0))` }} />
    </div>
  )
}
