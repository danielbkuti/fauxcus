from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import TaskViewSet, SubTaskViewSet, NotificationViewSet, TriggerDeadlineDigestView

router = DefaultRouter()
router.register(r"tasks", TaskViewSet, basename="task")
router.register(r"subtasks", SubTaskViewSet, basename="subtask")
router.register(r"notifications", NotificationViewSet, basename="notification")

urlpatterns = router.urls + [
    path(
        "internal/send-deadline-digest/",
        TriggerDeadlineDigestView.as_view(),
        name="trigger-deadline-digest",
    ),
]
