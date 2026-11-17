import { cn } from '@/lib/utils'
// Registers the <pixel-fire> custom element (an unmodified copy of the
// design export, see lib/pixel-fire.js). Imported for its side effect —
// evaluated once, however many streak surfaces mount.
import '@/lib/pixel-fire.js'
import { Starfield } from '@/components/Starfield'

// Pixel-fire bed that sits along the bottom edge of anything showing a
// streak (design_export "streak card 2a"). The parent must be
// `relative overflow-hidden` so the bed is clipped to it, and must leave
// room at the bottom (see FIRE_PAD) so copy never sits on the flames —
// the copy itself goes above it at `z-[2]`.
//
// Flames reach further as the streak grows: 30% of the band at 1 day,
// capped at 54% at 30+ days. The export's own README says to stay at or
// below 55 — past that the tips get cut flat at the top of the band.
export function fireReach(streak) {
  return Math.min(54, 30 + Math.min(streak, 30) * 0.8)
}

// Band height per surface. The flame height is a percentage of the band
// (see fireReach), so two bands of different heights burn visibly
// differently at the same streak — the 96px card used to look more
// "inflamed" than the 36px stat tile next to it. Every surface now shares
// one band height so a given streak always burns the same size of fire,
// wherever it's shown. The `size` prop is kept so call sites still say
// which surface they are.
const BAND_HEIGHT = 36
const BAND = { card: BAND_HEIGHT, tile: BAND_HEIGHT }

// Extra bottom padding each surface needs so its copy clears the flames.
export const FIRE_PAD = { card: 'pb-[40px]', tile: 'pb-[40px]', panel: 'pb-[40px]' }

// A zero streak has no fire at all — there's nothing to be burning — so
// callers can render this unconditionally and size their own padding
// off `streak > 0`.
export function StreakFire({ streak, size = 'card' }) {
  if (!(streak > 0)) return null
  return (
    <pixel-fire
      aria-hidden="true"
      pixel-size="4"
      height={fireReach(streak)}
      fps="16"
      bands="8"
      background="transparent"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: BAND[size] ?? BAND.card, zIndex: 1, pointerEvents: 'none' }}
    />
  )
}

// The starfield "This week" card shown on both the Dashboard and the
// Calendar rail — one component now instead of the two near-identical
// copies each page used to carry.
export function StreakCard({ streak, dueToday }) {
  const lit = streak > 0
  return (
    <div
      className={cn('font-display relative isolate overflow-hidden rounded-[14px] bg-[#05060b] p-[18px] text-white', lit && FIRE_PAD.card)}
    >
      <Starfield shooting={false} />
      <StreakFire streak={streak} />
      <span aria-hidden="true" className="gradient-ring" style={{ zIndex: 3 }} />
      <div className="relative z-[2] flex flex-col gap-2">
        <span className="text-[14px] font-bold uppercase tracking-[.09em] text-white/60">This week</span>
        <span className="font-display text-[26px] font-semibold">
          {lit ? `You're on a ${streak}-day streak.` : 'Check something off to start a streak.'}
        </span>
        <span className="text-xs text-white/60">
          {dueToday > 0 ? `${dueToday} more due today — keep it going.` : 'A clean slate today. One task keeps it alive.'}
        </span>
      </div>
    </div>
  )
}
