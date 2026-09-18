import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SignupForm } from './SignupForm'
import { checkEmailExists, startSignup } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({
  checkEmailExists: vi.fn(),
  startSignup: vi.fn(),
}))

// Captures whatever react-router-dom's real useNavigate would have been
// called with, without needing a full route tree — SignupForm only ever
// calls navigate(), it never reads the current location besides
// useLocation()'s pre-fill, which MemoryRouter's default location (no
// state) already covers.
const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

function renderSignupForm() {
  return render(
    <MemoryRouter>
      <SignupForm />
    </MemoryRouter>
  )
}

describe('SignupForm (signup step 1: email)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the email field', () => {
    renderSignupForm()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('redirects to /login when the email already has an account', async () => {
    const user = userEvent.setup()
    checkEmailExists.mockResolvedValue({ exists: true })
    renderSignupForm()

    await user.type(screen.getByLabelText(/email/i), 'existing@test.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/login', { state: { email: 'existing@test.com' } })
    )
    expect(startSignup).not.toHaveBeenCalled()
  })

  it('starts signup and navigates to the verify step for a new email', async () => {
    const user = userEvent.setup()
    checkEmailExists.mockResolvedValue({ exists: false })
    startSignup.mockResolvedValue({ token: 'abc123' })
    renderSignupForm()

    await user.type(screen.getByLabelText(/email/i), 'new@test.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(startSignup).toHaveBeenCalledWith('new@test.com'))
    expect(navigateMock).toHaveBeenCalledWith('/signup/verify/abc123')
  })

  it('redirects to /login if startSignup itself reports the email already exists', async () => {
    // Realistic per the component's own comment: checkEmailExists said
    // no, but startSignup still rejects with "already exists" — e.g.
    // the account was created in the gap between the two calls.
    const user = userEvent.setup()
    checkEmailExists.mockResolvedValue({ exists: false })
    const error = new Error('email taken')
    error.data = { errors: { email: [{ message: 'An account with this email already exists.' }] } }
    startSignup.mockRejectedValue(error)
    renderSignupForm()

    await user.type(screen.getByLabelText(/email/i), 'raced@test.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/login', { state: { email: 'raced@test.com' } })
    )
  })

  it('shows the field error for any other startSignup failure', async () => {
    const user = userEvent.setup()
    checkEmailExists.mockResolvedValue({ exists: false })
    const error = new Error('server error')
    error.data = { errors: { email: [{ message: 'This field is required.' }] } }
    startSignup.mockRejectedValue(error)
    renderSignupForm()

    await user.type(screen.getByLabelText(/email/i), 'new@test.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('This field is required.')).toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
