# Project conventions

## Skeleton loaders are required for async page content

Any page or view whose content depends on an async fetch — a new route,
or new async-loaded content on an existing one — must render a skeleton
placeholder while that fetch is in flight. A `status === 'loading'`
branch that returns plain text (e.g. `<p>Loading…</p>`) or nothing at
all is not acceptable; an empty loading state reads as "there's nothing
here," not "this hasn't loaded yet."

Use the shared `Skeleton` primitive at
`frontend/src/components/ui/skeleton.jsx` — a pulsing placeholder block,
reshaped per call site via `className` (and an optional `style` for the
rare case where the tint itself is a runtime value, like a per-task-
state theme color, rather than a static Tailwind class). Shape the
skeleton to roughly match the real content's layout (card/row counts,
rough heights) so there's minimal reflow when the real content replaces
it — see `CalendarPage.jsx`, `Dashboard.jsx`, `TaskList.jsx`,
`TaskDetailPage.jsx`, `ProgressPage.jsx`, or `ProfilePage.jsx` for
examples across a range of layouts (grids, list rows, a themed page
shell, a dark stats band).

See README's Engineering Decisions → "Skeleton Loaders for Async Page
Content" for the full rationale.
