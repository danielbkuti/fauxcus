import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bell, Check, Search } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Footer } from '@/components/Footer'
import { ConfettiBurst } from '@/components/ConfettiBurst'
import { FIRE_PAD, StreakFire } from '@/components/StreakFire'
import { checkEmailExists } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Rebuilt from design_handoff_landing_page/README.md — a type-led,
// glass-surfaced page replacing the old gradient-blob hero and five
// equal icon tiles. Deliberately static: the only motion anywhere on
// this page is `.18s` hover feedback (see .glass-card/.plum-btn/
// .light-btn in index.css) — no scroll reveals, no autoplaying demo.
// The previous cycling-highlight/demo-loop hooks are gone with it.

const TRUST_ITEMS = ['Free to start', 'No card required', 'Nothing to configure']

const SPEC_ROWS = [
  { term: 'Subtasks roll up to the parent', value: 'Automatic' },
  { term: 'Search across tasks and dates', value: 'Live' },
  { term: 'Boards, swimlanes, workflow setup', value: 'None', muted: true },
]

const HOW_STEPS = [
  {
    title: 'Type what needs doing',
    body: 'One field, one line. Add a deadline if it has one — otherwise it just sits in the list.',
  },
  {
    title: 'Break the big ones down',
    body: 'Subtasks turn a vague job into three obvious moves, and roll up as you close them.',
  },
  {
    title: 'Work the top of the list',
    body: "Overdue first, then what's due soonest. Stats and streaks build themselves behind you.",
  },
]

// One instance per email form (hero + closing CTA) — each keeps its
// own state rather than sharing one, so typing in one never touches
// the other. Same checkEmailExists → /login or /signup flow the old
// page used, just restyled; `variant="dark"` is the closing CTA's
// version sitting on the dark plum card instead of the sand page.
function EmailCaptureForm({ variant = 'light', idPrefix }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)
  const dark = variant === 'dark'

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setChecking(true)
    try {
      const { exists } = await checkEmailExists(email)
      navigate(exists ? '/login' : '/signup', { state: { email } })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleSubmit} className="flex max-w-[480px] items-center gap-2.5">
        <label htmlFor={`${idPrefix}-email`} className="sr-only">
          Email address
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          name="email"
          autoComplete="email"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@work.com"
          required
          className={cn(
            'min-w-0 flex-1 rounded-[11px] px-[18px] py-[14px] text-[20px] outline-none focus-visible:ring-2 focus-visible:ring-[#7c5fb0]/50',
            dark
              ? 'bg-white/12 text-white placeholder:text-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,.25),inset_0_0_0_1px_rgba(255,255,255,.16)]'
              : 'bg-white/90 text-[#241a33] placeholder:text-[#241a33]/40 shadow-[inset_0_1px_0_rgba(255,255,255,.9),inset_0_0_0_1px_rgba(51,34,74,.12)]'
          )}
        />
        <button
          type="submit"
          disabled={checking}
          className={cn(
            'shrink-0 px-[22px] py-[15px] text-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c5fb0]/50',
            dark ? 'light-btn' : 'plum-btn'
          )}
        >
          {checking ? (
            'Checking…'
          ) : (
            <>
              Get started
              <ArrowRight className="size-[14px]" strokeWidth={3} aria-hidden="true" />
            </>
          )}
        </button>
      </form>
      {error && (
        <p role="alert" aria-live="polite" className={cn('text-sm', dark ? 'text-red-300' : 'text-destructive')}>
          {error}
        </p>
      )}
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-50 h-[70px] border-b border-[#33224a]/10 bg-[#f0eee9]/78 backdrop-blur-[16px]">
      <div className="mx-auto flex h-full max-w-[1180px] items-center justify-between px-4 sm:px-10">
        {/* This page only ever renders when logged out (App.jsx redirects
            an authenticated visitor away from / entirely), so linking to
            / here is a same-page no-op — kept for consistency with every
            other Logo instance in the app, all of which are real links.
            `sizeScale` shrinks it a bit (same ratio NavBar's own header
            logo uses) — at full size plus "Log in" and the button, a
            375px header had nowhere to give and "Log in" wrapped onto
            its own line, overlapping the logo. */}
        <Link to="/" aria-label="Fauxcus home" className="shrink-0">
          <Logo scale="secondary" sizeScale={0.85} />
        </Link>
        <nav className="hidden items-center gap-[30px] text-sm font-bold text-[#33224a]/68 sm:flex">
          <a
            href="#features"
            className="rounded transition-colors hover:text-[#33224a] focus-visible:ring-2 focus-visible:ring-[#7c5fb0]/50 focus-visible:outline-none"
          >
            Features
          </a>
          <a
            href="#how"
            className="rounded transition-colors hover:text-[#33224a] focus-visible:ring-2 focus-visible:ring-[#7c5fb0]/50 focus-visible:outline-none"
          >
            How it works
          </a>
        </nav>
        <div className="flex shrink-0 items-center gap-2.5 sm:gap-[18px]">
          <Link
            to="/login"
            className="rounded text-sm font-bold whitespace-nowrap text-[#33224a] focus-visible:ring-2 focus-visible:ring-[#7c5fb0]/50 focus-visible:outline-none"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="plum-btn px-3 py-2 text-sm sm:px-[17px] sm:py-[10px] focus-visible:ring-2 focus-visible:ring-[#7c5fb0]/50 focus-visible:outline-none"
          >
            Start free
            <ArrowRight className="size-[14px]" strokeWidth={3} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-10 sm:pt-[104px]">
      <span className="block text-[14px] font-bold tracking-[.18em] text-[#33224a]/50 uppercase">
        Tasks · Subtasks · Deadlines
      </span>
      {/* One line, not the design handoff's deliberate two-line wrap —
          no max-width/text-balance fighting it, and sized down enough
          at each breakpoint to actually fit the phrase on one line
          rather than just hoping it does. */}
      <h1 className="font-display mt-[26px] text-[42px] leading-[.94] font-semibold whitespace-nowrap text-[#241a33] sm:text-[73px] lg:text-[114px]">
        Nothing slips through.
      </h1>
      <div className="mt-11 grid grid-cols-1 items-end gap-12 lg:grid-cols-[1fr_420px] lg:gap-16">
        <div className="flex flex-col gap-[26px]">
          <p className="max-w-[34ch] text-lg leading-[1.5] text-[#241a33]/68 text-pretty sm:text-xl">
            Every task, subtask and deadline in one list. Close the last subtask and the parent
            closes itself.
          </p>
          <EmailCaptureForm idPrefix="hero" />
          <ul className="flex flex-wrap gap-[22px] text-xs font-bold text-[#241a33]/55">
            {TRUST_ITEMS.map((item) => (
              <li key={item} className="flex items-center gap-[7px]">
                <Check className="size-[13px] text-[#56a456]" strokeWidth={3.5} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <dl className="m-0 flex flex-col border-t border-[#33224a]/14">
          {SPEC_ROWS.map((row) => (
            <div
              key={row.term}
              className="flex items-baseline justify-between gap-4 border-b border-[#33224a]/14 py-[13px]"
            >
              <dt className="text-[17px] text-[#241a33]/60">{row.term}</dt>
              <dd
                className={cn(
                  'font-display m-0 text-[17px] font-semibold',
                  row.muted ? 'text-[#241a33]/35' : 'text-[#33224a]'
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

// A static recreation of the real home screen (Dashboard.jsx), not a
// screenshot — this environment has no way to capture and persist an
// actual pixel screenshot as a build asset, and the design handoff's
// own prototype took the same fallback for the same reason: "It was
// built in HTML here because the existing screenshot shows the *old*
// dashboard." Copy/colors/layout are pulled straight from the real
// Dashboard.jsx cards, marked `role="img"` with the interactive-looking
// bits (checkboxes, buttons) `aria-hidden` underneath it — none of it
// is a real control. Swap this whole block for an <img> once a fresh
// 2x screenshot of the real dashboard exists.
function ProductShot() {
  return (
    <section className="mx-auto max-w-[1320px] px-4 pt-12 sm:px-10 sm:pt-[76px]">
      <div
        className="relative rounded-[22px] p-0.5 shadow-[0_44px_90px_-50px_rgba(51,34,74,.6),0_8px_24px_-16px_rgba(51,34,74,.3)]"
        style={{
          background:
            'linear-gradient(150deg, rgba(224,195,252,.9), rgba(124,95,176,.55) 45%, rgba(142,197,252,.9))',
        }}
      >
        <div
          className="overflow-hidden rounded-[20px]"
          style={{ background: 'linear-gradient(180deg,#fbfaf8,#f4f2ee)' }}
        >
          <div className="flex items-center gap-3.5 border-b border-[#33224a]/8 bg-white/70 px-[18px] py-3.5">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-[#33224a]/16" />
              <span className="size-2.5 rounded-full bg-[#33224a]/16" />
              <span className="size-2.5 rounded-full bg-[#33224a]/16" />
            </span>
            <span className="flex flex-1 justify-center">
              <span className="rounded-lg bg-[#33224a]/6 px-4 py-1 text-[14px] font-bold text-[#33224a]/50">
                app.fauxcus.com
              </span>
            </span>
            <span className="hidden w-14 sm:inline" aria-hidden="true" />
          </div>
          <div
            role="img"
            aria-label="Fauxcus dashboard preview: today's Quick start cards for tasks, goals and the calendar, plus an Upcoming list with due-date pills."
            className="px-5 pt-6 pb-8 sm:px-10 sm:pt-[34px] sm:pb-11"
          >
            <div aria-hidden="true">
              <div className="mb-[22px] flex items-baseline justify-between">
                <h2 className="font-display m-0 text-2xl font-semibold text-[#241a33] sm:text-[44px]">
                  Welcome back, Sam
                </h2>
                <span className="hidden text-[17px] text-[#241a33]/45 sm:inline">
                  Thursday, September 3 · 8:57 AM
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div
                  className="flex flex-col justify-between gap-3 rounded-[14px] p-[18px] text-[#33224a] sm:min-h-[186px]"
                  style={{
                    background: 'linear-gradient(160deg,#f2e6ff 0%,#e0c3fc 52%,#c9a5ee 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,.75), inset 0 0 0 1px rgba(255,255,255,.35), inset 0 -18px 34px -22px rgba(0,0,0,.35), 0 16px 30px -20px rgba(124,95,176,.55)',
                  }}
                >
                  <div className="flex items-center justify-between text-[14px] font-bold">
                    <span>Task</span>
                    <span className="font-display font-semibold text-[#33224a]/72 tabular-nums">
                      7 done today
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 rounded-[10px] bg-[#33224a]/9 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-[13px] shrink-0 items-center justify-center rounded-[4px] bg-[#33224a] text-[#e0c3fc]">
                        <Check className="size-[9px]" strokeWidth={4} />
                      </span>
                      <span className="text-[14px] font-bold text-[#33224a]/70 line-through">
                        Draft the outline
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="size-[13px] shrink-0 rounded-[4px] border-[1.5px] border-[#33224a]/45 bg-[#33224a]/10" />
                      <span className="text-[14px] font-bold">Renew passport</span>
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-2.5">
                    <h3 className="font-display m-0 max-w-[110px] text-[22px] font-semibold">
                      Start a new task
                    </h3>
                    <span className="plum-btn px-3 py-2 text-xs">New task</span>
                  </div>
                </div>

                <div
                  className="flex flex-col justify-between gap-3 rounded-[14px] p-[18px] text-white sm:min-h-[186px]"
                  style={{
                    background: 'linear-gradient(160deg,#9b7dcd 0%,#7c5fb0 52%,#684d99 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,.75), inset 0 0 0 1px rgba(255,255,255,.35), inset 0 -18px 34px -22px rgba(0,0,0,.35), 0 16px 30px -20px rgba(124,95,176,.6)',
                  }}
                >
                  <div className="flex items-center justify-between text-[14px] font-bold">
                    <span>Goal</span>
                    <span className="font-display font-semibold text-white/82 tabular-nums">3 active</span>
                  </div>
                  <div className="flex flex-col gap-2 rounded-[10px] bg-black/20 p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[14px] font-bold">Ship v2</span>
                      <span className="font-display text-sm font-semibold tabular-nums">82%</span>
                    </div>
                    <div className="h-[7px] overflow-hidden rounded-full bg-white/25">
                      <span className="block h-full w-[82%] rounded-full bg-white" />
                    </div>
                    <span className="text-[13px] font-bold text-white/80">9 of 11 tasks · ends Sep 30</span>
                  </div>
                  <div className="flex items-end justify-between gap-2.5">
                    <h3 className="font-display m-0 max-w-[110px] text-[22px] font-semibold">
                      Start a new goal
                    </h3>
                    <span className="light-btn px-3 py-2 text-xs">New goal</span>
                  </div>
                </div>

                <div
                  className="flex flex-col justify-between gap-3 rounded-[14px] p-[18px] text-[#12314b] sm:min-h-[186px]"
                  style={{
                    background: 'linear-gradient(160deg,#bcdfff 0%,#8ec5fc 52%,#72b0ef 100%)',
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,.75), inset 0 0 0 1px rgba(255,255,255,.35), inset 0 -18px 34px -22px rgba(0,0,0,.35), 0 16px 30px -20px rgba(142,197,252,.75)',
                  }}
                >
                  <div className="flex items-center justify-between text-[14px] font-bold">
                    <span>Calendar</span>
                    <span className="font-display font-semibold text-[#12314b]/75 tabular-nums">September</span>
                  </div>
                  <div className="flex flex-col gap-2 rounded-[10px] bg-[#12314b]/9 p-3">
                    <div className="grid grid-cols-7 gap-1">
                      {[31, 1, 2, 3, 4, 5, 6].map((d, i) => (
                        <span
                          key={i}
                          className="flex h-5 items-center justify-center rounded-[5px] text-[13px] font-bold"
                          style={d === 3 ? { background: '#12314b', color: '#8ec5fc' } : { background: 'rgba(18,49,75,.1)' }}
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                    <span className="text-[13px] font-bold text-[#12314b]/75">4 due today · 2 tomorrow</span>
                  </div>
                  <div className="flex items-end justify-between gap-2.5">
                    <h3 className="font-display m-0 max-w-[110px] text-[22px] font-semibold">
                      View your calendar
                    </h3>
                    <span
                      className="rounded-[9px] px-3 py-2 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.42),0_8px_16px_-10px_rgba(18,49,75,.7)]"
                      style={{ background: 'linear-gradient(180deg,#22496b,#12314b 62%,#0d2740)' }}
                    >
                      Open
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-[30px] mb-3.5 flex items-center justify-between">
                <h3 className="font-display m-0 text-sm font-semibold tracking-[.02em]">Upcoming</h3>
                <span className="text-xs font-bold text-[#0284c7]">View all tasks →</span>
              </div>
              <div className="flex flex-col gap-2">
                {/* Matches the real Dashboard's UpcomingRow exactly — same
                    14px radius, same gradient ring on every row (not just
                    the first — an earlier pass here only rang the first
                    row, which is what the real page briefly did too
                    before that got reported as looking wrong), same
                    red-for-urgent/purple-for-scheduled pill colors. The
                    real Upcoming list never shows a completed item (they
                    drop out once checked), so all three rows here are
                    open tasks, not a fabricated "done" example. */}
                <div className="relative flex items-center gap-3.5 rounded-[14px] bg-white px-[17px] py-3 shadow-[inset_0_0_0_1px_rgba(37,37,37,.1)]">
                  <span aria-hidden="true" className="task-ring" />
                  <span className="size-[17px] shrink-0 rounded-[5px] border-[1.5px] border-[#e2e0da]" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[17px] font-bold">Draft the outline</span>
                    <span className="text-[14px] text-[#8e8e8e]">Part of Finish the Q3 report</span>
                  </div>
                  <span className="rounded-full bg-[#fef2f2] px-2.5 py-[3px] text-[14px] font-bold text-[#b91c1c]">
                    Due in 03:41:12
                  </span>
                </div>
                <div className="relative flex items-center gap-3.5 rounded-[14px] bg-white px-[17px] py-3 shadow-[inset_0_0_0_1px_rgba(37,37,37,.1)]">
                  <span aria-hidden="true" className="task-ring" />
                  <span className="size-[17px] shrink-0 rounded-[5px] border-[1.5px] border-[#e2e0da]" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[17px] font-bold">Renew passport</span>
                  </div>
                  <span className="rounded-full bg-[#b91c1c] px-2.5 py-[3px] text-[14px] font-bold text-white">
                    Overdue
                  </span>
                </div>
                <div className="relative flex items-center gap-3.5 rounded-[14px] bg-white px-[17px] py-3 shadow-[inset_0_0_0_1px_rgba(37,37,37,.1)]">
                  <span aria-hidden="true" className="task-ring" />
                  <span className="size-[17px] shrink-0 rounded-[5px] border-[1.5px] border-[#e2e0da]" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[17px] font-bold">Book the dentist</span>
                  </div>
                  <span className="rounded-full bg-[#f3e8ff] px-2.5 py-[3px] text-[14px] font-bold text-[#6b46a8]">
                    Sep 24, 2026
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FeatureGrid() {
  const proofSubtasks = ['Pull the numbers', 'Draft the outline', 'Send for review']
  const deadlineRows = [
    { name: 'Prepare client demo', pill: 'Due in 03:41:12', bg: '#fef2f2', color: '#b91c1c' },
    { name: 'Renew passport', pill: 'Overdue', bg: '#b91c1c', color: '#fff' },
    { name: 'Review the PR', pill: 'Sep 12, 2026', bg: '#f3e8ff', color: '#6b46a8' },
  ]

  return (
    <section id="features" className="mx-auto max-w-[1180px] px-6 pt-20 sm:px-10 sm:pt-[112px]">
      <div className="flex flex-col gap-6 border-b border-[#33224a]/14 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="font-display m-0 max-w-[20ch] text-[47px] leading-[1.02] font-semibold sm:text-[68px]">
          Five things it does. Nothing it doesn&apos;t.
        </h2>
        <p className="m-0 max-w-[28ch] text-sm leading-[1.6] text-[#241a33]/60">
          No boards to configure, no workflow to learn. The list keeps itself in order.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[7fr_5fr]">
        <div className="glass-card flex flex-col justify-between gap-7 p-8">
          <div className="flex flex-col gap-3">
            <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">01</span>
            <h3 className="font-display m-0 max-w-[22ch] text-[38px] font-semibold">
              Subtasks that finish the job for you
            </h3>
            <p className="m-0 max-w-[40ch] text-sm leading-[1.6] text-[#241a33]/65">
              Split anything into steps. Tick the last one and the parent marks itself done — no
              bookkeeping, no forgotten open tickets.
            </p>
          </div>
          {/* A real task card, not a stylised proof panel — same
              `rounded-2xl bg-card` shell, `.task-ring` border and
              completion pill TaskCard.jsx itself renders
              (`bg-gradient-to-r from-[#34d399] to-[#059669]`), and the
              same emerald Checkbox for the subtasks under it. A visitor
              who signs up sees exactly this, not a simplified stand-in. */}
          <div className="relative rounded-2xl bg-card p-5 shadow-[0_1px_2px_rgba(37,37,37,.05)]">
            <span aria-hidden="true" className="task-ring" />
            <div className="relative flex items-center gap-3">
              <span className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-r from-[#34d399] to-[#059669] px-3 py-1 text-xs font-semibold text-white sm:px-4 sm:py-1.5 sm:text-sm">
                Completed
              </span>
              <span className="flex-1 truncate text-sm font-semibold text-muted-foreground line-through sm:text-base">
                Finish the Q3 report
              </span>
              <span className="hidden shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 sm:inline">
                All 3 done
              </span>
            </div>
            <div className="relative mt-4 flex flex-col gap-2.5">
              {proofSubtasks.map((label) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-emerald-500 bg-emerald-500 text-white">
                    <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span className="text-sm text-muted-foreground line-through">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass-card flex flex-col justify-between gap-7 p-8">
          <div className="flex flex-col gap-3">
            <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">02</span>
            <h3 className="font-display m-0 max-w-[16ch] text-[38px] font-semibold">
              The deadline lives on the card
            </h3>
            <p className="m-0 text-sm leading-[1.6] text-[#241a33]/65">
              Counting down, due later, or already late — you can see it without opening
              anything.
            </p>
          </div>
          {/* Same due-pill component the real TaskCard/UpcomingRow render
              — red countdown, solid-red overdue, purple "set/plain"
              pill — inside a real card row (14px radius, task-ring),
              not the design handoff's smaller generic tile. */}
          <div className="flex flex-col gap-2.5">
            {deadlineRows.map((row) => (
              <div
                key={row.name}
                className="relative flex items-center justify-between gap-3 rounded-[14px] bg-card px-[14px] py-3 shadow-[0_1px_2px_rgba(37,37,37,.05)]"
              >
                <span aria-hidden="true" className="task-ring" />
                <span className="relative text-[17px] font-bold">{row.name}</span>
                <span
                  className="relative rounded-full px-2.5 py-[3px] text-[14px] font-bold tabular-nums"
                  style={{ background: row.bg, color: row.color }}
                >
                  {row.pill}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="glass-tile flex flex-col gap-3.5 p-[26px]">
          <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">03</span>
          <h3 className="font-display m-0 text-[27px] font-semibold">Find anything fast</h3>
          <p className="m-0 text-[17px] leading-[1.6] text-[#241a33]/65">
            Live search across every task and subtask by name — or type a date and jump to
            what&apos;s due then.
          </p>
          <span className="mt-1 inline-flex w-fit items-center gap-2.5 rounded-full bg-white/95 px-3.5 py-2 shadow-[inset_0_0_0_1px_rgba(51,34,74,.1)]">
            <Search className="size-3.5 text-[#33224a]/45" strokeWidth={2.5} aria-hidden="true" />
            <span className="text-xs font-bold text-[#241a33]/45">sep 12</span>
          </span>
        </div>
        <div className="glass-tile flex flex-col gap-3.5 p-[26px]">
          <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">04</span>
          <h3 className="font-display m-0 text-[27px] font-semibold">Goals with a real bar</h3>
          <p className="m-0 text-[17px] leading-[1.6] text-[#241a33]/65">
            Group tasks under a goal and watch the percentage move as they close. No manual
            status updates.
          </p>
          <div className="mt-1 flex flex-col gap-[7px]">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold">Ship v2</span>
              <span className="font-display text-[17px] font-semibold text-[#7c5fb0] tabular-nums">82%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#33224a]/8">
              <span
                className="block h-full w-[82%] rounded-full"
                style={{ background: 'linear-gradient(90deg,#7c5fb0,#e0c3fc)' }}
              />
            </div>
          </div>
        </div>
        <div className="glass-tile flex flex-col gap-3.5 p-[26px]">
          <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">05</span>
          <h3 className="font-display m-0 text-[27px] font-semibold">Reminders that arrive</h3>
          <p className="m-0 text-[17px] leading-[1.6] text-[#241a33]/65">
            A nudge before a deadline lands, and a gate that makes you deal with overdue work
            before piling on more.
          </p>
          <div className="mt-1 flex items-center gap-2.5 rounded-[11px] bg-white/95 px-[13px] py-[11px] shadow-[inset_0_0_0_1px_rgba(51,34,74,.1)]">
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[7px] bg-[#f5c451]/22 text-[#a3760c]">
              <Bell className="size-3" strokeWidth={2.5} aria-hidden="true" />
            </span>
            <span className="text-xs font-bold text-[#241a33]/70">2 tasks due tomorrow</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// Same emerald Checkbox look TaskCard/UpcomingRow render for a real
// subtask row (`border-input` unchecked, `border-emerald-500
// bg-emerald-500` checked) — not the design handoff's plain outline
// square.
function FilmstripRow({ label, checked }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
          checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-input bg-transparent'
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
      </span>
      <span className={cn('text-sm font-medium', checked && 'text-muted-foreground line-through')}>{label}</span>
    </div>
  )
}

// Frame 3 — the moment the parent closes. Static at rest, same as the
// other two frames (no autoplaying demo, per the design handoff), but
// hovering it replays the real completion celebration: ConfettiBurst
// (the exact component TaskCard.jsx mounts), the card's own
// `animate-flash-emerald` ring, and the checkbox's `animate-check-pop`
// — not a re-drawn approximation of them. `plays` increments on every
// hover-enter and keys the animated pieces so a fresh hover always
// replays from frame 0 instead of only ever firing once.
function ClosingParentFrame() {
  const [plays, setPlays] = useState(0)
  const celebrating = plays > 0

  return (
    <div
      key={plays}
      onMouseEnter={() => setPlays((p) => p + 1)}
      className={cn(
        'relative flex cursor-default flex-col gap-2.5 rounded-2xl bg-card p-5 shadow-[0_1px_2px_rgba(37,37,37,.05)]',
        celebrating && 'animate-flash-emerald'
      )}
    >
      <span aria-hidden="true" className="task-ring" />
      {celebrating && <ConfettiBurst />}
      <div className="relative flex items-center justify-between gap-2.5 border-b pb-2.5">
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-emerald-500 bg-emerald-500 text-white',
              celebrating && 'animate-check-pop'
            )}
          >
            <Check className="size-3" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="text-sm font-medium text-muted-foreground line-through">Finish the Q3 report</span>
        </span>
        <span className="rounded-full bg-[#d1fae5] px-2 py-[3px] text-[13px] font-bold text-[#047857]">done</span>
      </div>
      <div className="relative pl-[26px]">
        <FilmstripRow label="Send for review" checked />
      </div>
    </div>
  )
}

// Static three-frame filmstrip replacing the old page's timer-driven
// demo loop — the design handoff is explicit that this must stay
// static ("there isn't a step four"). Every frame is now the same
// `rounded-2xl bg-card` + `.task-ring` shell TaskCard.jsx itself
// renders, not a bespoke "proof panel" look.
function WatchItWork() {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pt-20 sm:px-10 sm:pt-[112px]">
      <div className="flex flex-col gap-4 border-b border-[#33224a]/14 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="font-display m-0 max-w-[18ch] text-[47px] leading-[1.02] font-semibold sm:text-[68px]">
          Watch it work
        </h2>
        <p className="m-0 max-w-[30ch] text-sm leading-[1.6] text-[#241a33]/60">
          Three ticks, start to finish — hover the last one. This is the whole interaction, there
          isn&apos;t a step four.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-[22px] sm:grid-cols-3">
        <div className="flex flex-col gap-4">
          <div className="relative flex flex-col gap-2.5 rounded-2xl bg-card p-5 shadow-[0_1px_2px_rgba(37,37,37,.05)]">
            <span aria-hidden="true" className="task-ring" />
            <FilmstripRow label="Pull the numbers" checked={false} />
            <FilmstripRow label="Draft the outline" checked={false} />
            <FilmstripRow label="Send for review" checked={false} />
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">01</span>
            <p className="m-0 text-sm leading-[1.55] text-[#241a33]/70">
              <strong className="text-[#241a33]">Three subtasks, one parent.</strong> Added in one
              line each, no fields to fill.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="relative flex flex-col gap-2.5 rounded-2xl bg-card p-5 shadow-[0_1px_2px_rgba(37,37,37,.05)]">
            <span aria-hidden="true" className="task-ring" />
            <FilmstripRow label="Pull the numbers" checked />
            <FilmstripRow label="Draft the outline" checked />
            <FilmstripRow label="Send for review" checked={false} />
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">02</span>
            <p className="m-0 text-sm leading-[1.55] text-[#241a33]/70">
              <strong className="text-[#241a33]">Two down.</strong> The parent&apos;s progress
              moves on its own — nothing to update.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <ClosingParentFrame />
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xs font-semibold tracking-[.14em] text-[#7c5fb0]/85">03</span>
            <p className="m-0 text-sm leading-[1.55] text-[#241a33]/70">
              <strong className="text-[#241a33]">Last tick closes the parent.</strong> The task
              leaves your list without you touching it.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-[1180px] px-6 pt-20 sm:px-10 sm:pt-[112px]">
      <h2 className="font-display m-0 max-w-[20ch] text-[47px] leading-[1.02] font-semibold sm:text-[68px]">
        Set up in about a minute
      </h2>
      <div className="mt-11 grid grid-cols-1 border-t border-[#33224a]/16 sm:grid-cols-3">
        {HOW_STEPS.map((step, i) => (
          <div
            key={step.title}
            className={cn(
              'flex flex-col gap-3.5 py-[30px]',
              i < HOW_STEPS.length - 1 && 'sm:border-r sm:border-[#33224a]/12',
              i === 0 ? 'sm:pr-[34px] sm:pl-0' : i === HOW_STEPS.length - 1 ? 'sm:pr-0 sm:pl-[34px]' : 'sm:px-[34px]'
            )}
          >
            <span className="font-display text-[57px] leading-none font-semibold text-[#33224a]/16 sm:text-[78px]">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="font-display m-0 text-[29px] font-semibold">{step.title}</h3>
            <p className="m-0 text-sm leading-[1.6] text-[#241a33]/65">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// All-invented sample data, same set the design handoff specifies —
// there's no signed-in visitor here to derive real numbers from, and
// the handoff explicitly allows the illustrative sample as long as
// it's clearly marked as one (see the "Example account" tag) rather
// than presented as the visitor's own.
function StatsBand() {
  return (
    <section className="mt-20 text-white sm:mt-[112px]" style={{ background: 'linear-gradient(170deg,#3b2856,#33224a 55%,#271a3a)' }}>
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-14 px-6 py-16 sm:px-10 lg:grid-cols-2 lg:gap-[72px] lg:py-24">
        <div className="flex flex-col gap-[22px]">
          <span className="text-[14px] font-bold tracking-[.18em] text-white/50 uppercase">Progress</span>
          <h2 className="font-display m-0 max-w-[18ch] text-[42px] leading-[1.02] font-semibold sm:text-[68px]">
            Your habits, measured without being asked about
          </h2>
          <p className="m-0 max-w-[38ch] text-base leading-[1.6] text-white/68">
            Completion rate, current streak and the hours you actually get things done — all
            derived from the ticking you&apos;re already doing. No timers, no check-ins, no
            weekly survey.
          </p>
          <Link
            to="/signup"
            className="light-btn mt-1.5 w-fit px-5 py-[13px] text-sm focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
          >
            See your numbers
            <ArrowRight className="size-3.5" strokeWidth={3} aria-hidden="true" />
          </Link>
        </div>

        <div aria-hidden="true" className="flex flex-col gap-2">
          <span className="self-end text-[13px] font-bold tracking-[.1em] text-white/35 uppercase">
            Example account
          </span>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-4 rounded-2xl bg-white/9 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,.28),inset_0_0_0_1px_rgba(255,255,255,.12)] backdrop-blur-[10px] sm:col-span-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-white/60">Completion rate · 30 days</span>
                <span className="font-display text-[57px] leading-none font-semibold tabular-nums sm:text-[68px]">
                  68%
                </span>
                <span className="text-xs text-white/55">124 of 182 tasks closed on time</span>
              </div>
              <div className="flex h-[88px] items-end gap-1.5">
                {[38, 56, 44, 72, 64, 88, 100].map((h, i) => (
                  <span
                    key={i}
                    className="w-[13px] rounded"
                    style={{
                      height: `${h}%`,
                      background: i === 6 ? '#fff' : i === 5 ? '#e0c3fc' : `rgba(224,195,252,${0.5 + i * 0.05})`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className={cn('relative flex flex-col gap-3 overflow-hidden rounded-2xl bg-white/9 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,.28),inset_0_0_0_1px_rgba(255,255,255,.12)] backdrop-blur-[10px]', FIRE_PAD.panel)}>
              <StreakFire streak={7} size="tile" />
              <span className="relative z-[2] text-xs font-bold text-white/60">Current streak</span>
              <span className="relative z-[2] font-display text-[49px] leading-none font-semibold tabular-nums">
                7 days
              </span>
              <div className="relative z-[2] flex gap-[5px]">
                {Array.from({ length: 7 }).map((_, i) => (
                  <span key={i} className="size-3.5 rounded-[5px] bg-[#56a456]" />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl bg-white/9 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,.28),inset_0_0_0_1px_rgba(255,255,255,.12)] backdrop-blur-[10px]">
              <span className="text-xs font-bold text-white/60">Most productive</span>
              <span className="font-display text-[49px] leading-none font-semibold tabular-nums">
                9–11am
              </span>
              <span className="text-xs text-white/55">41% of everything you close</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ClosingCTA() {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pt-20 sm:px-10 sm:pt-[112px]">
      <div
        className="relative overflow-hidden rounded-[24px] p-8 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_34px_70px_-40px_rgba(51,34,74,.8)] sm:p-16"
        style={{ background: 'linear-gradient(150deg,#3b2856,#33224a 52%,#271a3a)' }}
      >
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.15fr_.85fr] lg:gap-[60px]">
          <div className="flex flex-col gap-[18px]">
            <h2 className="font-display m-0 max-w-[16ch] text-[47px] leading-[1.02] font-semibold sm:text-[73px]">
              Start closing things out.
            </h2>
            <p className="m-0 max-w-[36ch] text-base leading-[1.6] text-white/68">
              Free while you try it, no card, and your first task takes about eight seconds.
            </p>
          </div>
          <div className="flex flex-col gap-[14px]">
            <EmailCaptureForm variant="dark" idPrefix="cta" />
            <span className="text-xs text-white/50">
              Already have an account?{' '}
              <Link
                to="/login"
                className="rounded font-bold text-[#e0c3fc] hover:underline focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
              >
                Log in
              </Link>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

// No `overflow-x-hidden` on the root wrapper below (unlike the old
// page) — this design has no negative-offset decorative blobs
// bleeding past the viewport edge that would need it, and
// `overflow-x` on any ancestor of a `position: sticky` element
// quietly breaks the stickiness (it forces `overflow-y: auto` per
// spec, which makes this div itself the sticky containing block
// instead of the viewport) — confirmed live: the header scrolled
// away with the page until this was removed.
export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f0eee9] text-[#241a33]">
      {/* Visually hidden until focused — the one keyboard-only path past
          the sticky header straight to the hero, skipping the nav. */}
      <a
        href="#main-content"
        className="sr-only rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60]"
      >
        Skip to content
      </a>

      <Header />

      <main id="main-content">
        <Hero />
        <ProductShot />
        <FeatureGrid />
        <WatchItWork />
        <HowItWorks />
        <StatsBand />
        <ClosingCTA />
      </main>

      {/* The same component every authenticated page uses, not a
          bespoke landing-page one, so the mark, link columns, and
          starfield ground are identical wherever they appear. */}
      <Footer />
    </div>
  )
}
