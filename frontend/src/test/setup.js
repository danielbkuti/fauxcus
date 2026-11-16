import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// <starfield-8bit> (src/lib/starfield-8bit.js) needs ResizeObserver and a
// real canvas, neither of which jsdom has. Every surface that carries the
// starfield (nav, footer, heroes, the FAB) can be mounted by some test, so
// it's stubbed once here — <starfield-8bit> then stays an inert unknown
// element, which is all those tests need.
vi.mock('@/lib/starfield-8bit.js', () => ({}))

// jsdom has no PointerEvent implementation at all — @base-ui/react's
// Checkbox (src/components/ui/checkbox.jsx, used by LoginForm's
// "remember me" and elsewhere) dispatches one on click, which throws
// ("PointerEvent is not a constructor") without this. A minimal
// MouseEvent-based polyfill is the standard workaround for testing
// Radix/base-ui-style components under jsdom.
if (!globalThis.PointerEvent) {
  class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
      this.pointerType = params.pointerType ?? 'mouse'
      this.isPrimary = params.isPrimary ?? true
    }
  }
  globalThis.PointerEvent = PointerEvent
}
// Same story for these — jsdom doesn't implement the Pointer Capture
// APIs at all, and base-ui/Radix-style components call them
// unconditionally on pointer interactions.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}

// Unmounts every component tree rendered in a test after it finishes —
// without this, a component left mounted (with its own timers/effects
// still running, e.g. TaskCard's countdown interval) can leak into the
// next test instead of being torn down.
afterEach(() => {
  cleanup()
})
