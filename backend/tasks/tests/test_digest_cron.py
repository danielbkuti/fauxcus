from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import Notification, Task

URL = "/api/internal/send-deadline-digest/"


class TriggerDeadlineDigestViewTestCase(APITestCase):
    """
    Covers tasks.api.views.TriggerDeadlineDigestView — the endpoint a
    GitHub Actions cron (.github/workflows/deadline-digest-cron.yml)
    calls daily to run send_deadline_digest in production, since
    Render's free tier has no Worker/Cron Job to host any persistent
    scheduler there. Auth here is a shared-secret bearer token
    (DIGEST_CRON_TOKEN), not a session — this endpoint is unauthenticated
    by design where the token itself is unset, which every non-happy-path
    test below relies on staying refused rather than silently open.
    """

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="digestuser",
            email="digestuser@test.com",
            password="password123",
            is_active=True,
        )
        Task.objects.create(
            user=self.user,
            name="Due soon task",
            status="pending",
            dateDeadline=timezone.now() + timedelta(hours=1),
        )

    @override_settings(DIGEST_CRON_TOKEN="")
    def test_unconfigured_token_rejects_everything(self):
        """An unset DIGEST_CRON_TOKEN must refuse, not act as a wildcard."""
        response = self.client.post(URL, HTTP_AUTHORIZATION="Bearer anything")
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    @override_settings(DIGEST_CRON_TOKEN="correct-token")
    def test_missing_token_rejected(self):
        response = self.client.post(URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(DIGEST_CRON_TOKEN="correct-token")
    def test_wrong_token_rejected(self):
        response = self.client.post(URL, HTTP_AUTHORIZATION="Bearer wrong-token")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(
        DIGEST_CRON_TOKEN="correct-token",
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    )
    def test_correct_token_runs_digest(self):
        """A valid token actually runs send_deadline_digest server-side."""
        response = self.client.post(URL, HTTP_AUTHORIZATION="Bearer correct-token")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            Notification.objects.filter(user=self.user).exists(),
            "digest should have created a Notification for the due-soon task",
        )

    @override_settings(DIGEST_CRON_TOKEN="correct-token")
    def test_get_not_allowed(self):
        """POST-only — a GET (e.g. someone visiting the URL) must not trigger anything."""
        response = self.client.get(URL, HTTP_AUTHORIZATION="Bearer correct-token")
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
