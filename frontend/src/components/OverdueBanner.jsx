import { Link } from 'react-router-dom'
import { TriangleAlert, X } from 'lucide-react'
import { HoverFillButton } from '@/components/HoverFillButton'
import { formatDeadline } from '@/lib/utils'

// Flattens every overdue task and subtask out of the full task list —
// not completed, has a deadline, that deadline's in the past — into
// one list, most overdue (earliest date) first. Each item carries the
// id of the task its link should open: itself for a task, its parent
// for a subtask (subtasks don't have their own page). Shared between
// the one-time check that decides whether to show the banner at all and
// the banner's own render, since it's cheap and both want the same list.
export function collectOverdueItems(tasks) {
  const now = Date.now()
  const items = []
  for (const task of tasks) {
    if (!task.completed && task.dateDeadline && new Date(task.dateDeadline).getTime() < now) {
      items.push({ key: `task-${task.id}`, name: task.name, date: task.dateDeadline, taskId: task.id })
    }
    for (const subtask of task.subtasks) {
      if (!subtask.completed && subtask.dateDeadline && new Date(subtask.dateDeadline).getTime() < now) {
        items.push({
          key: `subtask-${subtask.id}`,
          name: subtask.name,
          date: subtask.dateDeadline,
          taskId: task.id,
        })
      }
    }
  }
  return items.sort((a, b) => new Date(a.date) - new Date(b.date))
}

// An inline, dismissible summary — sits in the page's own normal flow
// at the top of the task list rather than a full-viewport blocking
// modal (see git history for the earlier `OverdueGateModal` version).
// Overdue tasks aren't an error the user caused, so this doesn't
// interrupt the page or need acknowledging before anything else is
// usable — `role="status"`/`aria-live="polite"` announces it the same
// way a toast would, without trapping focus or blocking clicks to the
// list underneath. `TriangleAlert` + the `#fee2e2`/`#7f1d1d` palette
// match the overdue state everywhere else in the app (TaskCard's own
// `STATE_CHROME.overdue`), instead of the ad hoc red the old modal used.
export function OverdueBanner({ overdueItems, onDismiss, onReview }) {
  const visible = overdueItems.slice(0, 3)
  const hiddenCount = overdueItems.length - visible.length

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-2xl border border-[#fecaca] bg-[#fee2e2] p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-[#b91c1c]" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-sm font-semibold text-[#7f1d1d]">
            {overdueItems.length === 1 ? '1 task is overdue' : `${overdueItems.length} tasks are overdue`}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {visible.map((item) => (
              <li key={item.key} className="flex min-w-0 items-baseline gap-1.5">
                <Link
                  to={`/tasks/${item.taskId}`}
                  onClick={onDismiss}
                  className="min-w-0 shrink truncate text-sm font-medium text-[#b91c1c] hover:underline"
                >
                  {item.name}
                </Link>
                <span className="shrink-0 text-xs whitespace-nowrap text-[#7f1d1d]/70">
                  Due {formatDeadline(item.date)}
                </span>
              </li>
            ))}
            {hiddenCount > 0 && <li className="text-xs text-[#7f1d1d]/70">+{hiddenCount} more</li>}
          </ul>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
        <HoverFillButton onClick={onReview}>Review</HoverFillButton>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-full p-1.5 text-[#7f1d1d]/70 hover:bg-[#fecaca] hover:text-[#7f1d1d]"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
