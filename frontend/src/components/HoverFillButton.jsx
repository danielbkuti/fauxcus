import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const HOVER_FILL_MS = 350
const PROGRESS_GRADIENT = 'bg-gradient-to-r from-[#e0c3fc] via-[#7c5fb0] to-[#8ec5fc]'

// A button whose gradient sweeps in from the left on hover — the same
// "completion" fill as the task list's Pending -> Complete button,
// generalized for reuse anywhere that sweep reads as "commit to this."
// Currently just the overdue banner's Review button: dismissing it is
// its own small act of acknowledgment, so it gets the same fill.
export function HoverFillButton({ children, onClick, className }) {
  const [hoverFilled, setHoverFilled] = useState(false)
  const timerRef = useRef(null)

  function handleMouseEnter() {
    timerRef.current = setTimeout(() => setHoverFilled(true), HOVER_FILL_MS)
  }

  function handleMouseLeave() {
    clearTimeout(timerRef.current)
    setHoverFilled(false)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'group relative overflow-hidden rounded-md border border-input bg-background px-5 py-2 text-sm font-medium transition-colors',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          PROGRESS_GRADIENT,
          'absolute inset-0 origin-left scale-x-0 transition-transform ease-linear group-hover:scale-x-100'
        )}
        style={{ transitionDuration: `${HOVER_FILL_MS}ms` }}
      />
      <span className={cn('relative', hoverFilled && 'text-white')}>{children}</span>
    </button>
  )
}
