#!/bin/sh
# fauxcus-api's real start command on Render — kept as a script file
# rather than an inline `sh -c "... && ..."` string in render.yaml's
# dockerCommand, after that inline form exited with status 127
# ("command not found"): dockerCommand strings appear to be split into
# argv some way other than a real shell parsing them, so the embedded
# double quotes around the `-c` argument landed as literal characters
# in a token instead of being consumed as quoting syntax. A script
# file sidesteps the question entirely — dockerCommand becomes the two
# plain, space-only tokens `sh render-start.sh`, nothing for any
# naive splitter to mis-parse.
#
# `set -e` so a failed migration stops the container rather than
# limping into gunicorn against a half-migrated database.
set -e

python backend/manage.py migrate --noinput

# Opt-in, off by default — set SEED_DEMO_DATA=true on fauxcus-api to
# populate demo@example.com with a realistic task history on a fresh
# (empty) database. Same no-shell-on-free-tier reasoning as migrate
# above: it's a management command with nowhere else to run it from.
# The command itself is idempotent (no-ops once the demo user has any
# tasks), so it's fine to leave the flag set rather than remembering
# to flip it back off after the first successful run.
if [ "$SEED_DEMO_DATA" = "true" ]; then
    python backend/manage.py seed_demo_data
fi

# exec replaces this shell with gunicorn (not a child of it), so
# gunicorn receives Render's own stop signal directly instead of it
# getting eaten by an sh process sitting in between.
exec gunicorn flexmaster.wsgi:application --chdir backend --bind 0.0.0.0:$PORT
