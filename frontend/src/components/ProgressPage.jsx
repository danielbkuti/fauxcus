import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useTaskStore } from '@/context/TaskStoreContext'
import { formatDeadline } from '@/lib/utils'
import { computeStats, computePeriodStats, formatDuration, formatPercent } from '@/lib/stats'
import { TaskSearch } from '@/components/TaskSearch'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Rebuilt from design_handoff_progress_page/README.md — replaces the
// old plain-text StatsPanel + small SVG ProgressCharts (both folded
// into this one file and deleted) with a designed dashboard: a
// full-bleed dark stats band up top, a sand-ground chart section below
// it, and the completed-tasks/subtasks archive as hairline rows.
// Nothing new is measured — every figure still comes from stats.js,
// just presented differently. The one new behaviour is the 30/90/all
// period toggle, backed by the new computePeriodStats (see stats.js);
// everything else here reads off the period-independent computeStats
// exactly as StatsPanel/ProgressCharts did.

const DASH = '—'

const PERIODS = [
  { key: '30', days: 30, label: '30 days' },
  { key: '90', days: 90, label: '90 days' },
  { key: 'all', days: null, label: 'All time' },
]

// ---- shared bits -----------------------------------------------------

// The card-header recipe every section below uses: an uppercase
// eyebrow left, a small note right, baseline-aligned. Per the handoff's
// "every card header is the same two-part row" rule.
function CardHead({ eyebrow, note }) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="text-[11px] font-bold tracking-[.14em] text-[#33224a]/50 uppercase">{eyebrow}</span>
      {note && <span className="text-xs text-[#241a33]/45">{note}</span>}
    </div>
  )
}

// "Glass card (light)" recipe from the handoff — same recipe as the
// landing page's `.glass-card` (index.css), reused rather than
// re-derived, just without that class's hover lift (these are static
// content containers, not clickable feature tiles).
function GlassCard({ className, children }) {
  return (
    <section
      className={cn('rounded-[18px] p-7', className)}
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,.97), rgba(255,255,255,.84))',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 1px rgba(51,34,74,.07), inset 0 -26px 44px -30px rgba(51,34,74,.16), 0 20px 44px -30px rgba(51,34,74,.34)',
      }}
    >
      {children}
    </section>
  )
}

// "Light tile" recipe — the two distribution cards.
function LightTile({ className, children }) {
  return (
    <section
      className={cn('rounded-[18px] bg-white/72 p-[26px] shadow-[inset_0_1px_0_rgba(255,255,255,.9),inset_0_0_0_1px_rgba(51,34,74,.07)]', className)}
    >
      {children}
    </section>
  )
}

// "Glass panel (on dark)" recipe — same rgba(255,255,255,.09)/blur(10px)
// treatment the landing page's StatsBand already uses inline; factored
// out here since this page repeats it five times.
function GlassPanel({ className, children }) {
  return (
    <div
      className={cn(
        'rounded-[18px] bg-white/9 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,.28),inset_0_0_0_1px_rgba(255,255,255,.12)] backdrop-blur-[10px]',
        className
      )}
    >
      {children}
    </div>
  )
}

// The shared shape all four small dark panels use: label → 38px figure
// → caption. Current streak swaps its caption for the seven-day strip
// instead (passed as `children`).
function PanelFigure({ label, value, caption, children }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <span className="text-xs font-bold text-white/60">{label}</span>
      <span className="font-display text-[38px] leading-none font-semibold tracking-[-.04em] text-white tabular-nums">
        {value}
      </span>
      {caption && <span className="text-xs text-white/55">{caption}</span>}
      {children}
    </div>
  )
}

function SpecRow({ label, value, valueClassName, last }) {
  return (
    <div
      className="flex items-center justify-between gap-4 py-[13px]"
      style={{
        boxShadow: last
          ? 'inset 0 1px 0 rgba(255,255,255,.14), inset 0 -1px 0 rgba(255,255,255,.14)'
          : 'inset 0 1px 0 rgba(255,255,255,.14)',
      }}
    >
      <span className="text-[13px] text-white/60">{label}</span>
      <span className={cn('font-display text-[13px] font-semibold tabular-nums', valueClassName ?? 'text-white')}>
        {value}
      </span>
    </div>
  )
}

// A rect with only its top two corners rounded — SVG has no per-corner
// `rx`, so bar charts that want a flat baseline (per the handoff) need
// a path instead of a plain <rect>.
function topRoundedRectPath(x, y, w, h, r) {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

// ---- stats band --------------------------------------------------------

function Sparkline({ dailyActivity }) {
  const last7 = dailyActivity.slice(-7)
  const max = Math.max(1, ...last7.map((d) => d.count))
  return (
    <div className="flex flex-col items-center gap-2 sm:items-end">
      <div className="flex h-[88px] items-end gap-1.5">
        {last7.map((d, i) => {
          const pct = Math.max(6, (d.count / max) * 100)
          const isToday = i === last7.length - 1
          const isYesterday = i === last7.length - 2
          const fill = isToday ? '#fff' : isYesterday ? '#e0c3fc' : `rgba(224,195,252,${(0.45 + i * 0.0625).toFixed(2)})`
          return (
            <span
              key={d.date.toISOString()}
              className="w-[14px] rounded"
              style={{ height: `${pct}%`, background: fill }}
              title={`${d.count} closed`}
            />
          )
        })}
      </div>
      <span className="text-[11px] font-bold tracking-[.1em] text-white/55 uppercase">Closed, last 7 days</span>
    </div>
  )
}

// Which of the last 7 calendar days belong to the *current* streak —
// not just "had any completion" (a stray completion five days ago
// isn't part of a streak that's currently sitting at 0), but the
// actual unbroken run computeStreaks counted, walking back from today
// (or yesterday, if today has nothing yet — same anchor rule
// computeStreaks itself uses).
function currentStreakDays(dailyActivity, currentStreak) {
  const days = new Set()
  if (currentStreak === 0) return days
  let endIdx = dailyActivity.length - 1
  if (dailyActivity[endIdx].count === 0) endIdx -= 1
  for (let i = 0; i < currentStreak && endIdx - i >= 0; i++) {
    days.add(dailyActivity[endIdx - i].date.toDateString())
  }
  return days
}

function StatsBand({ stats, periodStats, period, onPeriodChange }) {
  const { overview, habits } = stats
  const periodLabel = PERIODS.find((p) => p.key === period).label
  const last7 = habits.dailyActivity.slice(-7)
  const streakDays = currentStreakDays(habits.dailyActivity, habits.currentStreak)

  const bestTime = habits.bestTimeOfDay
  const timeMatch = bestTime?.label.match(/^(.+?)\s*\(([^)]+)\)$/)
  const totalTimeCompletions = habits.bestTimeDistribution.reduce((sum, d) => sum + d.count, 0)

  function handleKeyDown(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const idx = PERIODS.findIndex((p) => p.key === period)
    const dir = e.key === 'ArrowRight' ? 1 : -1
    onPeriodChange(PERIODS[(idx + dir + PERIODS.length) % PERIODS.length].key)
  }

  return (
    <section className="text-white" style={{ background: 'linear-gradient(170deg,#3b2856,#33224a 55%,#271a3a)' }}>
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-14 px-6 py-16 sm:px-10 lg:grid-cols-[440px_1fr] lg:items-start lg:gap-16 lg:py-[84px]">
        <div className="flex flex-col gap-5">
          <span className="text-[11px] font-bold tracking-[.18em] text-white/50 uppercase">Progress</span>
          <h1 className="font-display m-0 max-w-[16ch] text-[36px] leading-[1.02] font-semibold tracking-[-.045em] text-balance sm:text-[52px]">
            Counted while you worked.
          </h1>
          <p className="m-0 max-w-[36ch] text-base leading-[1.6] text-white/68">
            Every number here is folded out of the ticks you&apos;ve already made. No timers, no
            check-ins, nothing to keep up to date.
          </p>

          <div role="tablist" aria-label="Time period" className="flex gap-2" onKeyDown={handleKeyDown}>
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                tabIndex={period === p.key ? 0 : -1}
                onClick={() => onPeriodChange(p.key)}
                className={cn(
                  'rounded-[11px] px-4 py-[9px] text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                  period === p.key ? 'bg-[#f0eee9] text-[#33224a]' : 'bg-white/9 text-white/72'
                )}
                style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.28), inset 0 0 0 1px rgba(255,255,255,.12)' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-1 flex flex-col">
            <SpecRow label="Still open" value={`${overview.openCount} tasks`} />
            <SpecRow label="Overdue" value={`${overview.overdueCount} tasks`} valueClassName="text-[#fca5a5]" />
            <SpecRow label="Longest streak" value={`${habits.longestStreak} days`} />
            <SpecRow
              label="Subtasks closed"
              value={`${overview.subtaskCompleted} / ${overview.subtaskTotal}`}
              last
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <GlassPanel className="flex flex-col gap-6 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-white/60">Completion rate · {periodLabel}</span>
              <span className="font-display text-[60px] leading-none font-semibold tracking-[-.045em] tabular-nums">
                {periodStats.completionRate != null ? formatPercent(periodStats.completionRate) : DASH}
              </span>
              <span className="text-xs text-white/55">
                {periodStats.completionRate != null
                  ? `${periodStats.completedCount} of ${periodStats.eligibleCount} tasks closed`
                  : 'Not enough data yet'}
              </span>
            </div>
            <Sparkline dailyActivity={habits.dailyActivity} />
          </GlassPanel>

          <GlassPanel>
            <PanelFigure label="Current streak" value={`${habits.currentStreak} day${habits.currentStreak === 1 ? '' : 's'}`}>
              <div className="mt-1 flex gap-[5px]">
                {last7.map((d) => (
                  <span
                    key={d.date.toISOString()}
                    className="size-3.5 rounded-[5px]"
                    style={{ background: streakDays.has(d.date.toDateString()) ? '#56a456' : 'rgba(255,255,255,.14)' }}
                    title={d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  />
                ))}
              </div>
            </PanelFigure>
          </GlassPanel>

          <GlassPanel>
            <PanelFigure
              label="Most productive"
              value={bestTime ? `${(timeMatch ? timeMatch[1] : bestTime.label).replace(/^\w/, (c) => c.toUpperCase())}s` : DASH}
              caption={
                bestTime
                  ? `${timeMatch ? timeMatch[2] : ''} · ${formatPercent((bestTime.count / totalTimeCompletions) * 100)} of everything you close`
                  : 'Not enough data yet'
              }
            />
          </GlassPanel>

          <GlassPanel>
            <PanelFigure
              label="On time"
              value={periodStats.onTimeRate != null ? formatPercent(periodStats.onTimeRate) : DASH}
              caption={
                periodStats.datedCompletionCount > 0
                  ? `of ${periodStats.datedCompletionCount} with a deadline`
                  : 'Not enough data yet'
              }
            />
          </GlassPanel>

          <GlassPanel>
            <PanelFigure
              label="Typical turnaround"
              value={periodStats.avgCompletionMs != null ? formatDuration(periodStats.avgCompletionMs) : DASH}
              caption={
                periodStats.avgLeadMs != null
                  ? `created → closed · ${formatDuration(Math.abs(periodStats.avgLeadMs))} ${periodStats.avgLeadMs >= 0 ? 'ahead' : 'behind'} vs deadline`
                  : 'created → closed'
              }
            />
          </GlassPanel>
        </div>
      </div>
    </section>
  )
}

// ---- charts section ------------------------------------------------------

function WeeklyActivityChart({ weekly }) {
  const maxVal = Math.max(1, ...weekly.flatMap((w) => [w.created, w.completed]))
  const niceMax = Math.max(4, Math.ceil(maxVal / 4) * 4)
  const gridVals = [0, niceMax / 3, (niceMax * 2) / 3, niceMax]

  const plotH = 168
  const chartH = plotH + 24
  const groupW = 130
  const barW = 30
  const gap = 8
  const totalW = groupW * weekly.length

  function barHeight(v) {
    return v === 0 ? 0 : Math.max(3, (v / niceMax) * plotH)
  }

  return (
    <GlassCard>
      <CardHead eyebrow="Weekly activity" note={`Last ${weekly.length} weeks`} />
      <div className="flex gap-2">
        <div className="flex flex-col justify-between py-0 text-right text-[10px] font-bold text-[#241a33]/32" style={{ height: plotH }}>
          {[...gridVals].reverse().map((v) => (
            <span key={v}>{Math.round(v)}</span>
          ))}
        </div>
        <svg viewBox={`0 0 ${totalW} ${chartH}`} className="w-full" style={{ height: chartH }} role="img" aria-label="Tasks created versus completed per week">
          {gridVals.map((v) => {
            const y = plotH - (v / niceMax) * plotH
            return (
              <line
                key={v}
                x1="0"
                y1={y}
                x2={totalW}
                y2={y}
                stroke="rgba(51,34,74,.08)"
                strokeWidth={v === 0 ? 1.5 : 1}
                style={v === 0 ? { stroke: 'rgba(51,34,74,.2)' } : undefined}
              />
            )
          })}
          {weekly.map((w, i) => {
            const cx = i * groupW + groupW / 2
            const createdH = barHeight(w.created)
            const completedH = barHeight(w.completed)
            const createdX = cx - barW - gap / 2
            const completedX = cx + gap / 2
            return (
              <g key={w.label}>
                <path d={topRoundedRectPath(createdX, plotH - createdH, barW, createdH, 7)} fill="rgba(51,34,74,.2)" />
                {w.created > 0 && (
                  <text x={createdX + barW / 2} y={plotH - createdH + 15} textAnchor="middle" className="font-display" style={{ fontSize: 11, fontWeight: 600, fill: 'rgba(36,26,51,.6)' }}>
                    {w.created}
                  </text>
                )}
                <path d={topRoundedRectPath(completedX, plotH - completedH, barW, completedH, 7)} fill="url(#weeklyClosedGradient)" />
                {w.completed > 0 && (
                  <text x={completedX + barW / 2} y={plotH - completedH + 15} textAnchor="middle" className="font-display" style={{ fontSize: 11, fontWeight: 600, fill: '#fff' }}>
                    {w.completed}
                  </text>
                )}
                <text x={cx} y={chartH - 4} textAnchor="middle" style={{ fontSize: 12, fill: 'rgba(36,26,51,.5)' }}>
                  {w.label}
                </text>
              </g>
            )
          })}
          <defs>
            <linearGradient id="weeklyClosedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6cb96c" />
              <stop offset="60%" stopColor="#56a456" />
              <stop offset="100%" stopColor="#4a9149" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="mt-4 flex items-center gap-4 text-xs font-bold">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: '#56a456' }} />
          <span className="text-[#241a33]/70">Closed</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: 'rgba(51,34,74,.22)' }} />
          <span className="text-[#241a33]/70">Created</span>
        </span>
      </div>
    </GlassCard>
  )
}

function OverviewStackedBar({ overview }) {
  const { totalTasks, completedCount, overdueCount } = overview
  const openOnTrack = Math.max(0, overview.openCount - overdueCount)

  const segments = [
    { key: 'completed', label: 'Completed', count: completedCount, gradient: 'linear-gradient(180deg,#6cb96c,#56a456 60%,#4a9149)' },
    { key: 'open', label: 'Open', count: openOnTrack, gradient: 'linear-gradient(180deg,#9a7fc4,#7c5fb0 60%,#6b4fa0)' },
    { key: 'overdue', label: 'Overdue', count: overdueCount, gradient: 'linear-gradient(180deg,#d94a4a,#b91c1c)', textClass: 'text-[#b91c1c]' },
  ]

  return (
    <GlassCard className="flex flex-col">
      <CardHead eyebrow="Where it all stands" note={`${totalTasks} tasks`} />
      {totalTasks === 0 ? (
        <p className="text-sm text-[#241a33]/50">Nothing to show yet.</p>
      ) : (
        <>
          <div className="flex flex-1 flex-col justify-center gap-4">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[46px] leading-none font-semibold tracking-[-.04em]">
                {formatPercent(overview.completionRate)}
              </span>
              <span className="text-[13px] text-[#241a33]/55">closed</span>
            </div>
            <div
              className="flex h-[18px] gap-[3px] rounded-full p-0.5"
              style={{ background: 'rgba(51,34,74,.06)', boxShadow: 'inset 0 1px 2px rgba(51,34,74,.14)' }}
              role="img"
              aria-label="Task status breakdown"
            >
              {segments
                .filter((s) => s.count > 0)
                .map((s) => (
                  <span
                    key={s.key}
                    style={{ flexGrow: s.count, flexBasis: 0, minWidth: 5, background: s.gradient }}
                    className="rounded-full"
                  />
                ))}
            </div>
            <div className="flex flex-col">
              {segments.map((s, i) => (
                <div
                  key={s.key}
                  className="flex items-baseline justify-between gap-4 py-[13px]"
                  style={{ boxShadow: i < segments.length - 1 ? 'inset 0 -1px 0 rgba(51,34,74,.1)' : undefined }}
                >
                  <span className="flex items-center gap-2 text-[13px] text-[#241a33]/75">
                    <span className="size-2.5 rounded-[3px]" style={{ background: s.gradient }} />
                    {s.label}
                  </span>
                  <span className={cn('font-display text-sm font-semibold tabular-nums', s.textClass)}>
                    {s.count}{' '}
                    <span className="font-sans font-normal text-[#241a33]/45">
                      ({totalTasks > 0 ? Math.round((s.count / totalTasks) * 100) : 0}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {overdueCount > 0 && (
            <Link
              to="/tasks"
              state={{ filter: 'overdue' }}
              className="group mt-auto flex items-center gap-2 pt-4 text-[13px] font-bold text-[#33224a] transition-[gap] duration-150 hover:gap-[11px]"
            >
              Open the {overdueCount} overdue
              <ArrowRight className="size-3.5" strokeWidth={3} aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </GlassCard>
  )
}

const HEAT_LEVEL_FILL = [
  'rgba(51,34,74,.07)',
  'linear-gradient(155deg,rgba(224,195,252,.85),rgba(124,95,176,.34))',
  'linear-gradient(155deg,rgba(224,195,252,.95),rgba(124,95,176,.6))',
  'linear-gradient(155deg,#e0c3fc,rgba(124,95,176,.9))',
  'linear-gradient(155deg,#c9a5f2,#7c5fb0 60%,#6b4fa0)',
]
const WEEKDAY_GUTTER = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

function heatLevel(count) {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count <= 4) return 3
  return 4
}

function DailyHeatmap({ dailyActivity }) {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])

  // Monday-start rows: pad the front so the grid's true weekday
  // alignment is preserved (see the handoff's explicit note on this).
  const leadPad = (dailyActivity[0].date.getDay() + 6) % 7
  const cells = [
    ...Array.from({ length: leadPad }, () => null),
    ...dailyActivity,
  ]
  const cols = Math.ceil(cells.length / 7)
  const activeDays = dailyActivity.filter((d) => d.count > 0).length

  const monthLabels = []
  let lastMonth = null
  for (let col = 0; col < cols; col++) {
    const cell = cells[col * 7]
    if (!cell) {
      monthLabels.push(null)
      continue
    }
    const month = cell.date.getMonth()
    if (month !== lastMonth) {
      monthLabels.push(cell.date.toLocaleDateString(undefined, { month: 'short' }))
      lastMonth = month
    } else {
      monthLabels.push(null)
    }
  }

  return (
    <GlassCard>
      <CardHead eyebrow="Daily activity" note={`${activeDays} active days in 12 weeks`} />
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-3.5" style={{ width: 'fit-content' }}>
          <div className="flex flex-col justify-between pt-[17px]" style={{ width: 26, gap: 4 }}>
            {WEEKDAY_GUTTER.map((label, i) => (
              <span key={i} className="flex h-[13px] items-center text-[10px] font-bold text-[#241a33]/40">
                {label}
              </span>
            ))}
          </div>
          <div>
            <div className="mb-1.5 flex" style={{ gap: 4 }}>
              {monthLabels.map((label, i) => (
                <span key={i} className="text-[10px] font-bold tracking-[.1em] text-[#241a33]/38 uppercase" style={{ width: 13 }}>
                  {label}
                </span>
              ))}
            </div>
            <div className="grid grid-flow-col" style={{ gridTemplateRows: 'repeat(7, 13px)', gap: 4 }}>
              {cells.map((d, i) => {
                if (!d) return <span key={`pad-${i}`} className="size-[13px]" />
                const level = heatLevel(d.count)
                const isToday = d.date.getTime() === today
                return (
                  <span
                    key={d.date.toISOString()}
                    title={d.count > 0 ? `${d.count} closed` : 'Nothing closed'}
                    className="size-[13px] rounded-[4px] transition-transform duration-150 hover:scale-[1.35]"
                    style={{
                      background: HEAT_LEVEL_FILL[level],
                      boxShadow: isToday
                        ? '0 0 0 2px #f0eee9, 0 0 0 3.5px #33224a'
                        : level === 0
                          ? 'inset 0 1px 1px rgba(51,34,74,.1)'
                          : level === 4
                            ? 'inset 0 1px 0 rgba(255,255,255,.45), 0 3px 7px -3px rgba(124,95,176,.7)'
                            : 'inset 0 1px 0 rgba(255,255,255,.55)',
                    }}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[52ch] text-[13px] leading-[1.55] text-[#241a33]/60">
          The ringed square is today. An unbroken run of filled squares up to it is the current
          streak.
        </p>
        <div className="flex items-center gap-[7px] text-[11px] font-bold text-[#241a33]/45">
          Less
          {HEAT_LEVEL_FILL.map((fill, i) => (
            <span key={i} className="size-2.5 rounded-[2px]" style={{ background: fill }} />
          ))}
          More
        </div>
      </div>
    </GlassCard>
  )
}

// habits.bestDayDistribution labels are the WEEKDAY_SHORT abbreviations
// (stats.js) — fine as bar-chart labels, but "Weds win" reads as a
// typo, not a pluralized "Wed". Full weekday names, pluralized, for
// the note only.
const WEEKDAY_PLURAL = {
  Sun: 'Sundays',
  Mon: 'Mondays',
  Tue: 'Tuesdays',
  Wed: 'Wednesdays',
  Thu: 'Thursdays',
  Fri: 'Fridays',
  Sat: 'Saturdays',
}

function DayOfWeekDistribution({ data }) {
  const maxVal = Math.max(1, ...data.map((d) => d.count))
  const bestIndex = data.reduce((bi, d, i) => (d.count > data[bi].count ? i : bi), 0)
  const hasAny = data.some((d) => d.count > 0)
  const trackH = 112

  return (
    <LightTile>
      <CardHead
        eyebrow="By day of week"
        note={hasAny ? `${WEEKDAY_PLURAL[data[bestIndex].label] ?? data[bestIndex].label} win` : undefined}
      />
      <div className="grid grid-cols-7 gap-2.5">
        {data.map((d, i) => {
          const isBest = hasAny && i === bestIndex && d.count > 0
          const h = hasAny ? Math.max(3, (d.count / maxVal) * trackH) : 0
          return (
            <div key={d.label} className="flex flex-col items-center gap-1.5">
              <span className={cn('font-display text-xs font-semibold tabular-nums', isBest ? 'text-[#33224a]' : 'text-[#241a33]/70')}>
                {d.count}
              </span>
              <svg width="100%" height={trackH} viewBox={`0 0 32 ${trackH}`} preserveAspectRatio="none" className="w-full">
                <rect x="0" y="0" width="32" height={trackH} rx="7" fill="rgba(51,34,74,.045)" />
                <path
                  d={topRoundedRectPath(0, trackH - h, 32, h, 7)}
                  fill={isBest ? 'url(#dayPeakGradient)' : `rgba(124,95,176,${(0.36 + (d.count / maxVal) * 0.44).toFixed(2)})`}
                />
                <defs>
                  <linearGradient id="dayPeakGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c9a5f2" />
                    <stop offset="62%" stopColor="#7c5fb0" />
                    <stop offset="100%" stopColor="#6b4fa0" />
                  </linearGradient>
                </defs>
              </svg>
              <span className={cn('text-[11px] font-bold', isBest ? 'text-[#33224a]' : 'text-[#241a33]/55')}>
                {d.label}
              </span>
            </div>
          )
        })}
      </div>
    </LightTile>
  )
}

function TimeOfDayDistribution({ data }) {
  const maxVal = Math.max(1, ...data.map((d) => d.count))
  const bestIndex = data.reduce((bi, d, i) => (d.count > data[bi].count ? i : bi), 0)
  const hasAny = data.some((d) => d.count > 0)

  return (
    <LightTile>
      <CardHead eyebrow="By time of day" note={hasAny ? 'Peak highlighted' : undefined} />
      <div className="flex flex-col gap-3.5">
        {data.map((d, i) => {
          const isBest = hasAny && i === bestIndex && d.count > 0
          const pct = hasAny ? Math.max(2, (d.count / maxVal) * 100) : 0
          return (
            <div key={d.label} className="flex items-center gap-3.5">
              <span className={cn('w-[82px] shrink-0 text-xs font-bold', isBest ? 'text-[#33224a]' : 'text-[#241a33]/65')}>
                {d.label}
              </span>
              <div
                className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-full"
                style={{ background: 'rgba(51,34,74,.06)', boxShadow: 'inset 0 1px 2px rgba(51,34,74,.13)' }}
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: isBest ? 'linear-gradient(90deg,#e0c3fc,#7c5fb0 70%,#6b4fa0)' : 'rgba(124,95,176,.28)',
                    boxShadow: isBest ? '0 8px 16px -10px rgba(124,95,176,.9)' : undefined,
                  }}
                />
              </div>
              <span className={cn('font-display w-[34px] shrink-0 text-right text-xs font-semibold tabular-nums', isBest ? 'text-[#33224a]' : 'text-[#241a33]/65')}>
                {d.count}
              </span>
            </div>
          )
        })}
      </div>
    </LightTile>
  )
}

// ---- archive section ------------------------------------------------------

function ArchiveColumn({ eyebrow, items, renderRow, emptyLabel }) {
  const [expanded, setExpanded] = useState(false)
  const CAP = 10
  const visible = expanded ? items : items.slice(0, CAP)

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold tracking-[.14em] text-[#33224a]/50 uppercase">
          {eyebrow} · {items.length}
        </span>
        {items.length > CAP && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs font-bold text-[#33224a] hover:underline"
          >
            {expanded ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-sm text-[#241a33]/45">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col">{visible.map(renderRow)}</div>
      )}
    </div>
  )
}

function ArchiveRow({ to, title, subtitle, timestamp }) {
  return (
    <Link
      key={to + title}
      to={to}
      className="group flex items-baseline justify-between gap-5 py-[15px] transition-[padding-left] duration-150 hover:pl-1.5"
      style={{ boxShadow: 'inset 0 -1px 0 rgba(51,34,74,.12)' }}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-[#241a33]">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-[#241a33]/50">{subtitle}</span>}
      </span>
      <span className="shrink-0 text-xs text-[#241a33]/50 tabular-nums">{timestamp}</span>
    </Link>
  )
}

// ---- page ------------------------------------------------------------

export function ProgressPage() {
  const { tasks, status } = useTaskStore()
  const [period, setPeriod] = useState('30')

  const stats = useMemo(() => computeStats(tasks), [tasks])
  const periodStats = useMemo(
    () => computePeriodStats(tasks, PERIODS.find((p) => p.key === period).days),
    [tasks, period]
  )

  if (status === 'loading') {
    // Mirrors the real page's two bands — the dark stats gradient up
    // top, the light chart/archive section below — so loading doesn't
    // just look like an empty white page before the two sections'
    // very different backgrounds paint in.
    return (
      <div>
        <section className="text-white" style={{ background: 'linear-gradient(170deg,#3b2856,#33224a 55%,#271a3a)' }}>
          <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-14 px-6 py-16 sm:px-10 lg:grid-cols-[440px_1fr] lg:items-start lg:gap-16 lg:py-[84px]">
            <div className="flex flex-col gap-5">
              <Skeleton className="h-3 w-20 rounded-full bg-white/20" />
              <Skeleton className="h-10 w-full max-w-[16ch] rounded-2xl bg-white/15" />
              <div className="mt-2 flex flex-col gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-4 w-full rounded-full bg-white/10" />
                ))}
              </div>
            </div>
            <Skeleton className="h-[160px] w-full rounded-2xl bg-white/10" />
          </div>
        </section>
        <section style={{ background: '#f0eee9' }} className="mx-auto max-w-[1180px] px-6 pt-16 pb-[104px] sm:px-10 sm:pt-[88px]">
          <Skeleton className="h-9 w-64 max-w-full rounded-2xl" />
          <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Skeleton className="h-[220px] w-full rounded-2xl" />
            <Skeleton className="h-[220px] w-full rounded-2xl" />
          </div>
        </section>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <p className="text-sm text-destructive">Couldn&apos;t load your progress.</p>
      </div>
    )
  }

  const completedTasks = tasks
    .filter((t) => t.completed)
    .sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted))

  const completedSubtasks = tasks
    .flatMap((t) => t.subtasks.filter((s) => s.completed).map((s) => ({ ...s, parentTask: t })))
    .sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted))

  const nothingCompleted = completedTasks.length === 0 && completedSubtasks.length === 0
  const hasWeeklyActivity = stats.weekly.some((w) => w.created > 0 || w.completed > 0)
  const hasHabitData = stats.habits.dailyActivity.some((d) => d.count > 0)

  return (
    <div style={{ background: '#f0eee9' }}>
      {tasks.length > 0 && (
        <StatsBand stats={stats} periodStats={periodStats} period={period} onPeriodChange={setPeriod} />
      )}

      {tasks.length > 0 && (
        <section className="mx-auto max-w-[1180px] px-6 pt-16 sm:px-10 sm:pt-[88px]">
          <div className="flex flex-col gap-3 border-b border-[#33224a]/14 pb-[26px] sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-display m-0 max-w-[22ch] text-[28px] leading-[1.04] font-semibold tracking-[-.04em] sm:text-[40px]">
              How the weeks actually go
            </h2>
            <p className="m-0 max-w-[30ch] text-sm leading-[1.6] text-[#241a33]/60">
              What got created versus what actually closed, week by week.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[7fr_5fr]">
            {hasWeeklyActivity ? <WeeklyActivityChart weekly={stats.weekly} /> : <div />}
            <OverviewStackedBar overview={stats.overview} />
          </div>

          {hasHabitData && (
            <>
              <div className="mt-5">
                <DailyHeatmap dailyActivity={stats.habits.dailyActivity} />
              </div>
              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <DayOfWeekDistribution data={stats.habits.bestDayDistribution} />
                <TimeOfDayDistribution data={stats.habits.bestTimeDistribution} />
              </div>
            </>
          )}
        </section>
      )}

      <section className="mx-auto max-w-[1180px] px-6 pt-16 pb-[104px] sm:px-10 sm:pt-[88px]">
        <div className="flex flex-col gap-4 border-b border-[#33224a]/14 pb-[26px] sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-display m-0 text-[28px] leading-[1.04] font-semibold tracking-[-.04em] sm:text-[40px]">
            Everything you&apos;ve closed
          </h2>
          <div className="w-full sm:w-[340px]">
            <TaskSearch />
          </div>
        </div>

        {nothingCompleted ? (
          <p className="pt-6 text-sm text-[#241a33]/50">
            Nothing completed yet — finished tasks and subtasks will show up here.
          </p>
        ) : (
          <div className="mt-[34px] grid grid-cols-1 gap-14 sm:grid-cols-2">
            <ArchiveColumn
              eyebrow="Tasks"
              items={completedTasks}
              emptyLabel="No completed tasks yet."
              renderRow={(task) => (
                <ArchiveRow
                  key={task.id}
                  to={`/tasks/${task.id}`}
                  title={task.name}
                  timestamp={task.dateCompleted ? formatDeadline(task.dateCompleted) : 'Completed'}
                />
              )}
            />
            <ArchiveColumn
              eyebrow="Subtasks"
              items={completedSubtasks}
              emptyLabel="No completed subtasks yet."
              renderRow={(subtask) => (
                <ArchiveRow
                  key={subtask.id}
                  to={`/tasks/${subtask.parentTask.id}`}
                  title={subtask.name}
                  subtitle={`Part of ${subtask.parentTask.name}`}
                  timestamp={subtask.dateCompleted ? formatDeadline(subtask.dateCompleted) : 'Completed'}
                />
              )}
            />
          </div>
        )}
      </section>
    </div>
  )
}
