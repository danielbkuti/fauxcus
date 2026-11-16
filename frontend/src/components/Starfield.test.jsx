import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Starfield } from './Starfield'

// @/lib/starfield-8bit.js is stubbed globally in src/test/setup.js, so
// <starfield-8bit> is an inert element here — these check only what the
// wrapper hands it.
describe('Starfield', () => {
  it('renders an aria-hidden, non-interactive layer behind its surface', () => {
    const { container } = render(<Starfield />)
    const el = container.querySelector('starfield-8bit')
    expect(el).not.toBeNull()
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el.style.position).toBe('absolute')
    expect(el.style.zIndex).toBe('-1')
    expect(el.style.pointerEvents).toBe('none')
    expect(el).toHaveAttribute('pixel-size', '4')
  })

  it('leaves the shooting-star timer at its default unless switched off', () => {
    const { container } = render(<Starfield />)
    const el = container.querySelector('starfield-8bit')
    expect(el).not.toHaveAttribute('first-delay')
    expect(el).not.toHaveAttribute('interval')
  })

  it('pushes the shooting-star timer out a day with shooting={false}, and passes pixelSize through', () => {
    const { container } = render(<Starfield pixelSize={2} shooting={false} />)
    const el = container.querySelector('starfield-8bit')
    expect(el).toHaveAttribute('pixel-size', '2')
    expect(el).toHaveAttribute('first-delay', '86400')
    expect(el).toHaveAttribute('interval', '86400')
  })
})
