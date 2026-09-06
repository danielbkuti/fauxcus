import functools
from pathlib import Path

from django.conf import settings
from django.shortcuts import render
from django.http import HttpResponse


# The built frontend's index.html — read once and cached rather than
# on every request, since it never changes within a running
# container's lifetime (a new deploy is a new container, not a
# mutation of this one). Lives outside WHITENOISE_ROOT's own reach:
# WhiteNoise serves *files that exist* (the JS/CSS index.html itself
# references), but every React Router path (e.g. /tasks/5) doesn't
# exist as a file, so it falls through to normal Django URL
# resolution — this view is what catches that fallthrough. See
# urls.py's catch-all route, which is what actually wires this in.
@functools.lru_cache(maxsize=1)
def _frontend_index_html():
    path = Path(settings.WHITENOISE_ROOT) / "index.html"
    return path.read_text(encoding="utf-8")


def spa_view(request, *args, **kwargs):
    """Serves the built React app for '/' and every client-side route
    (React Router takes over in the browser from there) — this is what
    a hard refresh on e.g. /tasks/5 needs to not 404, now that the
    frontend is served from this same Django process instead of a
    separate static site (see Dockerfile.render, WHITENOISE_ROOT).
    Never reached in local dev — nothing here at '/' is meant to be
    browsed directly there either; the Vite dev server on :3000 is the
    real frontend locally, and frontend/dist doesn't exist to read."""
    try:
        html = _frontend_index_html()
    except FileNotFoundError:
        return HttpResponse(
            "Frontend build not found at WHITENOISE_ROOT — this route only works when "
            "Dockerfile.render's frontend-build stage actually ran (i.e. on Render, not "
            "plain local docker-compose, which serves the frontend from Vite on :3000 instead).",
            status=500,
        )
    return HttpResponse(html, content_type="text/html")


def contact_view(request, *args, **kwargs):
    return render(request, "contact.html", {})
