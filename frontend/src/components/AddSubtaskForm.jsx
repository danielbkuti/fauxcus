import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeadlineEditor } from '@/components/DeadlineEditor'
import { useExclusiveDeadlineEditor } from '@/hooks/useExclusiveDeadlineEditor'
import { formatDeadline } from '@/lib/utils'

// Standalone add-subtask form. Viewing/toggling/deleting existing
// subtasks now lives in TaskCard's own cascading stack instead of a
// separate list component — this is just the "create a new one" half.
// `onCancel` is optional — call sites that reveal this form inline
// (TaskCard/TaskDetailPage's "Want to break this down..." prompt) pass
// it so there's a way back out without submitting; AddTaskFab's own
// popover already has its own close (X) button, so it doesn't need a
// second one in here.
//
// The deadline picker sits right under the name field, same
// "soft-purple pill trigger toggles a floating DeadlineEditor" pattern
// as everywhere else a subtask deadline gets set — but same as
// `NewTaskPage` (also creating something that doesn't exist yet), it
// just holds the picked value in local form state rather than saving
// immediately; there's no subtask to PATCH until Add actually creates
// one. `onAdd` is called with both `name` and `dateDeadline` (`null` if
// never set) so callers can include it in the create request.
//
// `theme` is optional — passed only by TaskDetailPage, whose own
// "+ Add subtask" trigger already colours itself off the page's current
// state (`theme.title`). Passing it here makes this form's submit
// button match that neighboring button exactly instead of introducing
// a second, disconnected colour. TaskCard's list-view usage leaves it
// unset and gets a fixed blue instead — the list has no equivalent
// per-state themed button for this one to echo.
export function AddSubtaskForm({ onAdd, onCancel, theme }) {
  const [name, setName] = useState('')
  const [dateDeadline, setDateDeadline] = useState(null)
  const [editingDeadline, openDeadlineEditor, closeDeadlineEditor] = useExclusiveDeadlineEditor()
  const deadlineAnchorRef = useRef(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  function handlePickDeadline(iso) {
    setDateDeadline(iso)
    closeDeadlineEditor()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setAdding(true)
    try {
      await onAdd(name, dateDeadline)
      setName('')
      setDateDeadline(null)
    } catch (err) {
      setError(err.data?.name?.[0] ?? 'Could not add that subtask.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a subtask…"
          aria-label="New subtask name"
          className="h-8 flex-1 bg-white text-xs"
          required
        />
        <Button
          type="submit"
          size="sm"
          disabled={adding}
          style={theme ? { background: theme.title } : undefined}
          className={theme ? 'text-white hover:brightness-110' : 'bg-[#4f7fd4] text-white hover:bg-[#3d68bd]'}
        >
          {adding ? 'Adding…' : 'Add'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={adding}>
            Cancel
          </Button>
        )}
      </div>

      <div ref={deadlineAnchorRef} className="relative w-fit">
        <button
          type="button"
          onClick={() => (editingDeadline ? closeDeadlineEditor() : openDeadlineEditor())}
          disabled={adding}
          className="w-fit rounded-full bg-[#f3e8ff] px-3 py-1 text-xs font-medium text-[#6b46a8] transition-colors hover:bg-[#e9d5ff] disabled:pointer-events-none disabled:opacity-60"
        >
          {dateDeadline ? `Due ${formatDeadline(dateDeadline)}` : 'Set deadline'}
        </button>
        {editingDeadline && (
          <DeadlineEditor anchorRef={deadlineAnchorRef} value={dateDeadline} onSave={handlePickDeadline} onCancel={closeDeadlineEditor} />
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}
