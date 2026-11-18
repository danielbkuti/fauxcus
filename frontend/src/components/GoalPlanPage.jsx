import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Info, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useTaskStore } from '@/context/TaskStoreContext'
import {
  NEXT_PHASE_QUESTION,
  acceptPlan,
  describePlanError,
  fetchGoal,
  fetchPlanDraft,
  fetchPlanInfo,
  fetchPlanQuestions,
  formatPlanDate,
  formatTargetDate,
  isDraftAcceptable,
  removeDraftSubtask,
  removeDraftTask,
  renameDraftTask,
  withDraftKeys,
} from '@/lib/goals'

// Plan this goal: answer a few questions -> review a proposed set of
// tasks -> accept. Nothing is saved until the last step, and the
// review screen lets you drop or reword steps first, so the plan is
// always the user's to shape rather than something that just lands in
// their task list.

function QuestionsSkeleton({ count = 4 }) {
  return (
    <div className="mt-8 flex flex-col gap-6" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4 rounded-md" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}

function DraftSkeleton() {
  return (
    <div className="mt-8" aria-busy="true">
      <Skeleton className="h-4 w-full max-w-[60ch] rounded-md" />
      <Skeleton className="mt-2 h-4 w-2/3 rounded-md" />
      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className={i < 2 ? 'h-24 w-full rounded-xl' : 'h-14 w-full rounded-xl'} />
        ))}
      </div>
    </div>
  )
}

const SOURCE_LABELS = {
  template: 'Starter outline',
  ai: 'Suggested by AI',
}

export function GoalPlanPage() {
  const { id } = useParams()
  const goalId = Number(id)
  const navigate = useNavigate()
  const { refreshTasks } = useTaskStore()
  const [searchParams] = useSearchParams()
  // ?mode=next re-plans a goal that already has tasks: one open question
  // instead of the full set, and the draft builds on what's done.
  const mode = searchParams.get('mode') === 'next' ? 'next' : 'initial'

  const [goal, setGoal] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])
  // 'template' | 'ai' — known before anything is sent, so the screen can
  // say up front when text is about to go to a model.
  const [planSource, setPlanSource] = useState(null)
  // 'loading' | 'questions' | 'drafting' | 'review' | 'creating' | 'error'
  const [stage, setStage] = useState('loading')
  const [loadError, setLoadError] = useState(null)
  const [draft, setDraft] = useState(null)
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)

  // Goal and questions load together. A goal that can't be planned
  // (completed, or its target date has passed) is told so up front
  // rather than after the user has answered everything.
  useEffect(() => {
    let cancelled = false
    setStage('loading')
    fetchGoal(goalId)
      .then(async (data) => {
        if (cancelled) return
        setGoal(data)
        if (data.completed) {
          setLoadError('This goal is already completed. Reopen it to plan more steps.')
          setStage('error')
          return
        }
        // Re-planning asks one fixed question, so it only needs to know
        // which planner is active (free); a first plan fetches tailored
        // questions, which come back with the planner's source.
        const result =
          mode === 'next'
            ? { ...(await fetchPlanInfo(goalId)), questions: [NEXT_PHASE_QUESTION] }
            : await fetchPlanQuestions(goalId)
        if (cancelled) return
        setPlanSource(result.source)
        setQuestions(result.questions)
        setAnswers(result.questions.map(() => ''))
        setStage('questions')
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err.status === 404 ? 'This goal doesn’t exist, or it was deleted.' : describePlanError(err))
        setStage('error')
      })
    return () => {
      cancelled = true
    }
  }, [goalId, mode])

  async function handleDraft(event) {
    event?.preventDefault()
    setError(null)
    setStage('drafting')
    try {
      const payload = questions
        .map((question, i) => ({ question, answer: answers[i].trim() }))
        .filter((a) => a.answer)
      const result = await fetchPlanDraft(goalId, payload, mode)
      setDraft(withDraftKeys(result))
      setSource(result.source)
      setStage('review')
    } catch (err) {
      setError(describePlanError(err))
      setStage('questions')
    }
  }

  async function handleAccept() {
    setError(null)
    setStage('creating')
    try {
      await acceptPlan(goalId, draft)
      // The new tasks live in the shared store's list too — re-read it
      // so the goal page (and everything else) shows them right away.
      await refreshTasks().catch(() => {})
      navigate(`/goals/${goalId}`)
    } catch (err) {
      setError(describePlanError(err))
      setStage('review')
    }
  }

  const back = (
    <Link
      to={`/goals/${goalId}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Back to goal
    </Link>
  )

  if (stage === 'error') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-8 py-24 text-center">
        <h1 className="text-2xl font-semibold">Can’t plan this goal</h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" render={<Link to={goal ? `/goals/${goalId}` : '/goals'} />} nativeButton={false}>
          {goal ? 'Back to goal' : 'Back to goals'}
        </Button>
      </div>
    )
  }

  const heading = (
    <div className="mt-3">
      <h1 className="text-3xl leading-tight font-semibold">
        {stage === 'review' || stage === 'creating'
          ? 'Review your plan'
          : mode === 'next'
            ? 'Plan the next phase'
            : 'Plan your steps'}
      </h1>
      {goal ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{goal.name}</span>
          {goal.targetDate && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" />
              by {formatTargetDate(goal.targetDate)}
            </span>
          )}
        </p>
      ) : (
        <Skeleton className="mt-3 h-4 w-48 rounded-md" />
      )}
    </div>
  )

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {back}
      {heading}

      {stage === 'loading' && <QuestionsSkeleton count={mode === 'next' ? 1 : 4} />}

      {stage === 'questions' && (
        <form onSubmit={handleDraft} className="mt-8 flex flex-col gap-6">
          <p className="max-w-[65ch] text-sm text-muted-foreground">
            {mode === 'next'
              ? 'We’ll look at what you’ve already done and suggest what comes next. Tell us what’s changed if you like — it’s optional.'
              : 'A few quick questions help shape the steps. Answer what you like — every question is optional.'}
          </p>
          {planSource === 'ai' && (
            <p className="flex max-w-[65ch] items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Suggestions are written by an AI model (Anthropic’s Claude). Your goal’s name and details, your answers
                {mode === 'next' ? ', and the names and due dates of this goal’s tasks' : ''} are sent to it. Nothing
                is created until you review and accept.
              </span>
            </p>
          )}
          {questions.map((question, i) => (
            <div key={question} className="flex flex-col gap-2">
              <label htmlFor={`plan-q-${i}`} className="text-sm leading-snug font-medium">
                {question}
              </label>
              <textarea
                id={`plan-q-${i}`}
                value={answers[i]}
                onChange={(e) => setAnswers((current) => current.map((a, j) => (j === i ? e.target.value : a)))}
                rows={2}
                maxLength={1000}
                className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" size="lg">
              {mode === 'next' ? 'Suggest next steps' : 'Suggest steps'}
            </Button>
            <Button type="button" variant="ghost" size="lg" render={<Link to={`/goals/${goalId}`} />} nativeButton={false}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {stage === 'drafting' && <DraftSkeleton />}

      {(stage === 'review' || stage === 'creating') && draft && (
        <div className="mt-8">
          <div className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              {source && SOURCE_LABELS[source] && <p className="font-medium">{SOURCE_LABELS[source]}</p>}
              <p className="max-w-[65ch] text-muted-foreground">{draft.summary}</p>
            </div>
          </div>

          {draft.warnings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2" aria-label="Things to check">
              {draft.warnings.map((warning) => (
                <li
                  key={warning}
                  className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {warning}
                </li>
              ))}
            </ul>
          )}

          <ol className="mt-6 flex flex-col gap-3">
            {draft.tasks.map((task) => (
              <li key={task.key} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Input
                      value={task.name}
                      onChange={(e) => setDraft((d) => renameDraftTask(d, task.key, e.target.value))}
                      maxLength={100}
                      aria-label="Task name"
                      disabled={stage === 'creating'}
                      className="h-9 font-medium"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">{formatPlanDate(task.date)}</p>
                    {task.description && (
                      <p className="mt-2 max-w-[65ch] text-sm whitespace-pre-line text-foreground/70">
                        {task.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${task.name || 'task'}`}
                    disabled={stage === 'creating'}
                    onClick={() => setDraft((d) => removeDraftTask(d, task.key))}
                  >
                    <X />
                  </Button>
                </div>

                {task.subtasks.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 border-t pt-3">
                    {task.subtasks.map((sub) => (
                      <li key={sub.key} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 break-words">{sub.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatPlanDate(sub.date)}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove ${sub.name}`}
                          disabled={stage === 'creating'}
                          onClick={() => setDraft((d) => removeDraftSubtask(d, task.key, sub.key))}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          {draft.tasks.length === 0 && (
            <p className="mt-6 text-sm text-muted-foreground">
              You&apos;ve removed every step. Go back to start over.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={handleAccept} disabled={stage === 'creating' || !isDraftAcceptable(draft)}>
              {stage === 'creating'
                ? 'Creating…'
                : `Create ${draft.tasks.length} task${draft.tasks.length === 1 ? '' : 's'}`}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              disabled={stage === 'creating'}
              onClick={() => {
                setError(null)
                setStage('questions')
              }}
            >
              Back to questions
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
