from django.db import transaction
from django.utils import timezone

from .models import RateLimitAttempt


def get_client_ip(request):
    """
    Prefers X-Forwarded-For (set by a reverse proxy/load balancer) over
    REMOTE_ADDR, taking the first hop — the client's own address, not
    whatever proxy relayed the request. Falls back to REMOTE_ADDR for
    the common case of no proxy in front (e.g. local dev).
    """
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")


def is_rate_limited(request, scope, limit, window_seconds):
    """
    Fixed-window counter keyed by (scope, client IP), backed by a real
    table (RateLimitAttempt) rather than Django's cache framework.
    Only reports whether the caller is already over the limit; call
    record_attempt() separately to actually count this attempt (kept
    apart so a caller can choose to only count failures, e.g. login).

    `window_seconds` isn't used here — it only matters when an attempt
    is actually recorded (see record_attempt) — but stays a parameter
    so call sites read the same both places and don't need to know
    which of the two functions "owns" the window length.
    """
    attempt = RateLimitAttempt.objects.filter(
        scope=scope, client_ip=get_client_ip(request)
    ).first()
    if attempt is None or attempt.expires_at <= timezone.now():
        return False
    return attempt.count >= limit


def record_attempt(request, scope, window_seconds):
    """
    Increments the counter for (scope, client IP), sliding its expiry
    forward by window_seconds from now — matching the previous
    cache.set(key, value, timeout) behavior exactly: every recorded
    attempt resets the clock, so this is "N attempts with no gap longer
    than window_seconds between consecutive ones", not a strict window
    from the first attempt. A lapsed row (expired since the last
    attempt) restarts the count at 1 rather than continuing to add to a
    stale total.

    select_for_update() + an atomic transaction: without it, two
    requests from the same IP landing at nearly the same moment could
    both read the same count and both write count+1, undercounting by
    one — a real (if narrow) race a plain get-then-save doesn't guard
    against.
    """
    ip = get_client_ip(request)
    now = timezone.now()
    with transaction.atomic():
        attempt, created = RateLimitAttempt.objects.select_for_update().get_or_create(
            scope=scope,
            client_ip=ip,
            defaults={"count": 1, "expires_at": now + timezone.timedelta(seconds=window_seconds)},
        )
        if created:
            return
        if attempt.expires_at <= now:
            attempt.count = 1
        else:
            attempt.count += 1
        attempt.expires_at = now + timezone.timedelta(seconds=window_seconds)
        attempt.save(update_fields=["count", "expires_at"])


def reset_rate_limit(request, scope):
    RateLimitAttempt.objects.filter(scope=scope, client_ip=get_client_ip(request)).delete()
