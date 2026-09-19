import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SignupProgress } from '@/components/SignupProgress'
import { Logo } from '@/components/Logo'
import { checkEmailExists, startSignup } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Step 1 of the multi-step signup flow — just an email. Step 2 (code
// entry) happens on /signup/verify/:token (see SignupVerify.jsx) —
// this component's job ends the moment the email is sent; it navigates
// there itself with the token startSignup() hands back, rather than
// requiring the user to open their inbox and click a link.
export function SignupForm() {
  // Pre-filled when arriving from the landing page's email box, which
  // already checked this address is unrecognized — saves retyping it here.
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState(location.state?.email ?? '')
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      // Check first rather than let startSignup's own "already exists"
      // validation fire — an existing account means this person actually
      // wants to log in, so send them there with the email already
      // filled in instead of just showing an error on a form they can't
      // usefully submit.
      const { exists } = await checkEmailExists(email)
      if (exists) {
        navigate('/login', { state: { email } })
        return
      }

      const { token } = await startSignup(email)
      navigate(`/signup/verify/${token}`)
      return
    } catch (err) {
      // Fallback for the same "already exists" case if it somehow still
      // reaches startSignup (e.g. an account created between the check
      // above and this submit) — same redirect, not a dead-end error.
      if (err.data?.errors?.email?.[0]?.message?.includes('already exists')) {
        navigate('/login', { state: { email } })
        return
      }
      const message =
        err.data?.errors?.email?.[0]?.message ?? 'Something went wrong. Please try again.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
      <CardContent className="flex flex-col gap-5 pt-6">
        <SignupProgress currentStep="email" />

        <Logo scale="secondary" className="self-center" />

        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-black">Create your account</h2>
          <p className="text-sm text-black/70">Enter your email to get started.</p>
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
            {submitting ? 'Sending…' : 'Continue'}
          </Button>
        </form>

        <hr className="border-black/10" />

        <p className="text-xs text-black/70">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-sky-600 underline-offset-2 hover:underline"
          >
            Log in here
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
