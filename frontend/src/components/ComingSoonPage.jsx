import { Link } from 'react-router-dom'
import { Hammer } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Placeholder for nav destinations that don't have a real feature
// behind them yet (Goals, Calendar, Progress) — a real route so the nav
// link actually goes somewhere instead of 404ing or doing nothing.
export function ComingSoonPage({ title }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-8 py-24 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-[#7c5fb0]/10 text-[#7c5fb0]">
        <Hammer className="size-6" />
      </div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">
        {title} isn&apos;t built yet — it&apos;s on the way. Check back soon.
      </p>
      <Button variant="outline" size="sm" render={<Link to="/home" />} nativeButton={false}>
        Back to home
      </Button>
    </div>
  )
}
