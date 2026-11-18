// Two celebration scales for the task detail page, per
// `handoff/Celebrations-5c.md`: paper confetti on a single checked
// subtask row, five-shell fireworks across the whole page shell when
// the task itself is marked complete, and an independent one-shot
// colour wash that fires on both complete and reopen. Deliberately a
// separate component from the card-scale `ConfettiBurst` (see its own
// file) rather than a shared one — the geometry, emitter counts, and
// page-vs-row overlay placement are all different, and this page's
// fireworks/confetti aren't gated behind that flag. Everything here is
// deterministic per index (no `Math.random()`) so a re-render never
// re-randomises a burst mid-flight, and every overlay respects
// `prefers-reduced-motion` by not rendering at all rather than playing
// a shortened version.

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function degToRad(deg) {
  return (deg * Math.PI) / 180
}

// --- Page-level fireworks -------------------------------------------------
// Blue → pink → violet → gold, deliberately not the state palette: the
// celebration must not read as another status colour.
const FW_COLORS = ['#8ec5fc', '#4f8ef7', '#f9a8d4', '#ec4899', '#c7dcff', '#e0c3fc', '#fde68a', '#7c5fb0']

// Five shells sweeping the page (a card also uses five, tighter
// together) so a full-page completion feels bigger than a card's.
const FW_EMITTERS = [
  { left: '14%', top: '34%', delay: 0, scale: 1.0 },
  { left: '38%', top: '18%', delay: 220, scale: 1.25 },
  { left: '62%', top: '30%', delay: 430, scale: 1.4 },
  { left: '84%', top: '20%', delay: 640, scale: 1.05 },
  { left: '48%', top: '52%', delay: 880, scale: 0.9 },
]

const FW_SPARK_COUNT = 26
const FW_SPARK2_COUNT = 12

function fwOuterSparkStyle(i, e, scale, burstAt) {
  const angle = i * (360 / FW_SPARK_COUNT) + (i % 3) * 6 // %3 jitter breaks the wheel look
  const dist = (94 + (i % 4) * 18) * scale
  const sx = Math.cos(degToRad(angle)) * dist
  const sy = Math.sin(degToRad(angle)) * dist + 34 // +34px gravity droop
  const size = i % 5 === 0 ? 4 : 3
  const color = FW_COLORS[(i + e * 3) % FW_COLORS.length]
  const duration = 900 + (i % 4) * 110
  const delay = burstAt + (i % 5) * 16
  return {
    left: `${-size / 2}px`,
    top: `${-size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    background: color,
    boxShadow: `0 0 ${size * 3}px ${size * 0.8}px ${color}`,
    opacity: 0,
    '--sx': `${sx}px`,
    '--sy': `${sy}px`,
    animation: `fw-spark ${duration}ms cubic-bezier(.15,.6,.35,1) ${delay}ms forwards`,
  }
}

function fwInnerSparkStyle(i, scale, burstAt) {
  const angle = i * (360 / FW_SPARK2_COUNT) + 22
  const dist = (46 + (i % 3) * 13) * scale
  const sx = Math.cos(degToRad(angle)) * dist
  const sy = Math.sin(degToRad(angle)) * dist + 18
  const delay = burstAt + 50
  return {
    left: '-1px',
    top: '-1px',
    width: '2px',
    height: '2px',
    background: '#fff',
    boxShadow: '0 0 6px 1.6px #fff',
    opacity: 0,
    '--sx': `${sx}px`,
    '--sy': `${sy}px`,
    animation: `fw-spark 600ms cubic-bezier(.15,.6,.35,1) ${delay}ms forwards`,
  }
}

// No rising trail before the burst — it read as a stray dot appearing
// a beat before the "explosion" rather than part of it. Fires straight
// to flash → ring → sparks at `em.delay`.
function FireworkShell({ em, e }) {
  const burstAt = em.delay
  return (
    <div className="absolute" style={{ left: em.left, top: em.top, width: 0, height: 0 }}>
      <span
        className="absolute rounded-full"
        style={{
          left: `${-17 * em.scale}px`,
          top: `${-17 * em.scale}px`,
          width: `${34 * em.scale}px`,
          height: `${34 * em.scale}px`,
          background:
            'radial-gradient(circle, #fff 0%, rgba(249,168,212,.8) 38%, rgba(142,197,252,.35) 60%, rgba(142,197,252,0) 76%)',
          // Explicit resting opacity — without it the shape sits here at
          // full (unanimated) size/opacity for the whole `burstAt` delay,
          // reading as a little circle before it "explodes". Same fix as
          // the spark styles below (they already set opacity: 0 inline).
          opacity: 0,
          animation: `fw-flash 520ms ease-out ${burstAt}ms forwards`,
        }}
      />
      <span
        className="absolute rounded-full"
        style={{
          left: `${-95 * em.scale}px`,
          top: `${-95 * em.scale}px`,
          width: `${190 * em.scale}px`,
          height: `${190 * em.scale}px`,
          border: '3px solid rgba(236,72,153,.6)',
          opacity: 0,
          animation: `fw-ring 760ms cubic-bezier(.2,.7,.3,1) ${burstAt}ms forwards`,
        }}
      />
      {Array.from({ length: FW_SPARK_COUNT }).map((_, i) => (
        <span key={`o${i}`} className="absolute rounded-full" style={fwOuterSparkStyle(i, e, em.scale, burstAt)} />
      ))}
      {Array.from({ length: FW_SPARK2_COUNT }).map((_, i) => (
        <span key={`i${i}`} className="absolute rounded-full" style={fwInnerSparkStyle(i, em.scale, burstAt)} />
      ))}
    </div>
  )
}

// Covers the page shell — parent must be `position:relative;
// overflow:hidden; border-radius:30px` so sparks stay inside the
// rounded corners. Fires only on `false -> true` completion, never on
// reopen (see CompletionWash below for that side).
//
// `origin` ({ left, top } in px, relative to the shell) moves the first
// shell onto the progress dial's centre so the burst reads as coming
// out of the ring the moment it closes. Omitted → original layout.
export function TaskFireworks({ origin } = {}) {
  if (reducedMotion()) return null
  const emitters = origin
    ? [{ ...FW_EMITTERS[0], left: `${origin.left}px`, top: `${origin.top}px`, scale: 1.15 }, ...FW_EMITTERS.slice(1)]
    : FW_EMITTERS
  return (
    <div className="task-detail-fireworks pointer-events-none absolute inset-0 z-[4] overflow-hidden rounded-[30px]" aria-hidden="true">
      {emitters.map((em, e) => (
        <FireworkShell key={e} em={em} e={e} />
      ))}
    </div>
  )
}

// --- Subtask row confetti ---------------------------------------------
// App palette + gold, plus a brighter emerald and pink so a row-scale
// burst still separates from the emerald row it lands on.
const CONF_COLORS = ['#56a456', '#7c5fb0', '#8ec5fc', '#e0c3fc', '#f5c451', '#34d399', '#f9a8d4']

// Four emitters spread left-to-right across the row — off the
// checkbox, then three more spaced out toward the due-date badge — so
// the burst sweeps the whole row instead of clustering near the
// checkbox. Percentage lefts (not fixed px) so the spread actually
// scales with the row's real width instead of capping out ~290px in
// from the left edge on any row wider than that. Each still scaled
// well below the card burst's reach, so it reads as a row-scale event,
// not a card-scale one.
const CONF_EMITTERS = [
  { left: '4%', top: '50%', delay: 0, bias: 0.35, scale: 0.48 },
  { left: '34%', top: '50%', delay: 70, bias: -0.25, scale: 0.42 },
  { left: '64%', top: '50%', delay: 140, bias: 0.3, scale: 0.44 },
  { left: '94%', top: '50%', delay: 210, bias: -0.35, scale: 0.4 },
]
const CONF_PER_EMITTER = 10 // 40 pieces total

function confPieceGeometry(i, e, em) {
  const t = i / (CONF_PER_EMITTER - 1)
  const spread = (-92 + t * 184 + (i % 3) * 6) * em.scale + em.bias * 62
  const dx = spread * (1 + (i % 4) * 0.16)
  const peak = -(78 + (i % 5) * 26) * em.scale
  const fall = (150 + (i % 6) * 30) * em.scale
  const rot = (i % 2 ? 1 : -1) * (520 + i * 41)
  const dur = 1150 + (i % 5) * 150
  const delay = em.delay + (i % 7) * 22
  const shape = (i + e) % 3
  const color = CONF_COLORS[(i + e * 2) % CONF_COLORS.length]
  let w, h, radius
  if (shape === 0) {
    w = 3.5
    h = 10
    radius = '1.5px' // ribbon
  } else if (shape === 1) {
    w = 6
    h = 6
    radius = '1.5px' // square
  } else {
    w = 4.5
    h = 4.5
    radius = '50%' // dot
  }
  return { dx, peak, fall, rot, dur, delay, w, h, radius, color }
}

function ConfettiPiece({ i, e, em }) {
  const g = confPieceGeometry(i, e, em)
  return (
    <span
      className="absolute top-0 left-0"
      style={{ '--dx': `${g.dx}px`, animation: `conf-x ${g.dur}ms cubic-bezier(.2,.5,.5,1) ${g.delay}ms forwards` }}
    >
      <span
        className="block"
        style={{
          '--peak': `${g.peak}px`,
          '--fall': `${g.fall}px`,
          animation: `conf-y ${g.dur}ms cubic-bezier(.25,.5,.4,1) ${g.delay}ms forwards`,
        }}
      >
        <span
          className="block"
          style={{
            width: `${g.w}px`,
            height: `${g.h}px`,
            borderRadius: g.radius,
            background: g.color,
            boxShadow: '0 1px 4px rgba(37,37,37,.2)',
            '--rot': `${g.rot}deg`,
            animation: `conf-spin ${g.dur}ms ease-out ${g.delay}ms forwards`,
          }}
        />
      </span>
    </span>
  )
}

// Covers one subtask row — parent must be `position:relative` and must
// NOT clip via `overflow:hidden`, or the arcing pieces get cut at the
// row edge. Fires on check only, never on uncheck (call sites gate
// this, same as the fireworks above).
export function SubtaskConfetti() {
  if (reducedMotion()) return null
  return (
    <div className="task-detail-confetti pointer-events-none absolute inset-0 z-[6]" aria-hidden="true">
      {CONF_EMITTERS.map((em, e) => (
        <div key={e} className="absolute" style={{ left: em.left, top: em.top }}>
          {Array.from({ length: CONF_PER_EMITTER }).map((_, i) => (
            <ConfettiPiece key={i} i={i} e={e} em={em} />
          ))}
        </div>
      ))}
    </div>
  )
}

// --- Completion wash -------------------------------------------------
// Independent of the bursts above — fires on BOTH complete and reopen
// so the palette flip always reads as an event, even when nothing else
// is celebrating (reopening never gets fireworks/confetti, just this).
export function CompletionWash({ kind }) {
  if (reducedMotion()) return null
  const background =
    kind === 'complete'
      ? 'radial-gradient(circle at 50% 45%, rgba(52,211,153,.55), rgba(52,211,153,0) 65%)'
      : 'radial-gradient(circle at 50% 45%, rgba(224,86,47,.35), rgba(224,86,47,0) 65%)'
  return (
    <span
      aria-hidden="true"
      className="task-detail-wash pointer-events-none absolute inset-0 z-[1] rounded-[30px]"
      style={{ background, animation: 'done-wash 900ms ease-out forwards' }}
    />
  )
}
