from datetime import timedelta

from rest_framework import serializers
from ..models import Task, SubTask, TaskActivity, Notification, CalendarItem, Goal
from django.utils import timezone


class TaskActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskActivity
        fields = ["id", "message", "dateCreated"]
        read_only_fields = fields


class SubTaskSerializer(serializers.ModelSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Restrict which tasks a client can even choose from to the
        # requesting user's own tasks. Without this, `task` would accept
        # any task's primary key — including another user's — reopening
        # exactly the cross-user access bug the /api/tasks/ endpoint
        # doesn't have.
        request = self.context.get("request")
        if request is not None:
            self.fields["task"].queryset = Task.objects.filter(user=request.user)

    class Meta:
        model = SubTask
        fields = [
            "id",
            "task",
            "name",
            "dateCreated",
            "dateDeadline",
            "completed",
            "dateCompleted",
        ]
        # dateCompleted is only ever set by SubTask.save() reacting to
        # `completed` changing — never client-writable.
        read_only_fields = ["dateCreated", "dateCompleted"]


class TaskSerializer(serializers.ModelSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Same cross-user guard as SubTaskSerializer's `task` field: a
        # task can only be attached to one of the requesting user's own
        # goals, never another user's.
        request = self.context.get("request")
        if request is not None:
            self.fields["goal"].queryset = Goal.objects.filter(user=request.user)

    subtasks = SubTaskSerializer(many=True, read_only=True)
    days_since_created = serializers.ReadOnlyField()
    # Oldest first (see TaskActivity.Meta.ordering) — a log reads
    # top-to-bottom like a history, not newest-first like a feed.
    activityLog = TaskActivitySerializer(many=True, read_only=True, source="activity_log")

    def validate_dateDeadline(self, value):
        if value and value < timezone.now():
            raise serializers.ValidationError(
                "Deadline cannot be in the past."
            )
        return value

    def validate(self, data):
        status = data.get("status")
        completed = data.get("completed")

        if status == "completed" and not completed:
            raise serializers.ValidationError(
                "Completed status requires completed=True."
            )

        return data

    class Meta:
        model = Task
        fields = [
            "id",
            "goal",
            "name",
            "description",
            "dateCreated",
            "dateDeadline",
            "completed",
            "dateCompleted",
            "status",
            "days_since_created",
            "subtasks",
            "activityLog",
        ]
        # dateCompleted is only ever set by Task.save() reacting to
        # `completed` changing — never client-writable.
        read_only_fields = ["dateCreated", "dateCompleted"]


class GoalSerializer(serializers.ModelSerializer):
    # Derived, never stored — see Goal's docstring. Read from the
    # annotations GoalViewSet.get_queryset adds (one aggregate query for
    # the whole list, not a count per goal); falls back to counting
    # directly for a Goal instance that didn't come through that
    # queryset (e.g. one just created in the same request), so the
    # response shape is the same either way.
    taskCount = serializers.SerializerMethodField()
    completedTaskCount = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    def _counts(self, obj):
        total = getattr(obj, "task_count", None)
        done = getattr(obj, "completed_task_count", None)
        if total is None or done is None:
            total = obj.tasks.count()
            done = obj.tasks.filter(completed=True).count()
        return total, done

    def get_taskCount(self, obj):
        return self._counts(obj)[0]

    def get_completedTaskCount(self, obj):
        return self._counts(obj)[1]

    def get_progress(self, obj):
        """0-100, whole percent of this goal's tasks that are completed.
        0 for a goal with no tasks yet (nothing done, not "100% of
        nothing")."""
        total, done = self._counts(obj)
        return round(100 * done / total) if total else 0

    def validate_targetDate(self, value):
        # No backdating a timeline — but with a day of grace. targetDate
        # is a plain calendar date the viewer picked in *their* timezone,
        # while "today" here is the server's (UTC): a viewer west of UTC
        # picking their own today in the evening is already "tomorrow"
        # server-side and fine, but one east of UTC just after their
        # midnight is "yesterday" server-side. Only checked when the
        # value is actually being changed, so an old goal whose date has
        # since passed can still have its other fields edited.
        if value is None:
            return value
        if self.instance is not None and value == self.instance.targetDate:
            return value
        if value < timezone.localdate() - timedelta(days=1):
            raise serializers.ValidationError("Target date cannot be in the past.")
        return value

    class Meta:
        model = Goal
        fields = [
            "id",
            "name",
            "description",
            "dateCreated",
            "targetDate",
            "completed",
            "dateCompleted",
            "taskCount",
            "completedTaskCount",
            "progress",
        ]
        read_only_fields = ["dateCreated", "dateCompleted"]


class CalendarItemSerializer(serializers.ModelSerializer):
    def validate_dateStart(self, value):
        # Same "no backdating" rule Task/SubTask's own dateDeadline
        # enforces — see TaskSerializer.validate_dateDeadline above.
        if value < timezone.now():
            raise serializers.ValidationError("Start time cannot be in the past.")
        return value

    def validate(self, data):
        # On a partial update (PATCH) either side might be absent from
        # `data` — fall back to the existing instance's value so a
        # PATCH that only touches one of the two still gets checked
        # against the other's real, current value.
        start = data.get("dateStart", getattr(self.instance, "dateStart", None))
        end = data.get("dateEnd", getattr(self.instance, "dateEnd", None))
        if start and end and end < start:
            raise serializers.ValidationError("End time can't be before the start time.")
        return data

    class Meta:
        model = CalendarItem
        fields = ["id", "name", "location", "dateCreated", "dateStart", "dateEnd"]
        read_only_fields = ["dateCreated"]


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "message", "dateCreated", "read", "task"]
        # `read` is the one thing a client legitimately changes here
        # (marking a notification read) — everything else is only ever
        # set by send_deadline_digest. `task` is always the *task's* id
        # even for a subtask notification (the management command sets
        # it to the subtask's parent) — only tasks have their own
        # detail page to link to, same convention Dashboard.jsx's
        # UpcomingRow already uses for taskId.
        read_only_fields = ["message", "dateCreated", "task"]


class PlanAnswerSerializer(serializers.Serializer):
    """One clarifying question and the user's answer, as sent back with a
    plan request. Length-capped: these end up in a model prompt later."""

    question = serializers.CharField(max_length=300)
    answer = serializers.CharField(max_length=1000, allow_blank=True)


class PlanRequestSerializer(serializers.Serializer):
    answers = PlanAnswerSerializer(many=True, required=False, max_length=8)
    # IANA zone name from the browser (Intl.DateTimeFormat().resolvedOptions()
    # .timeZone); unrecognised values fall back to UTC server-side.
    timezone = serializers.CharField(max_length=64, required=False, allow_blank=True)
    # "initial" plans a goal from scratch; "next" re-plans one that
    # already has tasks, building on what's done.
    mode = serializers.ChoiceField(choices=["initial", "next"], required=False, default="initial")
