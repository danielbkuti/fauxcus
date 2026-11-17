import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { User, LogOut } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { NotificationBell } from '@/components/NotificationBell'
import { cn } from '@/lib/utils'
import { Starfield } from '@/components/Starfield'

const NAV_LINKS = [
  { to: '/home', label: 'Home' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/goals', label: 'Goals' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/progress', label: 'Progress' },
]

// Scoped to just this file's two Logo instances — the whole-app default
// stays 1. Was 0.995 (barely perceptible); trimmed further.
const NAV_LOGO_SCALE = 0.85

// Fixed top nav for the whole authenticated app. Starts off-white with a
// faint bottom hairline; past a small scroll threshold it blends into
// the starfield photo (the same one the logo's own lettering uses), the
// wordmark swaps from its gradient tile to the black/outlined one — with
// its lettering now switched to the brand gradient, so bar and wordmark
// aren't both carrying the same photo at once — and all the nav
// text/icons go from dark to white with it.
//
// The background swap is a cross-fade, not a class swap: a browser
// can't smoothly transition between a flat color and an image
// (background-image isn't an interpolable property, it just snaps), so
// instead there are two full-size layers stacked on top of each other
// — one flat, one the photo — and scrolling fades one out while fading
// the other in via opacity, which *is* interpolable. Same trick for the
// wordmark, via Logo's own two crossfading instances.
export function NavBar({ firstName, onLogout }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    function handleScroll() {
      setScrolled((was) => {
        const isPast = window.scrollY > 8
        return isPast === was ? was : isPast
      })
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const linkClass = ({ isActive }) =>
    cn(
      'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-500',
      scrolled
        ? cn('text-white/80 hover:bg-white/10 hover:text-white', isActive && 'bg-white/20 text-white')
        : cn('text-black/70 hover:bg-black/5 hover:text-black', isActive && 'bg-black/10 text-black')
    )

  const mobileLinkClass = ({ isActive }) =>
    cn(
      'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-500',
      scrolled
        ? cn('text-white/80', isActive && 'bg-white/20 text-white')
        : cn('text-black/70', isActive && 'bg-black/10 text-black')
    )

  return (
    <header className="font-display fixed inset-x-0 top-0 z-50">
      {/* Flat, off-white layer — visible at rest, fades out on scroll. */}
      <div
        className={cn(
          'absolute inset-0 border-b border-black/10 bg-neutral-50 transition-opacity duration-500 ease-in-out',
          scrolled ? 'opacity-0' : 'opacity-100'
        )}
        aria-hidden="true"
      />
      {/* Starfield layer — hidden at rest, fades in on scroll. Always
          mounted (the crossfade needs both layers present); its
          shooting-star timer is switched off, since a bar this short has
          nowhere for one to go. */}
      <div
        className={cn(
          'absolute inset-0 isolate overflow-hidden bg-[#05060b] shadow-sm transition-opacity duration-500 ease-in-out',
          scrolled ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden="true"
      >
        <Starfield shooting={false} />
      </div>

      <div className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <NavLink to="/home" className="relative inline-flex" aria-label="Fauxcus home">
          {/* Rest-state logo (color tile) sits in normal flow, reserving
              the layout space the scrolled copy then overlays exactly —
              same crossfade trick as the rest of this file (a browser
              can't smoothly transition between two different tile
              backgrounds, so two full copies cross-fade via opacity
              instead), just built on the shared Logo component now
              instead of two ad hoc text spans. Both copies get the same
              `sizeScale` so they stay aligned through the fade. */}
          <Logo
            scale="secondary"
            variant="color"
            sizeScale={NAV_LOGO_SCALE}
            className={cn('transition-opacity duration-500 ease-in-out', scrolled ? 'opacity-0' : 'opacity-100')}
          />
          <Logo
            scale="secondary"
            variant="black"
            sizeScale={NAV_LOGO_SCALE}
            className={cn(
              'absolute inset-0 transition-opacity duration-500 ease-in-out',
              scrolled ? 'opacity-100' : 'opacity-0'
            )}
          />
        </NavLink>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={linkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <NotificationBell scrolled={scrolled} />
          {/* Gradient ring only while scrolled — same overlay Logo's
              black variant uses, `relative` on each button gives it
              something to position against. Rest state keeps its plain
              ring/no-ring look; nothing about it needed an outline.
              Was purely decorative (see HANDOFF.md's "Known gaps") —
              now links to the profile page. */}
          <NavLink
            to="/profile"
            className={cn(
              'relative flex size-8 items-center justify-center rounded-full ring-1 transition-colors duration-500',
              scrolled ? 'bg-white/15 ring-white/30 hover:bg-white/25' : 'bg-white/70 ring-black/10 hover:bg-white'
            )}
            title={firstName ? `${firstName}'s profile` : 'Profile'}
            aria-label="Profile"
          >
            {scrolled && <span aria-hidden="true" className="gradient-ring" />}
            <User className={cn('size-4 transition-colors duration-500', scrolled ? 'text-white' : 'text-black/70')} />
          </NavLink>
          <button
            type="button"
            onClick={onLogout}
            title="Log out"
            aria-label="Log out"
            className={cn(
              'relative flex size-8 items-center justify-center rounded-full transition-colors duration-500',
              scrolled ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-black/5 text-black/70 hover:bg-black/10 hover:text-black'
            )}
          >
            {scrolled && <span aria-hidden="true" className="gradient-ring" />}
            <LogOut className="size-4" />
          </button>
        </div>
      </div>

      {/* Compact link row for narrow screens — the centered layout above
          hides below md, this replaces it rather than squeezing five
          labels into the same header row. */}
      <nav className="relative z-10 flex items-center gap-1 overflow-x-auto border-t border-black/10 px-4 py-1.5 md:hidden">
        {NAV_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} className={mobileLinkClass}>
            {link.label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
