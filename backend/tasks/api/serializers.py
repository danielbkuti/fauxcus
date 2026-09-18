from rest_framework import serializers
from ..models import Task, SubTask, TaskActivity, Notification, CalendarItem
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
