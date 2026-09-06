"""
One-time seed for a realistic demo account on a fresh deployment
(Neon starts genuinely empty — nothing else populates it). Meant to
run via render-start.sh's SEED_DEMO_DATA=true toggle rather than by
hand: Render's free plan has no Shell to run a one-off management
command from directly.

Idempotent — no-ops if the demo user already has any tasks — so it's
safe to leave SEED_DEMO_DATA=true set indefinitely rather than
needing to flip it back off after the first successful run.

seed_demo_data.json stores every deadline/completion timestamp as an
*offset in days from "now"* (generated from the same realistic task
set this app's local dev demo account already had, captured at
generation time) rather than fixed calendar dates — re-anchored to
timezone.now() at the moment this command actually executes, so the
seeded account looks current (a spread of overdue-but-already-done
history plus upcoming due dates) whenever it's run, not just on the
day this file was written.
"""

import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from tasks.models import SubTask, Task

DEMO_EMAIL = "demo@example.com"
DEMO_USERNAME = "demo"
# Only used the first time this command creates the account — if it
# already exists (e.g. from local testing), its real password is left
# untouched.
DEMO_PASSWORD = "DemoPass123!"

# How long before a task's earliest other timestamp (its deadline or
# its completion, whichever is sooner) it was supposedly "created" —
# a task has to have existed a little while before it was finished or
# came due. Without this, dateCreated (below) has nothing to backdate
# it, and a task "completed" 20 days ago ends up with a negative
# created→completed duration, which is exactly the bug this constant
# exists to avoid.
CREATION_LEAD_DAYS = 3


class Command(BaseCommand):
    help = "Seed a one-time realistic demo account (demo@example.com). No-ops if it already has tasks."

    def handle(self, *args, **options):
        User = get_user_model()
        user, created = User.objects.get_or_create(
            email=DEMO_EMAIL,
            defaults={
                "username": DEMO_USERNAME,
                "first_name": "Demo",
                "last_name": "User",
                "is_active": True,
            },
        )
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"Created {DEMO_EMAIL} / {DEMO_PASSWORD}"))

        if Task.objects.filter(user=user).exists():
            self.stdout.write("Demo user already has tasks — nothing to do.")
            return

        data_path = Path(__file__).resolve().parent / "seed_demo_data.json"
        with open(data_path) as f:
            tasks_data = json.load(f)

        now = timezone.now()

        def resolve(offset_days):
            return None if offset_days is None else now + timezone.timedelta(days=offset_days)

        # dateCreated is `auto_now_add`, so Task.objects.create() always
        # stamps it "now" regardless of any offset — there's no JSON
        # field for it at all. That's fine for an open task with no
        # history to speak of, but a task backdated as "completed 20
        # days ago" (completed_offset=-20) still got dateCreated=now,
        # i.e. created *after* it finished. computeStats' "time to
        # complete" (dateCompleted - dateCreated) then comes out
        # negative — harmless while every stats view averaged it over
        # all 26 completed tasks at once (diluted to something merely
        # off), but glaring once the Progress redesign's period toggle
        # narrows that average to just a handful of recent completions.
        # Same `auto_now_add` workaround _sync_date_completed already
        # uses below: create() can't set it, but a follow-up
        # .save(update_fields=[...]) can, since auto_now_add only fires
        # on the original INSERT.
        def created_offset_for(deadline_offset, completed_offset):
            candidates = [o for o in (deadline_offset, completed_offset, 0) if o is not None]
            return min(candidates) - CREATION_LEAD_DAYS

        for entry in tasks_data:
            deadline_offset = entry.get("deadline_offset")
            completed_offset = entry.get("completed_offset") if entry["completed"] else None

            task = Task.objects.create(
                user=user,
                name=entry["name"],
                description=entry.get("description"),
                dateDeadline=resolve(deadline_offset),
                completed=entry["completed"],
            )
            task.dateCreated = resolve(created_offset_for(deadline_offset, completed_offset))
            update_fields = ["dateCreated"]
            # Backdate dateCompleted to its own offset rather than
            # leaving the auto-set "completed right now" from create()
            # above — a realistic demo needs a spread of completion
            # times (for the streak/completion-rate stats), not every
            # finished task stamped at the exact same seed instant.
            # _sync_date_completed only overwrites dateCompleted when
            # `completed` itself changes, which it doesn't on this
            # second save, so this value sticks.
            if completed_offset is not None:
                task.dateCompleted = resolve(completed_offset)
                update_fields.append("dateCompleted")
            task.save(update_fields=update_fields)

            for sub in entry.get("subtasks", []):
                sub_deadline_offset = sub.get("deadline_offset")
                sub_completed_offset = sub.get("completed_offset") if sub["completed"] else None

                subtask = SubTask.objects.create(
                    task=task,
                    name=sub["name"],
                    dateDeadline=resolve(sub_deadline_offset),
                    completed=sub["completed"],
                )
                subtask.dateCreated = resolve(created_offset_for(sub_deadline_offset, sub_completed_offset))
                sub_update_fields = ["dateCreated"]
                if sub_completed_offset is not None:
                    subtask.dateCompleted = resolve(sub_completed_offset)
                    sub_update_fields.append("dateCompleted")
                subtask.save(update_fields=sub_update_fields)

        self.stdout.write(self.style.SUCCESS(f"Seeded {len(tasks_data)} tasks for {DEMO_EMAIL}."))
