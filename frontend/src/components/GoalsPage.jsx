import { Link } from 'react-router-dom'
import { Flag, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GoalProgressBar } from '@/components/GoalProgress'
import { useGoals } from '@/hooks/useGoals'
import { describeTimeLeft, formatTargetDate, sortActiveGoals } from '@/lib/goals'

function GoalCard({ goal }) {
  const timeLeft = describeTimeLeft(goal.targetDate)
  return (
    <Link
      to={`/goals/${goal.id}`}
      className="flex flex-col gap-3 rounded-[14px] bg-card p-5 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[19px] leading-snug font-semibold">{goal.name}</h3>
        {goal.completed ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700">Completed</span>
        ) : (
          timeLeft && (
            <span className="shrink-0 rounded-full bg-[#f3e8ff] px-2.5 py-0.5 text-xs whitespace-nowrap text-[#6b46a8]">
              {timeLeft}
            </span>
          )
        )}
      </div>
      {goal.description && <p className="line-clamp-2 text-sm text-muted-foreground">{goal.description}</p>}
      <div className="mt-auto flex flex-col gap-1.5">
        <GoalProgressBar percent={goal.progress} label={`${goal.name} progress`} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {goal.taskCount === 0
              ? 'No tasks yet'
              : `${goal.completedTaskCount} of ${goal.taskCount} task${goal.taskCount === 1 ? '' : 's'} done`}
          </span>
          {goal.targetDate && <span>{formatTargetDate(goal.targetDate)}</span>}
        </div>
      </div>
    </Link>
  )
}

function GoalCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-[22px] w-2/3 rounded-md" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-4 w-full rounded-md" />
      <div className="mt-2 flex flex-col gap-1.5">
        <Skeleton className="h-2 w-full" />
        <div className="flex justify-between">
          <Skeleton className="h-3 w-24 rounded-md" />
          <Skeleton className="h-3 w-20 rounded-md" />
        </div>
      </div>
    </div>
  )
}

export function GoalsPage() {
  const { goals, status } = useGoals()
  const active = sortActiveGoals(goals.filter((g) => !g.completed))
  const completed = goals.filter((g) => g.completed)

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Goals</h1>
        <Button render={<Link to="/goals/new" />} nativeButton={false}>
          <Plus />
          New goal
        </Button>
      </div>

      {status === 'loading' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true">
          <GoalCardSkeleton />
          <GoalCardSkeleton />
          <GoalCardSkeleton />
        </div>
      )}

      {status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load your goals. Try refreshing the page.
        </p>
      )}

      {status === 'ready' && goals.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-[14px] bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <div className="flex size-12 items-center justify-center rounded-full bg-[#7c5fb0]/10 text-[#7c5fb0]">
            <Flag className="size-5" />
          </div>
          <h2 className="text-lg font-semibold">Set your first goal</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Learn a language, buy a car, run a race — something bigger than one task. Give it a rough timeline and
            track your progress toward it.
          </p>
          <Button render={<Link to="/goals/new" />} nativeButton={false} className="mt-2">
            <Plus />
            New goal
          </Button>
        </div>
      )}

      {status === 'ready' && active.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {active.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </div>
      )}

      {status === 'ready' && completed.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">Completed</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {completed.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
