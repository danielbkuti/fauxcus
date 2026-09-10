import { cn } from '@/lib/utils'

// A pulsing placeholder block — the one shape every skeleton loader in
// the app is built from, reshaped per call site via className
// (rounded-full for a pill/bar, a smaller radius for a row or card,
// and/or a bg-*/opacity override for a call site that sits on a dark
// background instead of a light card). `style` is an escape hatch for
// the rarer case where the tint itself is a runtime value (e.g. a
// per-task-state theme color) rather than a static class — Tailwind's
// JIT scanner only picks up class names it can see as literal source
// text, not ones assembled from a variable. Every page with an async
// "loading" state should render one or more of these in place of its
// real content — never a bare "Loading…" string — while data is in
// flight. See README's Engineering Decisions entry ("Skeleton Loaders
// for Async Page Content") for why this is required going forward.
export function Skeleton({ className, style }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-full bg-foreground/10', className)} style={style} />
}
