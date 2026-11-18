from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from ..models import Goal, Task
from ..planner import TemplatePlanner, get_planner
from ..planning import PlanError, validate_plan


class TemplatePlannerTests(SimpleTestCase):
    class FakeGoal:
        name = "Buy a car"

    def test_every_horizon_yields_a_valid_plan(self):
        planner = TemplatePlanner()
        for horizon in (1, 2, 5, 14, 30, 90, 365, 2000, None):
            with self.subTest(horizon=horizon):
                raw = planner.draft(self.FakeGoal(), [], horizon)
                summary, tasks = validate_plan(raw)
                self.assertTrue(summary)
                self.assertGreaterEqual(len(tasks), 5)
                if horizon:
                    self.assertTrue(all(t.day <= horizon for t in tasks))

    def test_long_goal_names_still_fit(self):
        goal = type("G", (), {"name": "x" * 100})()
        _, tasks = validate_plan(TemplatePlanner().draft(goal, [], 60))
        self.assertTrue(all(len(t.name) <= 100 for t in tasks))

    def test_answers_are_carried_into_the_first_task_description(self):
        raw = TemplatePlanner().draft(
            self.FakeGoal(), [{"question": "Budget?", "answer": "$8k"}, {"question": "Skip", "answer": " "}], 30
        )
        self.assertIn("Budget? $8k", raw["tasks"][0]["description"])
        self.assertNotIn("Skip", raw["tasks"][0]["description"])

    def test_has_questions(self):
        self.assertGreaterEqual(len(TemplatePlanner().questions(self.FakeGoal())), 3)

    def test_get_planner_follows_settings(self):
        self.assertIsInstance(get_planner(), TemplatePlanner)
        with override_settings(GOAL_PLANNER="tasks.tests.test_goal_plan_api.BrokenPlanner"):
            self.assertIsInstance(get_planner(), BrokenPlanner)


class BrokenPlanner:
    source = "broken"

    def questions(self, goal):
        return []

    def draft(self, goal, answers, horizon_days, existing=(), phase="initial"):
        return {"tasks": []}


class RaisingPlanner:
    """Fails the way AnthropicPlanner does when the model is unreachable."""

    source = "ai"

    def questions(self, goal):
        raise PlanError("down")

    def draft(self, goal, answers, horizon_days, existing=(), phase="initial"):
        raise PlanError("down")


class RecordingPlanner(TemplatePlanner):
    source = "ai"
    calls = []

    def draft(self, goal, answers, horizon_days, existing=(), phase="initial"):
        RecordingPlanner.calls.append({"existing": list(existing), "phase": phase, "horizon": horizon_days})
        return super().draft(goal, answers, horizon_days, existing, phase)


class GoalPlanAPITests(APITestCase):
    def setUp(self):
        cache.clear()  # throttle counters live in the cache
        User = get_user_model()
        self.user = User.objects.create_user(
            username="u1", email="u1@test.com", password="password123", is_active=True
        )
        self.other = User.objects.create_user(
            username="u2", email="u2@test.com", password="password123", is_active=True
        )
        self.today = timezone.now().date()
        self.goal = Goal.objects.create(
            user=self.user, name="Buy a car", targetDate=self.today + timedelta(days=60)
        )
        self.client.force_authenticate(user=self.user)

    def url(self, step, goal=None):
        return f"/api/goals/{(goal or self.goal).id}/plan/{step}/"

    def draft(self, **body):
        return self.client.post(self.url("draft"), {"timezone": "UTC", **body}, format="json")

    # ------------------------------------------------------------ questions

    def test_questions(self):
        response = self.client.post(self.url("questions"))
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data["questions"]), 3)

    def test_requires_login(self):
        self.client.force_authenticate(user=None)
        for step in ("questions", "draft", "accept"):
            self.assertEqual(self.client.post(self.url(step)).status_code, 403)

    def test_cannot_plan_another_users_goal(self):
        theirs = Goal.objects.create(user=self.other, name="Theirs")
        for step in ("questions", "draft", "accept"):
            self.assertEqual(self.client.post(self.url(step, theirs), {}, format="json").status_code, 404)

    # ---------------------------------------------------------------- draft

    def test_draft_returns_a_schedule_and_creates_nothing(self):
        response = self.draft(answers=[{"question": "Budget?", "answer": "$8k"}])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["source"], "template")
        tasks = response.data["tasks"]
        self.assertGreaterEqual(len(tasks), 5)
        self.assertEqual(tasks[0]["date"], self.today.isoformat())
        self.assertLessEqual(tasks[-1]["date"], self.goal.targetDate.isoformat())
        self.assertEqual(Task.objects.filter(user=self.user).count(), 0)

    def test_draft_without_a_target_date_uses_the_default_horizon(self):
        goal = Goal.objects.create(user=self.user, name="Learn Spanish")
        response = self.client.post(self.url("draft", goal), {"timezone": "UTC"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_draft_validates_answers(self):
        too_long = [{"question": "q", "answer": "a" * 1001}]
        self.assertEqual(self.draft(answers=too_long).status_code, 400)
        too_many = [{"question": "q", "answer": "a"}] * 9
        self.assertEqual(self.draft(answers=too_many).status_code, 400)
        self.assertEqual(self.draft(answers=[{"answer": "no question"}]).status_code, 400)

    def test_unknown_timezone_falls_back_to_utc(self):
        self.assertEqual(self.draft(timezone="Mars/Olympus").status_code, 200)

    def test_cannot_draft_for_a_completed_goal(self):
        self.goal.completed = True
        self.goal.save()
        self.assertEqual(self.draft().status_code, 400)

    def test_cannot_draft_once_the_target_date_has_passed(self):
        self.goal.targetDate = self.today - timedelta(days=5)
        self.goal.save()
        response = self.draft()
        self.assertEqual(response.status_code, 400)
        self.assertIn("target date", response.data["detail"])

    def test_an_unusable_planner_result_is_a_retryable_502(self):
        with override_settings(GOAL_PLANNER="tasks.tests.test_goal_plan_api.BrokenPlanner"):
            response = self.draft()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(Task.objects.count(), 0)

    def test_plan_info_says_which_planner_would_be_used_without_calling_it(self):
        url = f"/api/goals/{self.goal.id}/plan/"
        self.assertEqual(self.client.get(url).data, {"source": "template"})
        with override_settings(GOAL_PLANNER="tasks.tests.test_goal_plan_api.RaisingPlanner"):
            self.assertEqual(self.client.get(url).data, {"source": "ai"})
        # Not throttled: it costs nothing.
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"goal_plan": "1/day"}):
            for _ in range(3):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_plan_info_is_private_to_the_goals_owner(self):
        theirs = Goal.objects.create(user=self.other, name="Theirs")
        self.assertEqual(self.client.get(f"/api/goals/{theirs.id}/plan/").status_code, 404)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(f"/api/goals/{self.goal.id}/plan/").status_code, 403)

    def test_questions_report_which_planner_wrote_them(self):
        self.assertEqual(self.client.post(self.url("questions")).data["source"], "template")

    def test_an_unavailable_model_is_a_retryable_502_for_questions_too(self):
        with override_settings(GOAL_PLANNER="tasks.tests.test_goal_plan_api.RaisingPlanner"):
            self.assertEqual(self.client.post(self.url("questions")).status_code, 502)
            self.assertEqual(self.draft().status_code, 502)

    def test_the_demo_account_is_always_served_by_the_free_template(self):
        demo = get_user_model().objects.create_user(
            username="demo", email="demo@example.com", password="x", is_active=True
        )
        goal = Goal.objects.create(user=demo, name="Demo goal")
        self.client.force_authenticate(user=demo)
        with override_settings(GOAL_PLANNER="tasks.tests.test_goal_plan_api.RaisingPlanner"):
            response = self.client.post(self.url("questions", goal))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["source"], "template")

    # ------------------------------------------------------ plan next phase

    def test_mode_must_be_initial_or_next(self):
        self.assertEqual(self.draft(mode="sideways").status_code, 400)

    def test_the_planner_is_told_the_phase_and_what_the_goal_already_has(self):
        Task.objects.create(
            user=self.user, goal=self.goal, name="Research", completed=True,
            dateDeadline=timezone.now() - timedelta(days=2),
        )
        Task.objects.create(
            user=self.user, goal=self.goal, name="Test drive",
            dateDeadline=timezone.now() + timedelta(days=5),
        )
        Task.objects.create(user=self.other, name="Not this goal's")
        RecordingPlanner.calls = []
        with override_settings(GOAL_PLANNER="tasks.tests.test_goal_plan_api.RecordingPlanner"):
            response = self.draft(mode="next")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["source"], "ai")
        call = RecordingPlanner.calls[0]
        self.assertEqual(call["phase"], "next")
        by_name = {t["name"]: t for t in call["existing"]}
        self.assertEqual(set(by_name), {"Research", "Test drive"})
        self.assertTrue(by_name["Research"]["completed"])
        self.assertEqual(by_name["Research"]["due_in_days"], -2)
        self.assertEqual(by_name["Test drive"]["due_in_days"], 5)

    def test_default_mode_is_initial(self):
        RecordingPlanner.calls = []
        with override_settings(GOAL_PLANNER="tasks.tests.test_goal_plan_api.RecordingPlanner"):
            self.draft()
        self.assertEqual(RecordingPlanner.calls[0]["phase"], "initial")
        self.assertEqual(RecordingPlanner.calls[0]["existing"], [])

    def test_next_phase_draft_can_be_accepted_alongside_existing_tasks(self):
        Task.objects.create(user=self.user, goal=self.goal, name="Research")
        draft = self.draft(mode="next").data
        response = self.accept(draft["tasks"])
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.goal.tasks.count(), 1 + len(draft["tasks"]))

    # --------------------------------------------------------------- accept

    def accept(self, tasks, **body):
        return self.client.post(self.url("accept"), {"timezone": "UTC", "tasks": tasks, **body}, format="json")

    def test_draft_then_accept_creates_goal_tasks(self):
        draft = self.draft().data
        response = self.accept(draft["tasks"])
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["created"], len(draft["tasks"]))
        self.assertEqual(self.goal.tasks.count(), len(draft["tasks"]))
        # ...and the goal's derived progress sees them.
        detail = self.client.get(f"/api/goals/{self.goal.id}/").data
        self.assertEqual(detail["taskCount"], len(draft["tasks"]))
        self.assertEqual(detail["progress"], 0)

    def test_the_user_can_drop_steps_before_accepting(self):
        draft = self.draft().data
        response = self.accept(draft["tasks"][:2])
        self.assertEqual(response.data["created"], 2)

    def test_accept_rejects_dates_outside_the_goals_window(self):
        late = (self.goal.targetDate + timedelta(days=1)).isoformat()
        early = (self.today - timedelta(days=2)).isoformat()
        for bad in (late, early, "soon", None):
            with self.subTest(date=bad):
                self.assertEqual(self.accept([{"name": "A", "date": bad, "subtasks": []}]).status_code, 400)
        self.assertEqual(Task.objects.count(), 0)

    def test_accept_rejects_empty_and_malformed_plans(self):
        self.assertEqual(self.accept([]).status_code, 400)
        self.assertEqual(self.accept(["nope"]).status_code, 400)
        self.assertEqual(self.accept([{"name": " ", "date": self.today.isoformat()}]).status_code, 400)

    def test_accept_rejects_a_subtask_due_after_its_task(self):
        task = {
            "name": "A",
            "date": self.today.isoformat(),
            "subtasks": [{"name": "S", "date": (self.today + timedelta(days=1)).isoformat()}],
        }
        self.assertEqual(self.accept([task]).status_code, 400)

    def test_accept_rejects_oversized_plans(self):
        many = [{"name": f"T{i}", "date": self.today.isoformat()} for i in range(41)]
        self.assertEqual(self.accept(many).status_code, 400)

    def test_cannot_accept_into_a_completed_goal(self):
        self.goal.completed = True
        self.goal.save()
        self.assertEqual(self.accept([{"name": "A", "date": self.today.isoformat()}]).status_code, 400)

    # ------------------------------------------------------------- throttle

    def test_questions_and_draft_share_a_daily_limit_but_accept_is_free(self):
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"goal_plan": "2/day"}):
            self.assertEqual(self.client.post(self.url("questions")).status_code, 200)
            self.assertEqual(self.draft().status_code, 200)
            self.assertEqual(self.draft().status_code, 429)
            self.assertEqual(self.client.post(self.url("questions")).status_code, 429)
            ok = self.accept([{"name": "A", "date": self.today.isoformat()}])
            self.assertEqual(ok.status_code, 201)

    def test_the_limit_is_per_user(self):
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"goal_plan": "1/day"}):
            self.assertEqual(self.client.post(self.url("questions")).status_code, 200)
            self.assertEqual(self.client.post(self.url("questions")).status_code, 429)
            self.client.force_authenticate(user=self.other)
            theirs = Goal.objects.create(user=self.other, name="Theirs")
            self.assertEqual(self.client.post(self.url("questions", theirs)).status_code, 200)
