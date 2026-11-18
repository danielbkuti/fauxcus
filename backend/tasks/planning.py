"""
Goal plans: the deterministic half of "turn a goal into tasks".

Nothing in here talks to an LLM. A *plan draft* is plain JSON in the
shape of PLAN_JSON_SCHEMA — whatever eventually produces it (a model, a
canned demo plan, a test fixture) — and this module does everything
after that, so the unpredictable part stays small and the rest is
ordinary, testable code:

    validate_plan(raw)        raw JSON  -> PlannedTask objects (or PlanError)
    schedule_plan(...)        relative days -> real dates (clamped to the
                              goal's target date, spread across days),
                              plus human-readable warnings for the draft UI
    create_plan_tasks(...)    persist a schedule as Tasks/SubTasks linked
                              to the goal, atomically

Why relative days: models are unreliable at calendar arithmetic ("what
date is 45 days from now?") but fine at sequencing ("do this on day 3").
The draft therefore carries `day` offsets from the plan's start, and the
dates are computed here, where "today", the target date, timezones and
the per-day load limit are all known facts rather than guesses.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction

from .models import SubTask, Task

# Matches Task.name / SubTask.name max_length.
NAME_MAX_LENGTH = 100

# Guardrails on what a draft may contain. Generous for a real plan, tight
# enough that a runaway response can't flood someone's task list.
MAX_TASKS = 40
MAX_SUBTASKS_PER_TASK = 12
MAX_DAY_OFFSET = 3650  # ten years

# No more than this many generated tasks land on a single day; the rest
# slide to the next days with room. A plan that dumps nine things on
# Tuesday isn't a plan anyone follows.
MAX_TASKS_PER_DAY = 3

# Generated tasks are due at this hour, local time. Not midnight (the
# frontend's date-only convention): a task "due today" at 00:00 would be
# overdue the moment it appears.
DEFAULT_DUE_HOUR = 18


# JSON Schema for the plan draft — what a model is asked to produce (e.g.
# through the API's structured-outputs support). Deliberately free of
# numeric/length constraints, which some structured-output implementations
# reject; validate_plan below enforces every limit regardless, so the
# schema describes the shape and the code is the source of truth.
PLAN_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "day": {"type": "integer"},
                    "subtasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "day": {"type": "integer"},
                            },
                            "required": ["name", "day"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["name", "description", "day", "subtasks"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "tasks"],
    "additionalProperties": False,
}


class PlanError(ValueError):
    """The draft isn't usable. The message is safe to show or log; callers
    that retry a model call can feed it back as the reason."""


@dataclass
class PlannedSubtask:
    name: str
    day: int


@dataclass
class PlannedTask:
    name: str
    description: str
    day: int
    subtasks: list = field(default_factory=list)


@dataclass
class ScheduledSubtask:
    name: str
    date: date


@dataclass
class ScheduledTask:
    name: str
    description: str
    date: date
    subtasks: list = field(default_factory=list)


@dataclass
class Schedule:
    summary: str
    tasks: list
    warnings: list


# ------------------------------------------------------------ validation


def _clean_name(value, what):
    if not isinstance(value, str):
        raise PlanError(f"{what} must be text.")
    name = " ".join(value.split())  # collapse stray whitespace/newlines
    if len(name) > NAME_MAX_LENGTH:
        name = name[: NAME_MAX_LENGTH - 1].rstrip() + "…"
    return name


def _clean_day(value, what):
    # bool is an int subclass; `true` is not a day.
    if isinstance(value, bool) or not isinstance(value, int):
        raise PlanError(f"{what} must be a whole number of days.")
    if value < 0 or value > MAX_DAY_OFFSET:
        raise PlanError(f"{what} must be between 0 and {MAX_DAY_OFFSET}.")
    return value


def validate_plan(raw):
    """
    Returns (summary, [PlannedTask]) from a raw draft, or raises PlanError.

    Structural problems (wrong types, no tasks, over the size limits, a
    task with no name, a bad day) reject the whole draft — a retry is
    cheaper than guessing what was meant. Cosmetic ones are repaired:
    names are trimmed and cut to fit, nameless subtasks are dropped, and
    names that repeat within the draft get a "(2)", "(3)" suffix (tasks
    must be unique per user).
    """
    if not isinstance(raw, dict):
        raise PlanError("The plan must be an object.")
    raw_tasks = raw.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise PlanError("The plan has no tasks.")
    if len(raw_tasks) > MAX_TASKS:
        raise PlanError(f"The plan has too many tasks (max {MAX_TASKS}).")

    summary = raw.get("summary", "")
    summary = " ".join(summary.split()) if isinstance(summary, str) else ""

    tasks = []
    for i, item in enumerate(raw_tasks, start=1):
        label = f"Task {i}"
        if not isinstance(item, dict):
            raise PlanError(f"{label} must be an object.")
        name = _clean_name(item.get("name"), f"{label}'s name")
        if not name:
            raise PlanError(f"{label} has no name.")
        day = _clean_day(item.get("day"), f"{label}'s day")
        description = item.get("description", "")
        description = description.strip() if isinstance(description, str) else ""

        raw_subtasks = item.get("subtasks", [])
        if not isinstance(raw_subtasks, list):
            raise PlanError(f"{label}'s subtasks must be a list.")
        if len(raw_subtasks) > MAX_SUBTASKS_PER_TASK:
            raise PlanError(f"{label} has too many subtasks (max {MAX_SUBTASKS_PER_TASK}).")
        subtasks = []
        for j, sub in enumerate(raw_subtasks, start=1):
            if not isinstance(sub, dict):
                raise PlanError(f"{label}, subtask {j} must be an object.")
            sub_name = _clean_name(sub.get("name"), f"{label}, subtask {j}'s name")
            if not sub_name:
                continue
            sub_day = _clean_day(sub.get("day", day), f"{label}, subtask {j}'s day")
            subtasks.append(PlannedSubtask(name=sub_name, day=sub_day))

        tasks.append(PlannedTask(name=name, description=description, day=day, subtasks=subtasks))

    _dedupe_names(tasks)
    return summary, tasks


def _dedupe_names(tasks, taken=()):
    """Makes every task name unique (case-insensitively) among the draft
    and `taken`, by appending " (2)", " (3)"… and trimming the base so the
    result still fits NAME_MAX_LENGTH."""
    used = {n.casefold() for n in taken}
    for task in tasks:
        candidate, n = task.name, 1
        while candidate.casefold() in used:
            n += 1
            suffix = f" ({n})"
            candidate = task.name[: NAME_MAX_LENGTH - len(suffix)].rstrip() + suffix
        task.name = candidate
        used.add(candidate.casefold())


# ------------------------------------------------------------ scheduling


def schedule_plan(summary, tasks, start, target_date=None, max_per_day=MAX_TASKS_PER_DAY):
    """
    Turns relative days into dates.

    `start` is day 0 — the user's own "today", which only the caller
    (i.e. the client) knows; the server is in UTC. If `target_date` is
    given nothing is scheduled after it. Tasks keep their order; a task
    whose day is full (max_per_day) moves to the next day with room. If
    the whole window up to the target is full, the leftovers are placed
    on the target date anyway rather than dropped, and a warning says so
    — the draft UI shows warnings, so the user can lengthen the timeline
    or trim the plan before accepting.

    A subtask is never due after its task.
    """
    warnings = []
    if target_date is not None and target_date < start:
        raise PlanError("The target date is before the plan's start.")

    last_day = (target_date - start).days if target_date is not None else None

    load = {}  # day offset -> tasks already placed there
    placed = []  # (planned, final_day)
    clamped = moved = overflowed = 0
    # Stable by planned day, then draft order, so equal days keep the
    # model's sequence.
    for planned in sorted(tasks, key=lambda t: t.day):
        desired = planned.day
        if last_day is not None and desired > last_day:
            desired = last_day
            clamped += 1
        day = desired
        while load.get(day, 0) >= max_per_day:
            day += 1
            if last_day is not None and day > last_day:
                day = last_day
                overflowed += 1
                break
        if day != desired:
            moved += 1
        load[day] = load.get(day, 0) + 1
        placed.append((planned, day))

    scheduled = []
    for planned, day in placed:
        task_date = start + timedelta(days=day)
        subs = []
        for sub in planned.subtasks:
            sub_day = min(sub.day, day)  # never after its own task
            subs.append(ScheduledSubtask(name=sub.name, date=start + timedelta(days=sub_day)))
        subs.sort(key=lambda s: s.date)
        scheduled.append(
            ScheduledTask(
                name=planned.name,
                description=planned.description,
                date=task_date,
                subtasks=subs,
            )
        )
    scheduled.sort(key=lambda t: t.date)

    if clamped:
        warnings.append(
            f"{clamped} step{'s' if clamped != 1 else ''} didn't fit before the target date "
            "and were moved earlier."
        )
    if overflowed:
        warnings.append(
            f"{overflowed} step{'s' if overflowed != 1 else ''} had no free day before the "
            "target date, so the final days are crowded. Consider a longer timeline."
        )
    elif moved:
        warnings.append(
            f"{moved} step{'s' if moved != 1 else ''} moved to a later day so no day has "
            f"more than {max_per_day}."
        )
    return Schedule(summary=summary, tasks=scheduled, warnings=warnings)


# ------------------------------------------------------ JSON round trip


def schedule_to_dict(schedule):
    """A Schedule as plain JSON (dates as 'YYYY-MM-DD') — the draft the
    client shows, lets the user edit, and sends back to be accepted."""
    return {
        "summary": schedule.summary,
        "warnings": list(schedule.warnings),
        "tasks": [
            {
                "name": t.name,
                "description": t.description,
                "date": t.date.isoformat(),
                "subtasks": [{"name": s.name, "date": s.date.isoformat()} for s in t.subtasks],
            }
            for t in schedule.tasks
        ],
    }


def _clean_date(value, what, earliest, latest):
    if not isinstance(value, str):
        raise PlanError(f"{what} must be a date.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise PlanError(f"{what} must be a date like 2026-03-01.") from None
    if parsed < earliest:
        raise PlanError(f"{what} can't be before {earliest.isoformat()}.")
    if latest is not None and parsed > latest:
        raise PlanError(f"{what} can't be after the goal's target date ({latest.isoformat()}).")
    return parsed


def schedule_from_payload(payload, earliest, latest=None):
    """
    The inverse of schedule_to_dict, for a draft coming *back* from the
    client (possibly edited — steps removed, names reworded). Nothing in
    it is trusted: every limit validate_plan enforces is enforced again,
    and every date must fall in [earliest, latest] — `earliest` being the
    user's today, `latest` the goal's target date if it has one. Unlike
    validate_plan this does not reschedule anything: the user has already
    seen and approved these exact dates.
    """
    if not isinstance(payload, dict):
        raise PlanError("The plan must be an object.")
    raw_tasks = payload.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise PlanError("There are no tasks to create.")
    if len(raw_tasks) > MAX_TASKS:
        raise PlanError(f"The plan has too many tasks (max {MAX_TASKS}).")

    tasks = []
    for i, item in enumerate(raw_tasks, start=1):
        label = f"Task {i}"
        if not isinstance(item, dict):
            raise PlanError(f"{label} must be an object.")
        name = _clean_name(item.get("name"), f"{label}'s name")
        if not name:
            raise PlanError(f"{label} has no name.")
        task_date = _clean_date(item.get("date"), f"{label}'s date", earliest, latest)
        description = item.get("description", "")
        description = description.strip() if isinstance(description, str) else ""

        raw_subtasks = item.get("subtasks", [])
        if not isinstance(raw_subtasks, list):
            raise PlanError(f"{label}'s subtasks must be a list.")
        if len(raw_subtasks) > MAX_SUBTASKS_PER_TASK:
            raise PlanError(f"{label} has too many subtasks (max {MAX_SUBTASKS_PER_TASK}).")
        subtasks = []
        for j, sub in enumerate(raw_subtasks, start=1):
            if not isinstance(sub, dict):
                raise PlanError(f"{label}, subtask {j} must be an object.")
            sub_name = _clean_name(sub.get("name"), f"{label}, subtask {j}'s name")
            if not sub_name:
                continue
            sub_date = _clean_date(sub.get("date"), f"{label}, subtask {j}'s date", earliest, latest)
            if sub_date > task_date:
                raise PlanError(f"{label}, subtask {j} can't be due after the task itself.")
            subtasks.append(ScheduledSubtask(name=sub_name, date=sub_date))
        tasks.append(ScheduledTask(name=name, description=description, date=task_date, subtasks=subtasks))

    return Schedule(summary="", tasks=tasks, warnings=[])


# ----------------------------------------------------------- persistence


def resolve_timezone(name):
    """An IANA zone name from the client ("Europe/London") -> tzinfo.
    Anything missing or unrecognised falls back to UTC rather than
    failing the whole request over a cosmetic detail."""
    if not name:
        return dt_timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return dt_timezone.utc


def _deadline(day, tz):
    return datetime.combine(day, time(DEFAULT_DUE_HOUR, 0), tzinfo=tz)


@transaction.atomic
def create_plan_tasks(user, goal, schedule, tz=dt_timezone.utc):
    """
    Persists a Schedule as ordinary Tasks (and SubTasks) belonging to
    `goal`, all-or-nothing. Saved one at a time through .save(), not
    bulk_create, so each gets its usual "Task created" activity entry and
    behaves exactly like a task the user added by hand. Names that
    collide with the user's existing tasks get a numeric suffix (task
    names are unique per user). Returns the created tasks.
    """
    if goal.user_id != user.id:
        raise PlanError("That goal doesn't belong to this user.")

    taken = Task.objects.filter(user=user).values_list("name", flat=True)
    planned = [ScheduledTask(t.name, t.description, t.date, t.subtasks) for t in schedule.tasks]
    _dedupe_names(planned, taken=list(taken))

    created = []
    for item in planned:
        task = Task.objects.create(
            user=user,
            goal=goal,
            name=item.name,
            description=item.description or None,
            dateDeadline=_deadline(item.date, tz),
        )
        for sub in item.subtasks:
            SubTask.objects.create(task=task, name=sub.name, dateDeadline=_deadline(sub.date, tz))
        created.append(task)
    return created
