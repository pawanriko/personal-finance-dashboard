"""URL configuration for the Personal Finance Dashboard backend."""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path
from django.views.generic import TemplateView


def api_not_found(request, *args, **kwargs):
    """JSON 404 for unknown /api/ paths.

    Without this, an unmatched /api/... URL falls through Django's
    resolver to the SPA catch-all below and comes back as HTML 200.
    """
    return JsonResponse({"detail": "Not found."}, status=404)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    # django-allauth Google/GitHub OAuth endpoints.
    path("accounts/", include("allauth.urls")),
    # Unknown API paths are a real 404, not the SPA.
    re_path(r"^api/.*$", api_not_found),
    # Catch-all LAST: serve the built React SPA (frontend/dist/index.html)
    # for every non-API, non-admin path, so React Router works on refresh
    # and deep links. Static assets under /assets/ are served by
    # WhiteNoise before URL resolution, so they never reach this route.
    re_path(r"^.*$", TemplateView.as_view(template_name="index.html")),
]
