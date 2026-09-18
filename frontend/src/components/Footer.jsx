import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'

const GITHUB_REPO = 'https://github.com/danielbkuti/fauxcus'

// Every link here goes somewhere real — no placeholder "Pricing"/
// "Careers"/"Cookie policy"-style SaaS boilerplate (this used to be
// exactly that: a generic 4-column template with none of the links
// wired up). A solo portfolio project doesn't have a Company or Legal
// section worth pretending to have, so those columns are gone rather
// than left empty or faked.
const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'How it works', href: '/#how' },
      { label: 'Live demo', href: 'https://fauxcus-api.onrender.com', external: true },
    ],
  },
  {
    heading: 'Project',
    links: [
      { label: 'Source code', href: GITHUB_REPO, external: true },
      { label: 'Changelog', href: `${GITHUB_REPO}/commits/main`, external: true },
      { label: 'CI status', href: `${GITHUB_REPO}/actions`, external: true },
    ],
  },
  {
    heading: 'Developer',
    links: [
      { label: 'GitHub profile', href: 'https://github.com/danielbkuti', external: true },
      { label: 'Report an issue', href: `${GITHUB_REPO}/issues`, external: true },
    ],
  },
]

// Persistent footer at the bottom of every authenticated page (and the
// public landing page). The top edge is clipped into a gentle upward
// slope rather than a plain straight line, so the section break reads
// as a deliberate design choice rather than the page just stopping.
export function Footer() {
  return (
    <footer
      className="relative mt-16 bg-cover bg-center pt-20 pb-10 text-neutral-300"
      style={{
        backgroundImage: 'url(/starfield-bg-wide.jpg)',
        clipPath: 'polygon(0 40px, 100% 0, 100% 100%, 0 100%)',
      }}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-10 px-6 sm:grid-cols-3">
        {COLUMNS.map((column) => (
          <div key={column.heading}>
            <h4 className="mb-3 text-sm font-semibold text-white">{column.heading}</h4>
            <ul className="flex flex-col gap-2 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target={link.external ? '_blank' : undefined}
                    rel={link.external ? 'noopener noreferrer' : undefined}
                    className="transition-colors hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center gap-3 border-t border-white/10 px-6 pt-6 text-xs text-neutral-500 sm:flex-row sm:justify-between">
        {/* 'black' (inverse) variant — a starfield ground, not a
            light/neutral one the color tile is meant for. Links to
            /home regardless of auth state: this footer renders on both
            the public landing page and every authenticated page, and
            /home's own route guard (App.jsx) already bounces an
            anonymous visitor straight back to / — so this never needs
            to branch on auth state itself to behave correctly either
            way. */}
        <Link to="/home" aria-label="Fauxcus home">
          <Logo variant="black" scale="secondary" />
        </Link>
        <span>© {new Date().getFullYear()} Fauxcus. All rights reserved.</span>
      </div>
    </footer>
  )
}
