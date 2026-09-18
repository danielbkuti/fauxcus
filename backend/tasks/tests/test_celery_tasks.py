from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from ..models import Notification, Task
from ..tasks import send_deadline_digest_task


class SendDeadlineDigestTaskTestCase(TestCase):
    """
    Covers tasks.tasks.send_deadline_digest_task — the Celery Beat
    periodic task that replaced backend/scheduler.py's sleep loop for
    local dev (see flexmaster.settings.CELERY_BEAT_SCHEDULE). Called
    directly here rather than via .delay()/a real broker: this task is
    a thin call_command wrapper, so what's worth verifying is that it
    actually reaches send_deadline_digest and its side effects, not
    Celery's own dispatch machinery (which is Celery's problem to
    test, not this app's).
    """

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_runs_the_digest_command(self):
        user = get_user_model().objects.create_user(
            username="celeryuser",
            email="celeryuser@test.com",
            password="password123",
            is_active=True,
        )
        Task.objects.create(
            user=user,
            name="Due soon task",
            status="pending",
            dateDeadline=timezone.now() + timedelta(hours=1),
        )

        send_deadline_digest_task()

        self.assertTrue(
            Notification.objects.filter(user=user).exists(),
            "the task should have run send_deadline_digest, creating a Notification",
        )
