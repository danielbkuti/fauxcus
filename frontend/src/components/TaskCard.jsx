import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, CornerDownRight, TriangleAlert, Hourglass, CircleCheckBig, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AddSubtaskForm } from '@/components/AddSubtaskForm'
import { ConfettiBurst } from '@/components/ConfettiBurst'
import { cn, formatDeadline, calculateProgress } from '@/lib/utils'
import { useDeadlineStatus } from '@/hooks/useDeadlineStatus'
import { DeadlineEditor } from '@/components/DeadlineEditor'
import { useExclusiveDeadlineEditor } from '@/hooks/useExclusiveDeadlineEditor'
import { PulseRing } from '@/components/PulseRing'

const PROGRESS_GRADIENT = 'bg-gradient-to-r from-[#e0c3fc] via-[#7c5fb0] to-[#8ec5fc]'
// The hover-fill preview on the Pending button (see PendingCompleteButton).
const HOVER_FILL_MS = 350
// A stable empty Set — the default for `celebratingSubtaskIds` when a
// caller doesn't pass one, so `.has()` always has something to call
// without allocating a fresh Set on every render.
const EMPTY_SET = new Set()
// How long `justSavedDeadline` stays true after a save — just needs to
// clear the single pulse PulseRing plays off that true edge (1s) with
// a little room to spare, so a later unrelated re-render doesn't find
// it still true and think a save just happened again.
const PULSE_CONFIRM_MS = 1200
// How long the pointer has to sit over the subtask stack before the
// "Click to see more" hint shows — long enough that just passing over
// it on the way to actually clicking doesn't flash it.
const STACK_HINT_DELAY_MS = 5000

// Row pitch/height for the two states of the subtask stack: collapsed
// (overlapping peek) vs. expanded (fully separated). Both are plain
// numbers rather than CSS classes because the whole point is animating
// between them — top/height/opacity/scale all interpolate smoothly
// with a CSS transition, so switching from one set of numbers to the
// other is what produces the "drop down"/"retract" effect, not a swap
// of layout modes. It's the same set of (up to 3) subtasks in both
// states — expanding doesn't reveal more, just spreads out what's
// already there. Seeing everything is what the task detail page
// ("View more") is for.
const COLLAPSED_ROW_HEIGHT = 40
const COLLAPSED_PITCH = 12
const EXPANDED_ROW_HEIGHT = 40
const EXPANDED_PITCH = 48

// --- Card-states.md: the four-state design system --------------------
// A task (and, extended below, a standalone promoted subtask card) is
// always in exactly one of these: 'progress' (on track), 'urgent' (due
// <24h), 'overdue', or 'done'. Everything visual — banner colour/glyph,
// ring accent, flood surface, resting shadow, heartbeat — is looked up
// from here rather than forked per call site, per the handoff's "one
// pattern, four tunings" instruction. Values here are things it's safe
// to compute dynamically (hand-written CSS classes, or raw values fed
// through inline `style`) — never a Tailwind arbitrary-value class,
// since those need to appear as static literal text for Tailwind's
// scanner to generate them (see the *_CLASS lookup objects below for
// those instead).
const STATE_CHROME = {
  progress: {
    flood: 'task-glass',
    ring: undefined, // falls through to .task-ring's own default accent
    shadow: '0 10px 30px -20px rgba(124,95,176,.4), 0 1px 2px rgba(37,37,37,.05)',
    heartbeat: null,
    glyph: Clock,
    glyphBeat: null,
    bannerFrom: '#6b46a8',
    bannerTo: '#4f7fd4',
    // Matches `.task-glass`'s own `bg-card` base (white in light mode)
    // — see `floodBase`'s own comment below for what this is for.
    floodBase: '#ffffff',
  },
  urgent: {
    flood: 'task-glass-urgent',
    ring: 'linear-gradient(135deg,#fb7c50,#e0562f 60%,#9a3412)',
    shadow: '0 10px 30px -20px rgba(154,52,18,.38), 0 1px 2px rgba(37,37,37,.05)',
    heartbeat: 'animate-pulse-ember',
    glyph: Hourglass,
    glyphBeat: '2.4s',
    bannerFrom: '#9a3412',
    bannerTo: '#d4451c',
    floodBase: '#fffaf8', // must match .task-glass-urgent's own background-color
  },
  overdue: {
    flood: 'task-glass-overdue',
    ring: 'linear-gradient(135deg,#f87171,#b91c1c 60%,#7f1d1d)',
    shadow: '0 10px 30px -18px rgba(185,28,28,.45), 0 1px 2px rgba(37,37,37,.05)',
    heartbeat: 'animate-pulse-red',
    glyph: TriangleAlert,
    glyphBeat: '1.8s',
    bannerFrom: '#b91c1c',
    bannerTo: '#dc2626',
    floodBase: '#fffafa', // must match .task-glass-overdue's own background-color
  },
  done: {
    flood: 'task-glass-done',
    ring: 'linear-gradient(135deg,#6ee7b7,#059669 60%,#065f46)',
    shadow: '0 10px 30px -18px rgba(5,150,105,.4), 0 1px 2px rgba(37,37,37,.05)',
    heartbeat: null,
    glyph: CircleCheckBig,
    glyphBeat: null,
    bannerFrom: '#047857',
    bannerTo: '#059669',
    floodBase: '#f8fffb', // must match .task-glass-done's own background-color
  },
}

// Literal Tailwind fragments per state — kept as static strings (never
// built via template interpolation) so the JIT scanner can see them.
// Only 'urgent'/'overdue'/'done' ever override the default look; a
// missing key means "state doesn't touch this element" and callers fall
// back to the existing default class themselves.
const PILL_CLASS = {
  urgent: 'bg-[#ffe8e0] text-[#7c2d12] hover:bg-[#ffd6c4]',
  overdue: 'bg-[#fee2e2] text-[#7f1d1d] hover:bg-[#fecaca]',
}
const TITLE_CLASS = {
  urgent: 'text-[#7c2d12]',
  overdue: 'text-[#7f1d1d]',
  done: 'line-through decoration-[rgba(4,120,87,0.5)] text-[#047857]',
}
const BADGE_CLASS = {
  urgent: 'bg-[#ffe8e0] text-[#9a3412] hover:bg-[#ffd6c4]',
  overdue: 'bg-[#fee2e2] text-[#b91c1c]',
  done: 'bg-[#d1fae5] text-[#047857]',
}
// One step more saturated than the badge/pill tones (`PILL_CLASS`'s own
// hover, `#ffd6c4`/`#fecaca`/`#bbf7d0`) rather than the resting badge
// colour itself — the delete icon sits directly on that state's own
// lustre wash (e.g. `.task-glass-urgent`'s `#fffaf8`), which is close
// enough to `#ffe8e0` that the hover read as barely-there.
const DELETE_CLASS = {
  urgent: 'text-[#9a3412] hover:bg-[#ffd6c4] hover:text-[#9a3412]',
  overdue: 'text-[#b91c1c] hover:bg-[#fecaca] hover:text-[#b91c1c]',
  done: 'text-[#047857] hover:bg-[#bbf7d0] hover:text-[#047857]',
}
const TRACK_CLASS = {
  urgent: 'border-[#fca98d] bg-[#ffe8e0]',
  overdue: 'border-[#fca5a5] bg-[#fee2e2]',
  done: 'border-[#6ee7b7] bg-[#d1fae5]',
}
const FILL_CLASS = {
  overdue: 'bg-gradient-to-r from-[#f87171] to-[#b91c1c]',
  done: 'bg-gradient-to-r from-[#34d399] to-[#059669]',
  // urgent + progress keep PROGRESS_GRADIENT — an urgent deadline
  // doesn't mean the work itself is behind, a red bar would lie.
}
const META_CLASS = {
  urgent: 'text-[#9a3412]',
  overdue: 'text-[#b91c1c]',
  done: 'text-[#047857]',
}
const ROW_CLASS = {
  urgent: 'border-[#fca98d] bg-white shadow-[0_1px_2px_rgba(154,52,18,.1)]',
  overdue: 'border-[#fca5a5] bg-white shadow-[0_1px_2px_rgba(185,28,28,.1)]',
  done: 'border-[#6ee7b7] bg-white shadow-[0_1px_2px_rgba(5,150,105,.1)]',
}
const CHECKBOX_BORDER_CLASS = {
  urgent: 'border-[#fca98d]',
  overdue: 'border-[#fca5a5]',
}
const CHIP_CLASS = {
  urgent: 'bg-[#ffe8e0] text-[#9a3412] hover:bg-[#ffd6c4]',
  done: 'bg-[#d1fae5] text-[#047857] hover:bg-[#bbf7d0]',
}
const BANNER_ACTION_HOVER_TEXT = {
  progress: 'hover:text-[#6b46a8]',
  overdue: 'hover:text-[#b91c1c]',
  done: 'hover:text-[#047857]',
}

// The overdue banner's elapsed label wants a tighter shape than
// useDeadlineStatus's own `overdueDisplay` ("N day(s), HH:MM:SS", always
// with seconds) — "Xd HH:MM" once past a day, plain "HH:MM:SS" under it.
// Same underlying 1s tick and source string, just reshaped for the banner.
function formatOverdueElapsed(overdueDisplay) {
  if (!overdueDisplay) return ''
  const match = overdueDisplay.match(/^(\d+) days?, (\d{2}):(\d{2}):\d{2}$/)
  if (!match) return overdueDisplay
  const [, days, hh, mm] = match
  return `${days}d ${hh}:${mm}`
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// A compact "3d 4h" / "5h 12m" / "40m" duration, for the in-progress
// banner's "Next up" countdown — that one isn't urgent enough to need
// useDeadlineStatus's own HH:MM:SS clock, and can be multiple days out.
function formatDueInDays(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatTimeOfDay(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// The shared banner anatomy every state renders (only the four tunings
// above change): a full-bleed strip, first child of the card, glyph +
// message + optional action. `state` looks up its own gradient/glyph;
// `message`/`action` are state-specific text/handlers the caller builds.
// Rounds its own top corners to match the card it sits in (`radiusClass`)
// rather than relying on the card root clipping via `overflow-hidden` —
// that clipped more than just the banner's corners, cutting off any
// popover (the deadline editor) that opens from inside the card and
// needs to float over whatever's below it on the page.
function StateBanner({ state, message, action, radiusClass = 'rounded-t-2xl' }) {
  const chrome = STATE_CHROME[state]
  const Glyph = chrome.glyph
  return (
    <div
      className={cn('flex items-center gap-2.5 py-[9px] pr-5 pl-[18px] text-white', radiusClass)}
      style={{ background: `linear-gradient(90deg,${chrome.bannerFrom},${chrome.bannerTo})` }}
      onClick={(e) => e.stopPropagation()}
    >
      <Glyph
        className={cn('size-[15px] shrink-0', chrome.glyphBeat && 'animate-glyph-beat')}
        strokeWidth={state === 'done' ? 2.6 : 2.4}
        style={chrome.glyphBeat ? { animationDuration: chrome.glyphBeat } : undefined}
        aria-hidden="true"
      />
      <span className="flex-1 text-[12.5px] font-black tracking-[0.01em] tabular-nums">{message}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={cn(
            'shrink-0 rounded-full border border-white/[0.55] bg-white/[0.16] px-3 py-1 text-[11.5px] font-bold whitespace-nowrap transition-colors hover:bg-white',
            BANNER_ACTION_HOVER_TEXT[state]
          )}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// One subtask card in the stack. The checkbox and the due-date bubble
// are the interactive parts — the due-date bubble opens a small menu
// (mark complete / change deadline) as an alternative path to the same
// completion action. Every click handler here stops propagation: this
// sits inside both the stack's own expand/collapse toggle and the whole
// card's click-to-open-detail-page behavior, and interacting with
// either control should do neither. `justCompleted` is true for the
// brief window (TaskList's own SUBTASK_CELEBRATION_MS) after checking
// it off, during which the parent deliberately keeps rendering it here
// instead of letting it drop out immediately — long enough for the
// checkmark + strikethrough (and now the fireworks burst) to actually
// read as an animation. Owned by TaskList now, not this card, so the
// *other* copy of the same subtask (its promoted standalone entry, or
// this cascade-bundled one, whichever wasn't the one actually clicked)
// celebrates in step too — see TaskCard's own `celebratingSubtaskIds`
// prop for why.
//
// `partOf` is what turns this from a stack row into a standalone card:
// passed only when the task list promotes a subtask to its own spot in
// the sort (see TaskList's due-date bucketing), it swaps the absolute
// stack positioning for normal flow and adds a plain "Part of ..."
// tag above the card — grey by default, blue only on hover, same
// hover-reveal restraint as the rest of the app's hint text — that
// jumps back to the full task's card instead of navigating away.
export function SubtaskStackCard({
  subtask,
  dimmed,
  justCompleted,
  style,
  onToggleComplete,
  onSetDeadline,
  onDelete,
  partOf,
  pulseReady = true,
  // The *parent task's own* state ('progress' | 'urgent' | 'overdue' |
  // 'done') — TaskCard passes this through for its cascade rows so the
  // row surface reads as part of its flooded card. Unused by the
  // `partOf` (promoted standalone) branch, which derives its own state
  // below from the subtask's own status instead.
  parentState = 'progress',
}) {
  const [editingDeadline, openDeadlineEditor, closeDeadlineEditor] = useExclusiveDeadlineEditor()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  // Flipped true right after a successful deadline save, then back to
  // false a moment later — PulseRing uses the true edge to fire one
  // confirming pulse, independent of whether the new deadline is
  // actually urgent/overdue.
  const [justSavedDeadline, setJustSavedDeadline] = useState(false)
  const deleteRef = useRef(null)
  const dueChipAnchorRef = useRef(null)
  const checked = subtask.completed || justCompleted
  const countdown = useDeadlineStatus(subtask.dateDeadline, checked, { liveOverdue: true })

  // The promoted-standalone-card state, derived from this subtask's own
  // status rather than any parent — 'progress' (on track, no banner:
  // subtasks have nothing of their own to say when nothing's urgent),
  // 'urgent'/'overdue' from the same countdown the due-chip already
  // uses, or 'done' once checked.
  const ownState = checked ? 'done' : countdown.isOverdue ? 'overdue' : countdown.isUrgent ? 'urgent' : 'progress'
  // What actually colours this row's shared bits (checkbox, due chip,
  // delete icon) — the parent's state for a cascade row, this
  // subtask's own for a promoted one.
  const effectiveState = partOf ? ownState : parentState

  let subtaskBannerMessage = null
  let subtaskBannerAction = null
  if (ownState === 'overdue') {
    subtaskBannerMessage = `Overdue by ${formatOverdueElapsed(countdown.overdueDisplay)} — was due ${formatDeadline(subtask.dateDeadline)}`
    subtaskBannerAction = {
      label: 'Reschedule',
      onClick: (e) => {
        e.stopPropagation()
        openDeadlineEditor()
      },
    }
  } else if (ownState === 'urgent') {
    const dayLabel = isSameLocalDay(new Date(subtask.dateDeadline), new Date()) ? 'Due today' : 'Due tomorrow'
    subtaskBannerMessage = `${dayLabel} in ${countdown.countdownDisplay}`
  } else if (ownState === 'done') {
    subtaskBannerMessage = subtask.dateCompleted ? `Completed ${formatDeadline(subtask.dateCompleted)}` : 'Completed'
    subtaskBannerAction = {
      label: 'Reopen',
      onClick: (e) => {
        e.stopPropagation()
        onToggleComplete(false)
      },
    }
  }
  const showSubtaskBanner = partOf && ownState !== 'progress'

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

  async function handleDeleteConfirm(e) {
    e.stopPropagation()
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  function toggleDeadlineEditor() {
    if (editingDeadline) closeDeadlineEditor()
    else openDeadlineEditor()
  }

  // Checkbox.onCheckedChange hands back a boolean, not an event — the
  // stopPropagation happens via the Checkbox's own onClick instead.
  async function handleCheckboxChange(value) {
    setBusy(true)
    try {
      await onToggleComplete(value)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeadlineSave(dateDeadline) {
    await onSetDeadline(dateDeadline)
    closeDeadlineEditor()
    setJustSavedDeadline(true)
    setTimeout(() => setJustSavedDeadline(false), PULSE_CONFIRM_MS)
  }

  const rowContent = (
    <>
      <Checkbox
        checked={checked}
        onCheckedChange={handleCheckboxChange}
        onClick={(e) => e.stopPropagation()}
        disabled={busy || justCompleted}
        className={cn(
          'shrink-0 data-checked:border-emerald-500 data-checked:bg-emerald-500',
          !checked && CHECKBOX_BORDER_CLASS[effectiveState],
          justCompleted && 'animate-check-pop'
        )}
      />
      <span
        className={cn(
          'flex-1 truncate font-medium transition-colors duration-300',
          checked && (effectiveState === 'done' ? TITLE_CLASS.done : 'text-muted-foreground line-through')
        )}
      >
        {subtask.name}
      </span>

      {subtask.dateDeadline ? (
        // The chip stays on screen the whole time, editor included —
        // it used to be swapped out for the editor entirely, so the
        // one piece of context you actually want while picking a new
        // date (what it's currently set to) disappeared right when you
        // opened the picker.
        <div ref={dueChipAnchorRef} className="relative shrink-0">
          <PulseRing ready={(countdown.isOverdue || countdown.isUrgent) && pulseReady} forceOnce={justSavedDeadline} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleDeadlineEditor()
            }}
            className={cn(
              'relative rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors',
              countdown.isOverdue
                ? 'bg-red-700 text-white hover:bg-red-800'
                : countdown.isUrgent
                  ? 'bg-red-50 text-red-700 hover:bg-red-100'
                  : effectiveState === 'done' && checked
                    ? CHIP_CLASS.done
                    : effectiveState === 'urgent'
                      ? CHIP_CLASS.urgent
                      : // Soft purple, not amber — this is the app's
                        // generic "calm, nothing urgent" pill colour
                        // (same pair as TaskDetailPage's STATE_THEME.far)
                        // now that subtask deadline chips no longer use
                        // amber for it.
                        'bg-[#f3e8ff] text-[#6b46a8] hover:bg-[#e9d5ff]'
            )}
          >
            {effectiveState === 'done' && checked
              ? 'Done'
              : countdown.isOverdue
                ? 'Overdue'
                : countdown.isUrgent
                  ? `Due in: ${countdown.countdownDisplay}`
                  : `Due ${formatDeadline(subtask.dateDeadline)}`}
          </button>
          {editingDeadline && (
            <DeadlineEditor
              anchorRef={dueChipAnchorRef}
              value={subtask.dateDeadline}
              onSave={handleDeadlineSave}
              onCancel={closeDeadlineEditor}
            />
          )}
        </div>
      ) : !checked ? (
        // Previously nowhere on this page — a subtask with no deadline
        // yet had no "set one" control at all in the list view (only
        // ever settable from the add-subtask form at creation time, or
        // from the task detail page). Same soft-purple pill/portal-
        // popover pattern as the has-a-deadline case above. Hidden once
        // `checked`, same as a completed subtask never having had one
        // just shows nothing here — editing a finished subtask's
        // deadline isn't a control that exists anywhere else either.
        <div ref={dueChipAnchorRef} className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleDeadlineEditor()
            }}
            className="relative rounded-full bg-[#f3e8ff] px-2 py-0.5 text-[11px] font-medium text-[#6b46a8] transition-colors hover:bg-[#e9d5ff]"
          >
            Set deadline
          </button>
          {editingDeadline && (
            <DeadlineEditor anchorRef={dueChipAnchorRef} value={null} onSave={handleDeadlineSave} onCancel={closeDeadlineEditor} />
          )}
        </div>
      ) : null}

      {/* A completed subtask loses its delete control here — same rule
          as a completed task's own card (see TaskCard's delete-button
          gate below): once something's done, this list view isn't
          where you clean it up. Still deletable from the backend/other
          views, just not this button. */}
      {effectiveState !== 'done' && (
        <div className="relative shrink-0" ref={deleteRef}>
          {confirmingDelete ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border bg-card p-2.5 text-left shadow-lg"
            >
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
                  className="text-[11px] font-medium text-destructive hover:underline"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmingDelete(true)
              }}
              aria-label="Delete subtask"
              className={cn(
                'transition-colors',
                effectiveState === 'progress' ? 'text-muted-foreground hover:text-destructive' : DELETE_CLASS[effectiveState]
              )}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </>
  )

  if (!partOf) {
    return (
      <div
        className={cn(
          // Back to the original 1px `border` weight — `border-2`
          // read as noticeably heavier/boxier than the rest of the
          // card's own delicate lines once actually visible. The fix
          // for "can't see the outline" was the explicit colour below
          // (the theme's own default border token is nearly the same
          // lightness as the card underneath it and all but
          // disappeared), not the extra thickness — keeping the colour,
          // dropping the thickness back down.
          'absolute inset-x-0 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-[color,background-color,border-color,box-shadow] duration-300 ease-in-out',
          dimmed
            ? 'bg-muted/60 text-muted-foreground shadow-none'
            : parentState !== 'progress'
              ? ROW_CLASS[parentState]
              : 'border-slate-300 bg-card shadow-sm',
          justCompleted && 'animate-flash-emerald'
        )}
        style={
          editingDeadline
            ? // Used to also be load-bearing for DeadlineEditor itself:
              // the peek-stack's `transform`/`opacity` (from `style`, set
              // by TaskCard for the collapsed-stack scale/fade look)
              // created a stacking context that trapped the popover's
              // z-index below whatever was underneath. DeadlineEditor
              // now renders through a portal straight into
              // `document.body`, so it has no ancestor to be trapped by
              // any more — but this neutralization is worth keeping
              // anyway, purely cosmetic now: it reads the row at full
              // scale/opacity while you're actually picking its date,
              // rather than leaving it in its dimmed collapsed-peek look.
              { ...style, transform: 'none', opacity: 1 }
            : style
        }
      >
        {justCompleted && <ConfettiBurst />}
        {rowContent}
      </div>
    )
  }

  // The promoted-into-the-list version: one small card (same compact
  // sizing as a stack row, not a full task card), the subtask itself
  // on top and the "Part of ..." jump-back tag inside the same
  // border, below it — not a separate floating line above the card.
  // Bare text + arrow, grey by default and blue only on hover, same
  // hover-reveal restraint as the rest of the app's hint text. Same
  // state system as the main TaskCard (glass-lustre/gradient-ring/
  // banner/heartbeat — see STATE_CHROME above), just keyed off this
  // subtask's own status (`ownState`) instead of a task's — this is
  // the one place a subtask stands as its own list entry rather than
  // living inside a task's cascade, so it earns the same "this is a
  // real card" treatment. No banner while on track (`ownState ===
  // 'progress'`): a subtask has no "next up" of its own to report, so
  // — same as the main card's philosophy — it stays quiet.
  const chrome = STATE_CHROME[ownState]
  return (
    <div
      className={cn(
        chrome.flood,
        'relative rounded-lg text-xs transition-[color,background-color,border-color,box-shadow] duration-300 ease-in-out',
        showSubtaskBanner ? 'p-0' : 'flex flex-col gap-2 bg-card px-3 py-2 shadow-sm',
        chrome.heartbeat,
        justCompleted && 'animate-flash-emerald'
      )}
      style={showSubtaskBanner ? { boxShadow: chrome.shadow } : undefined}
    >
      <span aria-hidden="true" className="task-ring" style={{ '--task-accent': chrome.ring }} />
      {justCompleted && <ConfettiBurst />}
      {showSubtaskBanner && (
        <StateBanner state={ownState} message={subtaskBannerMessage} action={subtaskBannerAction} radiusClass="rounded-t-lg" />
      )}
      <div className={showSubtaskBanner ? 'flex flex-col gap-2 px-3 pt-2.5 pb-2' : 'contents'}>
        <div className="flex items-center gap-2">{rowContent}</div>
        <button
          type="button"
          onClick={partOf.onClick}
          className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-sky-600"
        >
          <CornerDownRight className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{partOf.label}</span>
        </button>
      </div>
    </div>
  )
}

// The task's own status toggle — both directions. When it's clickable
// (not blocked on incomplete subtasks), hovering previews what
// clicking would do: for a pending task, the gradient sweeps in from
// the left like a loading bar and the label flips to "Complete" once
// fully filled; for an already-completed task, a plain fill sweeps in
// from the *right* over the gradient and the label flips to "Undo" —
// same mechanic, reversed, so completing and undoing read as mirror
// images of each other. Either preview is purely visual — the button
// is fully clickable at every point along the fill, not just once it
// finishes; a click always fires immediately regardless of hover
// progress. Moving the mouse away cancels the timer and the fill
// retreats (plain CSS transition reversing). Undo preserves every
// other field (due date, created date) — it's a plain `completed:
// false` PATCH, same request shape either direction; the backend
// clears dateCompleted on its own and touches nothing else.
export function PendingCompleteButton({ task, blocked, onClick }) {
  const [hoverPreview, setHoverPreview] = useState(false)
  const timerRef = useRef(null)
  // Same status this button's card already computes for its ring/banner —
  // derived here too (task carries everything needed) rather than a new
  // prop, so the idle pill can go red/ember-flagged without widening the
  // component's own contract.
  const countdown = useDeadlineStatus(task.dateDeadline, task.completed)
  const idleState = task.completed
    ? 'done'
    : countdown.isOverdue
      ? 'overdue'
      : countdown.isUrgent
        ? 'urgent'
        : 'progress'

  function handleMouseEnter() {
    if (blocked) return
    timerRef.current = setTimeout(() => setHoverPreview(true), HOVER_FILL_MS)
  }

  function handleMouseLeave() {
    clearTimeout(timerRef.current)
    setHoverPreview(false)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        // Reset the hover preview immediately rather than leaving it
        // showing through the async completion toggle — task.completed
        // (and everything derived from it: idleState, the two
        // mutually-exclusive fill-sweep spans, the label) only updates
        // once the request round-trips, but the mouse is almost always
        // still sitting on the button right after a click. Without
        // this, the *old* preview state hangs around across that gap
        // and then collides with the real new state the instant it
        // lands — several unrelated properties changing at once reads
        // as a flicker rather than a clean transition.
        clearTimeout(timerRef.current)
        setHoverPreview(false)
        onClick()
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      disabled={blocked}
      title={blocked ? 'Complete all subtasks first' : task.completed ? 'Click to mark as pending again' : undefined}
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
        idleState === 'done'
          ? 'bg-gradient-to-r from-[#34d399] to-[#059669] text-white hover:opacity-90'
          : idleState === 'progress'
            ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            : cn(PILL_CLASS[idleState], 'hover:bg-secondary'),
        blocked && 'cursor-not-allowed opacity-60 hover:bg-secondary'
      )}
    >
      {!task.completed && !blocked && (
        <span
          aria-hidden="true"
          className={cn(
            PROGRESS_GRADIENT,
            'absolute inset-0 origin-left scale-x-0 transition-transform ease-linear group-hover:scale-x-100'
          )}
          style={{ transitionDuration: `${HOVER_FILL_MS}ms` }}
        />
      )}
      {task.completed && !blocked && (
        <span
          aria-hidden="true"
          className="absolute inset-0 origin-right scale-x-0 bg-secondary transition-transform ease-linear group-hover:scale-x-100"
          style={{ transitionDuration: `${HOVER_FILL_MS}ms` }}
        />
      )}
      <span
        className={cn(
          'relative',
          hoverPreview && !task.completed && 'text-white',
          hoverPreview && task.completed && 'text-secondary-foreground'
        )}
      >
        {task.completed ? (hoverPreview ? 'Undo' : 'Completed') : hoverPreview ? 'Complete' : 'Pending'}
      </span>
    </button>
  )
}

// Presentational, with local UI state for the deadline editor, the
// delete confirm step, and whether the subtask stack is expanded.
// `onToggleComplete`/`onSetDeadline` are called with the task and the
// new value; the parent (TaskList) owns updating the server and
// reconciling local state — this component never talks to the API
// directly.
export function TaskCard({
  task,
  celebrating,
  onToggleComplete,
  onSetDeadline,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onSetSubtaskDeadline,
  onDeleteSubtask,
  pulseReady = true,
  selectMode = false,
  selected = false,
  onSelectToggle,
  // Owned by TaskList, not this card — a subtask promoted to its own
  // standalone entry in the due-date sort renders as a *second*,
  // separate SubtaskStackCard instance outside this component
  // entirely (see TaskList's own renderEntry), so "is this subtask
  // celebrating" can't live in this card's local state the way it
  // used to: checking it off from the promoted card wouldn't be
  // visible in here, and vice versa. Lifting it to TaskList (shared by
  // every card, cascade-bundled or promoted, for the same subtask id)
  // is what makes both copies cross out together regardless of which
  // one was actually clicked.
  celebratingSubtaskIds = EMPTY_SET,
}) {
  const navigate = useNavigate()
  const [editingDeadline, openDeadlineEditor, closeDeadlineEditor] = useExclusiveDeadlineEditor()
  const dueChipAnchorRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  // The "Click to see more"/"Click to collapse" hint above the subtask
  // stack — deliberately not a plain CSS `:hover` reveal (instant, and
  // fires even on a passing mouse-over on the way to actually clicking
  // it). Only shows once the pointer's sat there a beat; a click
  // before that cancels the pending timer instead of flashing the hint
  // right as the click registers.
  const [showStackHint, setShowStackHint] = useState(false)
  const stackHintTimerRef = useRef(null)

  function handleStackMouseEnter() {
    stackHintTimerRef.current = setTimeout(() => setShowStackHint(true), STACK_HINT_DELAY_MS)
  }

  function handleStackMouseLeave() {
    clearTimeout(stackHintTimerRef.current)
    setShowStackHint(false)
  }

  useEffect(() => () => clearTimeout(stackHintTimerRef.current), [])
  const [addingSubtask, setAddingSubtask] = useState(false)

  // Two clicks to actually delete: the first just reveals a confirm
  // step, in-line rather than a browser confirm() dialog. Only reset
  // `deleting` on failure — on success the card unmounts along with the
  // rest of this state.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  // Flipped true right after a successful deadline save, then back to
  // false a moment later — PulseRing uses the true edge to fire one
  // confirming pulse, independent of whether the new deadline is
  // actually urgent/overdue.
  const [justSavedDeadline, setJustSavedDeadline] = useState(false)

  async function handleDeleteConfirm() {
    setDeleteError(null)
    setDeleting(true)
    try {
      await onDelete(task)
    } catch (err) {
      setDeleteError(err.data?.detail ?? 'Could not delete this task.')
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  async function handleDeadlineSave(dateDeadline) {
    await onSetDeadline(task, dateDeadline)
    closeDeadlineEditor()
    setJustSavedDeadline(true)
    setTimeout(() => setJustSavedDeadline(false), PULSE_CONFIRM_MS)
  }

  function toggleDeadlineEditor() {
    if (editingDeadline) closeDeadlineEditor()
    else openDeadlineEditor()
  }

  const progress = calculateProgress(task)
  // `liveOverdue: true` so the overdue banner's elapsed label actually
  // ticks — list cards previously opted out of this (a static "Overdue"
  // badge was enough before there was a live duration to show).
  const countdown = useDeadlineStatus(task.dateDeadline, task.completed, { liveOverdue: true })
  // The card's overall state — drives the banner, ring, flood surface,
  // shadow, and heartbeat below, plus every colour swap in the body.
  const state = task.completed ? 'done' : countdown.isOverdue ? 'overdue' : countdown.isUrgent ? 'urgent' : 'progress'
  const chrome = STATE_CHROME[state]

  // Completing a task is gated on every subtask already being done —
  // this only blocks the pending -> completed direction; reopening an
  // already-completed task is always allowed regardless of subtask
  // state.
  const hasIncompleteSubtasks = task.subtasks.some((s) => !s.completed)
  const blockedFromCompleting = !task.completed && hasIncompleteSubtasks
  const incompleteSubtaskCount = task.subtasks.filter((s) => !s.completed).length

  function handleToggleClick() {
    if (blockedFromCompleting) return
    onToggleComplete(task, !task.completed)
  }

  // The 3 most due subtasks: deadline first (soonest first), backfilled
  // with other incomplete subtasks (even undated) so at least 2 show
  // whenever at least 2 incomplete subtasks exist — never manufacturing
  // a second entry that isn't there. If every subtask is already done,
  // falls back to showing one of them so there's still something to
  // click into. A subtask mid-celebration still counts as "incomplete"
  // here — it's checked off server-side already, but stays put in the
  // stack (rendered with the checkmark + strikethrough) until its timer
  // clears, rather than vanishing the instant the request resolves.
  const incompleteSubtasks = task.subtasks.filter(
    (s) => !s.completed || celebratingSubtaskIds.has(s.id)
  )
  const dueSubtasks = incompleteSubtasks
    .filter((s) => s.dateDeadline)
    .sort((a, b) => new Date(a.dateDeadline) - new Date(b.dateDeadline))
  const undatedSubtasks = incompleteSubtasks.filter((s) => !s.dateDeadline)
  const minToShow = Math.min(2, incompleteSubtasks.length)
  const previewSubtasks = [
    ...dueSubtasks,
    ...undatedSubtasks.slice(0, Math.max(0, minToShow - dueSubtasks.length)),
  ].slice(0, 3)
  const rows = previewSubtasks.length > 0 ? previewSubtasks : task.subtasks.slice(0, 1)

  const rowHeight = expanded ? EXPANDED_ROW_HEIGHT : COLLAPSED_ROW_HEIGHT
  const pitch = expanded ? EXPANDED_PITCH : COLLAPSED_PITCH
  const stackHeight = rows.length > 0 ? (rows.length - 1) * pitch + rowHeight : 0
  const hasMoreThanShown = task.subtasks.length > rows.length

  // The soonest dated, still-incomplete subtask — what the 'progress'
  // (on-track) state's banner surfaces as "Next up", when there is one.
  // Called unconditionally (same as every other useDeadlineStatus call
  // on this card) even outside the 'progress' state, since hooks can't
  // be conditional; harmless to compute when unused.
  const nextUpSubtask = dueSubtasks[0] ?? null
  const nextUpCountdown = useDeadlineStatus(nextUpSubtask?.dateDeadline ?? null, false)

  function handleStackKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setExpanded((v) => !v)
    }
  }

  // Banner copy + action per state — the one thing that's genuinely
  // different across all four, everything else in STATE_CHROME/the
  // *_CLASS lookups is just colour. 'progress' only gets a banner when
  // there's an actual next-due subtask to report; a card with nothing
  // urgent to say stays quiet, same rule the other states don't need
  // (they always have something to report).
  let bannerMessage = null
  let bannerAction = null
  if (state === 'overdue') {
    bannerMessage = `Overdue by ${formatOverdueElapsed(countdown.overdueDisplay)} — was due ${formatDeadline(task.dateDeadline)}`
    bannerAction = {
      label: 'Reschedule',
      onClick: (e) => {
        e.stopPropagation()
        setAddingSubtask(false)
        openDeadlineEditor()
      },
    }
  } else if (state === 'urgent') {
    const dayLabel = isSameLocalDay(new Date(task.dateDeadline), new Date()) ? 'Due today' : 'Due tomorrow'
    const openClause = incompleteSubtaskCount > 0 ? ` — ${incompleteSubtaskCount} subtask${incompleteSubtaskCount === 1 ? '' : 's'} still open` : ''
    bannerMessage = `${dayLabel} in ${countdown.countdownDisplay}${openClause}`
    // No action button for this state — the message spans full width.
  } else if (state === 'done') {
    bannerMessage = task.dateCompleted ? `Completed ${formatDeadline(task.dateCompleted)}` : 'Completed'
    bannerAction = {
      label: 'Reopen',
      onClick: (e) => {
        e.stopPropagation()
        handleToggleClick()
      },
    }
  } else if (nextUpSubtask) {
    const dueTail = nextUpCountdown.isOverdue
      ? 'now overdue'
      : `due in ${nextUpCountdown.isUrgent ? nextUpCountdown.countdownDisplay : formatDueInDays(new Date(nextUpSubtask.dateDeadline).getTime() - Date.now())}`
    bannerMessage = `Next up: ${nextUpSubtask.name} — ${dueTail}`
    bannerAction = {
      label: 'Open',
      onClick: (e) => {
        e.stopPropagation()
        setExpanded(true)
      },
    }
  }
  const showBanner = bannerMessage !== null

  return (
    // The whole card opens the task detail page — everything that
    // isn't that (the status toggle, the deadline control, delete, the
    // subtask stack, the add-subtask link) stops its own click from
    // bubbling up to this, rather than this component trying to guess
    // "was that a real link" from the event target.
    <div
      id={`task-${task.id}`}
      onClick={() => (selectMode ? onSelectToggle?.() : navigate(`/tasks/${task.id}`))}
      className={cn(
        chrome.flood,
        'relative w-full cursor-pointer rounded-2xl bg-card',
        // No `transform` here on purpose — even a tiny hover lift
        // creates a new stacking context for the whole card, which
        // then traps this card's own deadline-editor popover (z-30)
        // inside it instead of letting it paint above the *next* card
        // in the list. That's what made the popover only "overlap
        // properly" while the mouse wasn't over it: hovering the
        // popover itself still counts as hovering this card (it's a
        // DOM descendant), so the stacking context — and the trapped
        // z-index — came and went with the hover. `hover:shadow-xl`
        // gives the same "this card is active" feedback without ever
        // creating one.
        'transition-shadow duration-300 ease-out hover:shadow-xl',
        showBanner ? 'p-0' : 'p-5',
        chrome.heartbeat,
        celebrating && 'animate-flash-emerald',
        selected && 'ring-2 ring-sky-400'
      )}
      style={{ boxShadow: chrome.shadow }}
    >
      {/* Gradient border ring — purely decorative overlay, replaces the flat
          `border`. Accent tracks state: purple in progress, ember urgent,
          red overdue, emerald done. Sits above the banner (see .task-ring's
          z-index) so it isn't clipped under it. */}
      <span aria-hidden="true" className="task-ring" style={{ '--task-accent': chrome.ring }} />
      {celebrating && <ConfettiBurst />}

      {/* ---- state banner: full-bleed, states the fact and (usually)
          offers the fix. Silent only for an on-track task with nothing
          due soon among its subtasks. ---- */}
      {showBanner && <StateBanner state={state} message={bannerMessage} action={bannerAction} />}

      <div className={showBanner ? 'px-5 pt-4 pb-5' : ''}>
      {/* ---- header row: status toggle, name, due date, delete ---- */}
      <div className="flex items-center gap-4">
        {selectMode && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onSelectToggle?.()}
            onClick={(e) => e.stopPropagation()}
            aria-label={selected ? 'Deselect task' : 'Select task'}
            className="shrink-0"
          />
        )}
        <PendingCompleteButton task={task} blocked={blockedFromCompleting} onClick={handleToggleClick} />

        <span
          className={cn(
            'flex-1 truncate text-lg font-semibold',
            state === 'done' ? TITLE_CLASS.done : TITLE_CLASS[state]
          )}
        >
          {task.name}
        </span>

        {/* The badge/chip stays on screen the whole time the editor's
            open (it used to be swapped out for the editor entirely, so
            the one piece of context worth keeping while picking a new
            date — what it's currently set to — disappeared right when
            you opened the picker). `relative` here is what the editor
            (rendered alongside, not instead) anchors off of. */}
        <div ref={dueChipAnchorRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          {state === 'done' ? (
            // The banner now carries the completion date/outcome — this
            // slot repurposes into a quieter subtask summary, and drops
            // out entirely for a task with none.
            task.subtasks.length > 0 && (
              <span className={cn('rounded-full px-3 py-1 text-xs font-medium', BADGE_CLASS.done)}>
                All {task.subtasks.length} done
              </span>
            )
          ) : state === 'overdue' ? (
            // Same idea — the banner already carries the countdown.
            incompleteSubtaskCount > 0 && (
              <span className={cn('rounded-full px-3 py-1 text-xs font-medium', BADGE_CLASS.overdue)}>
                {incompleteSubtaskCount} subtask{incompleteSubtaskCount === 1 ? '' : 's'} left
              </span>
            )
          ) : state === 'urgent' ? (
            // Also carried by the banner now — the badge quiets down to
            // a plain time-of-day rather than repeating the live
            // countdown. PulseRing stays here (unlike overdue/done): the
            // ping plus the ember heartbeat is exactly the layered
            // urgency this state was built for.
            <span className="relative inline-flex">
              <PulseRing ready={pulseReady} forceOnce={justSavedDeadline} className="bg-[#ea580c] opacity-[.7]" />
              <button
                type="button"
                onClick={() => {
                  setAddingSubtask(false)
                  toggleDeadlineEditor()
                }}
                className={cn(
                  'relative rounded-full px-3 py-1 text-xs font-medium tabular-nums transition-colors',
                  BADGE_CLASS.urgent
                )}
              >
                Due {formatTimeOfDay(task.dateDeadline)}
              </button>
            </span>
          ) : (
            // 'progress' — still the quick way to see/set this task's
            // own deadline from the list, deliberately kept rather than
            // repurposed into a subtask-count badge (that would remove
            // the only quick deadline entry point this card has). Blue
            // rather than the generic amber every other "set a
            // deadline" trigger in the app uses — same `#4f7fd4` this
            // state's own banner shades into on its right side (where
            // its "Open"/action button sits — see `STATE_CHROME.progress
            // .bannerTo` and `StateBanner` above) and the same blue
            // `STATE_THEME.far`'s ring/cta gradients end on on the task
            // detail page, just given a light-tint/dark-text pairing of
            // that hue (this app has no pre-made soft/strong pair for
            // blue the way it does for purple's `#f3e8ff`/`#6b46a8`).
            // `NewTaskPage` still keeps amber (this is the one badge
            // always sitting on top of this exact state, so it's the one
            // place amber actually clashed rather than just being
            // neutral) — but subtask due-chips and `AddSubtaskForm` have
            // since moved off amber too, onto that same soft-purple pair,
            // in a later pass.
            <span className="relative inline-flex">
              <button
                type="button"
                onClick={() => {
                  setAddingSubtask(false)
                  toggleDeadlineEditor()
                }}
                className="relative rounded-full bg-[#e9f0fb] px-3 py-1 text-xs font-medium tabular-nums text-[#1e488f] transition-colors hover:bg-[#d4e1f7]"
              >
                {task.dateDeadline ? `Due ${formatDeadline(task.dateDeadline)}` : 'Set deadline'}
              </button>
            </span>
          )}
          {editingDeadline && (
            <DeadlineEditor
              anchorRef={dueChipAnchorRef}
              value={task.dateDeadline}
              onSave={handleDeadlineSave}
              onCancel={closeDeadlineEditor}
              minDayOffset={0}
            />
          )}
        </div>

        {/* Delete is gone entirely once a task is completed — not from
            the backend (TaskDetailPage's own delete button still works
            on a completed task), just from this list-card view. A
            completed task isn't something you clean up in passing while
            scanning the list; the intentional friction of opening it
            first (or using /progress) is the point. */}
        {!task.completed && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {confirmingDelete ? (
              <div className="flex flex-col items-end gap-1">
                <p className="text-xs text-muted-foreground">Are you sure you want to delete this task?</p>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Confirm'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete task"
                className={state === 'progress' ? 'hover:text-destructive' : DELETE_CLASS[state]}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>

      {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}

      {/* ---- progress meter ---- */}
      <div className="relative mt-4">
        <div
          className={cn(
            'h-2 w-full overflow-hidden rounded-full border',
            state === 'progress' ? 'border-border bg-muted' : TRACK_CLASS[state]
          )}
        >
          <div
            className={cn(
              'relative h-full w-full origin-left overflow-hidden rounded-full transition-transform duration-500 ease-out',
              FILL_CLASS[state] ?? PROGRESS_GRADIENT
            )}
            style={{ transform: `scaleX(${progress / 100})` }}
          >
            {/* A shimmering sheen reads as healthy progress — dropped for
                overdue/done, where a moving highlight would send the
                wrong signal (either "still going" or "still working"). */}
            {state !== 'overdue' && state !== 'done' && progress > 0 && progress < 100 && (
              <span
                aria-hidden="true"
                className="animate-progress-sheen absolute inset-y-0 w-2/5 bg-gradient-to-r from-transparent via-white/70 to-transparent"
              />
            )}
          </div>
        </div>
        <p className={cn('mt-1 text-xs', state === 'progress' ? 'text-muted-foreground' : cn('font-bold', META_CLASS[state]))}>
          {progress}% complete
          {blockedFromCompleting && ' · Complete all subtasks to mark this task done.'}
        </p>
      </div>

      {/* ---- subtask stack: click the top card to spread the (up to 3)
          most-due subtasks out; click it again to pull them back into
          the stacked peek. Same cards throughout, just animating
          between overlapping and separated. "View more" is the only
          way to see beyond these 3 — that's the task detail page's job. ---- */}
      {task.subtasks.length > 0 && (
        <div className="mt-4" onClick={(e) => e.stopPropagation()}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              clearTimeout(stackHintTimerRef.current)
              setShowStackHint(false)
              setExpanded((v) => !v)
            }}
            onKeyDown={handleStackKeyDown}
            onMouseEnter={handleStackMouseEnter}
            onMouseLeave={handleStackMouseLeave}
            className="relative cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <div
              className={cn(
                'pointer-events-none absolute -top-7 left-0 z-10 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background shadow-md transition-opacity duration-150',
                showStackHint ? 'opacity-100' : 'opacity-0'
              )}
            >
              {expanded ? 'Click to collapse' : 'Click to see more'}
            </div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {previewSubtasks.length > 0 ? 'Next up' : 'All done'}
            </p>

            <div
              className="relative transition-[height] duration-300 ease-in-out"
              style={{ height: `${stackHeight}px` }}
            >
              {rows.map((subtask, i) => (
                <SubtaskStackCard
                  key={subtask.id}
                  subtask={subtask}
                  dimmed={!expanded && i > 0}
                  justCompleted={celebratingSubtaskIds.has(subtask.id)}
                  parentState={state}
                  style={{
                    top: `${i * pitch}px`,
                    height: `${rowHeight}px`,
                    // Every row's own `transform` (even the inert `scale(1)`
                    // expanded case) opens a fresh stacking context — the
                    // same class of bug DeadlineEditor used to hit before
                    // its portal rewrite. That's what was actually making
                    // ConfettiBurst here look "broken": a burst on a row
                    // with a lower resting z-index than its neighbors was
                    // rendered *inside* that row's own context, so it
                    // painted entirely behind whichever row was stacked in
                    // front of it — sparks flying "up" would vanish the
                    // moment they crossed under the card above. A
                    // celebrating row now gets bumped above every sibling
                    // for the duration of its burst, so it can't be hidden
                    // behind one regardless of stack position.
                    zIndex: celebratingSubtaskIds.has(subtask.id) ? rows.length + 1 : rows.length - i,
                    opacity: expanded ? 1 : 1 - i * 0.3,
                    transform: expanded ? 'scale(1)' : `scale(${1 - i * 0.03})`,
                  }}
                  onToggleComplete={(checked) => onToggleSubtask(task, subtask, checked)}
                  onSetDeadline={(dateDeadline) => onSetSubtaskDeadline(task, subtask, dateDeadline)}
                  onDelete={() => onDeleteSubtask(task, subtask)}
                  pulseReady={pulseReady}
                />
              ))}
              {/* Fades the bottom of the collapsed stack out instead of
                  ending on a hard edge, reinforcing that it's a peek.
                  Colour comes from this state's own `floodBase` (inline
                  style, not the `from-card` Tailwind token) — the token
                  resolves to plain white, which doesn't match a flooded
                  card's own tinted background and left a visible
                  square-cornered patch sitting on top of the last row's
                  own rounded corner. Only rendered when there's a second
                  row actually stacked underneath (`rows.length > 1`) —
                  with just one subtask, `stackHeight` is exactly one
                  row's height, so this flat, hard-cornered bar had
                  nothing to feather and just squared off that lone row's
                  own rounded bottom corners instead. `rounded-b-lg`
                  matches the row's own radius too, so even the
                  multi-row case can't show a hard corner poking past the
                  curve underneath it. */}
              {!expanded && rows.length > 1 && (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-5 rounded-b-lg"
                  style={{ background: `linear-gradient(to top, ${chrome.floodBase}, transparent)` }}
                />
              )}
            </div>
          </div>

          {expanded && hasMoreThanShown && (
            <button
              type="button"
              onClick={() => navigate(`/tasks/${task.id}`)}
              className="mt-2 text-xs font-medium text-sky-600 hover:text-sky-700 hover:underline"
            >
              View more →
            </button>
          )}
        </div>
      )}

      {/* Always somewhere to add a subtask on an open task, whether it
          has none yet (the inviting prompt) or already has some (a
          plain link below the stack) — this used to be hard-gated
          behind `task.subtasks.length === 0`, so the very first
          subtask you added made this whole section (and the form with
          it) disappear for good, with nothing on this card able to add
          a second one. Gone entirely once the task is completed —
          subtasks only make sense on something still open. */}
      {!task.completed && (
        <div onClick={(e) => e.stopPropagation()}>
          {addingSubtask ? (
            <div className="mt-4">
              <AddSubtaskForm
                onAdd={(name, dateDeadline) => onAddSubtask(task, name, dateDeadline)}
                onCancel={() => setAddingSubtask(false)}
              />
            </div>
          ) : task.subtasks.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Want to break this down into smaller chunks?{' '}
              <button
                type="button"
                onClick={() => {
                  // Same mutual-exclusion reasoning as the deadline
                  // badge's own onClick above — this form is about to
                  // grow its own deadline picker directly underneath
                  // it, close enough to the task's own to overlap if
                  // both were open together.
                  closeDeadlineEditor()
                  setAddingSubtask(true)
                }}
                className="font-medium text-sky-600 hover:text-sky-700 hover:underline"
              >
                Add subtasks
              </button>
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                closeDeadlineEditor()
                setAddingSubtask(true)
              }}
              className="mt-2 text-xs font-medium text-sky-600 hover:text-sky-700 hover:underline"
            >
              + Add another subtask
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
