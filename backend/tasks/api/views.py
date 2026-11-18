import secrets
from io import StringIO

from django.conf import settings
from django.core.management import call_command
from rest_framework import viewsets, permissions, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.throttling import ScopedRateThrottle
from ..models import Task, SubTask, TaskActivity, Notification, CalendarItem, Goal
from ..planner import get_planner
from ..planning import (PlanError, create_plan_tasks, resolve_timezone, schedule_from_payload,
                        schedule_plan, schedule_to_dict, validate_plan)
from .serializers import (TaskSerializer, SubTaskSerializer, NotificationSerializer,
                          CalendarItemSerializer, GoalSerializer, PlanRequestSerializer)
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
        "goal": ["exact"],
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


class GoalViewSet(viewsets.ModelViewSet):
    """
    REST API endpoint for a user's own goals — see Goal's docstring for
    what one is. Deleting a goal detaches its tasks (Task.goal is
    SET_NULL); it never deletes them.
    """

    serializer_class = GoalSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = {"completed": ["exact"]}
    # Only the plan/questions and plan/draft actions opt in to throttling
    # (they override this per-action); every other route stays unthrottled.
    # Declared here because DRF only lets an @action override attributes
    # the class already has.
    throttle_scope = None

    def get_queryset(self):
        # Progress is derived from the goal's tasks, so annotate both
        # counts onto the queryset in one aggregate query rather than
        # one COUNT per goal when the list is serialized. distinct=True
        # isn't needed: both counts join the same single relation.
        return (
            Goal.objects
            .filter(user=self.request.user)
            .annotate(
                task_count=Count("tasks"),
                completed_task_count=Count("tasks", filter=Q(tasks__completed=True)),
            )
            # Explicit, not left to Goal.Meta.ordering: Django drops
            # Meta.ordering on a GROUP BY (annotate + aggregate) query,
            # which would leave pagination with no deterministic order.
            .order_by("-dateCreated", "-id")
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # ------------------------------------------------ plan this goal
    #
    # Three steps, and only the last one writes anything:
    #   1. plan/questions — clarifying questions for the goal
    #   2. plan/draft     — a proposed schedule, returned to the client and
    #                       NOT stored; the user reviews/edits it there
    #   3. plan/accept    — the (possibly edited) draft comes back and is
    #                       turned into real tasks
    # Steps 1 and 2 are the ones that can cost money once a model is behind
    # the planner, so they share the "goal_plan" throttle scope; accepting
    # is just database writes and isn't throttled.

    def _plan_context(self, request):
        """Validated request body + the user's own 'today', worked out
        server-side from their timezone rather than trusted from the
        client."""
        serializer = PlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tz = resolve_timezone(serializer.validated_data.get("timezone"))
        today = timezone.now().astimezone(tz).date()
        return serializer.validated_data, tz, today

    @staticmethod
    def _check_plannable(goal, today):
        if goal.completed:
            return Response(
                {"detail": "This goal is already completed. Reopen it to plan more steps."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if goal.targetDate is not None and goal.targetDate < today:
            return Response(
                {"detail": "This goal's target date has passed. Move it to a future date first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return None

    @action(detail=True, methods=["get"], url_path="plan")
    def plan_info(self, request, pk=None):
        """Which planner would serve this user ("template" or "ai"), so the
        UI can say up front when text is about to be sent to a model.
        Free and unthrottled: it calls nothing."""
        self.get_object()
        return Response({"source": get_planner(request.user).source})

    @action(
        detail=True,
        methods=["post"],
        url_path="plan/questions",
        throttle_classes=[ScopedRateThrottle],
        throttle_scope="goal_plan",
    )
    def plan_questions(self, request, pk=None):
        goal = self.get_object()
        planner = get_planner(request.user)
        try:
            questions = planner.questions(goal)
        except PlanError:
            return Response(
                {"detail": "Couldn't put a plan together just now. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({"questions": questions, "source": planner.source})

    @action(
        detail=True,
        methods=["post"],
        url_path="plan/draft",
        throttle_classes=[ScopedRateThrottle],
        throttle_scope="goal_plan",
    )
    def plan_draft(self, request, pk=None):
        goal = self.get_object()
        data, tz, today = self._plan_context(request)
        problem = self._check_plannable(goal, today)
        if problem:
            return problem

        horizon = (goal.targetDate - today).days if goal.targetDate else None
        planner = get_planner(request.user)
        # What the goal already has, so a planner can avoid repeating it
        # (and, for "plan the next phase", build on what's done). Capped:
        # it ends up in a prompt.
        existing = [
            {
                "name": t.name,
                "completed": t.completed,
                "due_in_days": (t.dateDeadline.astimezone(tz).date() - today).days
                if t.dateDeadline
                else None,
            }
            for t in goal.tasks.order_by("-dateCreated")[:60]
        ]
        try:
            raw = planner.draft(
                goal, data.get("answers", []), horizon, existing=existing, phase=data["mode"]
            )
            summary, tasks = validate_plan(raw)
            schedule = schedule_plan(summary, tasks, today, goal.targetDate)
        except PlanError:
            # The planner's output was unusable — not the client's fault,
            # and nothing was created, so it's safe to just try again.
            return Response(
                {"detail": "Couldn't put a plan together just now. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({**schedule_to_dict(schedule), "source": planner.source})

    @action(detail=True, methods=["post"], url_path="plan/accept")
    def plan_accept(self, request, pk=None):
        goal = self.get_object()
        _data, tz, today = self._plan_context(request)
        problem = self._check_plannable(goal, today)
        if problem:
            return problem
        try:
            schedule = schedule_from_payload(request.data, today, goal.targetDate)
            created = create_plan_tasks(request.user, goal, schedule, tz)
        except PlanError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"created": len(created), "taskIds": [t.id for t in created]},
            status=status.HTTP_201_CREATED,
        )


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