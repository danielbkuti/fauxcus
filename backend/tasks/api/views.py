import secrets
from io import StringIO

from django.conf import settings
from django.core.management import call_command
from rest_framework import viewsets, permissions, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from ..models import Task, SubTask, TaskActivity, Notification, CalendarItem
from .serializers import TaskSerializer, SubTaskSerializer, NotificationSerializer, CalendarItemSerializer
from rest_framework.filters import OrderingFilter
from django_filters.rest_framework import DjangoFilterBackend


class TaskViewSet(viewsets.ModelViewSet):
    """
    REST API endpoint for managing user tasks.
    """

    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]

    # dateDeadline's gte/lte pair is what the calendar view (and
    # anything else wanting "what's due in this range") filters on —
    # e.g. ?dateDeadline__gte=2026-09-01T00:00:00Z&dateDeadline__lte=2026-10-01T00:00:00Z
    # for a month. Deliberately just gte/lte, not an `exact`-day lookup
    # like dateDeadline__date: dateDeadline is stored in UTC, and
    # "which calendar day is this due on" is a *local-timezone*
    # question the caller has to answer, same as every other
    # deadline-derived thing in this app (formatDeadline, the overdue
    # gate, etc.) — a raw __date lookup against the stored UTC value
    # would silently give the wrong day for a chunk of users near
    # midnight. Compute the local day's start/end as UTC client-side
    # and pass those as gte/lte instead.
    filterset_fields = {
        "completed": ["exact"],
        "status": ["exact"],
        "dateDeadline": ["gte", "lte"],
    }
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
    filter_backends = [DjangoFilterBackend]

    # Same reasoning as TaskViewSet's own dateDeadline filter — see
    # there for why this is gte/lte only, not an exact-day lookup.
    filterset_fields = {"dateDeadline": ["gte", "lte"]}

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


class CalendarItemViewSet(viewsets.ModelViewSet):
    """
    REST API endpoint for a user's own calendar items — see
    CalendarItem's own docstring for what these are and why they're a
    separate model from Task.
    """

    serializer_class = CalendarItemSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend]

    # Same gte/lte-only reasoning as TaskViewSet.filterset_fields — see
    # there. dateStart is always set (unlike Task's dateDeadline), so
    # unlike that filter there's no "no deadline at all" case to worry
    # about excluding.
    filterset_fields = {"dateStart": ["gte", "lte"]}

    def get_queryset(self):
        return CalendarItem.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


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
    host any persistent scheduler there (see render.yaml's own
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