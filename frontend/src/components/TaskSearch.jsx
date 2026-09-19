import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CalendarDays, ListChecks } from 'lucide-react'
import { useTaskStore } from '@/context/TaskStoreContext'
import { formatDeadline } from '@/lib/utils'

const MAX_SUGGESTIONS = 8

// A query token matches a name if it prefixes *any* word in that name,
// not just the name's own first word — "boo" hits "Book flights for
// conference" (word 1) same as it'd hit "Weekly book club" (word 2).
// Every query token has to land on some word (order-independent), so a
// two-word query narrows rather than requiring an exact phrase.
function nameMatchesQuery(name, queryTokens) {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean)
  return queryTokens.every((qt) => words.some((w) => w.startsWith(qt)))
}

// Flattens every task and every subtask of every task — completed
// included, nothing pre-filtered — into one list of candidates a text
// query can run against. Built fresh per render off the shared task
// store; the list is small enough (a personal task manager, not a
// multi-tenant search index) that there's no need to memoize beyond
// what useMemo already gives it below.
function collectCandidates(tasks) {
  const candidates = []
  for (const task of tasks) {
    candidates.push({ kind: 'task', task, name: task.name })
    for (const subtask of task.subtasks) {
      candidates.push({ kind: 'subtask', task, subtask, name: subtask.name })
    }
  }
  return candidates
}

function textSearch(tasks, query) {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (queryTokens.length === 0) return []
  return collectCandidates(tasks)
    .filter((c) => nameMatchesQuery(c.name, queryTokens))
    .slice(0, MAX_SUGGESTIONS)
}

// A task/subtask "is on" a given calendar date if its deadline falls
// on that local day — compared by local Y/M/D, not a raw ISO-string
// prefix, since the stored deadline carries a time of day and the
// viewer's own timezone is what a date search is implicitly asking
// about (same local-getter reasoning as toDatetimeLocalValue).
function isOnDate(iso, target) {
  if (!iso) return false
  const d = new Date(iso)
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  )
}

function dateSearch(tasks, target) {
  return collectCandidates(tasks)
    .filter((c) => isOnDate(c.kind === 'task' ? c.task.dateDeadline : c.subtask.dateDeadline, target))
    .slice(0, MAX_SUGGESTIONS)
}

// Digits the user actually typed (slashes/spaces stripped, so "8/2"
// and "82" behave the same) mapped onto MM/DD/YYYY position-by-position
// — whatever positions aren't typed yet are filled in from today's own
// date, so the preview always reads as a complete, real date while
// someone's still mid-keystroke. `complete` is true once all 8 digits
// (MM DD YYYY) have actually been typed, at which point it's an
// explicit date rather than a guess and Enter can act on it directly.
function buildDatePreview(digits) {
  const today = new Date()
  const todayDigits =
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0') +
    String(today.getFullYear()).padStart(4, '0')
  const merged = (digits + todayDigits.slice(digits.length)).slice(0, 8)
  const month = merged.slice(0, 2)
  const day = merged.slice(2, 4)
  const year = merged.slice(4, 8)
  const monthNum = Number(month)
  const dayNum = Number(day)
  const yearNum = Number(year)
  const valid = monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31
  return {
    label: `${month}/${day}/${year}`,
    date: valid ? new Date(yearNum, monthNum - 1, dayNum) : null,
    complete: digits.length >= 8,
  }
}

// Live search over every task and subtask (active, completed, and
// nested) by name, plus a date mode: typing a digit first switches the
// box into "search by date" — see buildDatePreview — rather than
// literal-name matching. Sits above TaskList as its own component
// since selecting a result just navigates to that task's own detail
// page rather than filtering the list underneath.
export function TaskSearch() {
  const navigate = useNavigate()
  const { tasks } = useTaskStore()
  const [query, setQuery] = useState('')
  const [dateMode, setDateMode] = useState(null) // null | Date — the *active* (submitted) date search
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef(null)

  const digitsMode = /^\s*\d/.test(query)
  const digits = digitsMode ? query.replace(/\D/g, '') : ''
  const datePreview = digitsMode && digits.length > 0 ? buildDatePreview(digits) : null

  const results = useMemo(() => {
    if (dateMode) return dateSearch(tasks, dateMode)
    if (digitsMode) return [] // showing the date-preview row instead, until it's submitted
    return textSearch(tasks, query)
  }, [tasks, query, digitsMode, dateMode])

  useEffect(() => {
    setActiveIndex(-1)
  }, [query, dateMode])

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function reset() {
    setQuery('')
    setDateMode(null)
    setOpen(false)
    setActiveIndex(-1)
  }

  function goToCandidate(candidate) {
    navigate(`/tasks/${candidate.task.id}`)
    reset()
  }

  function submitDatePreview() {
    if (!datePreview?.date) return
    setDateMode(datePreview.date)
    setOpen(true)
  }

  // Enter's meaning depends on what's showing: a highlighted suggestion
  // takes it; otherwise a fully-typed date (8 digits) runs the date
  // search; otherwise — including a partial number the person just hit
  // Enter on without waiting for the date preview — it's treated as an
  // ordinary literal-text search, per spec ("if they search just a
  // number, run it like a regular search for that number").
  function handleKeyDown(e) {
    const rowCount = dateMode || !digitsMode ? results.length : datePreview ? 1 : 0
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (rowCount > 0) setActiveIndex((i) => (i + 1) % rowCount)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (rowCount > 0) setActiveIndex((i) => (i - 1 + rowCount) % rowCount)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (digitsMode && !dateMode) {
        if (activeIndex === 0 && datePreview) {
          submitDatePreview()
        } else if (datePreview?.complete) {
          submitDatePreview()
        } else {
          // Partial number, no explicit pick — search it as plain text.
          setDateMode(null)
          setActiveIndex(-1)
        }
        return
      }
      if (activeIndex >= 0 && results[activeIndex]) goToCandidate(results[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDateRow = digitsMode && !dateMode && datePreview
  const showResults = dateMode || (!digitsMode && query.trim().length > 0)
  const showDropdown = open && (showDateRow || showResults)

  // Mirrors handleKeyDown's own notion of "row 0 is the date preview
  // when there's no submitted date search yet" — activeIndex is a
  // single flat cursor across whichever one of the two row sets is
  // actually showing, so the id it maps to has to follow the same
  // branch.
  const activeOptionId =
    digitsMode && !dateMode
      ? activeIndex === 0 && datePreview
        ? 'task-search-date-option'
        : undefined
      : activeIndex >= 0 && results[activeIndex]
        ? `task-search-option-${activeIndex}`
        : undefined

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Fully rounded (pill) bar with a gradient outline — `.gradient-ring`
          (index.css) is the same masked-border trick the Logo/FAB/NavBar
          chrome already uses, `border-radius: inherit` off this relative
          `rounded-full` wrapper is what makes it trace the pill instead of
          a rectangle. */}
      <div className="relative rounded-full">
        <span aria-hidden="true" className="gradient-ring" />
        <Search className="pointer-events-none absolute top-1/2 left-4 z-[2] size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={dateMode ? `Tasks on ${formatDateOnly(dateMode)}` : query}
          onChange={(e) => {
            setDateMode(null)
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search tasks…"
          readOnly={Boolean(dateMode)}
          aria-label="Search tasks"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="task-search-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          className="relative w-full rounded-full border-none bg-background py-2.5 pr-4 pl-10 text-sm outline-none"
        />
      </div>

      {showDropdown && (
        <div
          id="task-search-listbox"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {showDateRow && (
            <button
              id="task-search-date-option"
              role="option"
              aria-selected={activeIndex === 0}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={submitDatePreview}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                activeIndex === 0 ? 'bg-muted' : 'hover:bg-muted'
              }`}
            >
              <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
              Search for tasks on date <span className="font-semibold">{datePreview.label}</span>
            </button>
          )}

          {showResults && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {dateMode ? `No tasks due ${formatDateOnly(dateMode)}.` : 'No matching tasks.'}
            </p>
          )}

          {showResults &&
            results.map((c, i) => (
              <button
                key={c.kind === 'task' ? `task-${c.task.id}` : `subtask-${c.subtask.id}`}
                id={`task-search-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goToCandidate(c)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                  i === activeIndex ? 'bg-muted' : 'hover:bg-muted'
                }`}
              >
                {c.kind === 'subtask' ? (
                  <ListChecks className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <span
                    className={`size-3.5 shrink-0 rounded-full border ${c.task.completed ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground'}`}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className={c.kind === 'task' && c.task.completed ? 'text-muted-foreground line-through' : ''}>
                    {c.name}
                  </span>
                  {c.kind === 'subtask' && (
                    <span className="text-muted-foreground"> — in "{c.task.name}"</span>
                  )}
                </span>
                {(c.kind === 'task' ? c.task.dateDeadline : c.subtask.dateDeadline) && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDeadline(c.kind === 'task' ? c.task.dateDeadline : c.subtask.dateDeadline)}
                  </span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

function formatDateOnly(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
