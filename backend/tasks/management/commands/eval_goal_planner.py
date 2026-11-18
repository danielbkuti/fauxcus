"""
Compares models as goal planners on a fixed set of sample goals, so the
choice of model (and what it costs) rests on real output instead of a
guess.

    python manage.py eval_goal_planner --yes
    python manage.py eval_goal_planner --yes --models claude-haiku-5-5 --goals 3
    python manage.py eval_goal_planner --yes --out /tmp/planner-eval.md

THIS SPENDS REAL MONEY (a few cents per goal on Sonnet, a fraction of a
cent on Haiku), so it refuses to run without --yes, stops the moment its
running total passes --budget, and prints what it spent. It needs
ANTHROPIC_API_KEY in the environment or the project's .env. Nothing is
written to the database: goals here are in-memory stand-ins.

For every model x goal it makes the two calls a user would trigger — the
clarifying questions, then the plan draft (using the canned answers
below, standing in for a user) — and pushes the draft through the same
validate_plan / schedule_plan the API uses. The report has two parts:
a mechanical summary (did it produce a usable plan, how many tasks, how
many warnings, tokens, cost, seconds) and the full plans written out, so
a person can judge the part a script can't: are these good steps?
"""

import time
from datetime import timedelta
from types import SimpleNamespace

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from tasks.planner import AnthropicPlanner, NEAR_TERM_DAYS
from tasks.planning import PlanError, schedule_plan, validate_plan

# USD per million tokens (input, output) — as of this command's writing;
# check the current pricing page before trusting the dollar figures. A
# model missing from here is still run, just reported in tokens only.
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}
DEFAULT_MODELS = "claude-haiku-5-5,claude-sonnet-5-5"

# (name, details, days until target or None, canned answers). Chosen to
# cover what real goals look like: concrete purchases, skills with a soft
# finish line, big physical goals, a goal with no deadline, a vague one, a
# deadline that is too short to be realistic, and a small quick one.
SAMPLE_GOALS = [
    ("Buy a used car", "Reliable, under $9,000, for commuting. I don't have a car now.", 60,
     ["I can spend up to $9,000 in cash and I'll need insurance on top.", "I have saved $5,500 so far."]),
    ("Learn Spanish", "I want to be conversational for a trip to Mexico.", 180,
     ["I can hold a 10-minute conversation with a friend.", "I know about 100 words from school.",
      "About 4 hours a week."]),
    ("Run a half marathon", "", 120,
     ["Finish without walking, under 2:15.", "I run 5km twice a week at the moment.", "Evenings, 4 days a week."]),
    ("Pay off my credit card", "$4,200 balance at 24% APR.", 270,
     ["I can put $500 a month toward it.", "No other debt. Steady income."]),
    ("Read twelve books", "", None,
     ["Mostly novels, a couple of non-fiction.", "30 minutes on weekday evenings."]),
    ("Get my life together", "Everything feels messy.", 60,
     ["Work, money and my apartment mainly.", "I get overwhelmed and avoid it."]),
    ("Play a piano concert", "I want to perform a full recital.", 14,
     ["I have never played piano.", "An hour a day."]),
    ("Change careers into data analysis", "I'm an accountant with 6 years of experience.", 240,
     ["Land a junior analyst job.", "I know Excel well and a little SQL.", "8 hours a week alongside my job."]),
    ("Declutter the garage", "Floor to ceiling boxes, can't park the car in it.", 30,
     ["I can do two weekends and a few evenings.", "Some things to donate, some to sell, a lot to bin."]),
    ("Write a first draft of a novel", "Fantasy, about 80,000 words.", 150,
     ["I have an outline for the first act only.", "Mornings before work, 5 days a week."]),
]


def cost_of(model, usage):
    prices = PRICES.get(model)
    if not prices:
        return None
    return (usage["input_tokens"] * prices[0] + usage["output_tokens"] * prices[1]) / 1_000_000


class Command(BaseCommand):
    help = "Compare models as goal planners on sample goals. Spends real API money; needs --yes."

    def add_arguments(self, parser):
        parser.add_argument("--models", default=DEFAULT_MODELS, help="Comma-separated model IDs.")
        parser.add_argument("--goals", type=int, default=len(SAMPLE_GOALS), help="How many sample goals to use.")
        parser.add_argument("--budget", type=float, default=2.0, help="Stop once spend passes this many USD.")
        parser.add_argument("--out", default="goal-planner-eval.md", help="Where to write the report.")
        parser.add_argument("--yes", action="store_true", help="Confirm that this spends real money.")

    def handle(self, *args, **options):
        models = [m.strip() for m in options["models"].split(",") if m.strip()]
        goals = SAMPLE_GOALS[: max(options["goals"], 0)]
        if not models or not goals:
            raise CommandError("Nothing to run.")
        if not options["yes"]:
            raise CommandError(
                f"This makes {2 * len(models) * len(goals)} real API calls "
                f"({len(models)} model(s) x {len(goals)} goals x questions + plan) and costs "
                f"money; the budget cap is ${options['budget']:.2f}. Re-run with --yes to go ahead."
            )
        import os

        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise CommandError(
                "ANTHROPIC_API_KEY isn't set. Put it in the environment or the project's .env "
                "(never in the code or a commit)."
            )

        today = timezone.now().date()
        spent = 0.0
        results = []  # one dict per model x goal
        stopped = False
        for model in models:
            for name, details, days, answers in goals:
                if spent >= options["budget"]:
                    stopped = True
                    break
                results.append(self.run_one(model, name, details, days, answers, today))
                spent += results[-1]["cost"] or 0.0
                self.stdout.write(
                    f"{model:20} {name[:34]:34} "
                    f"{'ok' if results[-1]['ok'] else 'FAILED':6} ${results[-1]['cost'] or 0:.4f}"
                )
            if stopped:
                break

        report = self.render(models, results, spent, stopped, options["budget"])
        with open(options["out"], "w", encoding="utf-8") as fh:
            fh.write(report)
        self.stdout.write(self.style.SUCCESS(f"\nSpent about ${spent:.3f}. Report: {options['out']}"))
        if stopped:
            self.stdout.write(self.style.WARNING("Stopped early: the budget cap was reached."))

    # ------------------------------------------------------------------

    def run_one(self, model, name, details, days, answers, today):
        planner = AnthropicPlanner(model=model)
        goal = SimpleNamespace(name=name, description=details)
        target = today + timedelta(days=days) if days else None
        row = {"model": model, "goal": name, "days": days, "ok": False, "error": None,
               "questions": [], "schedule": None, "seconds": 0.0, "cost": None}
        started = time.monotonic()
        try:
            row["questions"] = planner.questions(goal, days)
            # Canned answers pair with the questions this model asked, in
            # order, so the draft sees realistic answered questions.
            paired = [
                {"question": q, "answer": a} for q, a in zip(row["questions"], answers, strict=False)
            ]
            raw = planner.draft(goal, paired, days)
            summary, tasks = validate_plan(raw)
            row["schedule"] = schedule_plan(summary, tasks, today, target)
            row["ok"] = True
        except PlanError as exc:
            row["error"] = str(exc)
        except Exception as exc:  # noqa: BLE001 — an eval should report, not crash
            row["error"] = f"{type(exc).__name__}: {exc}"
        row["seconds"] = time.monotonic() - started
        row["usage"] = dict(planner.usage)
        row["cost"] = cost_of(model, planner.usage)
        return row

    # ------------------------------------------------------------------

    def render(self, models, results, spent, stopped, budget):
        out = ["# Goal planner evaluation", ""]
        out.append(f"Spent about **${spent:.3f}** (budget ${budget:.2f}). "
                   "Dollar figures use the PRICES table in the command — verify it against current pricing.")
        if stopped:
            out.append("\n**Stopped early: the budget cap was reached, so not every goal was run for every model.**")
        out += ["", "## Summary", "",
                "| Model | Goals | Usable plans | Avg tasks | Avg subtasks | Avg warnings | Avg seconds | Avg cost / goal | Total cost |",
                "|---|---|---|---|---|---|---|---|---|"]
        for model in models:
            rows = [r for r in results if r["model"] == model]
            if not rows:
                continue
            ok = [r for r in rows if r["ok"]]
            avg = lambda f: (sum(f(r) for r in ok) / len(ok)) if ok else 0  # noqa: E731
            costs = [r["cost"] for r in rows if r["cost"] is not None]
            out.append(
                f"| {model} | {len(rows)} | {len(ok)}/{len(rows)} "
                f"| {avg(lambda r: len(r['schedule'].tasks)):.1f} "
                f"| {avg(lambda r: sum(len(t.subtasks) for t in r['schedule'].tasks)):.1f} "
                f"| {avg(lambda r: len(r['schedule'].warnings)):.1f} "
                f"| {sum(r['seconds'] for r in rows) / len(rows):.0f} "
                f"| {('$%.4f' % (sum(costs) / len(costs))) if costs else 'n/a'} "
                f"| {('$%.3f' % sum(costs)) if costs else 'n/a'} |"
            )

        out += ["", "## Plans, for reading", "",
                "Judge these by eye: are the steps concrete and in a sensible order? Is the near term "
                f"(first {NEAR_TERM_DAYS} days) detailed and the rest coarse? Does a hopeless timeline get "
                "said out loud? Are the questions ones that would actually change the plan?"]
        goal_names = list(dict.fromkeys(r["goal"] for r in results))
        for goal in goal_names:
            rows = [r for r in results if r["goal"] == goal]
            days = rows[0]["days"]
            out += ["", f"### {goal} — {'target in %d days' % days if days else 'no target date'}"]
            for r in rows:
                out += ["", f"#### {r['model']}"]
                u = r.get("usage", {})
                cost = f"${r['cost']:.4f}" if r["cost"] is not None else "n/a"
                out.append(f"_{u.get('input_tokens', 0)} in / {u.get('output_tokens', 0)} out tokens, "
                           f"{cost}, {r['seconds']:.0f}s_")
                if r["questions"]:
                    out += ["", "Questions asked:"] + [f"- {q}" for q in r["questions"]]
                if not r["ok"]:
                    out += ["", f"**No usable plan:** {r['error']}"]
                    continue
                sched = r["schedule"]
                out += ["", f"Summary: {sched.summary}"]
                for w in sched.warnings:
                    out.append(f"- ⚠ {w}")
                out.append("")
                for t in sched.tasks:
                    out.append(f"- **{t.date.isoformat()}** {t.name}" + (f" — {t.description}" if t.description else ""))
                    for s in t.subtasks:
                        out.append(f"    - {s.date.isoformat()} {s.name}")
        return "\n".join(out) + "\n"
