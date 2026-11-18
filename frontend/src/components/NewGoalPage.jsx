import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { GoalForm } from '@/components/GoalForm'
import { createGoal } from '@/lib/goals'

export function NewGoalPage() {
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(values) {
    setError(null)
    setSubmitting(true)
    try {
      const goal = await createGoal(values)
      navigate(`/goals/${goal.id}`)
    } catch (err) {
      setError(err.data?.name?.[0] ?? err.data?.targetDate?.[0] ?? 'Could not create that goal.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link to="/goals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to goals
      </Link>
      <h1 className="mt-3 mb-1 text-3xl font-semibold">New goal</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Something bigger than a single task — you&apos;ll break it into steps from here.
      </p>
      <GoalForm
        submitLabel="Create goal"
        submittingLabel="Creating…"
        onSubmit={handleSubmit}
        onCancel={() => navigate('/goals')}
        submitting={submitting}
        error={error}
      />
    </div>
  )
}
