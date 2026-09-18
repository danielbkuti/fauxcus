import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, Outlet, Link } from 'react-router-dom'
import './App.css'
import { LoginForm } from '@/components/LoginForm'
import { SignupForm } from '@/components/SignupForm'
import { SignupVerify } from '@/components/SignupVerify'
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm'
import { ResetPasswordForm } from '@/components/ResetPasswordForm'
import { LandingPage } from '@/components/LandingPage'
import { NavBar } from '@/components/NavBar'
import { Logo } from '@/components/Logo'
import { Dashboard } from '@/components/Dashboard'
import { TasksPage } from '@/components/TasksPage'
import { NewTaskPage } from '@/components/NewTaskPage'
import { TaskDetailPage } from '@/components/TaskDetailPage'
import { ProgressPage } from '@/components/ProgressPage'
import { ProfilePage } from '@/components/ProfilePage'
import { ComingSoonPage } from '@/components/ComingSoonPage'
import { CalendarPage } from '@/components/CalendarPage'
import { Footer } from '@/components/Footer'
import { AddTaskFab } from '@/components/AddTaskFab'
import { TaskStoreProvider } from '@/context/TaskStoreContext'
import { AddTaskFabProvider } from '@/context/AddTaskFabContext'
import { Skeleton } from '@/components/ui/skeleton'
import { checkAuth, logout } from '@/lib/auth'

// Wraps every public route (landing, login, signup, verify) so the
// gradient is one persistent element that never unmounts as you
// navigate between them — not a copy re-painted on each page. <Outlet />
// is where React Router renders whichever child route actually matched.
function PublicLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#e0c3fc] via-[#7c5fb0] to-[#8ec5fc]">
      <Outlet />
    </div>
  )
}

// Shared shell for the auth screens (login + signup + verify) — the
// top-left logo and the bottom info bar are identical on all three; only
// the card in the middle changes. The gradient itself now lives on
// PublicLayout, one level up, so it isn't duplicated here.

function AuthLayout({ children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-8">
      {/* 'black' (inverse) variant, not the default color/gradient tile —
          this corner sits directly on PublicLayout's own brand-gradient
          background one level up, and design-elements.md is explicit
          that the gradient tile shouldn't go on another gradient. Links
          to the landing page — every screen under AuthLayout (login,
          signup, verify, forgot/reset password) is only ever reached
          logged out, so that's always / here. */}
      <Link to="/" className="absolute top-6 left-8" aria-label="Fauxcus home">
        <Logo variant="black" scale="secondary" />
      </Link>
      {children}
      {/* Real destinations, not placeholders — "..." literally was the
          href before (a dead link, not filler text). No in-app contact
          form or about page exists, so these point at what actually
          does: the repo's issues for contact, its README for about. */}
      <div className="absolute bottom-0 left-0 flex w-full justify-center gap-6 bg-[#f8f9fa] p-4 text-sm">
        <a href="https://github.com/danielbkuti/fauxcus/issues" target="_blank" rel="noopener noreferrer">
          Contact Us
        </a>
        <a href="https://github.com/danielbkuti/fauxcus" target="_blank" rel="noopener noreferrer">
          About
        </a>
      </div>
    </div>
  )
}

// Shell for every authenticated page (Home, Tasks, Goals, Calendar,
// Progress) — NavBar is one persistent element shared across all of
// them, same pattern as PublicLayout above.
function AuthenticatedLayout({ firstName, onLogout }) {
  return (
    // TaskStoreProvider lives here, one level above every authenticated
    // page and the FAB — a single shared fetch of the task list that
    // Dashboard/TaskList/TaskDetailPage/AddTaskFab all read and write
    // through, instead of each independently fetching its own copy.
    // AddTaskFabProvider is the same idea for one boolean: whether the
    // FAB's menu is open — CalendarPage's empty-day state opens it too,
    // not just the FAB button itself, so that state can't stay local to
    // AddTaskFab the way it used to.
    <TaskStoreProvider>
      <AddTaskFabProvider>
        <div className="flex min-h-screen flex-col bg-background">
          <NavBar firstName={firstName} onLogout={onLogout} />
          {/* NavBar is fixed, and taller on narrow screens (it grows a second
              link row below md) — pt-28 clears that worst case, pt-16 clears
              the single-row desktop height (h-16) from md up. flex-1 here
              (plus flex-col on the root above) is what pins Footer to the
              viewport bottom on short pages (e.g. the new-task form) instead
              of it trailing off right under the content with a gap of bare
              background below — same sticky-footer pattern as any page with
              variable content height. */}
          <div className="flex flex-1 flex-col pt-28 md:pt-16">
            <div className="flex-1">
              <Outlet />
            </div>
            <Footer />
          </div>
          <AddTaskFab />
        </div>
      </AddTaskFabProvider>
    </TaskStoreProvider>
  )
}

function App() {
  // 'loading' | 'authenticated' | 'anonymous'
  const [authState, setAuthState] = useState('loading')
  const [username, setUsername] = useState(null)
  const [firstName, setFirstName] = useState('')
  // Set only by handleAuthSuccess (an actual login/signup/reset this
  // session) — never by the silent checkAuth() on load — so Dashboard's
  // welcome-name animation plays once right after signing in, not on
  // every later visit to /home. Dashboard consumes it on mount via
  // onWelcomeSeen, so it doesn't replay on a later navigation back here.
  const [justLoggedIn, setJustLoggedIn] = useState(false)

  useEffect(() => {
    checkAuth()
      .then((data) => {
        if (data.authenticated) {
          setUsername(data.username)
          setFirstName(data.first_name)
          setAuthState('authenticated')
        } else {
          setAuthState('anonymous')
        }
      })
      .catch(() => setAuthState('anonymous'))
  }, [])

  async function handleLogout() {
    await logout()
    setUsername(null)
    setFirstName('')
    setAuthState('anonymous')
  }

  function handleAuthSuccess(data) {
    setUsername(data.username)
    setFirstName(data.first_name)
    setAuthState('authenticated')
    setJustLoggedIn(true)
  }

  if (authState === 'loading') {
    // Shape guess: a nav bar + content block, since a return visit
    // (the common case for a task app) resolves into AuthenticatedLayout
    // — avoids a layout jump into the real NavBar once auth resolves,
    // unlike a plain centered "Loading…" string.
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="border-b">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <Skeleton className="h-8 w-32 rounded-full" />
            <div className="hidden items-center gap-6 md:flex">
              <Skeleton className="h-4 w-14 rounded-full" />
              <Skeleton className="h-4 w-14 rounded-full" />
              <Skeleton className="h-4 w-16 rounded-full" />
              <Skeleton className="h-4 w-18 rounded-full" />
            </div>
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <Skeleton className="h-40 w-full rounded-3xl" />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  const isAuthenticated = authState === 'authenticated'

  // A single route tree for both auth states, rather than an early
  // return that bypasses routing entirely once logged in: the URL bar
  // now actually reflects where you are, refresh and back/forward work,
  // and each route decides for itself whether the current auth state is
  // allowed there — landing/login/signup redirect an already
  // authenticated visitor straight to /home, and every authenticated
  // page redirects an anonymous one back to /.
  return (
    <Routes>
      {/* Every public route nests under PublicLayout, so the gradient is
          one persistent element shared across all of them, not a copy
          re-painted per page. */}
      <Route element={<PublicLayout />}>
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to="/home" replace /> : <LandingPage />}
        />
        <Route
          path="/login"
          element={
            isAuthenticated ? (
              <Navigate to="/home" replace />
            ) : (
              <AuthLayout>
                <LoginForm onLoginSuccess={handleAuthSuccess} />
              </AuthLayout>
            )
          }
        />
        <Route
          path="/signup"
          element={
            isAuthenticated ? (
              <Navigate to="/home" replace />
            ) : (
              <AuthLayout>
                <SignupForm />
              </AuthLayout>
            )
          }
        />
        <Route
          path="/signup/verify/:token"
          element={
            isAuthenticated ? (
              <Navigate to="/home" replace />
            ) : (
              <AuthLayout>
                <SignupVerify onSignupSuccess={handleAuthSuccess} />
              </AuthLayout>
            )
          }
        />
        <Route
          path="/forgot-password"
          element={
            isAuthenticated ? (
              <Navigate to="/home" replace />
            ) : (
              <AuthLayout>
                <ForgotPasswordForm />
              </AuthLayout>
            )
          }
        />
        <Route
          path="/reset-password/:uidb64/:token"
          element={
            isAuthenticated ? (
              <Navigate to="/home" replace />
            ) : (
              <AuthLayout>
                <ResetPasswordForm onResetSuccess={handleAuthSuccess} />
              </AuthLayout>
            )
          }
        />
      </Route>

      {/* Every authenticated route nests under AuthenticatedLayout, so
          the guard (redirect anonymous visitors to /) only needs to
          live in one place instead of being repeated per page. */}
      <Route
        element={
          isAuthenticated ? (
            <AuthenticatedLayout firstName={firstName} onLogout={handleLogout} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      >
        <Route
          path="/home"
          element={
            <Dashboard
              firstName={firstName}
              username={username}
              justLoggedIn={justLoggedIn}
              onWelcomeSeen={() => setJustLoggedIn(false)}
            />
          }
        />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/new" element={<NewTaskPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/goals" element={<ComingSoonPage title="Goals" />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      {/* Unmatched paths land on the real homepage (or the dashboard, if
          already logged in), not a dead end. */}
      <Route path="*" element={<Navigate to={isAuthenticated ? '/home' : '/'} replace />} />
    </Routes>
  )
}

export default App
