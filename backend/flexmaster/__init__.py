# Makes sure the Celery app is loaded whenever Django starts, so
# @shared_task-decorated tasks (tasks/tasks.py) register against it.
from .celery import app as celery_app

__all__ = ("celery_app",)
