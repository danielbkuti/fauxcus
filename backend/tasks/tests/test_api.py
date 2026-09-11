from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework import status
from ..models import Task, SubTask, CalendarItem


class TaskAPITestCase(APITestCase):

    def setUp(self):
        self.User = get_user_model()

        self.user1 = self.User.objects.create_user(
            username="user1",
            email="user1@test.com",
            password="password123",
            is_active=True
        )

        self.user2 = self.User.objects.create_user(
            username="user2",
            email="user2@test.com",
            password="password123",
            is_active=True
        )

        self.url = "/api/tasks/"

    def authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_authentication_required(self):
        """API should reject unauthenticated access."""
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_isolation(self):
        """Users should only see their own tasks."""
        Task.objects.create(user=self.user1, name="User1 Task", status="pending")
        Task.objects.create(user=self.user2, name="User2 Task", status="pending")

        self.authenticate(self.user1)
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["name"], "User1 Task")

    def test_create_task_assigns_user(self):
        """Task created via API should automatically assign request.user."""
        self.authenticate(self.user1)

        response = self.client.post(self.url, {
            "name": "New Task",
            "status": "pending",
            "completed": False
        })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Task.objects.count(), 1)
        self.assertEqual(Task.objects.first().user, self.user1)

    def test_filtering_completed(self):
        """Filtering by completed should work."""
        Task.objects.create(user=self.user1, name="A", completed=True, status="completed")
        Task.objects.create(user=self.user1, name="B", completed=False, status="pending")

        self.authenticate(self.user1)

        response = self.client.get(self.url + "?completed=true")
        self.assertEqual(len(response.data["results"]), 1)
        self.assertTrue(response.data["results"][0]["completed"])

    def test_filtering_date_range(self):
        """
        dateDeadline__gte/__lte — what the (future) calendar view filters
        on to fetch "what's due in this range" instead of the client
        walking the entire task list itself. A task with no deadline at
        all must never match a range filter (None isn't "outside every
        range", it's just not a date to compare).
        """
        now = timezone.now()
        Task.objects.create(
            user=self.user1, name="In range", status="pending", dateDeadline=now + timedelta(days=2)
        )
        Task.objects.create(
            user=self.user1, name="Out of range", status="pending", dateDeadline=now + timedelta(days=40)
        )
        Task.objects.create(user=self.user1, name="No deadline", status="pending")

        self.authenticate(self.user1)
        response = self.client.get(
            self.url,
            {
                "dateDeadline__gte": now.isoformat(),
                "dateDeadline__lte": (now + timedelta(days=7)).isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200)
        names = [t["name"] for t in response.data["results"]]
        self.assertEqual(names, ["In range"])

    def test_ordering(self):
        """Ordering by creation date should work."""
        self.authenticate(self.user1)

        Task.objects.create(user=self.user1, name="First", status="pending")
        Task.objects.create(user=self.user1, name="Second", status="pending")

        response = self.client.get(self.url + "?ordering=dateCreated")
        self.assertEqual(response.status_code, 200)


class SubTaskAPITestCase(APITestCase):
    """
    Regression coverage for a real bug: SubTaskSerializer used to omit the
    `task` field entirely, so POSTing a subtask crashed with a raw
    IntegrityError (task_id NOT NULL) instead of a clean response.
    """

    def setUp(self):
        self.User = get_user_model()

        self.user1 = self.User.objects.create_user(
            username="subuser1",
            email="subuser1@test.com",
            password="password123",
            is_active=True,
        )
        self.user2 = self.User.objects.create_user(
            username="subuser2",
            email="subuser2@test.com",
            password="password123",
            is_active=True,
        )

        self.task1 = Task.objects.create(user=self.user1, name="User1 Task", status="pending")
        self.task2 = Task.objects.create(user=self.user2, name="User2 Task", status="pending")

        self.url = "/api/subtasks/"

    def authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_create_subtask_on_own_task(self):
        """Creating a subtask on a task you own should succeed."""
        self.authenticate(self.user1)

        response = self.client.post(self.url, {
            "task": self.task1.id,
            "name": "Subtask A",
            "completed": False,
        })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(SubTask.objects.count(), 1)
        self.assertEqual(SubTask.objects.first().task, self.task1)

    def test_cannot_attach_subtask_to_other_users_task(self):
        """
        Attaching a subtask to someone else's task must be rejected — not
        silently allowed, and not a 500 crash.
        """
        self.authenticate(self.user1)

        response = self.client.post(self.url, {
            "task": self.task2.id,
            "name": "Malicious subtask",
            "completed": False,
        })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(SubTask.objects.count(), 0)

    def test_completing_only_subtask_does_not_complete_parent(self):
        """Same non-propagation behavior as test_models, but driven
        through the actual API path instead of the ORM directly."""
        self.authenticate(self.user1)

        create_response = self.client.post(self.url, {
            "task": self.task1.id,
            "name": "Only subtask",
            "completed": False,
        })
        subtask_id = create_response.data["id"]

        self.client.patch(f"{self.url}{subtask_id}/", {"completed": True})

        self.task1.refresh_from_db()
        self.assertFalse(self.task1.completed)

    def test_filtering_date_range(self):
        """Same dateDeadline__gte/__lte filtering as TaskViewSet — a
        subtask's own deadline is a first-class due-date in this app
        (the overdue gate and the due-date sort both already treat it
        that way), so the calendar view needs this endpoint filterable
        the same way, not just the parent task's."""
        now = timezone.now()
        SubTask.objects.create(task=self.task1, name="In range", dateDeadline=now + timedelta(days=2))
        SubTask.objects.create(task=self.task1, name="Out of range", dateDeadline=now + timedelta(days=40))
        SubTask.objects.create(task=self.task1, name="No deadline")

        self.authenticate(self.user1)
        response = self.client.get(
            self.url,
            {
                "dateDeadline__gte": now.isoformat(),
                "dateDeadline__lte": (now + timedelta(days=7)).isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200)
        names = [s["name"] for s in response.data["results"]]
        self.assertEqual(names, ["In range"])


class CalendarItemAPITestCase(APITestCase):

    def setUp(self):
        self.User = get_user_model()

        self.user1 = self.User.objects.create_user(
            username="caluser1",
            email="caluser1@test.com",
            password="password123",
            is_active=True,
        )
        self.user2 = self.User.objects.create_user(
            username="caluser2",
            email="caluser2@test.com",
            password="password123",
            is_active=True,
        )

        self.url = "/api/calendar-items/"

    def authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_authentication_required(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_isolation(self):
        CalendarItem.objects.create(user=self.user1, name="User1 item", dateStart=timezone.now() + timedelta(days=1))
        CalendarItem.objects.create(user=self.user2, name="User2 item", dateStart=timezone.now() + timedelta(days=1))

        self.authenticate(self.user1)
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["name"], "User1 item")

    def test_create_assigns_user(self):
        self.authenticate(self.user1)
        start = timezone.now() + timedelta(days=2)

        response = self.client.post(self.url, {"name": "Dentist", "dateStart": start.isoformat()})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(CalendarItem.objects.count(), 1)
        self.assertEqual(CalendarItem.objects.first().user, self.user1)

    def test_dateStart_cannot_be_in_the_past(self):
        self.authenticate(self.user1)

        response = self.client.post(
            self.url, {"name": "Backdated", "dateStart": (timezone.now() - timedelta(days=1)).isoformat()}
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CalendarItem.objects.count(), 0)

    def test_dateEnd_cannot_be_before_dateStart(self):
        self.authenticate(self.user1)
        start = timezone.now() + timedelta(days=2)

        response = self.client.post(
            self.url,
            {"name": "Backwards", "dateStart": start.isoformat(), "dateEnd": (start - timedelta(hours=1)).isoformat()},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CalendarItem.objects.count(), 0)

    def test_dateEnd_is_optional(self):
        self.authenticate(self.user1)

        response = self.client.post(
            self.url, {"name": "Point in time", "dateStart": (timezone.now() + timedelta(days=2)).isoformat()}
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(response.data["dateEnd"])

    def test_cannot_delete_other_users_item(self):
        other_item = CalendarItem.objects.create(
            user=self.user2, name="Not yours", dateStart=timezone.now() + timedelta(days=1)
        )

        self.authenticate(self.user1)
        response = self.client.delete(f"{self.url}{other_item.id}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(CalendarItem.objects.count(), 1)

    def test_filtering_date_range(self):
        """Same dateStart__gte/__lte filtering as Task/SubTask's own
        dateDeadline — see SubTaskAPITestCase's own version of this test
        for why it's gte/lte rather than an exact-day lookup."""
        now = timezone.now()
        CalendarItem.objects.create(user=self.user1, name="In range", dateStart=now + timedelta(days=2))
        CalendarItem.objects.create(user=self.user1, name="Out of range", dateStart=now + timedelta(days=40))

        self.authenticate(self.user1)
        response = self.client.get(
            self.url,
            {
                "dateStart__gte": now.isoformat(),
                "dateStart__lte": (now + timedelta(days=7)).isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200)
        names = [c["name"] for c in response.data["results"]]
        self.assertEqual(names, ["In range"])