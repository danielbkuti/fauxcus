import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { TIMELINE_PRESETS, addMonths, toDateInputValue, formatTargetDate } from '@/lib/goals'

// The one form behind both "New goal" and editing an existing goal:
// what you want (a name), roughly when (a timeline), and anything else
// worth knowing (details). `onSubmit` receives
// { name, description, targetDate } already trimmed/normalized
// (description/targetDate are `undefined` when blank — see below for how
// an edit clears them).
export function GoalForm({ initial, submitLabel, submittingLabel, onSubmit, onCancel, submitting, error }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '')
  const isEdit = Boolean(initial)

  // Local today, for the date input's `min` — same "no backdating a
  // timeline" rule the API enforces.
  const minDate = toDateInputValue(new Date())

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit({
      name: name.trim(),
      // On create a blank field is simply left out; on edit it has to go
      // out as an explicit null/'' or the old value could never be
      // cleared (PATCH ignores keys that aren't sent).
      description: description.trim() || (isEdit ? '' : undefined),
      targetDate: targetDate || (isEdit ? null : undefined),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="goal-name">What&apos;s the goal?</Label>
        <Input
          id="goal-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Buy a car, learn Spanish, run a half marathon…"
          maxLength={100}
          required
          autoFocus
          className="h-11 text-lg"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm leading-none font-medium">When do you want it done?</legend>
        <div className="flex flex-wrap items-center gap-2">
          {TIMELINE_PRESETS.map((preset) => {
            const presetDate = toDateInputValue(addMonths(preset.months))
            const selected = targetDate === presetDate
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={selected}
                onClick={() => setTargetDate(selected ? '' : presetDate)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                  selected
                    ? 'border-[#7c5fb0] bg-[#7c5fb0] text-white'
                    : 'border-border bg-background hover:bg-muted'
                )}
              >
                In {preset.label}
              </button>
            )
          })}
          <Input
            type="date"
            aria-label="Target date"
            value={targetDate}
            min={minDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="h-9 w-auto"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {targetDate ? `Target: ${formatTargetDate(targetDate)}.` : 'Optional — leave it open-ended if there’s no deadline.'}
        </p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="goal-description">Anything else we should know?</Label>
        <textarea
          id="goal-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Budget, constraints, what you've already tried, why it matters…"
          className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="lg" disabled={submitting || !name.trim()}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
