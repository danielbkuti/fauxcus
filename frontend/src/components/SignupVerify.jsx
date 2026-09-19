import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SignupProgress } from '@/components/SignupProgress'
import { checkPendingSignup, verifySignupCode, startSignup, submitSignupDetails, completeSignup } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Same boxed-field pattern used everywhere else in the auth forms.
// type="password" fields get a show/hide toggle for free — each
// instance tracks its own visibility, so revealing password1 doesn't
// also reveal password2.
function AuthField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  focused,
  onFocus,
  onBlur,
  error,
  autoComplete,
  required = true,
  inputMode,
  spellCheck,
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={cn(
          'flex flex-col gap-0.5 rounded-t-md border-b-2 bg-black/5 px-3 pt-2 pb-1.5 transition-colors',
          focused ? 'border-sky-400 bg-[#8ec5fc]/20' : 'border-black/30'
        )}
      >
        <label
          htmlFor={id}
          className={cn(
            'text-xs font-medium transition-colors',
            focused ? 'text-sky-500' : 'text-black/60'
          )}
        >
          {label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type={isPassword && visible ? 'text' : type}
            value={value}
            onChange={onChange}
            onFocus={onFocus}
            onBlur={onBlur}
            autoComplete={autoComplete}
            required={required}
            inputMode={inputMode}
            spellCheck={spellCheck}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-black outline-none"
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              tabIndex={-1}
              aria-label={visible ? 'Hide password' : 'Show password'}
              className="text-black/50 hover:text-black/80"
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// Splits a backend error payload (field -> [{message, code}]) into a
// per-field map plus a general/__all__ message. Same shape used by every
// other form in this app.
function splitErrors(errors) {
  const { __all__, ...perField } = errors
  const fieldErrors = {}
  for (const [field, issues] of Object.entries(perField)) {
    fieldErrors[field] = issues[0]?.message
  }
  return { fieldErrors, generalError: __all__?.[0]?.message ?? null }
}

// The page SignupForm navigates to right after step 1. Handles step 2
// (entering the emailed code), 3 (name/username), and 4 (password) all
// in one place — once the code's been typed in, the rest of the flow
// is a normal continuous session, same as it always was past that
// point.
export function SignupVerify({ onSignupSuccess }) {
  const { token } = useParams()

  // 'loading' | 'invalid' | 'code' | 'details' | 'password'
  const [status, setStatus] = useState('loading')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [resendState, setResendState] = useState('idle') // 'idle' | 'sending' | 'sent'
  const [values, setValues] = useState({
    firstName: '',
    lastName: '',
    username: '',
    password1: '',
    password2: '',
  })
  const [focusedField, setFocusedField] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [generalError, setGeneralError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    checkPendingSignup(token)
      .then((data) => {
        setEmail(data.email)
        setValues((v) => ({
          ...v,
          firstName: data.first_name,
          lastName: data.last_name,
          username: data.username,
        }))
        if (!data.email_verified) {
          setStatus('code')
          return
        }
        // Resuming a signup that already finished step 3 (e.g. a page
        // refresh) skips straight to the password step instead of
        // asking for the name again.
        setStatus(data.first_name && data.last_name ? 'password' : 'details')
      })
      .catch(() => setStatus('invalid'))
  }, [token])

  const setValue = (field) => (e) =>
    setValues((v) => ({ ...v, [field]: e.target.value }))

  const focusHandlers = (field) => ({
    onFocus: () => setFocusedField(field),
    onBlur: () => setFocusedField((f) => (f === field ? null : f)),
  })

  async function handleCodeSubmit(event) {
    event.preventDefault()
    setGeneralError(null)
    setSubmitting(true)

    try {
      const data = await verifySignupCode(token, code)
      setValues((v) => ({
        ...v,
        firstName: data.first_name,
        lastName: data.last_name,
        username: data.username,
      }))
      setStatus(data.first_name && data.last_name ? 'password' : 'details')
    } catch (err) {
      setGeneralError(err.data?.detail ?? 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    setResendState('sending')
    setGeneralError(null)
    try {
      await startSignup(email)
      setCode('')
      setResendState('sent')
      // Swaps the "on its way" note back to a live resend link after a
      // bit — otherwise a second genuinely-lost code would leave no way
      // back to the button without a refresh.
      setTimeout(() => setResendState((s) => (s === 'sent' ? 'idle' : s)), 15000)
    } catch {
      setResendState('idle')
      setGeneralError('Could not resend the code. Please try again.')
    }
  }

  async function handleDetailsSubmit(event) {
    event.preventDefault()
    setFieldErrors({})
    setGeneralError(null)
    setSubmitting(true)

    try {
      await submitSignupDetails(token, values)
      setStatus('password')
    } catch (err) {
      if (err.data?.errors) {
        const { fieldErrors, generalError } = splitErrors(err.data.errors)
        setFieldErrors(fieldErrors)
        setGeneralError(generalError)
      } else {
        setGeneralError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault()
    setFieldErrors({})
    setGeneralError(null)
    setSubmitting(true)

    try {
      const data = await completeSignup(token, values)
      onSignupSuccess(data)
    } catch (err) {
      if (err.data?.errors) {
        const { fieldErrors, generalError } = splitErrors(err.data.errors)
        setFieldErrors(fieldErrors)
        setGeneralError(generalError)
      } else {
        setGeneralError(err.data?.detail ?? 'Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          <p className="text-sm text-black/70">One moment…</p>
        </CardContent>
      </Card>
    )
  }

  if (status === 'invalid') {
    return (
      <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          <h2 className="text-2xl font-bold text-black">Signup no longer valid</h2>
          <p className="text-sm text-black/70">
            This signup has expired. Start again below.
          </p>
          <Link to="/signup" className="text-sm font-semibold text-sky-600 hover:underline">
            Back to signup
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (status === 'code') {
    return (
      <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
        <CardContent className="flex flex-col gap-5 pt-6">
          <SignupProgress currentStep="verify" />

          <div className="flex flex-col gap-2 text-center">
            <h2 className="text-2xl font-bold text-black">Check your email</h2>
            <p className="text-sm text-black/70">
              We sent a 6-digit code to <span className="font-semibold">{email}</span>.
              Enter it below to continue.
            </p>
          </div>

          <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
            <AuthField
              id="code"
              label="Verification code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              focused={focusedField === 'code'}
              autoComplete="one-time-code"
              inputMode="numeric"
              spellCheck={false}
              {...focusHandlers('code')}
            />

            {generalError && <p className="text-xs text-destructive">{generalError}</p>}

            <Button
              type="submit"
              disabled={submitting || code.length !== 6}
              className="w-full rounded-full py-3 text-base font-semibold hover:bg-[#8ec5fc] hover:text-black"
            >
              {submitting ? 'Verifying…' : 'Verify'}
            </Button>
          </form>

          <p className="text-center text-xs text-black/70">
            {resendState === 'sent' ? (
              'A new code is on its way.'
            ) : (
              <>
                Didn&apos;t get a code?{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendState === 'sending'}
                  className="font-semibold text-sky-600 hover:underline disabled:opacity-60"
                >
                  {resendState === 'sending' ? 'Sending…' : 'Resend it'}
                </button>
              </>
            )}
          </p>

          {/* Real gap before this: resending only ever re-sends to the
              same address (`email` above, fixed on this token), so a
              mistyped email had no way back at all short of manually
              editing the URL. Restarts signup from scratch rather than
              editing the email in place — this token's PendingSignup
              row is bound to the original address, there's no
              "change the email on an existing pending signup" endpoint
              to call instead. */}
          <p className="text-center text-xs text-black/70">
            Wrong email?{' '}
            <Link to="/signup" className="font-semibold text-sky-600 hover:underline">
              Start over
            </Link>
          </p>
        </CardContent>
      </Card>
    )
  }

  if (status === 'details') {
    return (
      <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
        <CardContent className="flex flex-col gap-5 pt-6">
          <SignupProgress currentStep="details" />

          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold text-black">Tell us about you</h2>
            <p className="text-sm text-black/70">
              Email verified — just a couple more details.
            </p>
          </div>

          <form onSubmit={handleDetailsSubmit} className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <AuthField
                  id="firstName"
                  label="First name"
                  value={values.firstName}
                  onChange={setValue('firstName')}
                  focused={focusedField === 'firstName'}
                  error={fieldErrors.first_name}
                  autoComplete="given-name"
                  {...focusHandlers('firstName')}
                />
              </div>
              <div className="flex-1">
                <AuthField
                  id="lastName"
                  label="Last name"
                  value={values.lastName}
                  onChange={setValue('lastName')}
                  focused={focusedField === 'lastName'}
                  error={fieldErrors.last_name}
                  autoComplete="family-name"
                  {...focusHandlers('lastName')}
                />
              </div>
            </div>

            <AuthField
              id="username"
              label="Username (optional)"
              value={values.username}
              onChange={setValue('username')}
              focused={focusedField === 'username'}
              error={fieldErrors.username}
              autoComplete="username"
              required={false}
              {...focusHandlers('username')}
            />

            {generalError && <p className="text-xs text-destructive">{generalError}</p>}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full py-3 text-base font-semibold hover:bg-[#8ec5fc] hover:text-black"
            >
              {submitting ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  // status === 'password'
  const greetingName = values.firstName || values.username || 'there'

  return (
    <Card className="w-full max-w-sm zoom-[1.125] border-transparent bg-[#f8f9fa] text-black shadow-2xl">
      <CardContent className="flex flex-col gap-5 pt-6">
        <SignupProgress currentStep="password" />

        <button
          type="button"
          onClick={() => setStatus('details')}
          className="flex w-fit items-center gap-1 text-sm font-semibold text-sky-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Edit username
        </button>

        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-black">Welcome, {greetingName}</h2>
          <p className="text-sm text-black/70">
            Please provide a password to finish creating your account.
          </p>
        </div>

        {/* Mirrors the backend's actual AUTH_PASSWORD_VALIDATORS config
            (backend/flexmaster/settings.py) — keep in sync if that list
            changes. */}
        <ul className="list-disc space-y-0.5 rounded-md bg-black/5 px-4 py-3 pl-8 text-xs text-black/60">
          <li>At least 8 characters</li>
          <li>Not entirely numbers</li>
          <li>Not a commonly used password</li>
          <li>Not too similar to your name, username, or email</li>
        </ul>

        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
          <AuthField
            id="password1"
            label="Password"
            type="password"
            value={values.password1}
            onChange={setValue('password1')}
            focused={focusedField === 'password1'}
            error={fieldErrors.password1}
            autoComplete="new-password"
            {...focusHandlers('password1')}
          />

          <AuthField
            id="password2"
            label="Confirm password"
            type="password"
            value={values.password2}
            onChange={setValue('password2')}
            focused={focusedField === 'password2'}
            error={fieldErrors.password2}
            autoComplete="new-password"
            {...focusHandlers('password2')}
          />

          {generalError && <p className="text-xs text-destructive">{generalError}</p>}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full py-3 text-base font-semibold hover:bg-[#8ec5fc] hover:text-black"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
