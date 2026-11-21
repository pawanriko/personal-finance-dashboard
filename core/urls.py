"""API URL routing for the Personal Finance Dashboard."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("accounts", views.AccountViewSet, basename="account")
router.register("categories", views.CategoryViewSet, basename="category")
router.register("transactions", views.TransactionViewSet, basename="transaction")
router.register("transfers", views.TransferViewSet, basename="transfer")
router.register(
    "recurring", views.RecurringTransactionViewSet, basename="recurring"
)
router.register("budgets", views.BudgetViewSet, basename="budget")
router.register("goals", views.GoalViewSet, basename="goal")
router.register(
    "goal-contributions",
    views.GoalContributionViewSet,
    basename="goal-contribution",
)
router.register("csv-imports", views.CsvImportViewSet, basename="csv-import")

urlpatterns = [
    path("", include(router.urls)),
    path("dashboard/", views.DashboardView.as_view(), name="dashboard"),
    path("reports/", views.ReportsView.as_view(), name="reports"),
    path("reports/export/", views.ReportExportView.as_view(), name="report-export"),
    path("auth/csrf/", views.csrf_view, name="auth-csrf"),
    path("auth/register/", views.register_view, name="auth-register"),
    path("auth/login/", views.login_view, name="auth-login"),
    path("auth/insforge/", views.insforge_login_view, name="auth-insforge"),
    path("auth/logout/", views.logout_view, name="auth-logout"),
    path("auth/me/", views.me_view, name="auth-me"),
    path("profile/", views.ProfileView.as_view(), name="profile"),
]
