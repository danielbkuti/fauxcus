import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Logo } from '@/components/Logo'
import { login } from '@/lib/auth'
import { cn } from '@/lib/utils'

export function LoginForm({ onLoginSuccess }) {
  // Pre-filled when arriving from the landing page's email box, which
  // already checked this address belongs to an existing account — saves
  // retyping it here.
  const location = useLocation()
  const [username, setUsername] = useState(location.state?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  // Off by default — the backend's own default is a session that ends
  // when the browser closes (see settings.SESSION_EXPIRE_AT_BROWSER_CLOSE);
  // checking this is what opts into a persistent, 2-week login instead.
  const [rememberMe, setRememberMe] = useState(false)
  // Tracks which field currently has focus ('username' | 'password' | null)
  // so we can highlight that field's label + input together while it's
  // being typed in.
  const [focusedField, setFocusedField] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const data = await login(username, password, rememberMe)
      onLoginSuccess(data)
    } catch (err) {
      // Our login_api view puts form errors under err.data.errors.__all__.
      // A 429 (too many failed attempts — see login_api's rate limit)
      // carries its own message under err.data.detail instead, since
      // there's no form at that point to attach a field error to.
      const message =
        err.status === 429
          ? (err.data?.detail ?? 'Too many failed login attempts. Please wait a few minutes and try again.')
          : (err.data?.errors?.__all__?.[0]?.message ?? 'Login failed. Please try again.')
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
      <CardContent className="flex flex-col gap-5 pt-6">
        {/* 1. Small wordmark, top-left — not the main headline anymore */}
        <Logo scale="secondary" className="self-center" />

        {/* 2 & 3. Bold left-aligned headline + muted description */}
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-black">Welcome back</h2>
          <p className="text-sm text-black/70">
            Log in to your Fauxcus account to manage your tasks.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 4. Field = a single filled box, underline-only border, label
              living inside the box above the typed value — not a separate
              label + bordered input like before. */}
          <div
            className={cn(
              'flex flex-col gap-0.5 rounded-t-md border-b-2 bg-black/5 px-3 pt-2 pb-1.5 transition-colors',
              focusedField === 'username' ? 'border-sky-400 bg-[#8ec5fc]/20' : 'border-black/30'
            )}
          >
            <label
              htmlFor="username"
              className={cn(
                'text-xs font-medium transition-colors',
                focusedField === 'username' ? 'text-sky-500' : 'text-black/60'
              )}
            >
              Username or Email
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onFocus={() => setFocusedField('username')}
              onBlur={() => setFocusedField((f) => (f === 'username' ? null : f))}
              autoComplete="username"
              spellCheck={false}
              className="border-0 bg-transparent p-0 text-sm text-black outline-none"
              required
            />
          </div>

          <div
            className={cn(
              'flex flex-col gap-0.5 rounded-t-md border-b-2 bg-black/5 px-3 pt-2 pb-1.5 transition-colors',
              focusedField === 'password' ? 'border-sky-400 bg-[#8ec5fc]/20' : 'border-black/30'
            )}
          >
            <label
              htmlFor="password"
              className={cn(
                'text-xs font-medium transition-colors',
                focusedField === 'password' ? 'text-sky-500' : 'text-black/60'
              )}
            >
              Password
            </label>
            <div className="flex items-center gap-2">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField((f) => (f === 'password' ? null : f))}
                autoComplete="current-password"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-black outline-none"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="text-black/50 hover:text-black/80"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs font-medium text-black/70">
              <Checkbox
                checked={rememberMe}
                onCheckedChange={(value) => setRememberMe(value === true)}
              />
              Remember me
            </label>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-sky-600 hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          {/* 5. Error directly under the fields, small + red */}
          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* 6. Full-width, fully pill-shaped button */}
          <Button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full py-3 text-base font-semibold hover:bg-[#8ec5fc] hover:text-black"
          >
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>

        {/* 7. Divider + secondary info block */}
        <hr className="border-black/10" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-bold text-black">Stay on top of everything.</p>
          <p className="text-xs text-black/70">
            Fauxcus keeps your tasks, subtasks, and deadlines in one place — synced the
            moment you log in.
          </p>
        </div>

        {/* 8. Sign-up link — now a real in-app route (client-side nav via
            react-router, no full page reload). */}
        <p className="text-xs text-black/70">
          Don&apos;t have an account?{' '}
          <Link
            to="/signup"
            className="font-semibold text-sky-600 underline-offset-2 hover:underline"
          >
            Sign up here
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
