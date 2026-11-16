import { cn } from '@/lib/utils'

const STEPS = [
  { key: 'email', label: 'Email' },
  { key: 'verify', label: 'Verify' },
  { key: 'details', label: 'Details' },
  { key: 'password', label: 'Password' },
]

// The checklist bar at the top of the signup card. `currentStep` is one
// of the keys above — everything before it renders as done (checkmark),
// everything after as upcoming.
export function SignupProgress({ currentStep }) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep)

  return (
    <div className="flex items-start">
      {STEPS.map((step, index) => (
        <div key={step.key} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                index < currentIndex && 'bg-sky-500 text-white',
                index === currentIndex && 'bg-black text-white',
                index > currentIndex && 'bg-black/10 text-black/40'
              )}
            >
              {index < currentIndex ? '✓' : index + 1}
            </div>
            <span
              className={cn(
                'text-[13px] font-medium whitespace-nowrap',
                index <= currentIndex ? 'text-black' : 'text-black/40'
              )}
            >
              {step.label}
            </span>
          </div>
          {index < STEPS.length - 1 && (
            <div
              className={cn(
                'mx-1 h-0.5 flex-1',
                index < currentIndex ? 'bg-sky-500' : 'bg-black/10'
              )}
              style={{ marginBottom: '14px' }}
            />
          )}
        </div>
      ))}
    </div>
  )
}
