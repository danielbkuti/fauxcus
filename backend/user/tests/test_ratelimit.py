from django.test import TestCase
from django.test.client import RequestFactory
from django.utils import timezone

from ..models import RateLimitAttempt
from ..ratelimit import get_client_ip, is_rate_limited, record_attempt, reset_rate_limit


def make_request(ip="1.2.3.4"):
    return RequestFactory().post("/", REMOTE_ADDR=ip)


class RateLimitTestCase(TestCase):
    """
    Covers ratelimit.py's DB-backed counter (RateLimitAttempt) — the
    replacement for the previous Django-cache-backed implementation.
    The whole point of moving off the cache is surviving a process
    restart, which these tests can't directly simulate (a restart
    doesn't touch Postgres at all — that's exactly the property being
    relied on), but they do verify the persisted counter itself behaves
    the same way the cache-backed one used to: fixed-ish window,
    sliding expiry, independent per (scope, IP).
    """

    def test_not_limited_with_no_attempts(self):
        self.assertFalse(is_rate_limited(make_request(), "login", limit=5, window_seconds=900))

    def test_not_limited_below_the_limit(self):
        request = make_request()
        for _ in range(4):
            record_attempt(request, "login", window_seconds=900)
        self.assertFalse(is_rate_limited(request, "login", limit=5, window_seconds=900))

    def test_limited_at_the_limit(self):
        request = make_request()
        for _ in range(5):
            record_attempt(request, "login", window_seconds=900)
        self.assertTrue(is_rate_limited(request, "login", limit=5, window_seconds=900))

    def test_reset_clears_the_counter(self):
        request = make_request()
        for _ in range(5):
            record_attempt(request, "login", window_seconds=900)
        self.assertTrue(is_rate_limited(request, "login", limit=5, window_seconds=900))

        reset_rate_limit(request, "login")

        self.assertFalse(is_rate_limited(request, "login", limit=5, window_seconds=900))
        self.assertFalse(RateLimitAttempt.objects.filter(scope="login", client_ip="1.2.3.4").exists())

    def test_different_ips_tracked_independently(self):
        attacker = make_request(ip="9.9.9.9")
        bystander = make_request(ip="8.8.8.8")
        for _ in range(5):
            record_attempt(attacker, "login", window_seconds=900)

        self.assertTrue(is_rate_limited(attacker, "login", limit=5, window_seconds=900))
        self.assertFalse(is_rate_limited(bystander, "login", limit=5, window_seconds=900))

    def test_different_scopes_tracked_independently(self):
        request = make_request()
        for _ in range(5):
            record_attempt(request, "login", window_seconds=900)

        self.assertTrue(is_rate_limited(request, "login", limit=5, window_seconds=900))
        self.assertFalse(is_rate_limited(request, "password-reset", limit=5, window_seconds=900))

    def test_expired_window_is_not_limited_and_restarts_the_count(self):
        request = make_request()
        record_attempt(request, "login", window_seconds=900)
        # Simulate the window having already lapsed, same as time
        # actually passing would — directly, rather than a slow real
        # sleep() in a test.
        RateLimitAttempt.objects.filter(scope="login", client_ip="1.2.3.4").update(
            expires_at=timezone.now() - timezone.timedelta(seconds=1)
        )
        self.assertFalse(is_rate_limited(request, "login", limit=1, window_seconds=900))

        record_attempt(request, "login", window_seconds=900)

        self.assertEqual(
            RateLimitAttempt.objects.get(scope="login", client_ip="1.2.3.4").count,
            1,
            "a lapsed window should restart the count at 1, not add to the stale total",
        )

    def test_record_attempt_slides_the_expiry_forward(self):
        request = make_request()
        record_attempt(request, "login", window_seconds=900)
        first_expiry = RateLimitAttempt.objects.get(scope="login", client_ip="1.2.3.4").expires_at

        # Pull the expiry back to prove the next call actually moves it
        # forward again, rather than the test passing by coincidence.
        RateLimitAttempt.objects.filter(scope="login", client_ip="1.2.3.4").update(
            expires_at=timezone.now() + timezone.timedelta(seconds=1)
        )
        record_attempt(request, "login", window_seconds=900)
        second_expiry = RateLimitAttempt.objects.get(scope="login", client_ip="1.2.3.4").expires_at

        self.assertGreater(second_expiry, timezone.now() + timezone.timedelta(seconds=800))
        self.assertNotEqual(first_expiry, second_expiry)

    def test_get_client_ip_prefers_x_forwarded_for(self):
        request = RequestFactory().post(
            "/", REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="203.0.113.5, 10.0.0.1"
        )
        self.assertEqual(get_client_ip(request), "203.0.113.5")

    def test_get_client_ip_falls_back_to_remote_addr(self):
        request = make_request(ip="203.0.113.9")
        self.assertEqual(get_client_ip(request), "203.0.113.9")
