import { cn } from '@/lib/utils'

// The goal's progress bar — shared by the Goals list, a goal's own page,
// and the dashboard's "Goals in progress" card so all three agree on how
// a goal's completion reads. role="progressbar" so the number isn't
// conveyed by the fill width alone.
export function GoalProgressBar({ percent, label, className }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-foreground/10', className)}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#7c5fb0] to-[#8ec5fc] transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
