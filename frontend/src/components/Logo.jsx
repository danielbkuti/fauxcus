import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// The Fauxcus wordmark — chip lockup, per design_handoff_logo_variants/
// README.md. Replaces the earlier notch-cutout construction (a corner
// square with the check punched through it as a CSS mask, starfield-
// filled letters, a stroked outline traced behind the glyphs) with a
// simpler one: the check becomes its own rounded chip sitting inline
// beside the wordmark, and the wordmark is solid white at every scale.
// See git history for the notch version if you need it back.
//
// One component covers every in-app placement instead of each page
// hand-rolling its own gradient-clip-text span. Two tile variants,
// settled on as the permanent look everywhere a Fauxcus mark appears,
// not per-instance overrides:
//   - 'color' (default): the brand gradient tile, a dark plum chip.
//     For light/neutral grounds.
//   - 'black' (the spec calls this "Inverse"): a dark translucent
//     plate with a gradient hairline standing in for the old
//     `.gradient-ring` border, and a gradient-filled chip — except at
//     icon scale, where the chip goes flat white instead: at 12px the
//     three-stop gradient has no room to read and collapses into mud.
//     For dark, starfield or photographic grounds — this app's dark
//     Footer, and NavBar's scrolled state.
const SCALES = {
  primary: { fontSize: 96, tileRadius: 34, padding: '24px 44px', chip: 44, chipRadius: 12, check: 26, checkStroke: 3.4, gap: 28 },
  secondary: { fontSize: 42, tileRadius: 16, padding: '10px 21px', chip: 20, chipRadius: 6, check: 12, checkStroke: 4.2, gap: 14 },
  icon: { fontSize: 22, tileRadius: 8.5, padding: '5px 12px', chip: 12, chipRadius: 4, check: 8, checkStroke: 4.5, gap: 8 },
}

const BRAND_GRADIENT = 'linear-gradient(to bottom right, #e0c3fc, #7c5fb0, #8ec5fc)'

// Tile lustre — every scale, both variants would use the same value
// except icon scale's colour tile is very slightly less bright
// (rgba(255,255,255,.7) instead of .75) per the specimen.
const TILE_LUSTRE = {
  primary: 'inset 0 1px 0 rgba(255,255,255,.75), inset 0 -1px 0 rgba(0,0,0,.15)',
  secondary: 'inset 0 1px 0 rgba(255,255,255,.75), inset 0 -1px 0 rgba(0,0,0,.15)',
  icon: 'inset 0 1px 0 rgba(255,255,255,.7), inset 0 -1px 0 rgba(0,0,0,.15)',
}
// Colour variant only, primary/secondary only — dropped at icon scale
// (too small to read, and the ground around it is usually busy there).
const COLOR_DROP_SHADOW = {
  primary: '0 22px 44px -22px rgba(124,95,176,.85)',
  secondary: '0 10px 22px -14px rgba(124,95,176,.8)',
}
// Inverse tile fill, per scale — icon drops the blur and goes a touch
// more opaque to hold its own edge without it (backdrop-filter is also
// the one CSS property this component avoids relying on for anything
// load-bearing at 17px).
const INVERSE_TILE = {
  primary: { background: 'rgba(20,13,32,.72)', backdropFilter: 'blur(6px)' },
  secondary: { background: 'rgba(20,13,32,.72)', backdropFilter: 'blur(6px)' },
  icon: { background: 'rgba(20,13,32,.82)' },
}
// The gradient hairline's own thickness, per scale — everything else
// about it is the existing `.gradient-ring` class (index.css), just
// with this overriding its default 2px padding.
const HAIRLINE_PADDING = { primary: 2, secondary: 1.5, icon: 1 }

export function Logo({ variant = 'color', scale = 'secondary', sizeScale = 1, className }) {
  const s = SCALES[scale]
  const isInverse = variant === 'black'
  const chipBg = isInverse ? (scale === 'icon' ? 'rgba(255,255,255,.92)' : BRAND_GRADIENT) : 'rgba(51,34,74,.85)'
  const checkColor = isInverse ? '#2b1c40' : '#fff'
  const boxShadow = isInverse
    ? undefined
    : [TILE_LUSTRE[scale], scale !== 'icon' && COLOR_DROP_SHADOW[scale]].filter(Boolean).join(', ')

  return (
    <span
      className={cn('relative inline-flex items-center align-middle', className)}
      style={{
        borderRadius: s.tileRadius,
        padding: s.padding,
        gap: s.gap,
        boxShadow,
        transform: sizeScale === 1 ? undefined : `scale(${sizeScale})`,
        ...(isInverse ? INVERSE_TILE[scale] : { background: BRAND_GRADIENT }),
      }}
    >
      {/* Stands in for the old notch's `.gradient-ring` border — same
          class, just overriding its thickness per scale. Its own mask
          leaves the interior fully transparent, so it can sit either
          side of the text/chip in paint order without ever covering
          them. */}
      {isInverse && (
        <span aria-hidden="true" className="gradient-ring" style={{ padding: HAIRLINE_PADDING[scale] }} />
      )}

      <span
        className="font-display relative block leading-none font-bold whitespace-nowrap text-white"
        style={{ fontSize: s.fontSize, letterSpacing: '.01em' }}
      >
        Fauxcus
      </span>

      <span
        aria-hidden="true"
        className="relative flex flex-none items-center justify-center"
        style={{ width: s.chip, height: s.chip, borderRadius: s.chipRadius, background: chipBg, color: checkColor }}
      >
        <Check width={s.check} height={s.check} strokeWidth={s.checkStroke} />
      </span>
    </span>
  )
}
