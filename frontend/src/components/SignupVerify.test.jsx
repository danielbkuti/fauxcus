import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SignupVerify } from './SignupVerify'
import {
  checkPendingSignup,
  verifySignupCode,
  startSignup,
  submitSignupDetails,
  completeSignup,
} from '@/lib/auth'

vi.mock('@/lib/auth', () => ({
  checkPendingSignup: vi.fn(),
  verifySignupCode: vi.fn(),
  startSignup: vi.fn(),
  submitSignupDetails: vi.fn(),
  completeSignup: vi.fn(),
}))

function renderSignupVerify(onSignupSuccess = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/signup/verify/tok123']}>
      <Routes>
        <Route
          path="/signup/verify/:token"
          element={<SignupVerify onSignupSuccess={onSignupSuccess} />}
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('SignupVerify (signup steps 2-4: code, details, password)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "signup no longer valid" for a bad/expired token', async () => {
    checkPendingSignup.mockRejectedValue(new Error('not found'))
    renderSignupVerify()

    expect(await screen.findByText(/signup no longer valid/i)).toBeInTheDocument()
  })

  it('shows a code-entry error message from the backend', async () => {
    const user = userEvent.setup()
    checkPendingSignup.mockResolvedValue({
      email: 'new@test.com',
      email_verified: false,
      first_name: '',
      last_name: '',
      username: '',
    })
    const error = new Error('bad code')
    error.data = { detail: "That code isn't right. 4 attempt(s) left." }
    verifySignupCode.mockRejectedValue(error)
    renderSignupVerify()

    await screen.findByText(/check your email/i)
    await user.type(screen.getByLabelText(/verification code/i), '000000')
    await user.click(screen.getByRole('button', { name: /verify/i }))

    expect(await screen.findByText("That code isn't right. 4 attempt(s) left.")).toBeInTheDocument()
  })

  it('resends the code on request', async () => {
    const user = userEvent.setup()
    checkPendingSignup.mockResolvedValue({
      email: 'new@test.com',
      email_verified: false,
      first_name: '',
      last_name: '',
      username: '',
    })
    startSignup.mockResolvedValue({ token: 'tok123' })
    renderSignupVerify()

    await screen.findByText(/check your email/i)
    await user.click(screen.getByRole('button', { name: /resend it/i }))

    await waitFor(() => expect(startSignup).toHaveBeenCalledWith('new@test.com'))
    expect(await screen.findByText(/a new code is on its way/i)).toBeInTheDocument()
  })

  it('walks code → details → password → onSignupSuccess end to end', async () => {
    const user = userEvent.setup()
    const onSignupSuccess = vi.fn()

    checkPendingSignup.mockResolvedValue({
      email: 'new@test.com',
      email_verified: false,
      first_name: '',
      last_name: '',
      username: '',
    })
    // Code verifies, but no name on file yet — next is the details step.
    verifySignupCode.mockResolvedValue({
      email_verified: true,
      first_name: '',
      last_name: '',
      username: '',
    })
    submitSignupDetails.mockResolvedValue({
      success: true,
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
    })
    completeSignup.mockResolvedValue({ success: true, authenticated: true, username: 'ada' })

    renderSignupVerify(onSignupSuccess)

    // Step 2: code
    await screen.findByText(/check your email/i)
    await user.type(screen.getByLabelText(/verification code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify/i }))
    await waitFor(() => expect(verifySignupCode).toHaveBeenCalledWith('tok123', '123456'))

    // Step 3: details
    await screen.findByText(/tell us about you/i)
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    // Called with the form's whole `values` state, not just the three
    // fields this step edits — submitSignupDetails itself destructures
    // only firstName/lastName/username back out of it.
    await waitFor(() =>
      expect(submitSignupDetails).toHaveBeenCalledWith('tok123', {
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: '',
        password1: '',
        password2: '',
      })
    )

    // Step 4: password
    await screen.findByText(/welcome, ada/i)
    await user.type(screen.getByLabelText(/^password$/i), 'S3cure!Pass')
    await user.type(screen.getByLabelText(/confirm password/i), 'S3cure!Pass')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(completeSignup).toHaveBeenCalledWith('tok123', {
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: '',
        password1: 'S3cure!Pass',
        password2: 'S3cure!Pass',
      })
    )
    expect(onSignupSuccess).toHaveBeenCalledWith({
      success: true,
      authenticated: true,
      username: 'ada',
    })
  })
})
