import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreakCard, StreakFire, fireReach } from './StreakFire'

// pixel-fire.js registers a real custom element that needs ResizeObserver
// and canvas, neither of which jsdom implements. These tests are about
// *when* the fire is rendered and how it's configured, not about the
// canvas animation itself, so the registration is stubbed out and
// <pixel-fire> stays an inert unknown element.
vi.mock('@/lib/pixel-fire.js', () => ({}))

describe('fireReach', () => {
  it('starts at 30% for a 1-day streak and grows with it', () => {
    expect(fireReach(1)).toBeCloseTo(30.8)
    expect(fireReach(10)).toBeGreaterThan(fireReach(1))
  })

  it('never exceeds 54%, however long the streak', () => {
    // The design export warns that anything past 55 clips the flame tips
    // flat against the top of the band.
    expect(fireReach(30)).toBe(54)
    expect(fireReach(365)).toBe(54)
  })
})

describe('StreakFire', () => {
  it('renders nothing for a zero streak', () => {
    const { container } = render(<StreakFire streak={0} />)
    expect(container.querySelector('pixel-fire')).toBeNull()
  })

  it('renders an aria-hidden pixel-fire for a live streak, sized by its surface', () => {
    const { container } = render(
      <>
        <StreakFire streak={5} size="card" />
        <StreakFire streak={5} size="tile" />
      </>
    )
    const [card, tile] = container.querySelectorAll('pixel-fire')
    expect(card.getAttribute('aria-hidden')).toBe('true')
    expect(card.getAttribute('height')).toBe(String(fireReach(5)))
    expect(card.style.height).toBe('96px')
    expect(tile.style.height).toBe('36px')
  })
})

describe('StreakCard', () => {
  it('shows the fire, the streak copy, and extra bottom padding when a streak is live', () => {
    const { container } = render(<StreakCard streak={7} dueToday={2} />)
    expect(screen.getByText("You're on a 7-day streak.")).toBeInTheDocument()
    expect(screen.getByText('2 more due today — keep it going.')).toBeInTheDocument()
    expect(container.querySelector('pixel-fire')).not.toBeNull()
    expect(container.firstChild.className).toContain('pb-[78px]')
  })

  it('shows no fire and no extra padding without a streak', () => {
    const { container } = render(<StreakCard streak={0} dueToday={0} />)
    expect(screen.getByText('Check something off to start a streak.')).toBeInTheDocument()
    expect(container.querySelector('pixel-fire')).toBeNull()
    expect(container.firstChild.className).not.toContain('pb-[78px]')
  })
})
