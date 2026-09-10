import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Flame, Hammer } from 'lucide-react'
import { fetchSubtasksDueBetween, fetchTasksDueBetween, updateSubTask, updateTask } from '@/lib/tasks'
import { cn, URGENT_WINDOW_MS } from '@/lib/utils'
import { computeStats } from '@/lib/stats'
import { useTaskStore } from '@/context/TaskStoreContext'
import { useAddTaskFab } from '@/context/AddTaskFabContext'
import { Skeleton } from '@/components/ui/skeleton'

// Rebuilt per design_handoff_calendar_page/README.md ("Glass", direction
// 1a) — rounded white day cards on a lilac-grey ground, colored deadline
// state pills, a starfield hero matching the rest of the app's brand
// chrome. The month/week/day grid math (below) carries over from the
// previous version essentially unchanged; almost everything else here
// is new.

const VIEW_TYPES = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
]

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// The five deadline states the handoff's palette table defines, plus
// 'goal' — unused today (Goals has no data model yet, see GoalsRailCard)
// but kept so the filter chip and this map agree on the same five keys.
const STATE_PALETTE = {
  progress: { bg: '#f3e8ff', fg: '#6b46a8', border: '#e2d0f5', dot: '#7c5fb0' },
  urgent: { bg: '#ffe8e0', fg: '#9a3412', border: '#fca98d', dot: '#ea580c' },
  overdue: { bg: '#fee2e2', fg: '#b91c1c', border: '#fca5a5', dot: '#b91c1c' },
  done: { bg: '#d1fae5', fg: '#047857', border: '#6ee7b7', dot: '#059669' },
  goal: { bg: '#e9f0fb', fg: '#1e488f', border: '#c3d8f2', dot: '#4f7fd4' },
}

// 'all' isn't a real deadline state (it means "no filter"), so it gets
// its own bg/fg/border rather than a STATE_PALETTE entry — the handoff
// calls this out explicitly ("All active uses #f1eff5 / #33224a /
// rgba(51,34,74,.1)").
const ALL_CHIP_COLORS = { bg: '#f1eff5', fg: '#33224a', border: 'rgba(51,34,74,.1)' }

const FILTER_CHIPS = [
  { key: 'all', state: null, label: 'All' },
  { key: 'progress', state: 'progress', label: 'On track' },
  { key: 'urgent', state: 'urgent', label: 'Due soon' },
  { key: 'overdue', state: 'overdue', label: 'Overdue' },
  { key: 'done', state: 'done', label: 'Done' },
  { key: 'goal', state: 'goal', label: 'Goals' },
]

// Airy density (2 pills per month cell) hard-coded rather than exposed
// as a setting — the handoff explicitly offers this as the fallback
// ("if you'd rather not ship a setting, hard-code Airy and keep the
// '+N more' overflow"), and this app has nowhere yet to persist a
// per-user display preference.
const MONTH_PILL_CAP = 2

const TIME_BANDS = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
  { key: 'anytime', label: 'Anytime' },
]

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

// A plain YYYY-MM-DD string in the *viewer's* local time zone — the
// same instant parsed from a UTC deadline lands on the right key here
// regardless of where in the world this is opened, since Date's plain
// (non-UTC) getters already report local values. Used both to bucket
// fetched items by day and to key/compare grid cells, so "today",
// "selected", and "has items due" all agree on what day something
// actually falls on.
function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// ISO-8601 week number (Monday-start weeks; week 1 is whichever week
// contains the year's first Thursday) — not part of the design handoff,
// but a previously-shipped, explicitly-requested feature (clicking a
// week number jumps to Week view) this rebuild keeps rather than drops.
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7 // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3) // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3)
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000))
}

// Builds the 6-row, Monday-first grid for the month containing
// `anchor` — including the leading/trailing days from the adjacent
// months needed to fill the first and last week. Always 42 cells so the
// grid's height never jumps between months.
function buildMonthGrid(anchor) {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7 // Mon=0 ... Sun=6
  const gridStart = addDays(firstOfMonth, -firstWeekday)
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i)
    return { date, key: localDayKey(date), inMonth: date.getMonth() === anchor.getMonth() }
  })
}

// The single Monday-first week containing `anchor` — 7 cells.
function buildWeekGrid(anchor) {
  const dow = (anchor.getDay() + 6) % 7
  const weekStart = startOfDay(addDays(anchor, -dow))
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    return { date, key: localDayKey(date), inMonth: true }
  })
}

// The fetch/selection boundary for whatever's currently visible —
// [start, end), end exclusive — driven by view type + anchor date.
function computeVisibleRange(viewType, anchorDate) {
  if (viewType === 'day') {
    const start = startOfDay(anchorDate)
    return { start, end: addDays(start, 1) }
  }
  if (viewType === 'week') {
    const cells = buildWeekGrid(anchorDate)
    return { start: cells[0].date, end: addDays(cells[6].date, 1) }
  }
  const cells = buildMonthGrid(anchorDate)
  return { start: cells[0].date, end: addDays(cells[cells.length - 1].date, 1) }
}

// Flattens a page of tasks + a page of subtasks (each already filtered
// server-side to the visible range) into one list of {kind, id, taskId,
// name, dateDeadline, completed, parentName} items. `taskNameById`
// resolves a subtask's parent name from the already-fully-loaded
// TaskStoreContext (not the range-filtered `tasks` array this function
// also receives) — that array routinely excludes a due subtask's parent,
// which may have a different deadline or none at all.
function flattenItems(tasks, subtasks, taskNameById) {
  const items = []
  for (const task of tasks) {
    if (task.dateDeadline) {
      items.push({
        kind: 'task',
        id: task.id,
        taskId: task.id,
        name: task.name,
        dateDeadline: task.dateDeadline,
        completed: task.completed,
      })
    }
  }
  for (const subtask of subtasks) {
    items.push({
      kind: 'subtask',
      id: subtask.id,
      taskId: subtask.task,
      name: subtask.name,
      dateDeadline: subtask.dateDeadline,
      completed: subtask.completed,
      parentName: taskNameById.get(subtask.task),
    })
  }
  return items
}

function groupByDay(items) {
  const byDay = new Map()
  for (const item of items) {
    const key = localDayKey(new Date(item.dateDeadline))
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(item)
  }
  for (const dayItems of byDay.values()) {
    dayItems.sort((a, b) => new Date(a.dateDeadline) - new Date(b.dateDeadline))
  }
  return byDay
}

// The deadline-state helper the handoff asks for ("should come from the
// app's existing deadline/urgency helper, not be recomputed here") — a
// plain function rather than the app's usual useDeadlineStatus hook,
// since this runs over many items per render (grid cells, bands) where
// a hook can't be called in a loop. `nowMs` comes from this page's own
// slow clock tick (see useClock below), same 30-second-resolution
// convention the rest of the app uses for anything that isn't a live
// countdown.
function computeItemState(item, nowMs) {
  if (item.completed) return 'done'
  const remaining = new Date(item.dateDeadline).getTime() - nowMs
  if (remaining <= 0) return 'overdue'
  if (remaining <= URGENT_WINDOW_MS) return 'urgent'
  return 'progress'
}

// Filter chips are single-select over deadline state — `state: null`
// (the "All" chip) means no filtering.
function filterItems(items, state, nowMs) {
  if (!state) return items
  return items.filter((item) => computeItemState(item, nowMs) === state)
}

// Morning/Afternoon/Evening/Anytime, per the handoff's Week/Day view
// bands. Every deadline in this app carries a concrete time of day (see
// lib/utils.js's formatDeadline comment), so 'anytime' never actually
// matches anything today — the row still renders (structurally always
// present, per the handoff), just empty, and this keeps working
// correctly if a genuinely time-less deadline is ever introduced.
function timeBand(item) {
  const hour = new Date(item.dateDeadline).getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// The header label above the grid — what it says depends on view type: a
// single day spells itself out in full, a week shows its span (always
// naming the month on both ends — asking Intl for day+year with month
// omitted hits an ICU fallback that renders literal "(day: 13)" text), a
// month just names itself.
function viewLabel(viewType, anchorDate, range) {
  if (viewType === 'day') {
    return anchorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
  if (viewType === 'week') {
    const lastDay = addDays(range.end, -1)
    const startLabel = range.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const endLabel = lastDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${startLabel} – ${endLabel}`
  }
  return anchorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// "this month" / "this week" / "today" — feeds both the hero sub-line
// and the "Due ___" stat card's label, so both always describe whatever
// period is actually on screen rather than a fixed "this month".
function periodNoun(viewType) {
  if (viewType === 'day') return 'today'
  if (viewType === 'week') return 'this week'
  return 'this month'
}

// Ticks every 30s — plenty for deadline-state colors and the hero clock,
// same "slow tick" resolution useDeadlineStatus already uses for its own
// non-urgent case.
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  return now
}

function StatCard({ value, label, flame, loading }) {
  return (
    <div className="flex min-w-[120px] flex-1 flex-col gap-[3px] rounded-[12px] bg-white/8 p-[14px_18px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.16)] backdrop-blur-[6px]">
      {loading ? (
        <span aria-hidden="true" className="block h-[26px] w-9 animate-pulse rounded-md bg-white/20" />
      ) : (
        <span className="flex items-center gap-1.5 font-display text-[26px] font-bold tracking-[-.02em] text-white tabular-nums">
          {value}
          {flame && <Flame className="size-[18px] fill-orange-400 text-orange-400" aria-hidden="true" />}
        </span>
      )}
      <span className="text-[11px] font-bold uppercase tracking-[.07em] text-white/60">{label}</span>
    </div>
  )
}

// The state-colored pill used for month-cell and week-band items — not
// individually clickable (only the day cell / row it sits in is), same
// as the handoff's own "no time chip, no click target" spec for these.
function ItemPill({ item, nowMs }) {
  const palette = STATE_PALETTE[computeItemState(item, nowMs)]
  return (
    <span
      className="flex min-w-0 items-center gap-1 rounded-[7px] px-[5px] py-[3px]"
      style={{ background: palette.bg, boxShadow: `inset 0 0 0 1px ${palette.border}` }}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: palette.dot }} />
      <span
        className={cn('truncate text-[11px] font-bold', item.completed && 'line-through opacity-[.62]')}
        style={{ color: palette.fg }}
      >
        {item.name}
      </span>
    </span>
  )
}

// One month-grid day cell. Hover/focus both reveal the same affordance
// (empty-day "+ Add task" hint, or the overflow peek popover) so the
// peek stays keyboard-reachable, per the handoff's own instruction —
// touch devices get neither (no hover, and focus doesn't fire on tap),
// where tapping the day just selects it instead, exactly as asked.
function MonthDayCell({ cell, isToday, isSelected, items, hasAnyItems, nowMs, canAdd, loading, onSelect, onOpenDay, onAdd }) {
  const [active, setActive] = useState(false)
  const visible = items.slice(0, MONTH_PILL_CAP)
  const overflow = Math.max(0, items.length - MONTH_PILL_CAP)
  const hasCompleted = items.some((i) => i.completed)

  function handleClick() {
    if (!cell.inMonth || loading) return
    if (hasAnyItems) {
      onSelect(cell.key)
      return
    }
    onSelect(cell.key)
    if (canAdd) onAdd(cell.date)
  }

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        tabIndex={cell.inMonth ? 0 : -1}
        onClick={handleClick}
        onDoubleClick={() => cell.inMonth && onOpenDay(cell.date)}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        style={{ minHeight: 124 }}
        className={cn(
          'flex w-full min-w-0 flex-col rounded-[13px] p-[10px_10px_11px] text-left transition-[transform,box-shadow] motion-safe:duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c5fb0]',
          !cell.inMonth && 'pointer-events-none bg-[#f6f5f8] opacity-55',
          cell.inMonth && 'cursor-pointer bg-white shadow-[inset_0_0_0_1px_rgba(51,34,74,.07)] motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[inset_0_0_0_1px_rgba(51,34,74,.07),0_14px_30px_-24px_rgba(37,37,37,.55)]',
          cell.inMonth && isToday && !isSelected && 'bg-[#faf6ff] shadow-[0_0_0_1.5px_#c3a9e8,0_10px_26px_-24px_rgba(37,37,37,.5)]',
          cell.inMonth && isSelected && 'shadow-[0_0_0_2px_#7c5fb0,0_14px_30px_-22px_rgba(37,37,37,.6)]'
        )}
      >
        <div className="flex items-center justify-between">
          {isToday ? (
            <span
              className="flex h-6 min-w-6 items-center justify-center rounded-[8px] px-1.5 font-display text-[13px] font-bold text-white"
              style={{ background: 'linear-gradient(to bottom right,#7c5fb0,#8ec5fc)' }}
            >
              {cell.date.getDate()}
            </span>
          ) : (
            <span
              className={cn(
                'font-display text-[13px] font-semibold tabular-nums',
                cell.inMonth ? 'text-[#33224a]' : 'text-[#b3afbd]'
              )}
            >
              {cell.date.getDate()}
            </span>
          )}
          {hasCompleted && <Flame className="size-3 fill-[#fb923c] text-[#fb923c]" aria-hidden="true" />}
        </div>

        <div className="mt-2 flex flex-col gap-1">
          {loading ? (
            <Skeleton className="h-[19px] w-[70%]" />
          ) : (
            <>
              {visible.map((item) => (
                <ItemPill key={`${item.kind}-${item.id}`} item={item} nowMs={nowMs} />
              ))}
              {overflow > 0 && <span className="mt-[5px] text-[11px] font-bold text-[#7c5fb0]">+{overflow} more</span>}
              {items.length === 0 && cell.inMonth && active && canAdd && (
                <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#7c5fb0]">
                  <Plus className="size-[11px]" aria-hidden="true" />
                  Add task
                </span>
              )}
            </>
          )}
        </div>
      </button>

      {!loading && active && overflow > 0 && (
        <div className="absolute left-1/2 top-full z-20 w-[238px] -translate-x-1/2 translate-y-2 rounded-xl bg-white p-[12px_13px] shadow-[0_18px_40px_-18px_rgba(37,37,37,.55),0_0_0_1px_rgba(51,34,74,.08)]">
          <p className="mb-2 font-display text-xs font-semibold text-[#33224a]">
            {cell.date.toLocaleDateString(undefined, { weekday: 'long' })} {cell.date.getDate()} — {items.length} item
            {items.length === 1 ? '' : 's'}
          </p>
          <div className="flex flex-col gap-1.5">
            {items.map((item) => {
              const palette = STATE_PALETTE[computeItemState(item, nowMs)]
              return (
                <div key={`${item.kind}-${item.id}`} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: palette.dot }} />
                  <span className={cn('min-w-0 flex-1 truncate text-xs text-[#3f3b46]', item.completed && 'line-through')}>
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#a8a5a0]">{formatTime(item.dateDeadline)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Month grid — the weekday header, then 6 week rows. The leading 28px
// week-number column isn't part of the design handoff; it's a
// previously-shipped, explicitly-requested feature (click a week number
// → jump to Week view) kept alongside the new visual design rather than
// dropped for it.
function MonthGrid({ grid, todayKey, selectedKey, itemsByDay, nowMs, now, filterState, loading, onSelectDay, onOpenDay, onOpenWeek, onAddDay }) {
  const todayStart = startOfDay(now)
  const weeks = Array.from({ length: grid.length / 7 }, (_, i) => grid.slice(i * 7, i * 7 + 7))

  return (
    <div>
      <div className="mb-2 grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-2">
        <span aria-hidden="true" />
        {WEEKDAY_SHORT.map((label) => (
          <span key={label} className="pl-1 text-[11px] font-bold uppercase tracking-[.09em] text-[#a8a5a0]">
            {label}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {weeks.map((week, i) => (
          <div key={i} className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] items-start gap-2">
            <button
              type="button"
              onClick={() => onOpenWeek(week[0].date)}
              title={`Week ${isoWeekNumber(week[0].date)} — view week`}
              aria-label={`View week ${isoWeekNumber(week[0].date)}`}
              className="mt-2 rounded-[6px] text-[11px] font-bold text-[#b3afbd] transition-colors hover:bg-white hover:text-[#7c5fb0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c5fb0]"
            >
              {isoWeekNumber(week[0].date)}
            </button>
            {week.map((cell) => {
              const allItems = itemsByDay.get(cell.key) ?? []
              return (
                <MonthDayCell
                  key={cell.key}
                  cell={cell}
                  isToday={cell.key === todayKey}
                  isSelected={cell.key === selectedKey}
                  items={filterItems(allItems, filterState, nowMs)}
                  hasAnyItems={allItems.length > 0}
                  nowMs={nowMs}
                  canAdd={cell.date >= todayStart}
                  loading={loading}
                  onSelect={onSelectDay}
                  onOpenDay={onOpenDay}
                  onAdd={onAddDay}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

const CARD_SHADOW = '0 0 0 1px rgba(51,34,74,.08), 0 18px 40px -34px rgba(37,37,37,.6)'

function WeekView({ grid, todayKey, selectedKey, itemsByDay, nowMs, filterState, loading, onSelectDay, onOpenDay }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: CARD_SHADOW }}>
      <div className="grid border-b border-[#ece9f2]" style={{ gridTemplateColumns: '88px repeat(7,minmax(0,1fr))' }}>
        <span aria-hidden="true" />
        {grid.map((cell) => (
          <button
            key={cell.key}
            type="button"
            onClick={() => onSelectDay(cell.key)}
            onDoubleClick={() => onOpenDay(cell.date)}
            className={cn(
              'border-l border-[#ece9f2] p-[11px_10px] text-left text-[11px] font-bold tracking-[.04em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c5fb0]',
              cell.key === todayKey ? 'text-[#7c5fb0]' : 'text-[#8b8794]',
              cell.key === selectedKey && 'bg-[rgba(124,95,176,.07)]'
            )}
          >
            {cell.date.toLocaleDateString(undefined, { weekday: 'short' })} {cell.date.getDate()}
          </button>
        ))}
      </div>
      {TIME_BANDS.map((band) => (
        <div
          key={band.key}
          className="grid border-b border-[#f2eff6] last:border-b-0"
          style={{ gridTemplateColumns: '88px repeat(7,minmax(0,1fr))' }}
        >
          <div className="p-[14px_12px] text-[11px] font-bold uppercase tracking-[.08em] text-[#a8a5a0]">{band.label}</div>
          {grid.map((cell) => {
            const items = filterItems(itemsByDay.get(cell.key) ?? [], filterState, nowMs).filter((item) => timeBand(item) === band.key)
            return (
              <div
                key={cell.key}
                className={cn(
                  'flex min-h-[62px] flex-col gap-[5px] border-l border-[#f2eff6] p-[10px_8px]',
                  cell.key === selectedKey && 'bg-[rgba(124,95,176,.05)]'
                )}
              >
                {loading
                  ? band.key !== 'anytime' && <Skeleton className="h-[19px] w-full max-w-[72px]" />
                  : items.map((item) => <ItemPill key={`${item.kind}-${item.id}`} item={item} nowMs={nowMs} />)}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function DayItemRow({ item, nowMs }) {
  const navigate = useNavigate()
  const palette = STATE_PALETTE[computeItemState(item, nowMs)]
  return (
    <div
      onClick={() => navigate(`/tasks/${item.taskId}`)}
      className="flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2 transition-colors"
      style={{ background: palette.bg, boxShadow: `inset 0 0 0 1px ${palette.border}` }}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: palette.dot }} />
      <span
        className={cn('truncate text-[11px] font-bold', item.completed && 'line-through opacity-[.62]')}
        style={{ color: palette.fg }}
      >
        {item.name}
      </span>
      <span
        className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[.06em]"
        style={{ background: palette.bg, color: palette.fg }}
      >
        {item.kind}
      </span>
      <span className="ml-auto shrink-0 text-xs font-bold tabular-nums text-[#a8a5a0]">{formatTime(item.dateDeadline)}</span>
    </div>
  )
}

function DayView({ date, items, nowMs, loading }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-baseline justify-between border-b border-[#ece9f2] p-[20px_22px]">
        <h2 className="m-0 font-display text-xl font-semibold tracking-[-.02em] text-[#33224a]">
          {date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <span className="text-xs font-bold text-[#a8a5a0]">
          {loading ? '–' : items.length} item{items.length === 1 ? '' : 's'}
        </span>
      </div>
      {TIME_BANDS.map((band) => {
        const bandItems = items.filter((item) => timeBand(item) === band.key)
        return (
          <div key={band.key} className="grid min-h-[76px] border-b border-[#f2eff6] last:border-b-0" style={{ gridTemplateColumns: '120px 1fr' }}>
            <div className="p-[18px_22px] text-[11px] font-bold uppercase tracking-[.08em] text-[#a8a5a0]">{band.label}</div>
            <div className="flex flex-col justify-center gap-[7px] p-[14px_22px_16px]">
              {loading ? (
                band.key !== 'anytime' && <Skeleton className="h-8 w-full max-w-[260px] rounded-[9px]" />
              ) : (
                <>
                  {bandItems.length === 0 && <span className="text-xs text-[#c9c6d1]">—</span>}
                  {bandItems.map((item) => (
                    <DayItemRow key={`${item.kind}-${item.id}`} item={item} nowMs={nowMs} />
                  ))}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// The rail's "live completion toggle" checkbox — hand-rolled rather
// than the shared shadcn Checkbox, since this needs the exact 17×17 /
// state-bordered / green-when-checked look the handoff specifies, not
// that component's own styling. Same pattern Dashboard.jsx's own
// TaskPreviewRow already uses for a smaller (14px) version of the same
// idea.
function RailCheckbox({ checked, borderColor, onToggle, disabled }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      disabled={disabled}
      aria-label={checked ? 'Mark not done' : 'Mark done'}
      className="mt-px flex size-[17px] shrink-0 items-center justify-center rounded-[5px] transition-colors disabled:opacity-60"
      style={checked ? { background: '#059669', boxShadow: 'inset 0 0 0 1.5px #059669' } : { background: '#fff', boxShadow: `inset 0 0 0 1.5px ${borderColor}` }}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  )
}

function SelectedDayRow({ item, nowMs, onToggle }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const palette = STATE_PALETTE[computeItemState(item, nowMs)]

  async function handleToggle() {
    setBusy(true)
    try {
      await onToggle(item, !item.completed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={() => navigate(`/tasks/${item.taskId}`)}
      className="flex cursor-pointer items-start gap-2.5 rounded-[11px] px-[11px] py-2.5 transition-colors"
      style={{ background: palette.bg, boxShadow: `inset 0 0 0 1px ${palette.border}` }}
    >
      <RailCheckbox checked={item.completed} borderColor={palette.border} onToggle={handleToggle} disabled={busy} />
      <div className="min-w-0 flex-1">
        <p
          className={cn('truncate text-[11px] font-bold', item.completed && 'line-through opacity-[.62]')}
          style={{ color: palette.fg }}
        >
          {item.name}
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-[#a8a5a0]">
          {item.kind === 'task' ? 'Task' : 'Subtask'} · {formatTime(item.dateDeadline)}
        </p>
      </div>
    </div>
  )
}

function SelectedDayCard({ date, isToday, items, nowMs, loading, onToggle, canAdd, onAddClick }) {
  return (
    <div className="rounded-2xl bg-white p-[18px]" style={{ boxShadow: CARD_SHADOW }}>
      <p className="text-[11px] font-bold uppercase tracking-[.09em] text-[#a8a5a0]">
        {isToday ? 'Today · selected day' : 'Selected day'}
      </p>
      <h3 className="mt-1 font-display text-xl font-semibold tracking-[-.02em] text-[#33224a]">
        {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
      </h3>

      {loading ? (
        <div className="mt-3.5 flex flex-col gap-2">
          <Skeleton className="h-[48px] w-full rounded-[11px]" />
          <Skeleton className="h-[48px] w-full rounded-[11px]" />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3.5 text-sm text-[#8b8794]">Nothing scheduled. A clear day.</p>
      ) : (
        <div className="mt-3.5 flex flex-col gap-2">
          {items.map((item) => (
            <SelectedDayRow key={`${item.kind}-${item.id}`} item={item} nowMs={nowMs} onToggle={onToggle} />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onAddClick}
        disabled={!canAdd}
        title={canAdd ? undefined : "Can't set a deadline in the past"}
        className="mt-3.5 flex w-full items-center gap-2 rounded-[11px] px-3.5 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        style={{
          background: 'linear-gradient(180deg,#4c3670 0%,#33224a 62%,#2b1c40 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.42), inset 0 -1px 0 rgba(0,0,0,.18), 0 8px 16px -10px rgba(51,34,74,.7)',
        }}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Add task on this day
      </button>
    </div>
  )
}

// Goals has no data model yet (see App.jsx's own /goals route, still a
// ComingSoonPage) — this reuses Dashboard's "Goals is on the way" tone
// and copy, just restyled to this page's own card shell instead of
// inventing a second "coming soon" voice for the app.
function GoalsRailCard() {
  return (
    <div className="rounded-2xl bg-white p-[18px]" style={{ boxShadow: CARD_SHADOW }}>
      <p className="text-[11px] font-bold uppercase tracking-[.09em] text-[#a8a5a0]">Goals landing this month</p>
      <Link
        to="/goals"
        className="group mt-3.5 flex flex-col items-center gap-2.5 rounded-xl bg-[#f5f8fd] px-4 py-6 text-center shadow-[inset_0_0_0_1px_#dbe6f5] transition-colors hover:bg-[#eef4fc]"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-[#1e488f]/10 text-[#1e488f] transition-transform duration-200 group-hover:scale-110">
          <Hammer className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-[#12314b]">Goals is on the way</p>
        <p className="text-xs text-[#12314b]/60">Set a bigger target and track progress toward it over time.</p>
      </Link>
    </div>
  )
}

function StreakRailCard({ currentStreak, dueToday }) {
  return (
    <div
      className="relative overflow-hidden rounded-[14px] bg-cover bg-center p-[18px] text-white"
      style={{ backgroundImage: 'url(/starfield-bg.jpg)' }}
    >
      <span aria-hidden="true" className="gradient-ring" style={{ zIndex: 3 }} />
      <div className="relative z-[2] flex flex-col gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[.09em] text-white/60">This week</span>
        <span className="font-display text-xl font-semibold tracking-[-.02em]">
          {currentStreak > 0 ? `You're on a ${currentStreak}-day streak.` : "Check something off to start a streak."}
        </span>
        <span className="text-xs text-white/60">
          {dueToday > 0 ? `${dueToday} more due today — keep it going.` : 'A clean slate today. One task keeps it alive.'}
        </span>
      </div>
    </div>
  )
}

export function CalendarPage() {
  const { tasks, refreshTasks } = useTaskStore()
  const { currentStreak } = computeStats(tasks).habits
  const taskNameById = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks])
  const { setOpen: setFabOpen, setPrefillDate } = useAddTaskFab()

  const now = useClock()
  const nowMs = now.getTime()
  const [viewType, setViewType] = useState('month') // 'month' | 'week' | 'day'
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(now))
  const [selectedKey, setSelectedKey] = useState(() => localDayKey(now))
  const [filter, setFilter] = useState('all')
  // Raw fetch results, not the grouped-by-day form — grouping also needs
  // taskNameById (a subtask's parent name), which changes independently
  // of the visible range (any task mutation anywhere in the app updates
  // the shared store). Keeping the two separate means a store update
  // re-groups the already-fetched data in memory instead of re-hitting
  // the network for a range that hasn't actually changed.
  const [rawItems, setRawItems] = useState({ tasks: [], subtasks: [] })
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'

  const range = useMemo(() => computeVisibleRange(viewType, anchorDate), [viewType, anchorDate])
  const grid = useMemo(() => {
    if (viewType === 'day') return null
    return viewType === 'week' ? buildWeekGrid(anchorDate) : buildMonthGrid(anchorDate)
  }, [viewType, anchorDate])

  // Keeps the selected day in sync with whatever range is actually on
  // screen — without this, switching view type or navigating away from
  // the range the current selection falls in leaves the rail
  // permanently stuck showing a stale, now out-of-range day.
  useEffect(() => {
    const todayInRange = now >= range.start && now < range.end
    setSelectedKey(todayInRange ? localDayKey(now) : localDayKey(range.start))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    Promise.all([
      fetchTasksDueBetween(range.start.toISOString(), range.end.toISOString()),
      fetchSubtasksDueBetween(range.start.toISOString(), range.end.toISOString()),
    ])
      .then(([tasksData, subtasksData]) => {
        if (cancelled) return
        setRawItems({ tasks: tasksData.results, subtasks: subtasksData.results })
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [range])

  const itemsByDay = useMemo(
    () => groupByDay(flattenItems(rawItems.tasks, rawItems.subtasks, taskNameById)),
    [rawItems, taskNameById]
  )

  const todayKey = localDayKey(now)
  const activeFilterState = FILTER_CHIPS.find((c) => c.key === filter)?.state ?? null
  const selectedItems = filterItems(itemsByDay.get(selectedKey) ?? [], activeFilterState, nowMs)
  // The day the rail (and, in Day view, the main pane) is showing — the
  // single visible day in Day view, otherwise whichever day is selected
  // in the Month/Week grid.
  const viewingDate = viewType === 'day' ? anchorDate : (grid?.find((c) => c.key === selectedKey)?.date ?? now)
  const isUpcoming = viewingDate >= startOfDay(now)

  // Hero stat row — scoped to whatever period is actually on screen
  // (the range fetch above already limits itemsByDay to it), and
  // deliberately unfiltered by the filter chips, per the handoff ("the
  // hero stat counts stay unfiltered — they describe the whole period").
  const periodStats = useMemo(() => {
    let due = 0
    let overdue = 0
    let completed = 0
    for (const items of itemsByDay.values()) {
      for (const item of items) {
        if (item.completed) completed += 1
        else due += 1
        if (computeItemState(item, nowMs) === 'overdue') overdue += 1
      }
    }
    return { due, overdue, completed }
  }, [itemsByDay, nowMs])

  // The streak card's "N more due today" — computed from the full,
  // always-loaded task store rather than this page's own range-scoped
  // fetch, since that fetch only covers today when the visible period
  // actually includes it (e.g. not when browsing a different month).
  const dueTodayCount = useMemo(() => {
    let count = 0
    for (const task of tasks) {
      if (!task.completed && task.dateDeadline && localDayKey(new Date(task.dateDeadline)) === todayKey) count += 1
      for (const subtask of task.subtasks) {
        if (!task.completed && !subtask.completed && subtask.dateDeadline && localDayKey(new Date(subtask.dateDeadline)) === todayKey) {
          count += 1
        }
      }
    }
    return count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, todayKey])

  function goToPrevious() {
    setAnchorDate((current) => {
      if (viewType === 'day') return addDays(current, -1)
      if (viewType === 'week') return addDays(current, -7)
      return new Date(current.getFullYear(), current.getMonth() - 1, 1)
    })
  }

  function goToNext() {
    setAnchorDate((current) => {
      if (viewType === 'day') return addDays(current, 1)
      if (viewType === 'week') return addDays(current, 7)
      return new Date(current.getFullYear(), current.getMonth() + 1, 1)
    })
  }

  function goToDay(date) {
    setAnchorDate(startOfDay(date))
    setViewType('day')
  }

  function goToWeek(date) {
    setAnchorDate(startOfDay(date))
    setViewType('week')
  }

  // Opens the FAB's own menu with that day carried along as
  // `prefillDate` — whichever option the FAB menu's own "Add a new
  // task" click leads to (NewTaskPage) reads it back out to seed the
  // deadline. See AddTaskFabContext/AddTaskFab.jsx.
  function openAddForDay(date) {
    setPrefillDate(localDayKey(date))
    setFabOpen(true)
  }

  // Optimistic completion toggle for the rail's checkbox — flips the
  // item locally first (so the row updates instantly), then persists
  // it and refreshes the shared task store (a subtask completion can
  // cascade its parent's own `completed` field server-side, so a full
  // refresh is simpler and more correct than guessing that locally).
  // Rolls the local flip back if the request fails.
  async function handleToggleItem(item, checked) {
    function apply(data, value) {
      if (item.kind === 'task') {
        return { ...data, tasks: data.tasks.map((t) => (t.id === item.id ? { ...t, completed: value } : t)) }
      }
      return { ...data, subtasks: data.subtasks.map((s) => (s.id === item.id ? { ...s, completed: value } : s)) }
    }

    setRawItems((data) => apply(data, checked))
    try {
      if (item.kind === 'task') await updateTask(item.id, { completed: checked })
      else await updateSubTask(item.id, { completed: checked })
      await refreshTasks()
    } catch {
      setRawItems((data) => apply(data, !checked))
    }
  }

  const loading = status === 'loading'
  const heroToday = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const noun = periodNoun(viewType)
  // StatCard's label already renders CSS-uppercase, so this doesn't need
  // its own capitalization — "Due today" / "Due this week" / "Due this
  // month" all read fine lowercase before that transform is applied.
  const statLabel = `Due ${noun}`
  const heroSubtitle = `${periodStats.due} deadline${periodStats.due === 1 ? '' : 's'} ${noun} · ${periodStats.overdue} overdue · ${periodStats.completed} completed`

  return (
    <div style={{ background: '#eceaf1' }}>
      <div className="mx-auto max-w-[1152px] px-6 pt-8 pb-14">
        {/* ---- hero ---- */}
        <div
          className="relative overflow-hidden rounded-[18px] bg-cover bg-center p-[30px] shadow-[0_18px_40px_-28px_rgba(37,37,37,.65)]"
          style={{ backgroundImage: 'url(/starfield-bg-wide.jpg)' }}
        >
          <span aria-hidden="true" className="gradient-ring" style={{ zIndex: 3 }} />
          <div className="relative z-[2] flex flex-col gap-[26px]">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[.12em] text-white/55">{heroToday}</span>
                <h1 className="m-0 font-display text-[44px] font-bold leading-[1.05] tracking-[-.03em] text-white">
                  {viewLabel(viewType, anchorDate, range)}
                </h1>
                {loading ? (
                  <span aria-hidden="true" className="mt-0.5 block h-[17px] w-64 max-w-full animate-pulse rounded-full bg-white/15" />
                ) : (
                  <p className="m-0 text-sm text-white/62">{heroSubtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goToPrevious}
                  aria-label={`Previous ${viewType}`}
                  className="flex size-[34px] items-center justify-center rounded-[10px] bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)] transition-colors hover:bg-white/22 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setAnchorDate(startOfDay(now))}
                  className="flex h-[34px] items-center rounded-[10px] bg-white/10 px-4 text-[13px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)] transition-colors hover:bg-white/22 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={goToNext}
                  aria-label={`Next ${viewType}`}
                  className="flex size-[34px] items-center justify-center rounded-[10px] bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)] transition-colors hover:bg-white/22 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-3.5">
              <StatCard value={periodStats.due} label={statLabel} loading={loading} />
              <StatCard value={periodStats.overdue} label="Overdue" loading={loading} />
              <StatCard value={periodStats.completed} label="Completed" loading={loading} />
              <StatCard value={currentStreak} label="Day streak" flame={currentStreak > 0} />
            </div>
          </div>
        </div>

        {/* ---- toolbar: view switch + filter chips ---- */}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <div role="tablist" aria-label="Calendar view" className="flex gap-[3px] rounded-[11px] bg-[#f1eff5] p-[3px] shadow-[inset_0_0_0_1px_rgba(51,34,74,.08)]">
            {VIEW_TYPES.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={viewType === v.key}
                onClick={() => setViewType(v.key)}
                className={cn(
                  'rounded-[9px] px-[18px] py-[7px] text-[13px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c5fb0]',
                  viewType === v.key
                    ? 'bg-white text-[#33224a] shadow-[0_2px_6px_-2px_rgba(51,34,74,.3),0_0_0_1px_rgba(51,34,74,.07)]'
                    : 'text-[#8b8794] hover:text-[#33224a]'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-[7px]">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-[.09em] text-[#a8a5a0]">Filter</span>
            {FILTER_CHIPS.map((chip) => {
              const active = filter === chip.key
              const palette = chip.state ? STATE_PALETTE[chip.state] : ALL_CHIP_COLORS
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(chip.key)}
                  className="rounded-full px-[11px] py-[5px] text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c5fb0]"
                  style={
                    active
                      ? { background: palette.bg, color: palette.fg, boxShadow: `inset 0 0 0 1px ${palette.border}` }
                      : { background: '#fff', color: '#8b8794', boxShadow: 'inset 0 0 0 1px rgba(51,34,74,.1)' }
                  }
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ---- body: grid/list + rail (all views) ---- */}
        <div className="mt-[18px] grid grid-cols-1 items-start gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_336px]">
          <div className="min-w-0">
            {status === 'error' ? (
              <p className="text-sm text-destructive">Couldn&apos;t load the calendar. Try reloading.</p>
            ) : viewType === 'month' ? (
              <MonthGrid
                grid={grid}
                todayKey={todayKey}
                selectedKey={selectedKey}
                itemsByDay={itemsByDay}
                nowMs={nowMs}
                now={now}
                filterState={activeFilterState}
                loading={loading}
                onSelectDay={setSelectedKey}
                onOpenDay={goToDay}
                onOpenWeek={goToWeek}
                onAddDay={openAddForDay}
              />
            ) : viewType === 'week' ? (
              <WeekView
                grid={grid}
                todayKey={todayKey}
                selectedKey={selectedKey}
                itemsByDay={itemsByDay}
                nowMs={nowMs}
                filterState={activeFilterState}
                loading={loading}
                onSelectDay={setSelectedKey}
                onOpenDay={goToDay}
              />
            ) : (
              <DayView
                date={anchorDate}
                items={filterItems(itemsByDay.get(selectedKey) ?? [], activeFilterState, nowMs)}
                nowMs={nowMs}
                loading={loading}
              />
            )}
          </div>

          <div className="flex flex-col gap-3.5 min-[900px]:max-[1199px]:grid min-[900px]:max-[1199px]:grid-cols-3">
            <SelectedDayCard
              date={viewingDate}
              isToday={localDayKey(viewingDate) === todayKey}
              items={selectedItems}
              nowMs={nowMs}
              loading={loading}
              onToggle={handleToggleItem}
              canAdd={isUpcoming}
              onAddClick={() => openAddForDay(viewingDate)}
            />
            <GoalsRailCard />
            <StreakRailCard currentStreak={currentStreak} dueToday={dueTodayCount} />
          </div>
        </div>
      </div>
    </div>
  )
}
