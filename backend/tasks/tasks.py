from celery import shared_task
from django.core.management import call_command


@shared_task
def send_deadline_digest_task():
    """
    Runs the send_deadline_digest management command — the same one
    tasks.api.views.TriggerDeadlineDigestView calls directly for the
    production cron (see that view's docstring). Celery Beat calls this
    once a day locally (flexmaster.settings.CELERY_BEAT_SCHEDULE),
    replacing backend/scheduler.py's old sleep-until-target-time loop
    with a real broker-backed periodic task.
    """
    call_command("send_deadline_digest")
