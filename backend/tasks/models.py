from django.db import models, transaction
from django.utils.timezone import now


def _sync_date_completed(instance, model_cls, kwargs):
    """
    Shared by Task.save() and SubTask.save(): sets dateCompleted to now()
    the moment `completed` actually flips to True, clears it back to
    None the moment it flips back to False — never touched any other
    time. Mutates `kwargs` in place to append "dateCompleted" to
    update_fields when the caller passed one (e.g.
    Task.update_completion_status() saves with
    update_fields=["completed"]); without that, Django would silently
    drop the dateCompleted change instead of persisting it.
    """
    update_fields = kwargs.get("update_fields")
    previous_completed = None
    if instance.pk:
        previous_completed = (
            model_cls.objects.filter(pk=instance.pk).values_list("completed", flat=True).first()
        )

    completed_changed = (
        previous_completed is not None and previous_completed != instance.completed
    ) or (previous_completed is None and instance.completed)

    if completed_changed:
        instance.dateCompleted = now() if instance.completed else None
        if update_fields is not None:
            kwargs["update_fields"] = list(update_fields) + ["dateCompleted"]


def _format_dt(value):
    """Same rough shape as the frontend's own formatDeadline (month day,
    year, time) — just not forced to the viewer's own locale, since this
    runs server-side. Good enough for a log line; not meant to be the
    single source of truth for date display the way formatDeadline is."""
    if value is None:
        return None
    return value.strftime("%b %d, %Y, %I:%M %p")


def _log_task_changes(task, before, created):
    """
    Appends a TaskActivity row for task creation, or for any of name /
    completed / dateDeadline actually changing — called from
    Task.save() itself (see there) rather than from the API layer, so
    every write path (the API, the admin, a shell script, the
    auto-reopen in update_completion_status below) gets logged the same
    way instead of only the ones a view happens to instrument.
    `before` is a dict of the previous field values (None on creation).
    """
    messages = []
    if created:
        messages.append("Task created")
    else:
        if before["name"] != task.name:
            messages.append(f'Task renamed to "{task.name}"')
        if before["completed"] != task.completed:
            messages.append("Task marked complete" if task.completed else "Task reopened")
        if before["dateDeadline"] != task.dateDeadline:
            if task.dateDeadline is None:
                messages.append("Task deadline cleared")
            elif before["dateDeadline"] is None:
                messages.append(f"Task deadline set to {_format_dt(task.dateDeadline)}")
            else:
                messages.append(f"Task deadline changed to {_format_dt(task.dateDeadline)}")
    for message in messages:
        TaskActivity.objects.create(task=task, message=message)


def _log_subtask_changes(subtask, before, created):
    """Same idea as _log_task_changes, for a subtask — logged against
    the *parent* task's activity log (subtasks don't get their own),
    since that's the log the task detail page actually renders."""
    messages = []
    if created:
        messages.append(f'Subtask "{subtask.name}" added')
    else:
        if before["name"] != subtask.name:
            messages.append(f'Subtask "{before["name"]}" renamed to "{subtask.name}"')
        if before["completed"] != subtask.completed:
            messages.append(
                f'Subtask "{subtask.name}" marked complete'
                if subtask.completed
                else f'Subtask "{subtask.name}" reopened'
            )
        if before["dateDeadline"] != subtask.dateDeadline:
            if subtask.dateDeadline is None:
                messages.append(f'Subtask "{subtask.name}" deadline cleared')
            elif before["dateDeadline"] is None:
                messages.append(f'Subtask "{subtask.name}" deadline set to {_format_dt(subtask.dateDeadline)}')
            else:
                messages.append(
                    f'Subtask "{subtask.name}" deadline changed to {_format_dt(subtask.dateDeadline)}'
                )
    for message in messages:
        TaskActivity.objects.create(task=subtask.task, message=message)


# Create your models here.
class Task(models.Model):
    user = models.ForeignKey("user.CustomUser", related_name="tasks", on_delete=models.CASCADE)
    name = models.CharField(max_length=100, null=False, blank=False)
    description = models.TextField(blank=True, null=True)
    dateCreated = models.DateTimeField(auto_now_add=True)
    dateDeadline = models.DateTimeField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    # Set automatically in save() whenever `completed` actually changes —
    # never set directly by a caller. Cleared back to None if the task
    # is reopened, so it always reflects the most recent completion
    # rather than the first one.
    dateCompleted = models.DateTimeField(null=True, blank=True)
    # When send_deadline_digest last included this task in a digest —
    # None means "not yet reminded about its current deadline". Reset
    # back to None in save() whenever dateDeadline actually changes (see
    # below), so rescheduling a task makes it eligible for a fresh
    # reminder instead of staying silently skipped because the
    # *previous* deadline already got one. Never set anywhere except by
    # that command.
    reminderSentAt = models.DateTimeField(null=True, blank=True)

    status = models.CharField(
        max_length=20,
        choices=[
            ('pending', 'Pending'),
            ('in_progress', 'In Progress'),
            ('completed', 'Completed')
        ],
        default='pending'
    )

    def save(self, *args, **kwargs):
        """See _sync_date_completed. Also logs a TaskActivity row for
        creation and for any tracked field actually changing — see
        _log_task_changes. Also clears reminderSentAt when dateDeadline
        actually changes — see that field's own comment above."""
        _sync_date_completed(self, Task, kwargs)
        created = self.pk is None
        before = (
            None
            if created
            else Task.objects.filter(pk=self.pk).values("name", "completed", "dateDeadline").first()
        )
        if before is not None and before["dateDeadline"] != self.dateDeadline:
            self.reminderSentAt = None
            update_fields = kwargs.get("update_fields")
            if update_fields is not None:
                kwargs["update_fields"] = list(update_fields) + ["reminderSentAt"]
        super().save(*args, **kwargs)
        _log_task_changes(self, before, created)

    @property
    def days_since_created(self):
        """
        Returns the number of days since the task was created.
        This is computed dynamically to avoid storing derived data.
        """
        return (now() - self.dateCreated).days

    def update_completion_status(self):
        """
        Keeps completion state consistent with subtasks in one direction
        only: a task can never validly stay marked completed while one
        of its subtasks isn't, so it's reopened automatically the moment
        that happens.

        It deliberately does NOT go the other way — finishing the last
        subtask does not, by itself, mark the task completed. Completing
        a task is its own explicit action (gated client-side on every
        subtask already being done), separate from finishing the
        subtasks themselves — the two are tracked as distinct portions
        of a task's progress, not one triggering the other.

        Instead of loading all subtasks into memory, we ask the database
        whether any incomplete subtasks exist. This avoids unnecessary
        queries and scales better for tasks with many subtasks.
        """

        has_incomplete = self.subtasks.filter(completed=False).exists()

        if has_incomplete and self.completed:
            self.completed = False
            self.save(update_fields=["completed"])

    def __str__(self):
        return self.name

    class Meta:
        ordering = ["-dateCreated"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"],
                name="unique_task_per_user"
            )
        ]
        indexes = [
            models.Index(fields=["user", "completed"]),
            models.Index(fields=["dateDeadline"]),
            models.Index(fields=["status"]),
        ]


class TaskActivity(models.Model):
    """
    An append-only log of committed changes to a task and its
    subtasks — created, renamed, completed/reopened, deadline set/
    changed/cleared, and (for subtasks) removed. Populated entirely
    from Task.save()/SubTask.save() (_log_task_changes/
    _log_subtask_changes above) plus SubTaskViewSet.perform_destroy
    (deletion doesn't go through save()) — never written to directly
    by a view/serializer, so every write path is covered the same way.
    Read-only from the API: exposed as a nested list on TaskSerializer.
    """

    task = models.ForeignKey(Task, related_name="activity_log", on_delete=models.CASCADE)
    message = models.CharField(max_length=255)
    dateCreated = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["dateCreated"]
        verbose_name_plural = "task activity"

    def __str__(self):
        return self.message


class SubTask(models.Model):
    task = models.ForeignKey(Task, related_name="subtasks", on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    dateCreated = models.DateTimeField(auto_now_add=True)
    dateDeadline = models.DateTimeField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    # Same rules as Task.dateCompleted — set the moment `completed`
    # flips to True, cleared the moment it flips back. Lets the frontend
    # sort completed subtasks by when each was actually finished
    # (most-recent first) instead of losing that ordering entirely.
    dateCompleted = models.DateTimeField(null=True, blank=True)
    # Same rules and purpose as Task.reminderSentAt above.
    reminderSentAt = models.DateTimeField(null=True, blank=True)

    class Meta:
        # Same default as Task/Notification. Genuinely load-bearing, not
        # just cosmetic: without it, a paginated SubTaskViewSet listing
        # (e.g. the calendar view's own dateDeadline range filter) has
        # no deterministic order at all — DRF's paginator warns about
        # exactly this (UnorderedObjectListWarning), and the practical
        # symptom is results that can shuffle, repeat, or go missing
        # across pages.
        ordering = ["-dateCreated"]

    def save(self, *args, **kwargs):
        """
        Keeps dateCompleted in sync (see _sync_date_completed), then
        ensures the parent task's own completion state stays
        synchronized, then logs a TaskActivity row for creation or any
        tracked field actually changing (see _log_subtask_changes) —
        deliberately outside the atomic block below so a failure
        writing the log entry (it never should, but) can't roll back an
        otherwise-successful save. Also clears reminderSentAt when
        dateDeadline actually changes — see Task.save()'s identical
        handling for why.
        """
        _sync_date_completed(self, SubTask, kwargs)
        created = self.pk is None
        before = (
            None
            if created
            else SubTask.objects.filter(pk=self.pk).values("name", "completed", "dateDeadline").first()
        )
        if before is not None and before["dateDeadline"] != self.dateDeadline:
            self.reminderSentAt = None
            update_fields = kwargs.get("update_fields")
            if update_fields is not None:
                kwargs["update_fields"] = list(update_fields) + ["reminderSentAt"]
        with transaction.atomic():
            super().save(*args, **kwargs)
            self.task.update_completion_status()
        _log_subtask_changes(self, before, created)

    def __str__(self):
        return f"{self.name} (Subtask of {self.task.name})"


class CalendarItem(models.Model):
    """
    A time-anchored calendar entry — "this happens at/between these
    times" — as distinct from a Task ("finish this by a deadline").
    Deliberately minimal and deliberately *not* a Task subtype: no
    `completed`, no subtasks, no activity log. An event isn't something
    you check off, it's something that occurs; forcing it through Task's
    completion machinery would mean either it sits "incomplete" forever
    or gets auto-completed the instant it passes, neither of which means
    anything for something like "Dentist appointment" or "Sam's
    birthday". `dateEnd` is optional — many calendar items (a birthday,
    a one-line reminder) are a single point in time, not a span.
    """

    user = models.ForeignKey("user.CustomUser", related_name="calendar_items", on_delete=models.CASCADE)
    name = models.CharField(max_length=100, null=False, blank=False)
    location = models.CharField(max_length=200, blank=True, null=True)
    dateCreated = models.DateTimeField(auto_now_add=True)
    dateStart = models.DateTimeField(null=False, blank=False)
    dateEnd = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ["dateStart"]
        indexes = [
            models.Index(fields=["user", "dateStart"]),
        ]


class Notification(models.Model):
    """
    In-app (and, via the same digest run, email) notifications for a
    user. Currently the only write path is send_deadline_digest (a
    management command, see tasks/management/commands/) — one row per
    task/subtask a given day's digest included — never written to
    directly by a view or serializer. A separate model from
    TaskActivity rather than folded into it: TaskActivity is scoped to
    one task's own history and has no read/unread state; a notification
    belongs to a *user* across all their tasks and needs exactly that.
    `task`/`subtask` are nullable and independent (never both set) so
    the same model covers a reminder about the task itself or one of
    its subtasks; both use SET_NULL rather than CASCADE so deleting the
    task/subtask later leaves the notification's own history intact
    instead of silently vanishing it.
    """

    user = models.ForeignKey("user.CustomUser", related_name="notifications", on_delete=models.CASCADE)
    task = models.ForeignKey(Task, related_name="notifications", on_delete=models.SET_NULL, null=True, blank=True)
    subtask = models.ForeignKey(SubTask, related_name="notifications", on_delete=models.SET_NULL, null=True, blank=True)
    message = models.CharField(max_length=255)
    dateCreated = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-dateCreated"]
        indexes = [
            models.Index(fields=["user", "read"]),
        ]

    def __str__(self):
        return self.message
