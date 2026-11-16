import '@/lib/starfield-8bit.js'

// The app's starry ground — a thin React wrapper around the exported
// <starfield-8bit> custom element (src/lib/starfield-8bit.js, kept
// byte-for-byte as exported), which replaced the old static
// starfield-bg.jpg / starfield-bg-wide.jpg background images.
//
// Drop it in as the first child of any surface that used to carry the
// JPG. It fills its nearest positioned ancestor and sits at z-index -1,
// so the surface just needs `isolate` (a stacking context, so -1 means
// "behind this surface's own content" rather than "behind the page") and
// a dark fallback colour for the frame before the canvas paints.
//
//   <div className="relative isolate overflow-hidden bg-[#05060b] ...">
//     <Starfield />
//     ...content...
//   </div>
//
// `shooting={false}` for surfaces where a streak of light would be noise
// (the nav bar, the FAB, the small cards) — the element's twinkle stays.
// The shooting-star timer is pushed out to a day instead of switched
// off because the element has no off-switch for it. Under
// prefers-reduced-motion the element itself skips both animations and
// leaves the still field.
const A_DAY = '86400'

export function Starfield({ pixelSize = 4, density, shooting = true }) {
  return (
    <starfield-8bit
      aria-hidden="true"
      pixel-size={pixelSize}
      density={density}
      first-delay={shooting ? undefined : A_DAY}
      interval={shooting ? undefined : A_DAY}
      style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}
    />
  )
}
