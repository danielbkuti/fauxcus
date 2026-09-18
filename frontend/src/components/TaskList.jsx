import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ListChecks, SquarePlus, X } from 'lucide-react'
import { TaskCard, SubtaskStackCard } from '@/components/TaskCard'
import { OverdueGateModal, collectOverdueItems } from '@/components/OverdueGateModal'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { updateTask, deleteTask, createSubTask, updateSubTask, deleteSubTask } from '@/lib/tasks'
import { useTaskStore } from '@/context/TaskStoreContext'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import { cn, UPCOMING_WINDOW_MS } from '@/lib/utils'

// "Due date" is the only sort with buckets and promoted subtasks —
// that machinery exists specifically to surface urgency, which isn't
// a meaningful concept under the other sorts. Those render a flat list
// of full task cards only.
const SORT_OPTIONS = [
  { value: 'due', label: 'Due date' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'newest', label: 'Newest created' },
  { value: 'oldest', label: 'Oldest created' },
]

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'nodate', label: 'No deadline' },
]

// Shared by both a task's own date and a promoted subtask entry's date
// (see `sortEntries` below) — "Overdue"/"No deadline" mean the same
// thing for either kind of item, so both are judged by this one rule
// rather than the filter only ever looking at a task's own date.
function dateMatchesFilter(dateDeadline, filterMode) {
  if (filterMode === 'overdue') {
    return Boolean(dateDeadline) && new Date(dateDeadline).getTime() < Date.now()
  }
  if (filterMode === 'nodate') {
    return !dateDeadline
  }
  return true
}

function applyFilter(tasks, filterMode) {
  if (filterMode === 'all') return tasks
  return tasks.filter((t) => dateMatchesFilter(t.dateDeadline, filterMode))
}

function sortTasksFlat(tasks, sortMode) {
  const sorted = [...tasks]
  if (sortMode === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  else if (sortMode === 'newest') sorted.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated))
  else if (sortMode === 'oldest') sorted.sort((a, b) => new Date(a.dateCreated) - new Date(b.dateCreated))
  return sorted
}

// How many completed tasks show inline before the list defers to the
// Progress page instead of just growing forever — same spirit as the
// subtask cascade preview on each card, which caps at 3 for the same
// reason.
const COMPLETED_PREVIEW_COUNT = 3

// How long a just-completed task stays put (playing its confetti burst)
// before it's actually allowed to drop into the Completed section.
// Comfortably covers the burst's own animation (850ms + up to ~230ms of
// staggered particle start delays).
const CELEBRATION_MS = 1300

// How long a just-checked subtask stays visible — checkmark filled in,
// name crossed out — before it's actually allowed to drop out.
// Comfortably over 1 second per spec. Owned here (not by TaskCard)
// because a subtask can render in *two* places at once under the
// due-date sort — bundled in its parent's cascade, and promoted to its
// own standalone entry — and both need to cross out together
// regardless of which one was actually clicked.
const SUBTASK_CELEBRATION_MS = 1400

export function TaskList() {
  const navigate = useNavigate()
  // A caller can arrive here asking for a filter pre-applied — today
  // just the Progress page's "Open the N overdue" link — via router
  // state rather than a URL query param, since this is a same-app
  // navigation, not a shareable/bookmarkable link.
  const location = useLocation()
  // Sourced from the shared store (loaded once, at the authenticated
  // layout level) rather than an independent fetch of its own — this
  // is the same store AddTaskFab and the other task pages read and
  // write through, so a mutation from any of them shows up here too
  // without needing a reload.
  const { tasks, status, setTasks, refreshTasks, refreshTask: refreshTaskInStore } = useTaskStore()
  // Task ids currently mid-celebration — kept in the active section
  // (regardless of their actual completed state) until their timer
  // clears, so completing a task doesn't just instantly teleport it to
  // the bottom of the page.
  const [celebratingIds, setCelebratingIds] = useState(() => new Set())
  // Same idea, for subtasks — kept separate from `celebratingIds`
  // (task ids) since they're never compared against each other, just
  // two different id namespaces. Shared by every TaskCard's cascade
  // *and* every promoted standalone SubtaskStackCard this list renders
  // directly (see renderEntry) — whichever one of the two a given
  // subtask wasn't clicked from still needs to see it celebrating.
  const [celebratingSubtaskIds, setCelebratingSubtaskIds] = useState(() => new Set())
  const [showOverdueGate, setShowOverdueGate] = useState(false)
  // Guards the overdue gate to a one-time check per page load — without
  // it, every subsequent task mutation (checking something off, adding
  // a subtask) would re-fetch `tasks` and re-open the modal the user
  // just dismissed.
  const overdueCheckedRef = useRef(false)
  const [sortMode, setSortMode] = useState('due')
  const [filterMode, setFilterMode] = useState(() => location.state?.filter ?? 'all')

  // Bulk select: off by default, and a plain id Set rather than
  // anything fancier — "is this id selected" is the only question
  // anything here ever asks of it.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)

  // Cards slide in from the left the first time they scroll into view —
  // see useScrollReveal for the mechanics. `enabled` is false (and the
  // wrapper below renders with no reveal classes at all, fully visible
  // from the start) under reduced motion or without IntersectionObserver
  // support.
  const { registerCard, enabled: revealEnabled } = useScrollReveal()

  useEffect(() => {
    if (status !== 'ready' || overdueCheckedRef.current) return
    overdueCheckedRef.current = true
    if (collectOverdueItems(tasks).length > 0) setShowOverdueGate(true)
  }, [status, tasks])

  // Optimistic: flip the checkbox immediately rather than waiting on the
  // PATCH round-trip, revert only if the request actually fails. Once
  // it succeeds, merges the server's response back in rather than
  // trusting the optimistic patch alone — completing a task also sets
  // dateCompleted server-side, which the client has no way to know in
  // advance.
  async function handleToggle(task, checked) {
    // Marking complete (not reopening) plays a short celebration in
    // place before the task is allowed to actually drop into the
    // Completed section — see CELEBRATION_MS.
    if (checked) {
      setCelebratingIds((current) => new Set(current).add(task.id))
      setTimeout(() => {
        setCelebratingIds((current) => {
          const next = new Set(current)
          next.delete(task.id)
          return next
        })
      }, CELEBRATION_MS)
    }

    setTasks((current) =>
      current.map((t) => (t.id === task.id ? { ...t, completed: checked } : t))
    )
    try {
      const updated = await updateTask(task.id, { completed: checked })
      setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, ...updated } : t)))
    } catch {
      setTasks((current) =>
        current.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t))
      )
    }
  }

  // Same optimistic pattern as handleToggle, but re-throws on failure
  // instead of swallowing the error — TaskCard awaits this itself so it
  // can show the specific validation message (e.g. "can't be in the
  // past") right next to the field that caused it, not just revert
  // silently.
  async function handleSetDeadline(task, dateDeadline) {
    const previous = task.dateDeadline
    setTasks((current) =>
      current.map((t) => (t.id === task.id ? { ...t, dateDeadline } : t))
    )
    try {
      await updateTask(task.id, { dateDeadline })
    } catch (err) {
      setTasks((current) =>
        current.map((t) => (t.id === task.id ? { ...t, dateDeadline: previous } : t))
      )
      throw err
    }
  }

  // Optimistic like the others, but re-throws on failure — TaskCard
  // awaits this itself so it can show a delete-specific error next to
  // the confirm button instead of the task just silently reappearing.
  async function handleDelete(task) {
    const previous = tasks
    setTasks((current) => current.filter((t) => t.id !== task.id))
    try {
      await deleteTask(task.id)
    } catch (err) {
      setTasks(previous)
      throw err
    }
  }

  // Re-fetches one task and folds it back into the shared store — used
  // after any subtask mutation. Completing/adding a subtask can flip
  // the parent task's own `completed` field server-side
  // (Task.update_completion_status), so pulling the authoritative task
  // back down is simpler and safer than re-deriving that logic here.
  async function refreshTask(taskId) {
    await refreshTaskInStore(taskId)
  }

  async function handleAddSubtask(task, name, dateDeadline) {
    await createSubTask({ task: task.id, name, dateDeadline })
    await refreshTask(task.id)
  }

  // Marking complete (not reopening) holds the subtask in place —
  // checked, struck through — in *both* of its possible renders (the
  // cascade-bundled row and, if this subtask is currently promoted to
  // its own entry, that standalone card too) for SUBTASK_CELEBRATION_MS
  // before either is allowed to actually treat it as done. Same
  // celebrate-then-mutate order as handleToggle above, for the same
  // reason.
  async function handleToggleSubtask(task, subtask, completed) {
    if (completed) {
      setCelebratingSubtaskIds((current) => new Set(current).add(subtask.id))
      setTimeout(() => {
        setCelebratingSubtaskIds((current) => {
          const next = new Set(current)
          next.delete(subtask.id)
          return next
        })
      }, SUBTASK_CELEBRATION_MS)
    }
    await updateSubTask(subtask.id, { completed })
    await refreshTask(task.id)
  }

  // Same shape as handleSetDeadline, for a subtask instead of the task
  // itself — used by the "Change deadline" option on a subtask's
  // due-date bubble in the task list's cascade preview.
  async function handleSetSubtaskDeadline(task, subtask, dateDeadline) {
    await updateSubTask(subtask.id, { dateDeadline })
    await refreshTask(task.id)
  }

  async function handleDeleteSubtask(task, subtask) {
    await deleteSubTask(subtask.id)
    await refreshTask(task.id)
  }

  // Bulk select: toggling one id, selecting everything currently
  // visible, or dropping the selection entirely (also what turning
  // select mode off does, so re-entering it never starts pre-selected).
  function toggleSelected(taskId) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
    setConfirmingBulkDelete(false)
  }

  // Only tasks not already completed and with no incomplete subtask of
  // their own are eligible — the same completion gate TaskCard's own
  // Pending/Complete button enforces for this list (see the module note
  // on completion being gated here, not on the detail page). Selecting
  // an ineligible task is still allowed (it's still fair game for bulk
  // delete); bulk-complete just quietly skips it.
  function isEligibleForBulkComplete(task) {
    return !task.completed && !task.subtasks.some((s) => !s.completed)
  }

  async function handleBulkComplete() {
    const eligible = tasks.filter((t) => selectedIds.has(t.id) && isEligibleForBulkComplete(t))
    if (eligible.length === 0) return
    setBulkBusy(true)
    try {
      await Promise.all(eligible.map((t) => updateTask(t.id, { completed: true })))
      await refreshTasks()
    } finally {
      setBulkBusy(false)
      exitSelectMode()
    }
  }

  async function handleBulkDeleteConfirm() {
    setBulkBusy(true)
    try {
      await Promise.all([...selectedIds].map((id) => deleteTask(id)))
      await refreshTasks()
    } finally {
      setBulkBusy(false)
      exitSelectMode()
    }
  }

  // Where a promoted subtask's "Part of ..." tag sends you — normally
  // not a navigation, just scrolls the full task's own card into view
  // and gives it a brief highlight so it's obvious which one it meant
  // (direct DOM manipulation rather than React state, same call as the
  // task detail page's FLIP reorder animation: a purely transient
  // visual effect that doesn't need to survive a re-render). Now that a
  // filter can promote a subtask onto the page without its parent task
  // also matching (see `subtaskEntries` above), the task's own card
  // might genuinely not be rendered here at all — falls back to a real
  // navigation to the task's own detail page in that case, rather than
  // silently doing nothing.
  function handleJumpToTask(taskId) {
    const el = document.getElementById(`task-${taskId}`)
    if (!el) {
      navigate(`/tasks/${taskId}`)
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-sky-400')
    window.setTimeout(() => el.classList.remove('ring-2', 'ring-sky-400'), 1200)
  }

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 shadow-sm ring-1 ring-foreground/10">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <Skeleton className={cn('h-4 flex-1 rounded-full', i % 2 === 1 && 'max-w-[60%]')} />
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <p className="text-sm text-destructive">Couldn&apos;t load your tasks. Try reloading.</p>
    )
  }

  // A celebrating task stays in the active list even though it's
  // already `completed` server-side — it only actually moves down once
  // its timer clears.
  const activeTasks = tasks.filter((t) => !t.completed || celebratingIds.has(t.id))
  const filteredActiveTasks = applyFilter(activeTasks, filterMode)
  // Most recently completed first, same ordering rule as the task
  // detail page's completed-subtask group — only the freshest few are
  // worth showing inline, the rest live on /progress.
  const completedTasks = tasks
    .filter((t) => t.completed && !celebratingIds.has(t.id))
    .sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted))
  const visibleCompletedTasks = completedTasks.slice(0, COMPLETED_PREVIEW_COUNT)
  const hiddenCompletedCount = completedTasks.length - visibleCompletedTasks.length
  // Everything selectable by "Select all" — every task actually
  // rendered right now, active or completed, under whatever filter's
  // currently applied. Not the promoted-subtask entries the due-date
  // sort adds — bulk select only ever operates on whole tasks.
  const selectableIds = [...filteredActiveTasks, ...visibleCompletedTasks].map((t) => t.id)
  const selectedCount = selectedIds.size
  const eligibleSelectedCount = tasks.filter(
    (t) => selectedIds.has(t.id) && isEligibleForBulkComplete(t)
  ).length

  function selectAll() {
    setSelectedIds(new Set(selectableIds))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function renderCard(task) {
    return (
      <div
        key={`task-${task.id}`}
        ref={revealEnabled ? registerCard : undefined}
        className={revealEnabled ? 'card-reveal' : undefined}
      >
        <TaskCard
          task={task}
          celebrating={celebratingIds.has(task.id)}
          onToggleComplete={handleToggle}
          onSetDeadline={handleSetDeadline}
          onDelete={handleDelete}
          onAddSubtask={handleAddSubtask}
          onToggleSubtask={handleToggleSubtask}
          onSetSubtaskDeadline={handleSetSubtaskDeadline}
          onDeleteSubtask={handleDeleteSubtask}
          pulseReady={!showOverdueGate}
          selectMode={selectMode}
          selected={selectedIds.has(task.id)}
          onSelectToggle={() => toggleSelected(task.id)}
          celebratingSubtaskIds={celebratingSubtaskIds}
        />
      </div>
    )
  }

  // The "Due date" sort: every active task always gets its own entry
  // at its own deadline, and every dated, incomplete subtask of every
  // task *also* gets its own entry at its own deadline — not just the
  // single soonest one per task. Each holds exactly as much priority
  // in the sort as any standalone task; a task with three subtasks due
  // before it can show all three ahead of it, each also still shows up
  // bundled in its own task's normal cascade preview lower down.
  // Undated subtasks never get promoted this way; they stay bundled in
  // the task's normal preview only.
  //
  // Task entries and subtask entries are filtered independently rather
  // than subtask entries only ever existing under an already-filtered
  // task — a subtask can be overdue while its own parent task isn't (or
  // vice versa), and the filter is meant to judge each entry on its own
  // date, not inherit its parent's. Built from every active task
  // (`activeTasks`, not `filteredActiveTasks`) so an overdue subtask
  // still surfaces under the "Overdue" filter even when its task doesn't
  // itself match.
  const taskEntries = filteredActiveTasks.map((task) => ({ type: 'task', task, date: task.dateDeadline }))
  const subtaskEntries = activeTasks.flatMap((task) => {
    // A subtask mid-celebration stays promoted too — without this it'd
    // vanish from its standalone spot the instant the check succeeds,
    // never actually playing the cross-out it's meant to.
    const datedIncompleteSubtasks = task.subtasks.filter(
      (s) => (!s.completed || celebratingSubtaskIds.has(s.id)) && s.dateDeadline
    )
    return datedIncompleteSubtasks
      .filter((s) => dateMatchesFilter(s.dateDeadline, filterMode))
      .map((subtask) => ({ type: 'subtask', task, subtask, date: subtask.dateDeadline }))
  })
  const sortEntries = [...taskEntries, ...subtaskEntries]

  // Three buckets: due this week (includes overdue — an overdue date
  // is even sooner than "within a week"), no deadline, then later.
  // Soonest first within the dated buckets.
  const now = Date.now()
  const dueSoon = []
  const undated = []
  const later = []
  for (const entry of sortEntries) {
    if (!entry.date) undated.push(entry)
    else if (new Date(entry.date).getTime() - now <= UPCOMING_WINDOW_MS) dueSoon.push(entry)
    else later.push(entry)
  }
  dueSoon.sort((a, b) => new Date(a.date) - new Date(b.date))
  later.sort((a, b) => new Date(a.date) - new Date(b.date))

  function renderEntry(entry) {
    if (entry.type === 'task') return renderCard(entry.task)
    const { task, subtask } = entry
    return (
      <div
        key={`subtask-${subtask.id}`}
        ref={revealEnabled ? registerCard : undefined}
        className={revealEnabled ? 'card-reveal' : undefined}
      >
        <SubtaskStackCard
          subtask={subtask}
          justCompleted={celebratingSubtaskIds.has(subtask.id)}
          partOf={{
            label: `Part of "${task.name}"`,
            onClick: () => handleJumpToTask(task.id),
          }}
          onToggleComplete={(checked) => handleToggleSubtask(task, subtask, checked)}
          onSetDeadline={(dateDeadline) => handleSetSubtaskDeadline(task, subtask, dateDeadline)}
          onDelete={() => handleDeleteSubtask(task, subtask)}
          pulseReady={!showOverdueGate}
        />
      </div>
    )
  }

  function renderBucket(label, entries) {
    if (entries.length === 0) return null
    return (
      <div key={label} className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground">{label}</h2>
        {entries.map(renderEntry)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {showOverdueGate && (
        <OverdueGateModal
          overdueItems={collectOverdueItems(tasks)}
          onDismiss={() => setShowOverdueGate(false)}
          onReview={() => {
            setFilterMode('overdue')
            setShowOverdueGate(false)
          }}
        />
      )}

      {tasks.length === 0 ? (
        // Same clickable-card treatment as Dashboard's own empty
        // "Upcoming" state — a graphic + CTA pill, not just a line of
        // text, since this is most people's very first screen after
        // signing up.
        <Link
          to="/tasks/new"
          className="group flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center transition-colors hover:border-[#56a456]/50 hover:bg-[#56a456]/5"
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-[#56a456]/10 text-[#56a456] transition-transform duration-200 group-hover:scale-110">
            <ListChecks className="size-5" />
          </div>
          <p className="text-sm font-medium">
            No tasks yet — add one to get started.
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#56a456] px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#56a456]/25 transition-transform duration-200 group-hover:scale-105">
            <SquarePlus className="size-3.5" />
            Add a new task
          </span>
        </Link>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilterMode(option.value)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filterMode === option.value
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Sort by
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value)}
                  className="rounded-md border bg-background px-2 py-1 text-xs text-foreground outline-none focus-visible:border-ring"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                variant={selectMode ? 'secondary' : 'outline'}
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              >
                {selectMode ? (
                  <>
                    <X /> Cancel
                  </>
                ) : (
                  <>
                    <ListChecks /> Select
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Bulk action bar — only up while select mode is on. Selection
              survives a filter/sort change (it's just an id Set), so
              switching views mid-selection doesn't lose it. */}
          {selectMode && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
                <span>{selectedCount} selected</span>
                <button type="button" onClick={selectAll} className="hover:text-foreground hover:underline">
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedCount === 0}
                  className="hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                >
                  Clear
                </button>
              </div>

              <div className="flex items-center gap-2">
                {confirmingBulkDelete ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Delete {selectedCount} task{selectedCount === 1 ? '' : 's'}?
                    </span>
                    <Button size="sm" variant="destructive" onClick={handleBulkDeleteConfirm} disabled={bulkBusy}>
                      {bulkBusy ? 'Deleting…' : 'Confirm'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmingBulkDelete(false)}
                      disabled={bulkBusy}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleBulkComplete}
                      disabled={bulkBusy || eligibleSelectedCount === 0}
                      title={
                        selectedCount > 0 && eligibleSelectedCount === 0
                          ? 'None of the selected tasks can be completed yet — clear their subtasks first.'
                          : undefined
                      }
                    >
                      {bulkBusy ? 'Working…' : `Complete${eligibleSelectedCount > 0 ? ` (${eligibleSelectedCount})` : ''}`}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirmingBulkDelete(true)}
                      disabled={bulkBusy || selectedCount === 0}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {sortMode === 'due' ? (
            sortEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks match this filter.</p>
            ) : (
              <>
                {renderBucket('Due this week', dueSoon)}
                {renderBucket('No deadline', undated)}
                {renderBucket('Later', later)}
              </>
            )
          ) : filteredActiveTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks match this filter.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {sortTasksFlat(filteredActiveTasks, sortMode).map(renderCard)}
            </div>
          )}

          {filterMode === 'all' && completedTasks.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  Completed ({completedTasks.length})
                </h2>
                {hiddenCompletedCount > 0 && (
                  <Link
                    to="/progress"
                    className="text-xs font-medium text-sky-600 hover:underline"
                  >
                    View all completed →
                  </Link>
                )}
              </div>
              {visibleCompletedTasks.map(renderCard)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
