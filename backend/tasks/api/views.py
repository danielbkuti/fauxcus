import secrets
from io import StringIO

from django.conf import settings
from django.core.management import call_command
from rest_framework import viewsets, permissions, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from ..models import Task, SubTask, TaskActivity, Notification
from .serializers import TaskSerializer, SubTaskSerializer, NotificationSerializer
from rest_framework.filters import OrderingFilter
from django_filters.rest_framework import DjangoFilterBackend


class TaskViewSet(viewsets.ModelViewSet):
    """
    REST API endpoint for managing user tasks.
    """

    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]

    filterset_fields = ["completed", "status"]
    ordering_fields = ["dateDeadline", "dateCreated"]
    ordering = ["-dateDeadline"]

    def get_queryset(self):
        return (
            Task.objects
            .filter(user=self.request.user)
            .select_related("user")
            .prefetch_related("subtasks", "activity_log")
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class SubTaskViewSet(viewsets.ModelViewSet):
    """
    REST API endpoint for managing subtasks.
    """

    serializer_class = SubTaskSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return SubTask.objects.filter(
            task__user=self.request.user
        )

    def perform_create(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        # Deletion doesn't go through SubTask.save(), so it's the one
        # write path _log_subtask_changes never sees — logged here
        # instead, against the parent task, before the row (and its
        # name) actually goes away.
        task = instance.task
        name = instance.name
        instance.delete()
        TaskActivity.objects.create(task=task, message=f'Subtask "{name}" removed')


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    A user's own notifications — list + update `read` only. Rows are
    only ever created by the send_deadline_digest management command,
    never through this endpoint (no create/delete action exposed —
    there's no legitimate client-side reason to make up a new
    notification or erase one from the record).
    """

    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        updated = self.get_queryset().filter(read=False).update(read=True)
        return Response({"updated": updated})


class TriggerDeadlineDigestView(APIView):
    """
    POST-only endpoint that runs `manage.py send_deadline_digest` on
    demand. Exists so a free external scheduler can trigger the daily
    digest in production — Render's free tier has no Worker/Cron Job to
    run backend/scheduler.py's loop there (see render.yaml's own
    comments), so nothing does this in prod otherwise. Meant to be
    called once a day by .github/workflows/deadline-digest-cron.yml.

    Not session-authenticated (a cron job has no browser session) —
    guarded instead by a shared-secret bearer token that must match
    DIGEST_CRON_TOKEN in both this service's env and the GitHub Actions
    secret of the same name.
    """

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        expected = settings.DIGEST_CRON_TOKEN
        if not expected:
            # Not configured in this environment — refuse rather than
            # treat a blank expected token as "anything matches".
            return Response(
                {"detail": "DIGEST_CRON_TOKEN is not configured on this server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        provided = request.headers.get("Authorization", "")
        token = provided[len("Bearer "):] if provided.startswith("Bearer ") else ""
        if not token or not secrets.compare_digest(token, expected):
            return Response({"detail": "Invalid or missing token."}, status=status.HTTP_403_FORBIDDEN)

        out = StringIO()
        call_command("send_deadline_digest", stdout=out)
        return Response({"detail": "Digest run complete.", "output": out.getvalue()})