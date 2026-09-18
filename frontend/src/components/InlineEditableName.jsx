import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

// Click-to-rename, shared by the task detail page's own title and
// each of its subtask rows — neither had any way to rename anything
// after creation before this. Not editing? just the name plus a
// pencil that only shows on hover, matching the app's existing
// hover-reveal restraint elsewhere (the cascade's tooltips, the
// "Add subtasks" link). Editing swaps in a plain text input with
// Save/Cancel, no popover — this doesn't need the deadline editor's
// floating-card treatment, an inline swap reads fine for a single
// text field.
export function InlineEditableName({ value, onSave, textClassName, inputClassName }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    e.stopPropagation()
    const trimmed = draft.trim()
    if (!trimmed) return
    setError(null)
    setSaving(true)
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
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            aria-label={`Rename "${value}"`}
            className={cn(
              'rounded-md border border-input bg-transparent px-2 py-1 outline-none focus-visible:border-ring',
              inputClassName
            )}
          />
          <button type="submit" disabled={saving} className="text-xs font-medium text-emerald-700 hover:underline">
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
      onClick={(e) => {
        e.stopPropagation()
        setDraft(value)
        setEditing(true)
      }}
      className={cn('group/edit flex min-w-0 items-center gap-1.5 text-left', textClassName)}
    >
      <span className="truncate">{value}</span>
      <Pencil
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100"
        aria-hidden="true"
      />
    </button>
  )
}
