"""
Celery application for local dev — replaces backend/scheduler.py's
bespoke sleep-until-target-time loop with a real broker-backed task
queue (Celery Beat schedules tasks.tasks.send_deadline_digest_task,
Celery workers run it).

Deliberately local-dev-only: Render's free tier has no way to host a
persistent background process (no Worker/Cron Job — see render.yaml's
own comments), so this Celery setup never runs in production at all.
The live site's daily digest still goes out via the free GitHub
Actions cron added separately
(.github/workflows/deadline-digest-cron.yml), which calls the exact
same underlying send_deadline_digest management command over HTTP —
this and that are two different schedulers calling the same job, not
two different jobs.
"""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "flexmaster.settings")

app = Celery("flexmaster")
# namespace="CELERY": every Celery-related Django setting is prefixed
# CELERY_ (CELERY_BROKER_URL, CELERY_BEAT_SCHEDULE, ...) rather than
# colliding with plain-Django settings of the same short name.
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
