import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import '@/lib/starfield-8bit.js'

// Dashboard Quick start · design "1a Night cartridge" with the 3a icon mix
// (quickstart-1a export). Starfield cards with stepped-pixel corners and
// 8-bit hover animations. Styles and keyframes live in index.css (.qs-*).

const PX = {
  clipboard: ['...#####...', '.###+++###.', '.#.#####.#.', '.#.......#.', '.#.++.--.#.', '.#.......#.', '.#.++.--.#.', '.#.......#.', '.#.++.--.#.', '.#.......#.', '.#########.'],
  trophy: ['..#######..', '-.#+#####.-', '-.#+#####.-', '.-#+#####-.', '...#####...', '....###....', '.....#.....', '.....#.....', '...#####...', '..-------..', '...........'],
  page7: ['..-.....-..', '###########', '###########', '#.........#', '#..#####..#', '#......#..#', '#.....#...#', '#....#....#', '#....#....#', '#.........#', '###########'],
  arrow: ['....#..', '....##.', '#######', '....##.', '....#..'],
  check: ['....#', '...##', '#.##.', '.##..', '..#..'],
}

// '#' = color, '+' = white highlight, '-' = half-tone shade, '.' = empty
export function PixelIcon({ name, color, scale = 2 }) {
  const rows = PX[name]
  const w = rows[0].length
  const h = rows.length
  return (
    <svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} fill={color}
      shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      {rows.flatMap((r, y) => [...r].map((ch, x) => ch === '.' ? null : (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1"
          fill={ch === '+' ? '#ffffff' : undefined} fillOpacity={ch === '-' ? 0.5 : undefined} />
      )))}
    </svg>
  )
}

const THEMES = {
  task: { border: '#e0c3fc', ink: '#e0c3fc', btnShade: '#a88be0', seed: 21 },
  goal: { border: '#a88be0', ink: '#c9b8ff', btnShade: '#7c5fb0', seed: 57 },
  cal: { border: '#8ec5fc', ink: '#8ec5fc', btnShade: '#3a7bd5', seed: 93 },
}

function Card({ to, kind, icon, label, meta, title, cta, children }) {
  const t = THEMES[kind]
  const sky = useRef(null)
  return (
    <Link to={to} className="qs-card" style={{ '--qs-border': t.border, '--qs-ink': t.ink, '--qs-shade': t.btnShade }}
      onMouseEnter={() => sky.current?.shoot?.()} onFocus={() => sky.current?.shoot?.()}>
      <div className="qs-card-inner">
        {/* Shooting stars only on hover/focus: the element's own timer is
            pushed out to a day, the same trick Starfield.jsx uses. */}
        <starfield-8bit ref={sky} aria-hidden="true" pixel-size="4" seed={t.seed}
          first-delay="86400" interval="86400" class="qs-sky" />
        <div className="qs-head">
          <span className="qs-label"><PixelIcon name={icon} color={t.ink} />{label}</span>
          <span className="qs-meta">{meta}</span>
        </div>
        <div className="qs-panel">{children}</div>
        <div className="qs-foot">
          <h3 className="qs-title">{title}</h3>
          <span className="qs-btn">{cta}<PixelIcon name="arrow" color="#05060b" /></span>
        </div>
      </div>
    </Link>
  )
}

function TaskRow({ title, done, anim }) {
  return (
    <div className={`qs-row${anim ? ` qs-anim-${anim}` : ''}${done ? ' is-done' : ''}`}>
      <span className="qs-box">
        <span className="qs-box-fill"><PixelIcon name="check" color="#05060b" /></span>
      </span>
      <span className="qs-row-text"><span className="qs-row-label">{title}<span className="qs-strike" /></span></span>
    </div>
  )
}

// Placeholder rows while the task list or goals are still loading
// (CLAUDE.md: async content gets a skeleton, not an empty panel).
function PanelSkeleton({ lines }) {
  return lines.map((w, i) => <Skeleton key={i} className="h-[18px] rounded-none bg-white/15" style={{ width: w }} />)
}

function week(now) {
  const dow = now.getDay()
  const mon = new Date(now)
  mon.setHours(0, 0, 0, 0)
  mon.setDate(mon.getDate() + (dow === 0 ? -6 : 1 - dow))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return { date: d.getDate(), today: d.toDateString() === now.toDateString() }
  })
}

/**
 * tasks: up to 3 { title, done }; the first two open ones animate on hover.
 * goal:  { title, pct, done, total, endsLabel } or null.
 * tasksLoading / goalsLoading: show skeleton rows in that card's panel.
 * activeGoals: null hides the Goal card's count (goals not loaded yet).
 */
export default function QuickStartCards({
  tasks = [], doneToday = 0, activeGoals = 0, goal = null, now = new Date(),
  tasksLoading = false, goalsLoading = false,
  taskHref = '/tasks/new', goalHref = '/goals/new', calendarHref = '/calendar',
}) {
  let animSlot = 0
  const rows = tasks.slice(0, 3).map(t => ({ ...t, anim: !t.done && animSlot < 2 ? ++animSlot : 0 }))
  const shortDate = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <div className="qs-grid">
      <Card to={taskHref} kind="task" icon="clipboard" label="Task" meta={tasksLoading ? '' : `${doneToday} done today`}
        title="Start a new task" cta="New task">
        {tasksLoading
          ? <PanelSkeleton lines={['78%', '64%', '70%']} />
          : rows.length
            ? rows.map((r, i) => <TaskRow key={i} {...r} />)
            : <span className="qs-sub">Nothing on your list yet</span>}
      </Card>

      <Card to={goalHref} kind="goal" icon="trophy" label="Goal" meta={activeGoals === null ? '' : `${activeGoals} active`}
        title="Start a new goal" cta="New goal">
        {goalsLoading ? (
          <PanelSkeleton lines={['60%', '100%', '72%']} />
        ) : goal ? (
          <>
            <div className="qs-goal-top"><span className="qs-goal-name">{goal.title}</span><span className="qs-goal-pct">{goal.pct}%</span></div>
            <div className="qs-bar"><span className="qs-bar-fill" style={{ '--qs-pct': `${goal.pct}%` }} /></div>
            <span className="qs-sub">{goal.done} of {goal.total} tasks{goal.endsLabel ? ` · ends ${goal.endsLabel}` : ''}</span>
          </>
        ) : <span className="qs-sub">Set a target and track it here</span>}
      </Card>

      <Card to={calendarHref} kind="cal" icon="page7" label="Calendar" meta={shortDate}
        title="View your calendar" cta="Open">
        <div className="qs-week">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={'d' + i} className="qs-dow">{d}</span>)}
          {week(now).map((c, i) => <span key={i} className={`qs-day${c.today ? ' is-today' : ''}`}>{c.date}</span>)}
        </div>
        <span className="qs-sub">Full calendar view →</span>
      </Card>
    </div>
  )
}
