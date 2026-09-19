import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { requestPasswordReset } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Step 1 of forgot-password — just an email, same shape as SignupForm's
// own first step. Always ends on the same "check your email" state
// regardless of whether the address actually has an account — the
// backend deliberately doesn't say either way (see
// password_reset_request_api), so this can't reveal it either.
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await requestPasswordReset(email)
      setSubmitted(true)
    } catch (err) {
      const message =
        err.status === 429
          ? (err.data?.detail ?? 'Too many requests. Please wait a while and try again.')
          : (err.data?.errors?.email?.[0]?.message ?? 'Something went wrong. Please try again.')
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <Logo scale="secondary" />
          <h2 className="text-2xl font-bold text-black">Check your email</h2>
          <p className="text-sm text-black/70">
            If an account exists for <span className="font-semibold">{email}</span>, we&apos;ve
            sent a link to reset its password.
          </p>
          <Link
            to="/login"
            className="mt-2 text-sm font-semibold text-sky-600 hover:underline"
          >
            Back to login
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
      <CardContent className="flex flex-col gap-5 pt-6">
        <Logo scale="secondary" className="self-center" />

        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-black">Reset your password</h2>
          <p className="text-sm text-black/70">
            Enter your account email and we&apos;ll send you a link to choose a new password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div
            className={cn(
              'flex flex-col gap-0.5 rounded-t-md border-b-2 bg-black/5 px-3 pt-2 pb-1.5 transition-colors',
              focused ? 'border-sky-400 bg-[#8ec5fc]/20' : 'border-black/30'
            )}
          >
            <label
              htmlFor="email"
              className={cn(
                'text-xs font-medium transition-colors',
                focused ? 'text-sky-500' : 'text-black/60'
              )}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoComplete="email"
              spellCheck={false}
              className="border-0 bg-transparent p-0 text-sm text-black outline-none"
              required
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full py-3 text-base font-semibold hover:bg-[#8ec5fc] hover:text-black"
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>

        <hr className="border-black/10" />

        <p className="text-xs text-black/70">
          Remembered it after all?{' '}
          <Link
            to="/login"
            className="font-semibold text-sky-600 underline-offset-2 hover:underline"
          >
            Back to login
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
