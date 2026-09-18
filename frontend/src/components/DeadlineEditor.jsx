import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WheelPicker } from '@/components/ui/wheel-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

// How far the popover keeps itself from the viewport's own edges, and
// the gap it leaves between itself and whatever it's anchored to.
const EDGE_GAP = 8

// Standard focusable-element query for the Tab trap below — everything
// this popover ever actually contains (WheelPicker's own `tabIndex={0}`
// listbox root, the Checkbox, plain `<button>`s) is covered by this,
// and it deliberately excludes the popover's own `tabIndex={-1}` root
// (the initial-focus landing spot, not a stop in the cycle itself).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const DAY_MS = 24 * 60 * 60 * 1000
// Wheel range: 90 days back (room to backdate/correct) to 10 years
// ahead by default — expressed as a min/max Date the day/month/year
// wheels are each kept inside of (see buildDayItems/buildMonthItems/
// buildYearItems below) rather than one linear offset. The backend
// itself has no upper bound on dateDeadline at all (only "not in the
// past" for a task) — this was a UI-only cap, previously a single
// year, which is fine for a task but too tight for anything long-range
// (a goal's target date, say). Both bounds are overridable per call
// site — see `minDayOffset`/`maxDayOffset` below — this default just
// needs to be generous rather than exactly right for every future use.
const MIN_DAY_OFFSET = -90
const MAX_DAY_OFFSET = 3650

function pad2(n) {
  return String(n).padStart(2, '0')
}

function startOfLocalDay(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function daysInMonth(year, month) {
  // `month` here is 1-indexed (1 = January); passing it straight as
  // the (0-indexed) month argument to `Date` lands one calendar month
  // ahead, and day 0 of that month is the last day of the one before
  // it — i.e. exactly the month we actually asked about.
  return new Date(year, month, 0).getDate()
}

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'short' })
)

const MINUTE_ITEMS = Array.from({ length: 60 }, (_, m) => ({ value: m, label: pad2(m) }))
const HOUR_ITEMS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
const PERIOD_ITEMS = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
]

// Apple-style vertical wheel picker for editing a task or subtask
// deadline — shared by every place that happens: TaskCard's own
// deadline, a subtask's due-date bubble (cascade + promoted card), and
// the task detail page. Time-of-day is opt-in via the checkbox —
// unchecked, the deadline lands on the selected date at local
// midnight (same convention date-only deadlines already used before
// time-of-day support existed); checked, three more wheels pick the
// time.
//
// Renders through a portal into `document.body`, positioned with real
// `position: fixed` screen coordinates measured off `anchorRef` (the
// trigger every call site wraps this in), rather than as a normal DOM
// descendant positioned with `absolute`. That used to mean this
// popover's visibility depended on every ancestor between it and its
// trigger never establishing a CSS stacking context of its own (any
// `transform`/`opacity` on one did, silently trapping the popover's
// z-index below it) — a whole recurring class of "popover paints in
// the wrong place" bugs that kept resurfacing in different ancestors.
// A portal has no ancestors to trap it in the first place. It also
// means "is there room to open downward" can be answered honestly:
// the old absolute-positioned version only ever checked raw viewport
// pixels, which on a scrolling list of cards are almost never actually
// empty — they're the next card. This version still measures the same
// way, but a real dimming backdrop (below) means even a popover that
// ends up overlapping a neighboring card now reads as an intentional
// floating panel instead of a layout bug.
//
// Six independent wheels rather than one combined date wheel and one
// combined time wheel: day/month/year, and (when time's on)
// hour/minute/AM-PM. `minDayOffset` defaults to letting you backdate
// up to 90 days, which is what the backend actually allows for a
// *subtask* deadline — but a *task* deadline is rejected outright if
// it's in the past (even resubmitting an already-past one unchanged),
// so both task-level call sites pass `minDayOffset={0}` to keep the
// wheels from ever landing on a value Save can't possibly accept.
// `maxDayOffset` is the same idea for the far end — defaults to a
// generous 10 years (MAX_DAY_OFFSET) since the backend enforces no
// upper bound at all; a call site with its own, tighter or wider,
// sense of "how far out is reasonable" (a goal's target date, say)
// can override it the same way. The day/month/year wheels enforce
// both bounds by construction — their item lists are built from
// `minDate`/`maxDate` and narrow at the boundary years/months (see
// buildDayItems/buildMonthItems) — so every selectable combination is
// already in range; there's nothing left to clamp at Save time the
// way the old single offset wheel needed to.
// Time-of-day isn't similarly bounded (same as before): picking a time
// earlier than "now" on today's date just surfaces the backend's own
// validation error, exactly like it always has.
export function DeadlineEditor({
  anchorRef,
  value,
  onSave,
  onCancel,
  className,
  minDayOffset = MIN_DAY_OFFSET,
  maxDayOffset = MAX_DAY_OFFSET,
}) {
  const initial = value ? new Date(value) : new Date()
  const initialHasTime = Boolean(value) && (initial.getHours() !== 0 || initial.getMinutes() !== 0)

  const today = startOfLocalDay(new Date())
  const minDate = addDays(today, minDayOffset)
  const maxDate = addDays(today, maxDayOffset)

  function clampToRange(date) {
    if (date < minDate) return minDate
    if (date > maxDate) return maxDate
    return date
  }

  const clampedInitial = clampToRange(startOfLocalDay(initial))
  const [year, setYear] = useState(() => clampedInitial.getFullYear())
  const [month, setMonth] = useState(() => clampedInitial.getMonth() + 1)
  const [day, setDay] = useState(() => clampedInitial.getDate())

  const [hasTime, setHasTime] = useState(initialHasTime)
  const [hour12, setHour12] = useState(() => {
    const h24 = initial.getHours()
    return h24 % 12 === 0 ? 12 : h24 % 12
  })
  const [minute, setMinute] = useState(() => initial.getMinutes())
  const [period, setPeriod] = useState(() => (initial.getHours() >= 12 ? 'PM' : 'AM'))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const popoverRef = useRef(null)
  // Real viewport coordinates for the portal-rendered popover, in
  // `position: fixed` terms — null until the first measurement lands,
  // so the popover can stay invisible for that one frame instead of
  // flashing at (0, 0). Recomputed on mount, whenever "Add a time"
  // changes the popover's own height, and on every scroll/resize so it
  // stays glued to its anchor instead of drifting once the fixed
  // coordinates go stale.
  const [coords, setCoords] = useState(null)

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef?.current
      const popover = popoverRef.current
      if (!anchor || !popover) return
      const anchorRect = anchor.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()

      const spaceBelow = window.innerHeight - anchorRect.bottom
      const spaceAbove = anchorRect.top
      const openUpward = popoverRect.height + EDGE_GAP > spaceBelow && spaceAbove > spaceBelow
      const rawTop = openUpward ? anchorRect.top - popoverRect.height - EDGE_GAP : anchorRect.bottom + EDGE_GAP
      const top = Math.min(Math.max(EDGE_GAP, rawTop), window.innerHeight - popoverRect.height - EDGE_GAP)

      // Right-align to the anchor's right edge by default (matches most
      // triggers, which sit near the right edge of their card); fall
      // back to left-aligning off the anchor's left edge if that would
      // push the popover past the left edge of the viewport, then clamp
      // either way so it can never actually run off either side.
      const rightAligned = anchorRect.right - popoverRect.width
      const leftAligned = anchorRect.left
      const left =
        rightAligned < EDGE_GAP && leftAligned + popoverRect.width <= window.innerWidth - EDGE_GAP
          ? leftAligned
          : Math.min(Math.max(EDGE_GAP, rightAligned), window.innerWidth - popoverRect.width - EDGE_GAP)

      setCoords({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    // Capture phase so a scroll on any nested scrollable ancestor (not
    // just the window) still triggers a reposition — scroll events
    // don't bubble, but a capture-phase listener on window still sees
    // them on the way down.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [hasTime, anchorRef])

  // Closes on Escape — the overlay below handles every other way out.
  // Tab/Shift+Tab is trapped inside the popover: a portal appends this
  // straight to the end of `document.body`, disconnected in the DOM
  // from the anchor that opened it, so without this Tab would walk
  // straight into whatever's dimmed behind the backdrop instead of
  // wrapping back around inside the (visually) only thing on screen.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const popover = popoverRef.current
      if (!popover) return
      const focusable = Array.from(popover.querySelectorAll(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      // Active element is the popover's own tabIndex={-1} root right
      // after open (see the initial-focus effect below) — neither
      // "first" nor "last" of the real focusable list, so it needs its
      // own branch: Tab should land on the first control, Shift+Tab
      // should wrap to the last one, same as leaving either end of the
      // real cycle.
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === popover)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || active === popover)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  // Moves focus into the popover itself once it's actually positioned
  // (not before — an element still `visibility: hidden` for that first
  // measurement frame can't take focus in most browsers). Runs once per
  // mount: `didFocusRef` guards it from re-firing on every later
  // reposition (scroll/resize) that also updates `coords`.
  const didFocusRef = useRef(false)
  useEffect(() => {
    if (coords && !didFocusRef.current) {
      didFocusRef.current = true
      popoverRef.current?.focus()
    }
  }, [coords])

  function buildYearItems() {
    const items = []
    for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y++) {
      items.push({ value: y, label: String(y) })
    }
    return items
  }

  function buildMonthItems(forYear) {
    let lo = 1
    let hi = 12
    if (forYear === minDate.getFullYear()) lo = minDate.getMonth() + 1
    if (forYear === maxDate.getFullYear()) hi = maxDate.getMonth() + 1
    const items = []
    for (let m = lo; m <= hi; m++) items.push({ value: m, label: MONTH_LABELS[m - 1] })
    return items
  }

  function buildDayItems(forYear, forMonth) {
    let lo = 1
    let hi = daysInMonth(forYear, forMonth)
    if (forYear === minDate.getFullYear() && forMonth === minDate.getMonth() + 1) {
      lo = Math.max(lo, minDate.getDate())
    }
    if (forYear === maxDate.getFullYear() && forMonth === maxDate.getMonth() + 1) {
      hi = Math.min(hi, maxDate.getDate())
    }
    const items = []
    for (let d = lo; d <= hi; d++) items.push({ value: d, label: String(d) })
    return items
  }

  const yearItems = buildYearItems()
  const monthItems = buildMonthItems(year)
  const dayItems = buildDayItems(year, month)

  // Keeps month/day valid whenever a wheel above them moves somewhere
  // that makes the current pick impossible — e.g. dragging the year
  // down to the boundary year excludes months before `minDate`'s, or
  // flipping to February strands a day-of-month in the 29-31 range.
  // Deliberately re-derives from the *current* state each time rather
  // than tracking "did the user touch this wheel" — simpler, and the
  // only moment this can ever actually fire is right after a change to
  // a wheel above it in the hierarchy.
  useEffect(() => {
    const items = buildMonthItems(year)
    if (!items.some((i) => i.value === month)) {
      setMonth(clamp(month, items[0].value, items[items.length - 1].value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  useEffect(() => {
    const items = buildDayItems(year, month)
    if (!items.some((i) => i.value === day)) {
      setDay(clamp(day, items[0].value, items[items.length - 1].value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const result = new Date(year, month - 1, day)
      if (hasTime) {
        const h24 = period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12
        result.setHours(h24, minute, 0, 0)
      }
      await onSave(result.toISOString())
    } catch (err) {
      setError(err.data?.dateDeadline?.[0] ?? 'Could not update the deadline.')
      setSaving(false)
    }
  }

  // Distinct from Cancel — this actually clears an existing deadline.
  // Only offered when there is one; a wheel has no natural "empty"
  // position the way the old text input did.
  async function handleClear() {
    setError(null)
    setSaving(true)
    try {
      await onSave(null)
    } catch (err) {
      setError(err.data?.dateDeadline?.[0] ?? 'Could not update the deadline.')
      setSaving(false)
      setConfirmingClear(false)
    }
  }

  return createPortal(
    <>
      {/* Full-page dimming backdrop — closes the popover on any click
          outside it, *and* stops that click from also reaching whatever
          it happened to land on underneath (a task card's own
          navigate-on-click, a checkbox). A `document`-level JS listener
          doesn't do that reliably: some interactive elements (this
          app's own custom Checkbox included) toggle off `pointerdown`
          rather than `click`, so listening for one specific event type
          can miss the thing that actually changed state. A real element
          sitting in front of everything else, caught by the browser's
          own hit-testing before the click ever reaches its visual
          target, works regardless of which event any given widget
          happens to key off of.
          Visibly dimmed (not just an invisible click-catcher) on
          purpose: this popover is portaled to the very top of the page
          now, so on a scrolling list it can legitimately end up
          floating over a neighboring card rather than empty space. The
          dim is what tells you that's intentional — the rest of the
          page is inert while this is open — instead of it reading like
          a rendering bug. */}
      <div
        className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[1px] transition-opacity"
        onClick={(e) => {
          e.stopPropagation()
          onCancel()
        }}
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-label="Edit deadline"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: coords ? `${coords.top}px` : 0,
          left: coords ? `${coords.left}px` : 0,
          visibility: coords ? 'visible' : 'hidden',
        }}
        className={cn('z-[70] w-64 rounded-lg border bg-card p-3 text-left shadow-lg outline-none', className)}
      >
      <p className="text-center text-xs font-medium tabular-nums text-muted-foreground">
        Date: {pad2(day)}/{pad2(month)}/{year}
      </p>
      <div className="mt-1 flex justify-center gap-1">
        <WheelPicker items={dayItems} value={day} onChange={setDay} itemHeight={32} visibleCount={3} className="w-14" />
        <WheelPicker items={monthItems} value={month} onChange={setMonth} itemHeight={32} visibleCount={3} className="w-16" />
        <WheelPicker items={yearItems} value={year} onChange={setYear} itemHeight={32} visibleCount={3} className="w-16" />
      </div>

      <label className="mt-3 flex items-center justify-center gap-2 text-xs">
        <Checkbox checked={hasTime} onCheckedChange={setHasTime} disabled={saving} />
        <span>Add a time</span>
      </label>

      {hasTime && (
        <>
          <p className="mt-2 text-center text-xs font-medium tabular-nums text-muted-foreground">
            Time: {pad2(hour12)}:{pad2(minute)}:{period}
          </p>
          <div className="mt-1 flex justify-center gap-1">
            <WheelPicker items={HOUR_ITEMS} value={hour12} onChange={setHour12} itemHeight={32} visibleCount={3} className="w-12" />
            <WheelPicker items={MINUTE_ITEMS} value={minute} onChange={setMinute} itemHeight={32} visibleCount={3} className="w-12" />
            <WheelPicker items={PERIOD_ITEMS} value={period} onChange={setPeriod} itemHeight={32} visibleCount={3} className="w-14" />
          </div>
        </>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {confirmingClear ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">Are you sure you want to clear the deadline?</p>
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              disabled={saving}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="text-xs font-medium text-destructive hover:underline"
            >
              {saving ? 'Clearing…' : 'Clear'}
            </button>
          </div>
        </div>
      ) : (
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Soft purple, matching the app's established "set/change a
              deadline" pair (#f3e8ff/#6b46a8) — reads as "this is the
              deadline action" rather than a plain text link. Used to be
              amber here, before that convention moved to purple
              everywhere else this editor opens from. */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-[#f3e8ff] px-3 py-1 text-xs font-medium text-[#6b46a8] transition-colors hover:bg-[#e9d5ff] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-xs text-muted-foreground hover:underline"
          >
            Cancel
          </button>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            disabled={saving}
            className="text-xs text-destructive hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      )}
      </div>
    </>,
    document.body
  )
}
