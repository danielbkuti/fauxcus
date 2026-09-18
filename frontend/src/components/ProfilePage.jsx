import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchProfile, updateProfile, changePassword, deleteAccount, logout } from '@/lib/auth'
import { formatDeadline } from '@/lib/utils'

// Same shape as ResetPasswordForm/SignupVerify's own splitErrors — a
// Django `form.errors.get_json_data()` payload is `{field: [{message,
// code}]}` plus an optional `__all__` for whole-form errors. Duplicated
// rather than shared, matching how every other form in this app already
// hand-rolls this (see ResetPasswordForm.jsx's own copy).
function splitErrors(errors) {
  const { __all__, ...perField } = errors ?? {}
  const fieldErrors = {}
  for (const [field, issues] of Object.entries(perField)) {
    fieldErrors[field] = issues[0]?.message
  }
  return { fieldErrors, generalError: __all__?.[0]?.message ?? null }
}

// Show/hide password field — same pattern as ResetPasswordForm's own
// AuthField, simplified (this page's fields sit inside a plain Card,
// not the auth screens' boxed/floating-label look).
function PasswordField({ id, label, value, onChange, error, autoComplete }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required
          className="pr-8"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// The nav bar's User icon now links here — previously decorative (see
// HANDOFF.md's "Known gaps"). Three independent sections, each its own
// form/save action rather than one page-wide submit: personal info,
// password, and — since an account settings page without one is
// missing something real users expect — a danger-zone account
// deletion.
export function ProfilePage() {
  const navigate = useNavigate()

  // 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('loading')
  const [profile, setProfile] = useState(null)

  // --- Personal info ---
  const [infoValues, setInfoValues] = useState({ firstName: '', lastName: '', username: '', dateOfBirth: '' })
  const [infoErrors, setInfoErrors] = useState({})
  const [infoGeneralError, setInfoGeneralError] = useState(null)
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoSaved, setInfoSaved] = useState(false)

  // --- Change password ---
  const [pwValues, setPwValues] = useState({ currentPassword: '', password1: '', password2: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [pwGeneralError, setPwGeneralError] = useState(null)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)

  // --- Danger zone ---
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchProfile()
      .then((data) => {
        setProfile(data)
        setInfoValues({
          firstName: data.first_name,
          lastName: data.last_name,
          username: data.username,
          dateOfBirth: data.date_of_birth ?? '',
        })
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  async function handleSaveInfo(event) {
    event.preventDefault()
    setInfoErrors({})
    setInfoGeneralError(null)
    setInfoSaved(false)
    setInfoSaving(true)
    try {
      const data = await updateProfile(infoValues)
      setProfile(data)
      setInfoSaved(true)
    } catch (err) {
      if (err.data?.errors) {
        const { fieldErrors, generalError } = splitErrors(err.data.errors)
        setInfoErrors(fieldErrors)
        setInfoGeneralError(generalError)
      } else {
        setInfoGeneralError(err.data?.detail ?? 'Could not save your profile.')
      }
    } finally {
      setInfoSaving(false)
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault()
    setPwErrors({})
    setPwGeneralError(null)
    setPwSaved(false)
    setPwSaving(true)
    try {
      await changePassword(pwValues)
      setPwValues({ currentPassword: '', password1: '', password2: '' })
      setPwSaved(true)
    } catch (err) {
      if (err.data?.errors) {
        const { fieldErrors, generalError } = splitErrors(err.data.errors)
        setPwErrors(fieldErrors)
        setPwGeneralError(generalError)
      } else {
        setPwGeneralError(err.data?.detail ?? 'Could not change your password.')
      }
    } finally {
      setPwSaving(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleteError(null)
    setDeleting(true)
    try {
      await deleteAccount(deletePassword)
      // The account's gone — no session left to log out of, just get
      // back to a clean anonymous state and off this now-404 page.
      await logout().catch(() => {})
      navigate('/')
      window.location.reload()
    } catch (err) {
      const { fieldErrors, generalError } = splitErrors(err.data?.errors)
      setDeleteError(fieldErrors.password ?? generalError ?? err.data?.detail ?? 'Could not delete your account.')
      setDeleting(false)
    }
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-2xl px-8 py-8">
        <p className="text-sm text-destructive">Couldn&apos;t load your profile.</p>
      </div>
    )
  }

  const loading = status === 'loading'
  // Falls back to the username whenever both name fields are blank —
  // a brand-new account before it's ever filled in Personal Info below.
  const displayName = profile && ([profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      {/* Hero — same starfield/gradient-ring treatment as Home/Progress/
          Calendar (see Dashboard.jsx's own hero), sized down for this
          narrower page instead of the wide viewport-spanning version.
          Renders unconditionally, loading or not — only the name/email
          text inside is skeletoned — so there's no jarring swap from a
          generic skeleton block into a completely different-looking
          hero once the fetch resolves. */}
      <div
        className="relative overflow-hidden rounded-[18px] bg-cover bg-center p-[26px] shadow-[0_18px_40px_-28px_rgba(37,37,37,.65)]"
        style={{ backgroundImage: 'url(/starfield-bg.jpg)' }}
      >
        <span aria-hidden="true" className="gradient-ring" style={{ zIndex: 3 }} />
        <div className="relative z-[2] flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/10 outline outline-1 -outline-offset-1 outline-white/20 backdrop-blur-[6px]">
            <User className="size-6 text-white/85" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[.12em] text-white/55">Account</span>
            {loading ? (
              <>
                <Skeleton className="h-7 w-40 rounded-md bg-white/20" />
                <Skeleton className="h-4 w-56 max-w-full rounded-full bg-white/15" />
              </>
            ) : (
              <>
                <h1 className="truncate font-display text-2xl font-bold tracking-[-.02em] text-white">{displayName}</h1>
                <p className="truncate text-sm text-white/62">
                  {profile.email} · Joined {formatDeadline(profile.date_joined)}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        [0, 1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40 rounded-md" />
              <Skeleton className="mt-1.5 h-3.5 w-64 max-w-full rounded-full" />
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <Skeleton className="h-9 w-full max-w-sm rounded-md" />
                {i < 2 && <Skeleton className="h-9 w-full max-w-sm rounded-md" />}
                <Skeleton className="h-9 w-28 rounded-md" />
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <>
      {/* ---------------------------------------------------- Personal info */}
      <Card>
        <CardHeader>
          <CardTitle>Personal info</CardTitle>
          <CardDescription>Your name, username, and date of birth.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveInfo} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="first-name">First name</Label>
                <Input
                  id="first-name"
                  value={infoValues.firstName}
                  onChange={(e) => setInfoValues((v) => ({ ...v, firstName: e.target.value }))}
                  autoComplete="given-name"
                  required
                />
                {infoErrors.first_name && <p className="text-xs text-destructive">{infoErrors.first_name}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="last-name">Last name</Label>
                <Input
                  id="last-name"
                  value={infoValues.lastName}
                  onChange={(e) => setInfoValues((v) => ({ ...v, lastName: e.target.value }))}
                  autoComplete="family-name"
                  required
                />
                {infoErrors.last_name && <p className="text-xs text-destructive">{infoErrors.last_name}</p>}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={infoValues.username}
                onChange={(e) => setInfoValues((v) => ({ ...v, username: e.target.value }))}
                autoComplete="username"
                spellCheck={false}
                required
              />
              {infoErrors.username && <p className="text-xs text-destructive">{infoErrors.username}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="date-of-birth">Date of birth</Label>
              <Input
                id="date-of-birth"
                type="date"
                value={infoValues.dateOfBirth ?? ''}
                onChange={(e) => setInfoValues((v) => ({ ...v, dateOfBirth: e.target.value }))}
                max={new Date().toISOString().slice(0, 10)}
                className="w-fit"
              />
              {infoErrors.date_of_birth && <p className="text-xs text-destructive">{infoErrors.date_of_birth}</p>}
            </div>

            {infoGeneralError && <p className="text-xs text-destructive">{infoGeneralError}</p>}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={infoSaving}>
                {infoSaving ? 'Saving…' : 'Save changes'}
              </Button>
              {infoSaved && <span className="text-xs font-medium text-emerald-700">Saved.</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ------------------------------------------------- Change password */}
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Requires your current password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <PasswordField
              id="current-password"
              label="Current password"
              value={pwValues.currentPassword}
              onChange={(e) => setPwValues((v) => ({ ...v, currentPassword: e.target.value }))}
              autoComplete="current-password"
              error={pwErrors.current_password}
            />
            <PasswordField
              id="new-password"
              label="New password"
              value={pwValues.password1}
              onChange={(e) => setPwValues((v) => ({ ...v, password1: e.target.value }))}
              autoComplete="new-password"
              error={pwErrors.password1}
            />
            <PasswordField
              id="confirm-password"
              label="Confirm new password"
              value={pwValues.password2}
              onChange={(e) => setPwValues((v) => ({ ...v, password2: e.target.value }))}
              autoComplete="new-password"
              error={pwErrors.password2}
            />

            {pwGeneralError && <p className="text-xs text-destructive">{pwGeneralError}</p>}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pwSaving}>
                {pwSaving ? 'Changing…' : 'Change password'}
              </Button>
              {pwSaved && <span className="text-xs font-medium text-emerald-700">Password changed.</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------- Danger zone */}
      <Card className="ring-red-200">
        <CardHeader>
          <CardTitle className="text-red-700">Delete account</CardTitle>
          <CardDescription>Permanently deletes your account and every task in it. This can&apos;t be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          {confirmingDelete ? (
            <div className="flex flex-col gap-3">
              <PasswordField
                id="delete-password"
                label="Confirm your password to delete your account"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoComplete="current-password"
              />
              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={deleting || !deletePassword}
                >
                  {deleting ? 'Deleting…' : 'Permanently delete my account'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setConfirmingDelete(false)
                    setDeletePassword('')
                    setDeleteError(null)
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
              Delete my account
            </Button>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  )
}
