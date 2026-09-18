# Handoff: Calendar Page — direction 1a ("Glass")

## Overview
A new **Calendar page** for the Fauxcus task/goal app. It replaces the current `/calendar` route (today a `ComingSoonPage` stub) with a real month/week/day calendar over the app's existing tasks, subtasks and goals.

The page answers three questions at a glance: *what is due when*, *what is overdue*, and *am I keeping my streak*. It is a read-and-triage surface first (scan the month, click a day, see its items) and a light create surface second (click an empty day, or the FAB, to add a task on that date).

Direction **1a "Glass"** was chosen over 1b "Ledger": rounded white day cards on a lilac-grey ground, colored state pills, soft elevation, matching the app's existing glass/gradient chrome.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing the intended look and behavior. They are **not production code to copy directly**.

`Calendar Page.dc.html` is a design-tool file: it renders through a small custom runtime (`support.js`) with a template + logic-class split and inline style objects. Do not try to port that structure. The task is to **recreate this design inside the existing React codebase** (`frontend/`, React + the app's existing component and styling conventions — Tailwind classes and the existing `NavBar`, `Footer`, card and button patterns), using the app's real task/goal data instead of the prototype's hard-coded array.

Where this doc gives an exact hex or px value, match it. Where the codebase already has an equivalent token or component (nav, footer, FAB, starfield hero, deadline color helper), **use the existing one** rather than re-implementing from these values.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, hover/selected states and the interaction model are all final. Recreate pixel-close using existing app components where they exist.

Two things in the prototype are deliberately fake and must become real:
1. The month is pinned to **September 2026** and "today" is hard-coded to 2026-09-10. Real implementation is date-driven.
2. Prev/next month buttons are no-ops in the prototype. They must navigate.

Also note the prototype renders the whole app shell (navbar, hero, footer, FAB) only so the page could be judged in context. **Only the calendar page body is new work** — everything else already exists in the app.

---

## Screens / Views

The page is one route with three view modes (Month / Week / Day) sharing one header, one toolbar and one right-hand rail.

### Page frame

- Page background: `#eceaf1`. Content column `max-width: 1152px`, centered, `padding: 32px 24px 0`.
- Order top to bottom: existing NavBar (64px, `#fafafa`, 1px `rgba(0,0,0,.1)` bottom border, "Calendar" nav pill active) → hero band → toolbar → grid + rail → existing Footer → existing FAB.
- Body font `Lato` (400/700/900); display font `Sora` (400/600/700). Both already loaded by the app.

### 1. Hero band (all views)

- Full-width card, `border-radius: 18px`, `padding: 30px`, background image `starfield-bg-wide.jpg` (`cover`/`center`), `box-shadow: 0 18px 40px -28px rgba(37,37,37,.65)`.
- Overlaid 2px gradient ring border: `linear-gradient(to bottom right,#e0c3fc,#7c5fb0,#8ec5fc)` masked to the edge (the app's existing `.gradient-ring` treatment).
- Left column, flush left:
  - Eyebrow: today's full date, e.g. "Thursday, 10 September 2026" — 11px / 700 / uppercase / `letter-spacing: .12em` / `rgba(255,255,255,.55)`.
  - H1: the period label, e.g. "September 2026" — Sora 44px / 700 / `line-height: 1.05` / `letter-spacing: -.03em` / `#fff`.
  - Sub: "{n} deadlines this month · {n} overdue · {n} completed" — 14px / `rgba(255,255,255,.62)`.
- Right: period nav — 34×34 chevron-left button, "Today" pill (34px tall, `padding: 0 16px`, 13px/700), 34×34 chevron-right. All `border-radius: 10px`, `background: rgba(255,255,255,.1)`, `box-shadow: inset 0 0 0 1px rgba(255,255,255,.18)`, white icon/label; hover `background: rgba(255,255,255,.22)`.
- Stat row: four equal flex cards, `gap: 14px`, each `border-radius: 12px`, `padding: 14px 18px`, `background: rgba(255,255,255,.08)`, `box-shadow: inset 0 0 0 1px rgba(255,255,255,.16)`, `backdrop-filter: blur(6px)`. Value: Sora 26px/700, tabular-nums, white. Label: 11px/700/uppercase/`.07em`/`rgba(255,255,255,.6)`.
  - **Due this month** — count of incomplete, non-goal items in the period.
  - **Overdue** — count with state `overdue`.
  - **Completed** — count with state `done`.
  - **Day streak** — the user's current streak, followed by a 18px filled flame icon in `#fb923c`.

### 2. Toolbar

Row, space-between, `margin-top: 28px`.

- **Left — view segmented control.** Track: `padding: 3px`, `border-radius: 11px`, `background: #f1eff5`, `box-shadow: inset 0 0 0 1px rgba(51,34,74,.08)`. Options "Month", "Week", "Day": `padding: 7px 18px`, `border-radius: 9px`, 13px/700. Active: `background: #fff`, `color: #33224a`, `box-shadow: 0 2px 6px -2px rgba(51,34,74,.3), 0 0 0 1px rgba(51,34,74,.07)`. Inactive: transparent, `color: #8b8794`.
- **Right — status filter chips.** Label "FILTER" (11px/700/uppercase/`.09em`/`#a8a5a0`), then six chips, `gap: 7px`: **All, On track, Due soon, Overdue, Done, Goals** → states `null, progress, urgent, overdue, done, goal`. Chip: `padding: 5px 11px`, `border-radius: 999px`, 12px/700. Inactive: `background: #fff`, `color: #8b8794`, `box-shadow: inset 0 0 0 1px rgba(51,34,74,.1)`. Active: that state's `bg`/`fg`/`bd` from the deadline palette (All active uses `#f1eff5` / `#33224a` / `rgba(51,34,74,.1)`). Single-select, not multi.

### 3. Body layout

`display: grid; grid-template-columns: minmax(0,1fr) 336px; gap: 24px; align-items: start; margin-top: 18px`.
The left column must carry `min-width: 0` — without it the 7-column grid pushes the rail off-frame.

### 4. Month view (default)

- Weekday header: 7-column grid, `gap: 8px`, `margin-bottom: 8px`, labels **Mon…Sun** (week starts Monday), 11px/700/uppercase/`.09em`/`#a8a5a0`, `padding-left: 4px`.
- 5 week rows, each `display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 8px`; rows stacked with `gap: 8px`.
- **Day cell**: `position: relative`, `min-width: 0`, `min-height: 124px`, `padding: 10px 10px 11px`, `border-radius: 13px`, `cursor: pointer`, `transition: transform .15s, box-shadow .15s`.
  - In-month default: `background: #fff`, `box-shadow: inset 0 0 0 1px rgba(51,34,74,.07)`.
  - Out-of-month (leading/trailing days): `background: #f6f5f8`, `opacity: .55`, not interactive.
  - Today: `background: #faf6ff`, `box-shadow: 0 0 0 1.5px #c3a9e8, 0 10px 26px -24px rgba(37,37,37,.5)`.
  - Selected: `box-shadow: 0 0 0 2px #7c5fb0, 0 14px 30px -22px rgba(37,37,37,.6)` (selected wins over today).
  - Hover (in-month): `transform: translateY(-2px)` plus `, 0 14px 30px -24px rgba(37,37,37,.55)` added to the default shadow.
  - Header row inside the cell: date number left, streak flame right (12px, filled `#fb923c`, shown only on days with a completed item and only when streaks are enabled).
  - Date number: Sora 13px/600, tabular-nums, `#33224a` (out-of-month `#b3afbd`). **Today** instead renders as a chip: `min-width: 24px; height: 24px; padding: 0 6px; border-radius: 8px; background: linear-gradient(to bottom right,#7c5fb0,#8ec5fc); color: #fff`, Sora 13px/700.
  - Item pills: column, `gap: 4px`, `margin-top: 8px`. Each pill: `display: flex; align-items: center; gap: 4px; padding: 3px 5px; border-radius: 7px; background: {state.bg}; box-shadow: inset 0 0 0 1px {state.bd}; min-width: 0`. Inside: 6px round dot in `{state.dot}`, then the item name at 11px/700 in `{state.fg}`, `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. **No time chip in month cells** (time appears in peek, panel, week and day views only).
  - Completed items: name gets `text-decoration: line-through` and `opacity: .62` — the pill keeps its green fill.
  - Overflow: max **2** pills at Airy density, **4** at Dense. If more, show "+N more" beneath — `margin-top: 5px`, 11px/700, `#7c5fb0`.
  - **Empty-day hover affordance**: when hovering an in-month day with no items, show "＋ Add task" (11px/700/`#7c5fb0`, 11px plus icon, `margin-top: 6px`). Clicking creates on that date.
  - **Hover peek popover**: when hovering a day whose items exceed the per-cell cap, show a popover — `position: absolute; left: 50%; top: 100%; transform: translate(-50%,8px); width: 238px; z-index: 20; border-radius: 12px; background: #fff; padding: 12px 13px; box-shadow: 0 18px 40px -18px rgba(37,37,37,.55), 0 0 0 1px rgba(51,34,74,.08)`. Title "Wednesday 10 — 5 items" (Sora 12px/600/`#33224a`, `margin-bottom: 8px`), then every item as a row: dot, name (12px `#3f3b46`, ellipsis, struck through if done), time right-aligned (11px/700/`#a8a5a0`, tabular-nums).

### 5. Week view

White card, `border-radius: 16px`, `box-shadow: 0 0 0 1px rgba(51,34,74,.08), 0 18px 40px -34px rgba(37,37,37,.6)`, `overflow: hidden`.

- Header row: `grid-template-columns: 88px repeat(7, minmax(0,1fr))`, `border-bottom: 1px solid #ece9f2`. First cell empty; each day header "Mon 7" at `padding: 11px 10px`, 11px/700/`.04em`, `border-left: 1px solid #ece9f2`, `color: #8b8794` (today `#7c5fb0`), selected column `background: rgba(124,95,176,.07)`.
- Four time bands as rows — **Morning** (before 12:00), **Afternoon** (12:00–16:59), **Evening** (17:00+), **Anytime** (no time set). Row `border-bottom: 1px solid #f2eff6`; label cell `padding: 14px 12px`, 11px/700/uppercase/`.08em`/`#a8a5a0`.
- Band cells: column, `gap: 5px`, `padding: 10px 8px`, `min-height: 62px`, `border-left: 1px solid #f2eff6`, selected column `background: rgba(124,95,176,.05)`. Items use the same state pill as month view.

### 6. Day view

Same white card shell.

- Header: `padding: 20px 22px`, `border-bottom: 1px solid #ece9f2`, baseline space-between. Left: "Thursday, 10 September" (Sora 20px/600/`-.02em`/`#33224a`). Right: "3 items" (12px/700/`#a8a5a0`, singular "1 item").
- Four band rows, `grid-template-columns: 120px 1fr`, `min-height: 76px`, `border-bottom: 1px solid #f2eff6`. Label cell `padding: 18px 22px`, same label style as week.
- Item rows: column, `gap: 7px`, `padding: 14px 22px 16px`. Each row: `display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; background: {state.bg}; box-shadow: inset 0 0 0 1px {state.bd}`. Contents: 6px dot → name (11px/700/`{state.fg}`, struck if done) → kind tag → time (12px/700/`#a8a5a0`, tabular-nums, `margin-left: auto`).
- Kind tag: `padding: 2px 6px; border-radius: 5px; background: {state.bg}; color: {state.fg}`, 10px/900/uppercase/`.06em` — "TASK", "SUBTASK", "GOAL".

### 7. Right rail (336px, all views)

Column, `gap: 14px`. Three cards; first two are white, `border-radius: 16px`, `padding: 18px`, `box-shadow: 0 0 0 1px rgba(51,34,74,.08), 0 18px 40px -34px rgba(37,37,37,.6)`.

**a) Selected day**
- Eyebrow: "Today · selected day" when the selection is today, otherwise "Selected day" — 11px/700/uppercase/`.09em`/`#a8a5a0`.
- Title: "Thursday 10 Sep" — Sora 20px/600/`-.02em`/`#33224a`, `margin-top: 4px`.
- Item list, `gap: 8px`, `margin-top: 14px`. Each: `display: flex; align-items: flex-start; gap: 10px; padding: 10px 11px; border-radius: 11px; background: {state.bg}; box-shadow: inset 0 0 0 1px {state.bd}`.
  - Checkbox: 17×17, `border-radius: 5px`, `margin-top: 1px`. Unchecked `background: #fff`, `box-shadow: inset 0 0 0 1.5px {state.bd}`. Checked `background: #059669`, `box-shadow: inset 0 0 0 1.5px #059669`, white 11px check glyph. This is the **live completion toggle** — it writes back to the task.
  - Name 11px/700/`{state.fg}` (struck + `.62` opacity when done); meta beneath, 11px/700/`#a8a5a0`, format `"{Kind} · {time}"` or `"{Kind} · No time set"`.
- Empty state, when the day has nothing: "Nothing scheduled. A clear day." — 13px/`#8b8794`, `margin-top: 14px`.
- Primary button, full width, `margin-top: 14px`, `padding: 10px 14px`, `border-radius: 11px`, label **flush left** with a 14px plus icon: "Add task on this day". `background: linear-gradient(180deg,#4c3670 0%,#33224a 62%,#2b1c40 100%)`, `box-shadow: inset 0 1px 0 rgba(255,255,255,.42), inset 0 -1px 0 rgba(0,0,0,.18), 0 8px 16px -10px rgba(51,34,74,.7)`, white 13px/700.

**b) Goals landing this month**
- Eyebrow same style: "Goals landing this month".
- Per goal, `gap: 10px`: `border-radius: 12px; background: #f5f8fd; padding: 12px 13px; box-shadow: inset 0 0 0 1px #dbe6f5`. Row 1 baseline space-between: name 13px/700/`#12314b`, percent Sora 13px/600/`#1e488f`/tabular-nums. Row 2: 6px track, `border-radius: 999px`, `background: rgba(30,72,143,.14)`, fill `linear-gradient(to right,#7c5fb0,#8ec5fc)` at the completion %. Row 3 meta: "9 of 11 tasks · ends Sep 18" — 11px/700/`rgba(18,49,75,.6)`.

**c) Streak card**
- `border-radius: 14px`, `padding: 18px`, background image `starfield-bg.jpg` (`cover`/`center`), same gradient-ring border, white text.
- Eyebrow "This week" (11px/700/uppercase/`.09em`/`rgba(255,255,255,.6)`), headline "You're on a 7-day streak." (Sora 20px/600/`-.02em`), sub "2 more due today — keep it going." (12px/`rgba(255,255,255,.6)`). Copy is data-driven.

---

## Interactions & Behavior

- **View switch** — Month/Week/Day swaps the left column only; hero, toolbar, filters, selection and rail persist across the switch.
- **Period nav** — chevrons step the period by the active view's unit (month / week / day). "Today" jumps back to the current date and selects it. The hero H1 and sub-line follow the period.
- **Select a day** — clicking any in-month day cell (month view) or day column header (week view) sets the selection: the cell gets the 2px `#7c5fb0` ring, and the rail's first card re-renders to that day. Selection is independent of "today".
- **Click an empty day** — opens the app's existing create-task flow with the due date prefilled to that day. Same for the rail's "Add task on this day" button and the FAB (FAB prefills the selected day).
- **Hover a day** — 2px lift + shadow; empty in-month days reveal the "＋ Add task" hint; overflowing days reveal the peek popover. Peek should be keyboard-reachable too (focus opens it); suppress it on touch, where tapping the day opens the rail instead.
- **Filter chips** — single-select over deadline state. Filtering changes which pills render in the grid and which items appear in the rail; the hero stat counts stay **unfiltered** (they describe the whole period).
- **Toggle completion** — the rail checkbox completes/uncompletes optimistically: the item switches to the green `done` palette, its name strikes through at `.62` opacity, and the Completed / Due stats update.
- **Completed visibility** — a `showCompleted` preference hides done items from the grid and rail entirely when off (default on).
- **Streak markers** — a `showStreaks` preference toggles the per-day flame (default on). A day earns a flame if it has at least one completed item.
- **Density** — `Airy` (default) shows 2 pills per month cell, `Dense` shows 4. This is the one control worth exposing to users; if you'd rather not ship a setting, hard-code Airy and keep the "+N more" overflow.
- **Transitions** — cell hover `transform`/`box-shadow` at `.15s`; peek popover fades/rises 8px. Respect `prefers-reduced-motion`: disable the lift and the today pulse.
- **Loading** — skeleton the grid as 35 empty cells at the real `min-height: 124px` so the page doesn't reflow; hero stats show dashes.
- **Empty period** — if the period has no items at all, keep the grid (it is a calendar, not a list) and show the rail's "Nothing scheduled. A clear day." copy.
- **Error** — fall back to the app's existing error card pattern in place of the grid; keep hero and nav intact.

### Responsive

The prototype is drawn at 1280px only. Intended breakpoints:
- **≥1200px** — as documented: grid + 336px rail.
- **900–1199px** — rail drops below the grid, full width, its three cards in a row.
- **<900px** — month grid becomes a scrollable list of days (date heading + item rows, reusing the day-view row style), or keep a compact 7-column grid showing dots only (one dot per item, max 3 + "+N") and always open the day in the rail-card style beneath. Hero stats wrap 2×2. Filter chips scroll horizontally. All tap targets ≥44px.

## State Management

Page-local state:
- `view: 'month' | 'week' | 'day'` — default `'month'`.
- `periodAnchor: Date` — the month/week/day being shown; default today.
- `selectedDate: string (YYYY-MM-DD)` — default today.
- `hoveredDate: string | null` — drives lift, add-hint and peek. Clear on mouse leave.
- `filter: 'all' | 'progress' | 'urgent' | 'overdue' | 'done' | 'goal'` — default `'all'`.
- Preferences (persist per user): `density`, `showCompleted`, `showStreaks`.

Derived, memoized on `periodAnchor`:
- Grid = 5 (or 6) week rows of 7 days, **Monday-start**, including leading/trailing out-of-month days.
- `itemsByDate` — items bucketed by ISO date, then filtered by `filter` and `showCompleted`.
- Time bands — Morning `<12:00`, Afternoon `12:00–16:59`, Evening `≥17:00`, Anytime (no time).
- Period stats — due (incomplete, non-goal), overdue, completed, streak.

Data: one fetch per period of tasks, subtasks and goals with a due date inside the visible grid range (including the out-of-month edges), plus the user's streak. Refetch on period change; cache adjacent periods so chevron paging is instant. Completion toggle is an optimistic mutation with rollback on failure.

Deadline **state** should come from the app's existing deadline/urgency helper, not be recomputed here — the prototype's five states map onto it: `progress` (on track), `urgent` (due soon), `overdue`, `done`, `goal` (goals use their own color regardless of urgency).

## Design Tokens

### Deadline state palette (fill / text / border / dot)
| State | bg | fg | border | dot |
| --- | --- | --- | --- | --- |
| progress (on track) | `#f3e8ff` | `#6b46a8` | `#e2d0f5` | `#7c5fb0` |
| urgent (due soon) | `#ffe8e0` | `#9a3412` | `#fca98d` | `#ea580c` |
| overdue | `#fee2e2` | `#b91c1c` | `#fca5a5` | `#b91c1c` |
| done | `#d1fae5` | `#047857` | `#6ee7b7` | `#059669` |
| goal | `#e9f0fb` | `#1e488f` | `#c3d8f2` | `#4f7fd4` |

### Brand / surface
- Page ground `#eceaf1`; card surface `#fff`; today tint `#faf6ff`; out-of-month `#f6f5f8`; segmented track `#f1eff5`.
- Ink: primary `#33224a`, body `#252525` / `#3f3b46`, secondary `#8b8794`, muted `#a8a5a0`, disabled `#b3afbd`.
- Accent purple `#7c5fb0`; deep purple `#33224a`; selected ring `#7c5fb0`; today ring `#c3a9e8`.
- Brand gradient `linear-gradient(to bottom right,#e0c3fc,#7c5fb0,#8ec5fc)`; progress-bar gradient `linear-gradient(to right,#7c5fb0,#8ec5fc)`; dark button gradient `linear-gradient(180deg,#4c3670,#33224a 62%,#2b1c40)`.
- Streak flame `#fb923c`. Goal card `#f5f8fd` on `#dbe6f5`, goal ink `#12314b` / `#1e488f`.
- Hairlines: `#ece9f2` (strong), `#f2eff6` (light), `rgba(51,34,74,.07–.10)` (card edge).

### Type
| Role | Font / size / weight |
| --- | --- |
| Hero H1 | Sora 44 / 700 / lh 1.05 / ls -.03em |
| Card + section title | Sora 20 / 600 / ls -.02em |
| Stat value | Sora 26 / 700 / ls -.02em / tabular-nums |
| Date number | Sora 13 / 600 (today 700) / tabular-nums |
| Eyebrow / label | Lato 11 / 700 / uppercase / ls .07–.12em |
| Body | Lato 13–14 / 400 |
| Pill / item name | Lato 11 / 700 |
| Button | Lato 13 / 700 |
| Kind tag | Lato 10 / 900 / uppercase / ls .06em |

All numerals in stats, dates and times use `font-variant-numeric: tabular-nums`.

### Spacing, radius, shadow
- Spacing steps used: 4, 5, 6, 7, 8, 10, 11, 14, 18, 22, 24, 28, 30, 32 px. Grid gaps 8 (cells) and 24 (grid↔rail).
- Radii: 7 (pill), 8 (today chip), 9 (seg option / day row), 10 (hero button), 11 (seg track / rail item / primary button), 12 (stat + goal card, peek), 13 (day cell), 14 (streak card), 16 (rail + view card), 18 (hero), 999 (chip, dot, track).
- Shadows: card `0 0 0 1px rgba(51,34,74,.08), 0 18px 40px -34px rgba(37,37,37,.6)`; cell edge `inset 0 0 0 1px rgba(51,34,74,.07)`; cell hover `0 14px 30px -24px rgba(37,37,37,.55)`; selected `0 0 0 2px #7c5fb0, 0 14px 30px -22px rgba(37,37,37,.6)`; today `0 0 0 1.5px #c3a9e8, 0 10px 26px -24px rgba(37,37,37,.5)`; peek `0 18px 40px -18px rgba(37,37,37,.55), 0 0 0 1px rgba(51,34,74,.08)`; hero `0 18px 40px -28px rgba(37,37,37,.65)`.
- Focus: every interactive element needs a visible keyboard ring — 2px `#7c5fb0` at `outline-offset: 2px`.

## Assets

All already in the app at `frontend/public` — reuse, don't re-add:
- `starfield-bg-wide.jpg` — hero band and footer.
- `starfield-bg.jpg` — rail streak card and FAB.

Icons are **Lucide**, stroke 2 (heavier for check/plus glyphs): `chevron-left`, `chevron-right`, `plus`, `check`, `flame` (filled `#fb923c`), plus the nav's existing `bell`, `user`, `log-out`.

No new assets are required.

## Files

- `Calendar Page.dc.html` — the design prototype. Direction **1a "Glass"** is the first block in the file (`id="1a"`); 1b "Ledger" below it is the rejected alternative, kept for reference only. The logic class at the bottom holds the `PALETTE` map, the grid builder and every style builder quoted above.
- `support.js` — the prototype's runtime. Reference only; nothing to port.
- `assets/` — copies of the two starfield images the prototype loads.

In the target codebase the work lands as `frontend/src/pages/CalendarPage.jsx` (replacing the `ComingSoonPage` mapping on the `/calendar` route), with the month grid, week grid, day list and the rail as sibling components under it.
