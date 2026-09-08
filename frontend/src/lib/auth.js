import { apiFetch } from './api'

export function checkAuth() {
  return apiFetch('/user/api/auth/')
}

export function login(username, password, rememberMe = false) {
  return apiFetch('/user/api/login/', {
    method: 'POST',
    body: { username, password, remember_me: rememberMe },
  })
}

export function logout() {
  return apiFetch('/user/api/logout/', { method: 'POST' })
}

// --- Multi-step signup flow ---

// Also doubles as "resend the code" — same call, a fresh code each
// time. Response now includes `token`, since the frontend navigates
// itself to the verify step rather than only reaching it via a clicked
// email link.
export function startSignup(email) {
  return apiFetch('/user/api/signup/start/', {
    method: 'POST',
    body: { email },
  })
}

export function checkPendingSignup(token) {
  return apiFetch(`/user/api/signup/pending/${token}/`)
}

export function verifySignupCode(token, code) {
  return apiFetch(`/user/api/signup/verify-code/${token}/`, {
    method: 'POST',
    body: { code },
  })
}

export function submitSignupDetails(token, { firstName, lastName, username }) {
  return apiFetch(`/user/api/signup/pending/${token}/`, {
    method: 'PATCH',
    body: {
      first_name: firstName,
      last_name: lastName,
      username,
    },
  })
}

export function completeSignup(token, { password1, password2 }) {
  return apiFetch(`/user/api/signup/complete/${token}/`, {
    method: 'POST',
    body: { password1, password2 },
  })
}

export function checkEmailExists(email) {
  return apiFetch(`/user/api/email-exists/?email=${encodeURIComponent(email)}`)
}

// --- Forgot password ---

export function requestPasswordReset(email) {
  return apiFetch('/user/api/password-reset/request/', {
    method: 'POST',
    body: { email },
  })
}

export function checkPasswordResetLink(uidb64, token) {
  return apiFetch(`/user/api/password-reset/confirm/${uidb64}/${token}/`)
}

export function confirmPasswordReset(uidb64, token, { password1, password2 }) {
  return apiFetch(`/user/api/password-reset/confirm/${uidb64}/${token}/`, {
    method: 'POST',
    body: { password1, password2 },
  })
}

// --- Profile page ---

export function fetchProfile() {
  return apiFetch('/user/api/profile/')
}

export function updateProfile({ firstName, lastName, username, dateOfBirth }) {
  return apiFetch('/user/api/profile/', {
    method: 'PATCH',
    body: {
      first_name: firstName,
      last_name: lastName,
      username,
      date_of_birth: dateOfBirth,
    },
  })
}

export function changePassword({ currentPassword, password1, password2 }) {
  return apiFetch('/user/api/profile/password/', {
    method: 'POST',
    body: { current_password: currentPassword, password1, password2 },
  })
}

export function deleteAccount(password) {
  return apiFetch('/user/api/profile/delete/', {
    method: 'POST',
    body: { password },
  })
}
