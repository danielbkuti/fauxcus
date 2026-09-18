import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LoginForm } from './LoginForm'
import { login } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({
  login: vi.fn(),
}))

function renderLoginForm(props = {}) {
  return render(
    <MemoryRouter>
      <LoginForm onLoginSuccess={vi.fn()} {...props} />
    </MemoryRouter>
  )
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the username, password, and remember-me fields', () => {
    renderLoginForm()

    expect(screen.getByLabelText(/username or email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    const rememberMe = screen.getByRole('checkbox')
    expect(rememberMe).toBeInTheDocument()
    expect(rememberMe).not.toBeChecked()
  })

  it('submits with remember_me=false by default', async () => {
    const user = userEvent.setup()
    login.mockResolvedValue({ authenticated: true, username: 'demo' })
    const onLoginSuccess = vi.fn()
    renderLoginForm({ onLoginSuccess })

    await user.type(screen.getByLabelText(/username or email/i), 'demo')
    await user.type(screen.getByLabelText(/^password$/i), 'Demo12345!')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('demo', 'Demo12345!', false))
    expect(onLoginSuccess).toHaveBeenCalledWith({ authenticated: true, username: 'demo' })
  })

  it('submits with remember_me=true once the checkbox is checked', async () => {
    const user = userEvent.setup()
    login.mockResolvedValue({ authenticated: true, username: 'demo' })
    renderLoginForm()

    await user.type(screen.getByLabelText(/username or email/i), 'demo')
    await user.type(screen.getByLabelText(/^password$/i), 'Demo12345!')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('demo', 'Demo12345!', true))
  })

  it('shows the backend-provided error on a rejected login', async () => {
    const user = userEvent.setup()
    const error = new Error('bad credentials')
    error.status = 400
    error.data = { errors: { __all__: [{ message: 'Invalid username or password.' }] } }
    login.mockRejectedValue(error)
    renderLoginForm()

    await user.type(screen.getByLabelText(/username or email/i), 'demo')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument()
  })

  it('shows a rate-limit-specific message on a 429', async () => {
    const user = userEvent.setup()
    const error = new Error('too many attempts')
    error.status = 429
    error.data = { detail: 'Too many failed login attempts. Please wait a few minutes and try again.' }
    login.mockRejectedValue(error)
    renderLoginForm()

    await user.type(screen.getByLabelText(/username or email/i), 'demo')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(
      await screen.findByText('Too many failed login attempts. Please wait a few minutes and try again.')
    ).toBeInTheDocument()
  })
})
