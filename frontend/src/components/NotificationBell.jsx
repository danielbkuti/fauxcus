import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/notifications'
import { cn, formatDeadline } from '@/lib/utils'

// Same "just now" / "Xm ago" / "Xh ago" / full-date-fallback shape as
// TaskDetailPage.jsx's own formatActivityTime — not shared between the
// two, matching this codebase's existing convention of a small per-file
// time formatter rather than one shared util for it.
function formatTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return formatDeadline(iso)
}

// How often to re-poll while mounted (i.e. the whole time you're on any
// authenticated page) — same "slow tick" spirit as Dashboard's own
// useClock. Nothing here needs to feel instant: the only thing that
// ever creates a notification is the once-daily digest job, not a live
// in-session event, so there's nothing to catch by polling faster.
const POLL_MS = 60000

// Bell + dropdown in the nav bar — `scrolled` mirrors NavBar's own prop
// of the same name so this button's color scheme (dark-on-light at
// rest, light-on-photo scrolled) matches the Profile/Logout buttons
// sitting right next to it, rather than picking its own inconsistent
// palette.
export function NotificationBell({ scrolled }) {
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  async function refresh() {
    try {
      setNotifications(await fetchNotifications())
    } catch {
      // Silent — a failed background poll just leaves the last-known
      // list showing; not worth surfacing an error for it.
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [])

  // Closes on outside click — a plain document listener is enough here
  // (no portal, no click-suppression-sensitive widgets underneath the
  // way DeadlineEditor's backdrop has to guard against).
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const unreadCount = notifications.filter((n) => !n.read).length

  // Optimistic, same pattern as every other mutation in this app
  // (TaskList's handleToggle, etc.) — flips local state immediately,
  // doesn't bother reverting on failure since the next poll
  // (POLL_MS later) would just re-show the true state anyway.
  async function handleSelect(notification) {
    setOpen(false)
    if (notification.read) return
    setNotifications((current) =>
      current.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
    )
    try {
      await markNotificationRead(notification.id)
    } catch {
      // See comment above.
    }
  }

  async function handleMarkAllRead() {
    setNotifications((current) => current.map((n) => ({ ...n, read: true })))
    try {
      await markAllNotificationsRead()
    } catch {
      // See handleSelect above.
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label="Notifications"
        className={cn(
          'relative flex size-8 items-center justify-center rounded-full transition-colors duration-500',
          scrolled ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-black/5 text-black/70 hover:bg-black/10 hover:text-black'
        )}
      >
        {scrolled && <span aria-hidden="true" className="gradient-ring" />}
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            // z-10, above .gradient-ring's own z-index:1 (index.css) — the
            // ring wraps the whole button including this top-right
            // corner, so without a higher z-index it painted over the
            // count bubble once scrolled (when the ring's actually
            // there) instead of sitting behind it.
            className="absolute -top-0.5 -right-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 rounded-lg border bg-card p-2 text-left text-foreground shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs font-semibold text-muted-foreground">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-sky-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nothing yet — deadline reminders show up here.
            </p>
          ) : (
            <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  to={n.task ? `/tasks/${n.task}` : '/tasks'}
                  onClick={() => handleSelect(n)}
                  className={cn(
                    'flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50',
                    !n.read && 'bg-sky-50'
                  )}
                >
                  <span className={cn('font-medium', n.read && 'text-muted-foreground')}>{n.message}</span>
                  <span className="text-[10px] text-muted-foreground">{formatTime(n.dateCreated)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
