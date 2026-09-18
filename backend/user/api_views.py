import json
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.http import JsonResponse
from django.utils import timezone
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .forms import (
    CustomLoginForm,
    SignupStartForm,
    SignupDetailsForm,
    SignupCompleteForm,
    PasswordResetRequestForm,
    PasswordResetConfirmForm,
    ProfileUpdateForm,
    ChangePasswordForm,
    DeleteAccountForm,
)
from .models import PendingSignup, generate_signup_code
from .ratelimit import is_rate_limited, record_attempt, reset_rate_limit
from .services import (
    send_signup_verification_email,
    send_password_reset_email,
    generate_username_from_name,
)

User = get_user_model()

# How long a signup-in-progress stays valid overall (steps 1-4).
PENDING_SIGNUP_EXPIRY = timedelta(hours=24)

# How long a single emailed code stays valid, and how many wrong
# guesses against it are allowed before it's locked out (rather than
# just letting someone try all million 6-digit codes) — a fresh code
# via "resend" (signup_start_api again) resets both.
SIGNUP_CODE_EXPIRY = timedelta(minutes=15)
SIGNUP_CODE_MAX_ATTEMPTS = 5

# Wrong-code guesses, per IP — on top of the per-record attempt cap
# above, since that alone doesn't stop one IP from grinding through
# many different pending signups' codes.
SIGNUP_CODE_RATE_LIMIT = 10
SIGNUP_CODE_RATE_WINDOW_SECONDS = 15 * 60

# Failed login attempts, per IP, before login_api starts refusing to
# even check credentials for a while — a brute-force throttle, not an
# account lockout (it's keyed on IP, not username, so it can't be used
# to lock a legitimate user out of their own account from elsewhere).
LOGIN_RATE_LIMIT = 5
LOGIN_RATE_WINDOW_SECONDS = 15 * 60

# Password-reset requests, per IP — looser than login (every request
# here "succeeds" from the caller's point of view regardless of
# whether the email exists), mainly to stop this becoming a free email
# bomb rather than to stop credential guessing.
PASSWORD_RESET_RATE_LIMIT = 3
PASSWORD_RESET_RATE_WINDOW_SECONDS = 60 * 60


@ensure_csrf_cookie
def check_auth(request):
    """
    Reports auth status, and (via @ensure_csrf_cookie) hands the frontend a
    csrftoken cookie on first load. The React app calls this once on mount —
    both to know whether to show the login screen, and to prime the CSRF
    cookie it needs before it can POST to /user/api/login/.
    """
    if request.user.is_authenticated:
        return JsonResponse({
            "authenticated": True,
            "username": request.user.username,
            "first_name": request.user.first_name,
        })
    else:
        return JsonResponse({
            "authenticated": False,
        })


@require_http_methods(["POST"])
def login_api(request):
    """
    JSON counterpart to the existing template-based login_view. Reuses
    CustomLoginForm so validation/auth rules live in exactly one place.

    Rate-limited per client IP (LOGIN_RATE_LIMIT failed attempts per
    LOGIN_RATE_WINDOW_SECONDS) — checked before the credentials are
    even looked at, so once tripped, further guesses aren't processed
    at all. Only failures count against the limit; the counter resets
    the moment a login actually succeeds.
    """
    if is_rate_limited(request, "login", LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_SECONDS):
        return JsonResponse({
            "authenticated": False,
            "detail": "Too many failed login attempts. Please wait a few minutes and try again.",
        }, status=429)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = CustomLoginForm(request, data=data)
    if form.is_valid():
        reset_rate_limit(request, "login")
        user = form.get_user()
        login(request, user)
        # Not a form field — a plain boolean, no validation needed.
        # SESSION_EXPIRE_AT_BROWSER_CLOSE=True is the app-wide default
        # (see settings.py), so an unchecked/omitted "remember me" just
        # falls through to that: session-only, gone once the browser
        # closes. Checked, it opts this one session into the longer
        # SESSION_COOKIE_AGE lifetime instead.
        if data.get("remember_me"):
            request.session.set_expiry(settings.SESSION_COOKIE_AGE)
        else:
            request.session.set_expiry(0)
        return JsonResponse({
            "authenticated": True,
            "username": user.username,
            "first_name": user.first_name,
        })

    record_attempt(request, "login", LOGIN_RATE_WINDOW_SECONDS)
    return JsonResponse({
        "authenticated": False,
        "errors": form.errors.get_json_data(),
    }, status=400)


@require_http_methods(["POST"])
def logout_api(request):
    logout(request)
    return JsonResponse({"authenticated": False})


@require_http_methods(["POST"])
def signup_start_api(request):
    """
    Step 1 of the new multi-step signup flow: takes just an email,
    rejects it if a real account already has it, and otherwise creates
    (or refreshes) a PendingSignup and emails a 6-digit code that
    continues the flow at /signup/verify/<token>/ in the React app.
    Returns the token directly (unlike the old link-based flow, the
    frontend needs it up front to navigate there itself and to submit
    the code against).

    Also doubles as "resend the code" — re-submitting the same
    not-yet-verified email gets a fresh code (invalidating the old one)
    and its in-progress fields reset, rather than erroring. The token
    itself is deliberately *not* regenerated on an existing record: the
    frontend is already sitting on /signup/verify/<token> when it calls
    this to resend, and rotating the token out from under that URL
    would 404 its own next request.
    """
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = SignupStartForm(data)
    if not form.is_valid():
        return JsonResponse({
            "success": False,
            "errors": form.errors.get_json_data(),
        }, status=400)

    email = form.cleaned_data["email"]

    pending = PendingSignup.objects.filter(email=email).first() or PendingSignup(email=email)
    pending.email_verified = False
    pending.code = generate_signup_code()
    pending.code_attempts = 0
    pending.code_sent_at = timezone.now()
    pending.first_name = ""
    pending.last_name = ""
    pending.username = ""
    pending.save()

    send_signup_verification_email(pending)

    return JsonResponse({"success": True, "token": pending.token})


@require_http_methods(["GET", "PATCH"])
def signup_pending_api(request, token):
    """
    One resource, two actions on it:

    - GET: reports what's already filled in, so the frontend knows
      which step to resume on — the code screen if the email isn't
      verified yet, otherwise details/password (also makes a page
      refresh mid-flow non-destructive). Deliberately read-only now:
      it used to mark the email verified just by being loaded, back
      when reaching this page at all meant the link had been clicked.
      Now that the token is handed to the frontend directly (see
      signup_start_api) rather than only living inside an emailed
      link, that would let anyone skip the code entirely — actual
      verification happens only in signup_verify_code_api below.
    - PATCH: step 3 — submits first/last name + an optional username.
      Requires the email to already be verified — enforces the step
      order server-side, not just by however the frontend happens to
      navigate.
    """
    try:
        pending = PendingSignup.objects.get(token=token)
    except PendingSignup.DoesNotExist:
        return JsonResponse({"detail": "This link is invalid or has expired."}, status=404)

    if timezone.now() - pending.created_at > PENDING_SIGNUP_EXPIRY:
        pending.delete()
        return JsonResponse({"detail": "This link is invalid or has expired."}, status=404)

    if request.method == "GET":
        return JsonResponse({
            "email": pending.email,
            "email_verified": pending.email_verified,
            "first_name": pending.first_name,
            "last_name": pending.last_name,
            "username": pending.username,
        })

    # PATCH from here on.
    if not pending.email_verified:
        return JsonResponse({"detail": "Please verify your email first."}, status=400)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = SignupDetailsForm(data)
    if not form.is_valid():
        return JsonResponse({
            "success": False,
            "errors": form.errors.get_json_data(),
        }, status=400)

    pending.first_name = form.cleaned_data["first_name"]
    pending.last_name = form.cleaned_data["last_name"]
    pending.username = form.cleaned_data["username"]
    pending.save(update_fields=["first_name", "last_name", "username"])

    return JsonResponse({
        "success": True,
        "email": pending.email,
        "first_name": pending.first_name,
        "last_name": pending.last_name,
        "username": pending.username,
    })


@require_http_methods(["POST"])
def signup_verify_code_api(request, token):
    """
    Step 2 — checks the code emailed by signup_start_api against what
    the user typed in. Two independent throttles on top of each other:
    a per-record attempt count (so one pending signup's code can't just
    be brute-forced through all million 6-digit values) and a per-IP
    rate limit (so one IP can't grind through many different pending
    signups instead). Only failed guesses count against either — a
    correct code always succeeds regardless of how many wrong ones
    came before it, as long as neither cap was already hit.
    """
    try:
        pending = PendingSignup.objects.get(token=token)
    except PendingSignup.DoesNotExist:
        return JsonResponse({"detail": "This link is invalid or has expired."}, status=404)

    if timezone.now() - pending.created_at > PENDING_SIGNUP_EXPIRY:
        pending.delete()
        return JsonResponse({"detail": "This link is invalid or has expired."}, status=404)

    # Idempotent — a retry/double-submit after already verifying just
    # reports success again rather than erroring on an attempts cap
    # that no longer matters.
    if pending.email_verified:
        return JsonResponse({
            "email": pending.email,
            "email_verified": True,
            "first_name": pending.first_name,
            "last_name": pending.last_name,
            "username": pending.username,
        })

    if is_rate_limited(request, "signup_verify_code", SIGNUP_CODE_RATE_LIMIT, SIGNUP_CODE_RATE_WINDOW_SECONDS):
        return JsonResponse({
            "detail": "Too many attempts. Please wait a while and try again.",
        }, status=429)

    if pending.code_attempts >= SIGNUP_CODE_MAX_ATTEMPTS:
        return JsonResponse({
            "detail": "Too many incorrect attempts. Request a new code and try again.",
        }, status=429)

    if timezone.now() - pending.code_sent_at > SIGNUP_CODE_EXPIRY:
        return JsonResponse({"detail": "This code has expired. Request a new one."}, status=400)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    code = str(data.get("code", "")).strip()

    if not code or not secrets.compare_digest(code, pending.code):
        record_attempt(request, "signup_verify_code", SIGNUP_CODE_RATE_WINDOW_SECONDS)
        pending.code_attempts += 1
        pending.save(update_fields=["code_attempts"])
        remaining = max(0, SIGNUP_CODE_MAX_ATTEMPTS - pending.code_attempts)
        return JsonResponse({
            "detail": "That code isn't right." + (f" {remaining} attempt(s) left." if remaining else ""),
        }, status=400)

    reset_rate_limit(request, "signup_verify_code")
    pending.email_verified = True
    pending.save(update_fields=["email_verified"])

    return JsonResponse({
        "email": pending.email,
        "email_verified": True,
        "first_name": pending.first_name,
        "last_name": pending.last_name,
        "username": pending.username,
    })


@require_http_methods(["POST"])
def signup_complete_api(request, token):
    """
    Step 4 (final) — takes the password and is what actually creates the
    real CustomUser; PendingSignup was only ever a staging area for
    everything collected in steps 1-3. Requires email_verified AND
    first/last name to already be filled in, enforcing that steps 2 and
    3 actually happened rather than just that the token exists.

    Deletes the PendingSignup once consumed, and logs the new user
    straight in — they just finished a whole guided signup, no reason
    to immediately ask them to log in again.
    """
    try:
        pending = PendingSignup.objects.get(token=token)
    except PendingSignup.DoesNotExist:
        return JsonResponse({"detail": "This link is invalid or has expired."}, status=404)

    if timezone.now() - pending.created_at > PENDING_SIGNUP_EXPIRY:
        pending.delete()
        return JsonResponse({"detail": "This link is invalid or has expired."}, status=404)

    if not pending.email_verified:
        return JsonResponse({"detail": "Please verify your email first."}, status=400)

    if not pending.first_name or not pending.last_name:
        return JsonResponse({"detail": "Please provide your name first."}, status=400)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = SignupCompleteForm(data, pending=pending)
    if not form.is_valid():
        return JsonResponse({
            "success": False,
            "errors": form.errors.get_json_data(),
        }, status=400)

    username = pending.username or generate_username_from_name(
        pending.first_name, pending.last_name
    )

    user = User.objects.create_user(
        username=username,
        email=pending.email,
        first_name=pending.first_name,
        last_name=pending.last_name,
        password=form.cleaned_data["password1"],
    )
    user.is_active = True
    user.save(update_fields=["is_active"])

    pending.delete()

    # login() normally learns which auth backend to credit from
    # authenticate() — we bypassed that by creating the user directly,
    # so with two backends configured (see AUTHENTICATION_BACKENDS) it
    # has no way to infer one. Has to be set explicitly.
    user.backend = settings.AUTHENTICATION_BACKENDS[0]
    login(request, user)

    return JsonResponse({
        "success": True,
        "authenticated": True,
        "username": user.username,
        "first_name": user.first_name,
    })


@require_http_methods(["GET"])
def check_email_exists(request):
    """
    Lets the landing page's single email box route to login vs. signup
    without the visitor picking which one themselves.

    Worth knowing: this is a real, if minor, email-enumeration surface —
    anyone can probe arbitrary addresses to learn which ones have
    accounts. Common tradeoff for this exact UX pattern; flagging it
    rather than silently shipping it.
    """
    email = request.GET.get("email", "").strip().lower()
    if not email:
        return JsonResponse({"detail": "Email is required."}, status=400)

    exists = User.objects.filter(email__iexact=email).exists()
    return JsonResponse({"exists": exists})


@require_http_methods(["POST"])
def password_reset_request_api(request):
    """
    Step 1 of forgot-password. Always responds the same way whether or
    not the email actually belongs to an account — unlike
    check_email_exists above, this endpoint deliberately does NOT leak
    that, since nothing in the reset flow itself needs to know.
    """
    if is_rate_limited(request, "password-reset", PASSWORD_RESET_RATE_LIMIT, PASSWORD_RESET_RATE_WINDOW_SECONDS):
        return JsonResponse({"detail": "Too many requests. Please wait a while and try again."}, status=429)
    record_attempt(request, "password-reset", PASSWORD_RESET_RATE_WINDOW_SECONDS)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = PasswordResetRequestForm(data)
    if not form.is_valid():
        return JsonResponse({"success": False, "errors": form.errors.get_json_data()}, status=400)

    email = form.cleaned_data["email"]
    try:
        # is_active=True: an account that never finished signup
        # verification has no usable password to reset yet.
        user = User.objects.get(email__iexact=email, is_active=True)
    except User.DoesNotExist:
        user = None

    if user is not None:
        send_password_reset_email(user)

    return JsonResponse({"success": True})


@require_http_methods(["GET", "POST"])
def password_reset_confirm_api(request, uidb64, token):
    """
    One resource, two actions on it — same shape as signup_pending_api:

    - GET: hit when the emailed link is first opened. Just validates
      the uid/token are still good, so the frontend can show the
      "choose a new password" form or a clean "link invalid/expired"
      state without requiring a submission first.
    - POST: sets the new password. Re-validates the same uid/token
      rather than trusting the earlier GET happened, since the two
      requests aren't otherwise tied together.
    """
    try:
        uid = urlsafe_base64_decode(uidb64).decode()
        user = User.objects.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None

    valid = user is not None and default_token_generator.check_token(user, token)

    if request.method == "GET":
        return JsonResponse({"valid": valid})

    if not valid:
        return JsonResponse({"detail": "This link is invalid or has expired."}, status=400)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = PasswordResetConfirmForm(data, user=user)
    if not form.is_valid():
        return JsonResponse({"success": False, "errors": form.errors.get_json_data()}, status=400)

    user.set_password(form.cleaned_data["password1"])
    user.save(update_fields=["password"])

    # Same reasoning as signup_complete_api: we're not going through
    # authenticate(), so Django has no way to infer which backend to
    # credit — has to be set explicitly before login() will accept it.
    user.backend = settings.AUTHENTICATION_BACKENDS[0]
    login(request, user)

    return JsonResponse({
        "success": True,
        "authenticated": True,
        "username": user.username,
        "first_name": user.first_name,
    })


def _serialize_profile(user):
    return {
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "date_of_birth": user.date_of_birth.isoformat() if user.date_of_birth else None,
        "date_joined": user.date_joined.isoformat(),
    }


@require_http_methods(["GET", "PATCH"])
def profile_api(request):
    """
    The profile page's own read/write endpoint — GET for the initial
    load, PATCH for saving the "Personal info" section (name, username,
    date of birth). Session-cookie auth like every other view in this
    file, so an anonymous request just gets a plain 401 rather than
    Django's default login-page redirect (there's no HTML page here to
    redirect to).
    """
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Authentication required."}, status=401)

    if request.method == "GET":
        return JsonResponse(_serialize_profile(request.user))

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = ProfileUpdateForm(data, user=request.user)
    if not form.is_valid():
        return JsonResponse({"success": False, "errors": form.errors.get_json_data()}, status=400)

    user = request.user
    user.first_name = form.cleaned_data["first_name"]
    user.last_name = form.cleaned_data["last_name"]
    user.username = form.cleaned_data["username"]
    user.date_of_birth = form.cleaned_data["date_of_birth"]
    user.save(update_fields=["first_name", "last_name", "username", "date_of_birth"])

    return JsonResponse({"success": True, **_serialize_profile(user)})


@require_http_methods(["POST"])
def change_password_api(request):
    """
    Profile page's "Change password" section. Requires the current
    password (unlike the emailed reset-link flow, which proves identity
    a different way) plus Django's own strength validation on the new
    one.
    """
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Authentication required."}, status=401)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = ChangePasswordForm(data, user=request.user)
    if not form.is_valid():
        return JsonResponse({"success": False, "errors": form.errors.get_json_data()}, status=400)

    user = request.user
    user.set_password(form.cleaned_data["password1"])
    user.save(update_fields=["password"])
    # set_password() rotates the hash Django's session middleware checks
    # on every request — without this, changing your own password would
    # silently log you out on the very next request.
    update_session_auth_hash(request, user)

    return JsonResponse({"success": True})


@require_http_methods(["POST"])
def delete_account_api(request):
    """
    Profile page's "Danger zone" — a real, irreversible account
    deletion, gated on re-entering the password as one more
    confirmation beyond the frontend's own "are you sure" prompt.
    Cascades to the user's tasks via Task.user's FK (see
    backend/tasks/models.py), same as deleting the user any other way
    would.
    """
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Authentication required."}, status=401)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid JSON body."}, status=400)

    form = DeleteAccountForm(data, user=request.user)
    if not form.is_valid():
        return JsonResponse({"success": False, "errors": form.errors.get_json_data()}, status=400)

    user = request.user
    logout(request)
    user.delete()

    return JsonResponse({"success": True})
