import os
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase

from ..management.commands import eval_goal_planner as command
from ..planner import AnthropicPlanner
from .test_planner import GOOD_PLAN, FakeClient, reply


class SmartClient(FakeClient):
    """Answers the questions call and the plan call by looking at which
    schema was requested, so a test needn't script the call order."""

    def __init__(self, input_tokens=1000, output_tokens=2000):
        super().__init__()
        self.input_tokens, self.output_tokens = input_tokens, output_tokens

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        wants_questions = "questions" in kwargs["output_config"]["format"]["schema"]["required"]
        payload = {"questions": ["What is your budget?", "When can you start?"]} if wants_questions else GOOD_PLAN
        return reply(payload, input_tokens=self.input_tokens, output_tokens=self.output_tokens)


def planner_factory(client):
    return lambda model=None: AnthropicPlanner(model=model, client=client)


class EvalCommandTests(SimpleTestCase):
    def run_command(self, *args, client=None, key="test-key"):
        out_path = os.path.join(tempfile.mkdtemp(), "report.md")
        stdout = StringIO()
        env = {"ANTHROPIC_API_KEY": key} if key else {}
        with patch.dict(os.environ, env, clear=False), patch.object(
            command, "AnthropicPlanner", planner_factory(client or SmartClient())
        ):
            if not key:
                os.environ.pop("ANTHROPIC_API_KEY", None)
            call_command("eval_goal_planner", *args, "--out", out_path, stdout=stdout)
        with open(out_path, encoding="utf-8") as fh:
            return fh.read(), stdout.getvalue()

    def test_refuses_to_spend_without_confirmation(self):
        with self.assertRaisesMessage(CommandError, "--yes"):
            call_command("eval_goal_planner")

    def test_refuses_without_an_api_key(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ANTHROPIC_API_KEY", None)
            with self.assertRaisesMessage(CommandError, "ANTHROPIC_API_KEY"):
                call_command("eval_goal_planner", "--yes")

    def test_writes_a_report_with_a_summary_and_the_plans(self):
        report, stdout = self.run_command(
            "--yes", "--models", "claude-haiku-5-5,claude-sonnet-5-5", "--goals", "2"
        )
        self.assertIn("## Summary", report)
        self.assertIn("| claude-haiku-5-5 | 2 | 2/2 |", report)
        self.assertIn("| claude-sonnet-5-5 | 2 | 2/2 |", report)
        self.assertIn("Buy a used car", report)
        self.assertIn("Pick a course", report)  # a task from the (fake) plan
        self.assertIn("What is your budget?", report)
        self.assertIn("Spent about", stdout)

    def test_cost_is_computed_from_token_usage(self):
        # 1000 in + 2000 out per call, two calls per goal, on Sonnet:
        # (2000 * $2 + 4000 * $10) / 1M = $0.044 per goal.
        self.assertAlmostEqual(
            command.cost_of("claude-sonnet-5-5", {"input_tokens": 2000, "output_tokens": 4000}), 0.044
        )
        self.assertIsNone(command.cost_of("some-future-model", {"input_tokens": 1, "output_tokens": 1}))

    def test_stops_when_the_budget_is_reached(self):
        # Each goal costs far more than the tiny budget, so only the
        # first one should run.
        client = SmartClient(input_tokens=1_000_000, output_tokens=1_000_000)
        report, stdout = self.run_command(
            "--yes", "--models", "claude-sonnet-5-5", "--goals", "5", "--budget", "0.01", client=client
        )
        self.assertEqual(len(client.calls), 2)  # one goal: questions + plan
        self.assertIn("Stopped early", report)
        self.assertIn("budget cap", stdout)

    def test_a_failing_goal_is_reported_not_fatal(self):
        class Failing(SmartClient):
            def _create(self, **kwargs):
                raise RuntimeError("boom")

        report, _ = self.run_command("--yes", "--models", "claude-haiku-5-5", "--goals", "1", client=Failing())
        self.assertIn("No usable plan", report)
        self.assertIn("0/1", report)

    def test_sample_goals_are_well_formed(self):
        self.assertGreaterEqual(len(command.SAMPLE_GOALS), 8)
        for name, details, days, answers in command.SAMPLE_GOALS:
            self.assertTrue(name and isinstance(details, str) and answers)
            self.assertTrue(days is None or days > 0)
