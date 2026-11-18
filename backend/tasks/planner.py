"""
Where a goal's clarifying questions and plan draft come from.

The API layer only knows the two-method interface below, so what sits
behind it can change without touching endpoints, validation, scheduling
or the frontend:

    questions(goal)                    -> list of question strings
    draft(goal, answers, horizon_days) -> a raw plan draft (PLAN_JSON_SCHEMA)

Today the only implementation is TemplatePlanner: a fixed, deterministic
outline that fits any goal. It calls nothing external and costs nothing,
which makes it the plan for the demo account and the stand-in while the
review/accept flow is built and tested. A model-backed planner would
implement the same two methods; settings.GOAL_PLANNER picks which one is
used. Whatever a planner returns is untrusted input — the caller always
runs it through validate_plan and schedule_plan.
"""

from django.conf import settings
from django.utils.module_loading import import_string

from .planning import NAME_MAX_LENGTH

# Plans are scheduled over the goal's own timeline, or this many days
# when it has none.
DEFAULT_HORIZON_DAYS = 90
# The first stretch is planned in detail (subtasks), later steps stay
# coarse — they're better re-planned once the user is closer to them.
NEAR_TERM_DAYS = 14


class TemplatePlanner:
    source = "template"

    def questions(self, goal):
        return [
            "What does success look like — how will you know you've reached this goal?",
            "Where are you starting from today? (What have you already done or got?)",
            "Roughly how much time can you give this each week?",
            "Is there anything that could get in the way — money, time, skills?",
        ]

    def draft(self, goal, answers, horizon_days):
        horizon = max(int(horizon_days or DEFAULT_HORIZON_DAYS), 1)

        def at(fraction):
            return min(int(round(horizon * fraction)), horizon)

        # "Fit" a goal name into step names without blowing the 100-char limit.
        label = goal.name if len(goal.name) <= 50 else goal.name[:49].rstrip() + "…"
        notes = "\n".join(
            f"{a['question']} {a['answer']}" for a in answers if a.get("answer", "").strip()
        )
        first_description = "Your notes so far:\n" + notes if notes else ""

        near = min(NEAR_TERM_DAYS, horizon)
        tasks = [
            {
                "name": f"Define what success looks like for {label}",
                "description": first_description,
                "day": 0,
                "subtasks": [
                    {"name": "Write the outcome in one sentence", "day": 0},
                    {"name": "List what you already have and what's missing", "day": min(1, near)},
                ],
            },
            {
                "name": "Research your options",
                "description": "Compare at least three ways to get there and note the trade-offs.",
                "day": min(3, near),
                "subtasks": [
                    {"name": "Collect options", "day": min(2, near)},
                    {"name": "Compare costs, time and effort", "day": min(3, near)},
                ],
            },
            {
                "name": "Choose an approach and set a budget",
                "description": "Decide how you'll do it and what it can cost in money and time.",
                "day": min(7, near),
                "subtasks": [],
            },
            {
                "name": "Take the first concrete step",
                "description": "Something small you can finish this week to get moving.",
                "day": near,
                "subtasks": [],
            },
            {
                "name": "Check progress at the one-quarter mark",
                "description": "What's working? What needs to change?",
                "day": at(0.25),
                "subtasks": [],
            },
            {
                "name": "Check progress at the halfway mark",
                "description": "Adjust the plan if you're ahead or behind.",
                "day": at(0.5),
                "subtasks": [],
            },
            {
                "name": "Final preparations",
                "description": "Handle everything that has to be done before the finish line.",
                "day": at(0.85),
                "subtasks": [],
            },
            {
                "name": f"Finish: {label}"[:NAME_MAX_LENGTH],
                "description": "Complete the goal, then take a moment to mark it done.",
                "day": horizon,
                "subtasks": [],
            },
        ]
        return {
            "summary": (
                "A starter outline: define success, research, decide, begin, then check in "
                "along the way. Edit it to fit — it's a template, not a tailored plan."
            ),
            "tasks": tasks,
        }


def get_planner():
    path = getattr(settings, "GOAL_PLANNER", "tasks.planner.TemplatePlanner")
    return import_string(path)()
