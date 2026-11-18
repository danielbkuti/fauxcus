import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, CheckCircle2, Circle, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GoalForm } from '@/components/GoalForm'
import { GoalProgressBar } from '@/components/GoalProgress'
import { useTaskStore } from '@/context/TaskStoreContext'
import {
  computeGoalProgress,
  deleteGoal,
  describeTimeLeft,
  fetchGoal,
  formatTargetDate,
  planActionFor,
  updateGoal,
} from '@/lib/goals'
import { cn, formatDeadline } from '@/lib/utils'

function GoalDetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8" aria-busy="true">
      <Skeleton className="mb-4 h-4 w-28 rounded-md" />
      <Skeleton className="h-9 w-2/3 rounded-md" />
      <Skeleton className="mt-3 h-4 w-40 rounded-md" />
      <div className="mt-8 rounded-[14px] bg-card p-5 ring-1 ring-foreground/10">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="mt-3 h-3 w-32 rounded-md" />
      </div>
      <Skeleton className="mt-8 mb-4 h-6 w-24 rounded-md" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    </div>
  )
}

function TaskRowSkeleton() {
  return <Skeleton className="h-14 w-full rounded-xl" />
}

// A goal's step. Read-only here on purpose: completing a task has its
// own rules (a task with open subtasks can't be ticked off) that live on
// the task's own page, so a row is a link there rather than a second,
// weaker copy of that checkbox.
function GoalTaskRow({ task }) {
  const subtasks = task.subtasks ?? []
  const subtasksDone = subtasks.filter((s) => s.completed).length
  const overdue = !task.completed && task.dateDeadline && new Date(task.dateDeadline).getTime() < Date.now()
  return (
    <Link
      to={`/tasks/${task.id}`}
      className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {task.completed ? (
        <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-label="Completed" />
      ) : (
        <Circle className="size-5 shrink-0 text-muted-foreground" aria-label="Not completed" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-[15px] font-medium', task.completed && 'text-muted-foreground line-through')}>
          {task.name}
        </p>
        {subtasks.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {subtasksDone} of {subtasks.length} subtask{subtasks.length === 1 ? '' : 's'}
          </p>
        )}
      </div>
      {task.dateDeadline && (
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap',
            overdue ? 'bg-red-50 text-red-700' : 'bg-[#f3e8ff] text-[#6b46a8]'
          )}
        >
          {overdue ? 'Overdue' : formatDeadline(task.dateDeadline)}
        </span>
      )}
    </Link>
  )
}

export function GoalDetailPage() {
  const { id } = useParams()
  const goalId = Number(id)
  const navigate = useNavigate()
  const { tasks, status: tasksStatus, refreshTasks } = useTaskStore()

  const [goal, setGoal] = useState(null)
  // 'loading' | 'ready' | 'notfound' | 'error'
  const [status, setStatus] = useState('loading')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchGoal(goalId)
      .then((data) => {
        if (cancelled) return
        setGoal(data)
        setStatus('ready')
      })
      .catch((err) => {
        if (!cancelled) setStatus(err.status === 404 ? 'notfound' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [goalId])

  if (status === 'loading') return <GoalDetailSkeleton />

  if (status !== 'ready') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-8 py-24 text-center">
        <h1 className="text-2xl font-semibold">{status === 'notfound' ? 'Goal not found' : 'Something went wrong'}</h1>
        <p className="text-sm text-muted-foreground">
          {status === 'notfound'
            ? 'This goal doesn’t exist, or it was deleted.'
            : 'We couldn’t load this goal. Try refreshing the page.'}
        </p>
        <Button variant="outline" size="sm" render={<Link to="/goals" />} nativeButton={false}>
          Back to goals
        </Button>
      </div>
    )
  }

  const goalTasks = tasks.filter((t) => t.goal === goalId)
  // The task store is the live copy (it updates as tasks are completed
  // on their own pages), so progress comes from it once loaded; the
  // numbers the goals API returned only stand in until then.
  const tasksReady = tasksStatus === 'ready'
  const progress = tasksReady
    ? computeGoalProgress(goalTasks)
    : { total: goal.taskCount, done: goal.completedTaskCount, percent: goal.progress }
  const timeLeft = describeTimeLeft(goal.targetDate)
  // "Suggest steps" for a goal with none; "Plan next phase" once it has some.
  const planAction = planActionFor(goalTasks)

  async function handleSave(values) {
    setFormError(null)
    setSaving(true)
    try {
      const updated = await updateGoal(goalId, values)
      setGoal(updated)
      setEditing(false)
    } catch (err) {
      setFormError(err.data?.name?.[0] ?? err.data?.targetDate?.[0] ?? 'Could not save your changes.')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleComplete() {
    setActionError(null)
    setBusy(true)
    try {
      setGoal(await updateGoal(goalId, { completed: !goal.completed }))
    } catch {
      setActionError('Could not update this goal.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setActionError(null)
    setBusy(true)
    try {
      await deleteGoal(goalId)
      // The goal's tasks survive (detached), so the shared task list
      // has to be re-read to drop their now-stale `goal` reference.
      await refreshTasks().catch(() => {})
      navigate('/goals')
    } catch {
      setActionError('Could not delete this goal.')
      setConfirmingDelete(false)
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-8 text-3xl font-semibold">Edit goal</h1>
        <GoalForm
          initial={goal}
          submitLabel="Save changes"
          submittingLabel="Saving…"
          onSubmit={handleSave}
          onCancel={() => {
            setEditing(false)
            setFormError(null)
          }}
          submitting={saving}
          error={formError}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link to="/goals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to goals
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl leading-tight font-semibold">{goal.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {goal.completed && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700">Completed</span>
            )}
            {goal.targetDate ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" />
                {formatTargetDate(goal.targetDate)}
                {!goal.completed && timeLeft && <span>· {timeLeft}</span>}
              </span>
            ) : (
              <span>No target date</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil />
            Edit
          </Button>
          <Button variant="outline" onClick={handleToggleComplete} disabled={busy}>
            {goal.completed ? 'Reopen' : 'Mark complete'}
          </Button>
        </div>
      </div>

      {goal.description && (
        <p className="mt-6 max-w-[65ch] text-[15px] leading-relaxed whitespace-pre-line text-foreground/80">
          {goal.description}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-2 rounded-[14px] bg-card p-5 ring-1 ring-foreground/10">
        <GoalProgressBar percent={progress.percent} label="Goal progress" className="h-2.5" />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {progress.total === 0
              ? 'No tasks yet'
              : `${progress.done} of ${progress.total} task${progress.total === 1 ? '' : 's'} done`}
          </span>
          <span className="font-semibold">{progress.percent}%</span>
        </div>
      </div>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Tasks</h2>
          <div className="flex items-center gap-2">
            {!goal.completed && (
              <Button
                variant="outline"
                size="sm"
                render={<Link to={`/goals/${goalId}/${planAction.to}`} />}
                nativeButton={false}
              >
                <ListChecks />
                {planAction.label}
              </Button>
            )}
            <Button variant="outline" size="sm" render={<Link to={`/tasks/new?goal=${goalId}`} />} nativeButton={false}>
              <Plus />
              Add task
            </Button>
          </div>
        </div>

        {tasksStatus === 'loading' && (
          <div className="flex flex-col gap-2" aria-busy="true">
            <TaskRowSkeleton />
            <TaskRowSkeleton />
            <TaskRowSkeleton />
          </div>
        )}

        {tasksStatus === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t load this goal&apos;s tasks.
          </p>
        )}

        {tasksReady && goalTasks.length === 0 && (
          <div className="rounded-[14px] border border-dashed px-6 py-10 text-center">
            <p className="text-sm font-medium">No tasks yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Break this goal into steps — each task you add here counts toward its progress.
              {!goal.completed && ' “Suggest steps” drafts a plan you can review and edit first.'}
            </p>
          </div>
        )}

        {tasksReady && goalTasks.length > 0 && (
          <div className="flex flex-col gap-2">
            {[...goalTasks]
              .sort((a, b) => {
                if (a.completed !== b.completed) return a.completed ? 1 : -1
                if (a.dateDeadline && b.dateDeadline) return new Date(a.dateDeadline) - new Date(b.dateDeadline)
                if (a.dateDeadline) return -1
                if (b.dateDeadline) return 1
                return new Date(a.dateCreated) - new Date(b.dateCreated)
              })
              .map((task) => (
                <GoalTaskRow key={task.id} task={task} />
              ))}
          </div>
        )}
      </section>

      <section className="mt-12 border-t pt-6">
        {actionError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {actionError}
          </p>
        )}
        {confirmingDelete ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              Delete this goal? Its {goalTasks.length === 1 ? 'task stays' : 'tasks stay'} in your task list.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete goal'}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)} className="text-muted-foreground">
            <Trash2 />
            Delete goal
          </Button>
        )}
      </section>
    </div>
  )
}
