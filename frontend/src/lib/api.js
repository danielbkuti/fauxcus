// Empty string, not undefined, when unset — on Render the frontend is
// now served from the same origin as this API (see Dockerfile.render/
// WHITENOISE_ROOT), so VITE_API_BASE_URL is deliberately never set at
// build time there and every request below should just be a relative
// path. `${undefined}${path}` would silently produce the literal
// string "undefined/user/api/..." instead.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

/**
 * Reads a cookie by name. Used to pull the `csrftoken` Django sets on us
 * (see @ensure_csrf_cookie on check_auth) so we can echo it back as the
 * X-CSRFToken header — Django's CSRF check compares the two.
 */
function getCookie(name) {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

/**
 * Thin fetch wrapper for talking to the Django API.
 * - Always sends the session cookie (`credentials: 'include'`), since
 *   auth here is Django sessions, not a bearer token.
 * - Attaches the CSRF header on any request that isn't safe/read-only.
 * - Throws on non-2xx so callers can just `await` and try/catch.
 */
export async function apiFetch(path, { method = 'GET', body, headers, ...rest } = {}) {
  const finalHeaders = { ...headers }
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'
  if (!SAFE_METHODS.has(method.toUpperCase())) {
    finalHeaders['X-CSRFToken'] = getCookie('csrftoken')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await response.json() : null

  if (!response.ok) {
    const error = new Error(data?.detail || `Request to ${path} failed (${response.status})`)
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}
