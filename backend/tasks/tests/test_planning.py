from datetime import date, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase

from .. import planning
from ..models import Goal, SubTask, Task
from ..planning import (
    NAME_MAX_LENGTH,
    PlanError,
    PlannedSubtask,
    PlannedTask,
    create_plan_tasks,
    resolve_timezone,
    schedule_plan,
    validate_plan,
)

START = date(2026, 11, 18)


def raw_plan(*tasks, summary="A plan"):
    return {"summary": summary, "tasks": list(tasks)}


def raw_task(name="Step", day=0, subtasks=None, description=""):
    return {"name": name, "description": description, "day": day, "subtasks": subtasks or []}


class ValidatePlanTests(SimpleTestCase):
    def test_valid_plan_is_parsed(self):
        summary, tasks = validate_plan(
            raw_plan(
                raw_task("Research cars", 0, [{"name": "List budget", "day": 0}], "Pick a budget"),
                raw_task("Test drive", 10),
                summary="Buy a used car",
            )
        )
        self.assertEqual(summary, "Buy a used car")
        self.assertEqual([t.name for t in tasks], ["Research cars", "Test drive"])
        self.assertEqual(tasks[0].description, "Pick a budget")
        self.assertEqual(tasks[0].subtasks, [PlannedSubtask("List budget", 0)])

    def test_rejects_non_objects_and_empty_plans(self):
        for bad in (None, [], "plan", {}, {"tasks": []}, {"tasks": "nope"}):
            with self.assertRaises(PlanError):
                validate_plan(bad)

    def test_rejects_bad_tasks(self):
        bad_tasks = [
            "not an object",
            raw_task(name="  "),
            raw_task(name=None),
            raw_task(day=-1),
            raw_task(day=1.5),
            raw_task(day=True),
            raw_task(day="3"),
            raw_task(day=planning.MAX_DAY_OFFSET + 1),
            {"name": "x", "day": 0, "subtasks": "nope"},
        ]
        for bad in bad_tasks:
            with self.subTest(bad=bad), self.assertRaises(PlanError):
                validate_plan(raw_plan(bad))

    def test_size_limits(self):
        too_many = [raw_task(f"T{i}", i) for i in range(planning.MAX_TASKS + 1)]
        with self.assertRaises(PlanError):
            validate_plan(raw_plan(*too_many))
        too_many_subs = [{"name": f"S{i}", "day": 0} for i in range(planning.MAX_SUBTASKS_PER_TASK + 1)]
        with self.assertRaises(PlanError):
            validate_plan(raw_plan(raw_task("T", 0, too_many_subs)))

    def test_long_names_are_cut_to_fit_and_whitespace_collapsed(self):
        _, tasks = validate_plan(raw_plan(raw_task("  " + "word " * 60 + "\n", 0)))
        self.assertLessEqual(len(tasks[0].name), NAME_MAX_LENGTH)
        self.assertTrue(tasks[0].name.endswith("…"))
        _, tasks = validate_plan(raw_plan(raw_task("Call\n  the   bank", 0)))
        self.assertEqual(tasks[0].name, "Call the bank")

    def test_nameless_subtasks_are_dropped_not_fatal(self):
        _, tasks = validate_plan(
            raw_plan(raw_task("T", 2, [{"name": " ", "day": 1}, {"name": "Real", "day": 1}]))
        )
        self.assertEqual([s.name for s in tasks[0].subtasks], ["Real"])

    def test_duplicate_names_get_numbered(self):
        _, tasks = validate_plan(raw_plan(raw_task("Review", 0), raw_task("review", 1), raw_task("Review", 2)))
        self.assertEqual([t.name for t in tasks], ["Review", "review (2)", "Review (3)"])

    def test_numbering_keeps_names_within_the_length_limit(self):
        long = "x" * NAME_MAX_LENGTH
        _, tasks = validate_plan(raw_plan(raw_task(long, 0), raw_task(long, 1)))
        self.assertEqual(len({t.name for t in tasks}), 2)
        self.assertTrue(all(len(t.name) <= NAME_MAX_LENGTH for t in tasks))

    def test_schema_describes_what_the_validator_accepts(self):
        self.assertEqual(set(planning.PLAN_JSON_SCHEMA["required"]), {"summary", "tasks"})
        item = planning.PLAN_JSON_SCHEMA["properties"]["tasks"]["items"]
        self.assertEqual(set(item["required"]), {"name", "description", "day", "subtasks"})


class SchedulePlanTests(SimpleTestCase):
    def schedule(self, tasks, target=None, **kwargs):
        return schedule_plan("s", tasks, START, target, **kwargs)

    def test_relative_days_become_dates(self):
        result = self.schedule([PlannedTask("a", "", 0), PlannedTask("b", "", 7)])
        self.assertEqual([t.date for t in result.tasks], [START, START + timedelta(days=7)])
        self.assertEqual(result.warnings, [])

    def test_output_is_sorted_by_date(self):
        result = self.schedule([PlannedTask("late", "", 9), PlannedTask("early", "", 1)])
        self.assertEqual([t.name for t in result.tasks], ["early", "late"])

    def test_target_date_clamps_later_tasks(self):
        target = START + timedelta(days=10)
        result = self.schedule([PlannedTask("a", "", 5), PlannedTask("b", "", 60)], target)
        self.assertEqual([t.date for t in result.tasks], [START + timedelta(days=5), target])
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("moved earlier", result.warnings[0])

    def test_nothing_is_ever_scheduled_past_the_target(self):
        target = START + timedelta(days=3)
        tasks = [PlannedTask(f"t{i}", "", i * 5) for i in range(10)]
        result = self.schedule(tasks, target)
        self.assertTrue(all(t.date <= target for t in result.tasks))
        self.assertEqual(len(result.tasks), 10)  # crowded, never dropped

    def test_crowded_target_window_warns(self):
        target = START + timedelta(days=1)  # 2 days x 3 slots = 6 slots
        tasks = [PlannedTask(f"t{i}", "", 0) for i in range(8)]
        result = self.schedule(tasks, target)
        self.assertTrue(any("longer timeline" in w for w in result.warnings))

    def test_a_busy_day_spills_forward(self):
        tasks = [PlannedTask(f"t{i}", "", 0) for i in range(5)]
        result = self.schedule(tasks, max_per_day=2)
        counts = {}
        for t in result.tasks:
            counts[t.date] = counts.get(t.date, 0) + 1
        self.assertEqual(counts, {START: 2, START + timedelta(days=1): 2, START + timedelta(days=2): 1})
        self.assertTrue(any("moved to a later day" in w for w in result.warnings))

    def test_spilled_tasks_keep_their_order(self):
        tasks = [PlannedTask(f"t{i}", "", 0) for i in range(4)]
        result = self.schedule(tasks, max_per_day=2)
        self.assertEqual([t.name for t in result.tasks], ["t0", "t1", "t2", "t3"])

    def test_spill_counts_against_the_day_it_lands_on(self):
        tasks = [PlannedTask(n, "", d) for n, d in [("a", 0), ("b", 0), ("c", 0), ("d", 1), ("e", 1)]]
        result = self.schedule(tasks, max_per_day=2)
        self.assertEqual(
            [(t.name, (t.date - START).days) for t in result.tasks],
            [("a", 0), ("b", 0), ("c", 1), ("d", 1), ("e", 2)],
        )

    def test_subtasks_are_never_due_after_their_task(self):
        task = PlannedTask("t", "", 4, [PlannedSubtask("late", 30), PlannedSubtask("ok", 2)])
        result = self.schedule([task])
        dates = {s.name: s.date for s in result.tasks[0].subtasks}
        self.assertEqual(dates, {"late": START + timedelta(days=4), "ok": START + timedelta(days=2)})

    def test_subtasks_follow_a_task_that_was_moved(self):
        a = PlannedTask("a", "", 0)
        b = PlannedTask("b", "", 0, [PlannedSubtask("s", 0)])
        result = self.schedule([a, b], max_per_day=1)
        moved = next(t for t in result.tasks if t.name == "b")
        self.assertEqual(moved.date, START + timedelta(days=1))
        self.assertLessEqual(moved.subtasks[0].date, moved.date)

    def test_subtasks_are_sorted_by_date(self):
        task = PlannedTask("t", "", 5, [PlannedSubtask("b", 4), PlannedSubtask("a", 1)])
        result = self.schedule([task])
        self.assertEqual([s.name for s in result.tasks[0].subtasks], ["a", "b"])

    def test_target_before_start_is_an_error(self):
        with self.assertRaises(PlanError):
            self.schedule([PlannedTask("a", "", 0)], START - timedelta(days=1))

    def test_target_on_start_day_is_allowed(self):
        result = self.schedule([PlannedTask("a", "", 5)], START)
        self.assertEqual(result.tasks[0].date, START)


class ResolveTimezoneTests(SimpleTestCase):
    def test_known_zone(self):
        self.assertEqual(resolve_timezone("Europe/London"), ZoneInfo("Europe/London"))

    def test_missing_or_bad_zone_falls_back_to_utc(self):
        for value in (None, "", "Mars/Olympus", "../etc/passwd"):
            with self.subTest(value=value):
                self.assertEqual(resolve_timezone(value).utcoffset(None).total_seconds(), 0)


class CreatePlanTasksTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="planner", email="planner@test.com", password="password123", is_active=True
        )
        self.other = User.objects.create_user(
            username="other", email="other@test.com", password="password123", is_active=True
        )
        self.goal = Goal.objects.create(user=self.user, name="Buy a car")

    def build(self, *tasks, target=None):
        summary, planned = validate_plan(raw_plan(*tasks))
        return schedule_plan(summary, planned, START, target)

    def test_creates_goal_linked_tasks_and_subtasks(self):
        schedule = self.build(
            raw_task("Research", 0, [{"name": "Set budget", "day": 0}, {"name": "Read reviews", "day": 1}], "Notes"),
            raw_task("Test drive", 7),
        )
        created = create_plan_tasks(self.user, self.goal, schedule)

        self.assertEqual([t.name for t in created], ["Research", "Test drive"])
        self.assertTrue(all(t.goal_id == self.goal.id and t.user_id == self.user.id for t in created))
        self.assertEqual(created[0].description, "Notes")
        self.assertIsNone(created[1].description)
        self.assertEqual(created[0].subtasks.count(), 2)
        self.assertEqual(self.goal.tasks.count(), 2)

    def test_deadlines_are_due_in_the_evening_of_the_users_local_day(self):
        tz = ZoneInfo("America/Los_Angeles")
        created = create_plan_tasks(self.user, self.goal, self.build(raw_task("A", 0)), tz=tz)
        local = created[0].dateDeadline.astimezone(tz)
        self.assertEqual((local.date(), local.hour), (START, planning.DEFAULT_DUE_HOUR))

    def test_subtask_deadlines_are_set(self):
        schedule = self.build(raw_task("A", 3, [{"name": "S", "day": 1}]))
        create_plan_tasks(self.user, self.goal, schedule)
        sub = SubTask.objects.get(name="S")
        self.assertEqual(sub.dateDeadline.date(), START + timedelta(days=1))

    def test_each_task_gets_its_usual_activity_entry(self):
        created = create_plan_tasks(self.user, self.goal, self.build(raw_task("A", 0)))
        self.assertIn("Task created", [a.message for a in created[0].activity_log.all()])

    def test_names_that_collide_with_existing_tasks_are_numbered(self):
        Task.objects.create(user=self.user, name="Research")
        created = create_plan_tasks(self.user, self.goal, self.build(raw_task("Research", 0)))
        self.assertEqual(created[0].name, "Research (2)")

    def test_another_users_task_names_do_not_collide(self):
        Task.objects.create(user=self.other, name="Research")
        created = create_plan_tasks(self.user, self.goal, self.build(raw_task("Research", 0)))
        self.assertEqual(created[0].name, "Research")

    def test_cannot_plan_into_someone_elses_goal(self):
        with self.assertRaises(PlanError):
            create_plan_tasks(self.other, self.goal, self.build(raw_task("A", 0)))
        self.assertEqual(Task.objects.filter(goal=self.goal).count(), 0)

    def test_is_all_or_nothing(self):
        # A and B are created first; the failure comes while writing B's
        # subtask, so both tasks must be rolled back.
        schedule = self.build(raw_task("A", 0), raw_task("B", 1, [{"name": "S", "day": 1}]))
        with patch.object(planning.SubTask.objects, "create", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                create_plan_tasks(self.user, self.goal, schedule)
        self.assertEqual(Task.objects.filter(user=self.user).count(), 0)
