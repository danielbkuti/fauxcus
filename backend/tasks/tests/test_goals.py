from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import Goal, Task


class GoalAPITestCase(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user1 = User.objects.create_user(
            username="user1", email="user1@test.com", password="password123", is_active=True
        )
        self.user2 = User.objects.create_user(
            username="user2", email="user2@test.com", password="password123", is_active=True
        )
        self.url = "/api/goals/"
        self.client.force_authenticate(user=self.user1)

    def test_authentication_required(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)

    def test_user_isolation(self):
        Goal.objects.create(user=self.user1, name="Mine")
        other = Goal.objects.create(user=self.user2, name="Theirs")

        response = self.client.get(self.url)
        self.assertEqual([g["name"] for g in response.data["results"]], ["Mine"])
        self.assertEqual(self.client.get(f"{self.url}{other.id}/").status_code, 404)

    def test_create_assigns_user_and_starts_empty(self):
        target = (timezone.localdate() + timedelta(days=60)).isoformat()
        response = self.client.post(
            self.url, {"name": "Buy a car", "description": "Used, under 10k", "targetDate": target}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Goal.objects.get(pk=response.data["id"]).user, self.user1)
        self.assertEqual(response.data["targetDate"], target)
        self.assertEqual(response.data["taskCount"], 0)
        self.assertEqual(response.data["progress"], 0)

    def test_target_date_and_description_are_optional(self):
        response = self.client.post(self.url, {"name": "Learn Spanish"})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data["targetDate"])

    def test_target_date_in_the_past_is_rejected(self):
        past = (timezone.localdate() - timedelta(days=10)).isoformat()
        response = self.client.post(self.url, {"name": "Too late", "targetDate": past})
        self.assertEqual(response.status_code, 400)
        self.assertIn("targetDate", response.data)

    def test_stale_target_date_does_not_block_other_edits(self):
        goal = Goal.objects.create(
            user=self.user1, name="Old", targetDate=timezone.localdate() - timedelta(days=30)
        )
        response = self.client.patch(f"{self.url}{goal.id}/", {"name": "Renamed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "Renamed")

    def test_progress_is_derived_from_tasks(self):
        goal = Goal.objects.create(user=self.user1, name="Ship it")
        Task.objects.create(user=self.user1, goal=goal, name="a", completed=True)
        Task.objects.create(user=self.user1, goal=goal, name="b", completed=True)
        Task.objects.create(user=self.user1, goal=goal, name="c")
        Task.objects.create(user=self.user1, goal=goal, name="d")
        Task.objects.create(user=self.user1, name="unrelated", completed=True)

        listed = self.client.get(self.url).data["results"][0]
        self.assertEqual(listed["taskCount"], 4)
        self.assertEqual(listed["completedTaskCount"], 2)
        self.assertEqual(listed["progress"], 50)

        detail = self.client.get(f"{self.url}{goal.id}/").data
        self.assertEqual(detail["progress"], 50)

    def test_completing_sets_date_completed(self):
        goal = Goal.objects.create(user=self.user1, name="Done soon")
        response = self.client.patch(f"{self.url}{goal.id}/", {"completed": True})
        self.assertIsNotNone(response.data["dateCompleted"])
        response = self.client.patch(f"{self.url}{goal.id}/", {"completed": False})
        self.assertIsNone(response.data["dateCompleted"])

    def test_deleting_a_goal_keeps_its_tasks(self):
        goal = Goal.objects.create(user=self.user1, name="Doomed")
        task = Task.objects.create(user=self.user1, goal=goal, name="Survivor")

        self.assertEqual(self.client.delete(f"{self.url}{goal.id}/").status_code, 204)

        task.refresh_from_db()
        self.assertIsNone(task.goal)

    def test_filter_by_completed(self):
        Goal.objects.create(user=self.user1, name="Open")
        Goal.objects.create(user=self.user1, name="Closed", completed=True)
        response = self.client.get(self.url, {"completed": "false"})
        self.assertEqual([g["name"] for g in response.data["results"]], ["Open"])


class TaskGoalLinkTestCase(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user1 = User.objects.create_user(
            username="user1", email="user1@test.com", password="password123", is_active=True
        )
        self.user2 = User.objects.create_user(
            username="user2", email="user2@test.com", password="password123", is_active=True
        )
        self.client.force_authenticate(user=self.user1)

    def test_create_task_under_own_goal(self):
        goal = Goal.objects.create(user=self.user1, name="Mine")
        response = self.client.post("/api/tasks/", {"name": "Step 1", "goal": goal.id})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["goal"], goal.id)

    def test_cannot_attach_task_to_another_users_goal(self):
        theirs = Goal.objects.create(user=self.user2, name="Theirs")
        response = self.client.post("/api/tasks/", {"name": "Sneaky", "goal": theirs.id})
        self.assertEqual(response.status_code, 400)
        self.assertIn("goal", response.data)

    def test_goal_is_optional_and_null_by_default(self):
        response = self.client.post("/api/tasks/", {"name": "Standalone"})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data["goal"])

    def test_filter_tasks_by_goal(self):
        goal = Goal.objects.create(user=self.user1, name="Mine")
        Task.objects.create(user=self.user1, goal=goal, name="In goal")
        Task.objects.create(user=self.user1, name="Not in goal")
        response = self.client.get("/api/tasks/", {"goal": goal.id})
        self.assertEqual([t["name"] for t in response.data["results"]], ["In goal"])
