"""API views. Every queryset is scoped to ``request.user`` — a user can
only ever see or change their own data (per-user isolation is also
covered by tests). Auth is Django session auth + CSRF.
"""

import csv
from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db.models import DecimalField, Q, Sum
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .insforge_auth import (
    InsforgeAuthError,
    InsforgeEmailCollision,
    resolve_user,
    verify_token,
)
from .models import (
    ZERO,
    Account,
    Budget,
    Category,
    CsvImport,
    Goal,
    GoalContribution,
    RecurringTransaction,
    Transaction,
    Transfer,
)
from .serializers import (
    AccountSerializer,
    BudgetSerializer,
    CategorySerializer,
    CsvImportSerializer,
    GoalContributionSerializer,
    GoalSerializer,
    LoginSerializer,
    ProfileSerializer,
    RecurringTransactionSerializer,
    RegisterSerializer,
    TransactionSerializer,
    TransferSerializer,
    UserSerializer,
)
from .signals import seed_default_categories

User = get_user_model()


class OwnerViewSet(viewsets.ModelViewSet):
    """Base viewset: querysets scoped to the owner, user set on create."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


# ---------------------------------------------------------------------------
# Core resources
# ---------------------------------------------------------------------------

class AccountViewSet(OwnerViewSet):
    queryset = Account.objects.all()
    serializer_class = AccountSerializer

    def get_queryset(self):
        # Annotate the ledger sums so the serializer can compute the
        # balance without an extra query per account.
        return (
            super()
            .get_queryset()
            .annotate(
                _income=Coalesce(
                    Sum(
                        "transactions__amount",
                        filter=Q(transactions__type="income"),
                    ),
                    ZERO,
                    output_field=DecimalField(max_digits=12, decimal_places=2),
                ),
                _expense=Coalesce(
                    Sum(
                        "transactions__amount",
                        filter=Q(transactions__type="expense"),
                    ),
                    ZERO,
                    output_field=DecimalField(max_digits=12, decimal_places=2),
                ),
            )
        )

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """Transaction history for one account, including transfer legs."""
        account = self.get_object()
        qs = (
            Transaction.objects.filter(user=request.user, account=account)
            .select_related("category")
            .order_by("-date", "-created_at")
        )
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        if start:
            qs = qs.filter(date__gte=start)
        if end:
            qs = qs.filter(date__lte=end)
        page = self.paginate_queryset(qs)
        serializer = TransactionSerializer(
            page if page is not None else qs,
            many=True,
            context={"request": request},
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)


class CategoryViewSet(OwnerViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer

    def get_queryset(self):
        qs = super().get_queryset()
        kind = self.request.query_params.get("type")
        if kind:
            qs = qs.filter(type=kind)
        parent = self.request.query_params.get("parent")
        if parent == "null":
            qs = qs.filter(parent__isnull=True)
        elif parent:
            qs = qs.filter(parent_id=parent)
        return qs.prefetch_related("children")

    @action(detail=False, methods=["post"], url_path="seed-defaults")
    def seed_defaults(self, request):
        """(Re)create the default categories for this user (idempotent)."""
        count = seed_default_categories(request.user)
        return Response({"default_categories": count})


class TransactionViewSet(OwnerViewSet):
    queryset = Transaction.objects.all()
    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("account", "category")
        params = self.request.query_params
        if params.get("include_transfers", "").lower() != "true":
            qs = qs.filter(is_transfer=False)
        if params.get("account"):
            qs = qs.filter(account_id=params["account"])
        if params.get("category"):
            qs = qs.filter(category_id=params["category"])
        if params.get("type"):
            qs = qs.filter(type=params["type"])
        if params.get("start"):
            qs = qs.filter(date__gte=params["start"])
        if params.get("end"):
            qs = qs.filter(date__lte=params["end"])
        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(merchant__icontains=search) | Q(notes__icontains=search)
            )
        return qs

    @action(detail=False, methods=["get"])
    def export(self, request):
        """Download the filtered transactions as CSV."""
        qs = self.get_queryset()
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            'attachment; filename="transactions.csv"'
        )
        writer = csv.writer(response)
        writer.writerow(
            ["date", "type", "amount", "account", "category", "merchant", "notes"]
        )
        for tx in qs.iterator():
            writer.writerow(
                [
                    tx.date.isoformat(),
                    tx.type,
                    services.money_str(tx.amount),
                    tx.account.name,
                    tx.category.name if tx.category else "",
                    tx.merchant,
                    tx.notes,
                ]
            )
        return response


class TransferViewSet(OwnerViewSet):
    queryset = Transfer.objects.all()
    serializer_class = TransferSerializer

    def get_queryset(self):
        return super().get_queryset().select_related(
            "source_account", "destination_account"
        )


class RecurringTransactionViewSet(OwnerViewSet):
    queryset = RecurringTransaction.objects.all()
    serializer_class = RecurringTransactionSerializer

    @action(detail=True, methods=["post"], url_path="generate-due")
    def generate_due(self, request, pk=None):
        """Create transactions for every due occurrence up to ``up_to``
        (default: today) and advance ``next_due``."""
        recurring = self.get_object()
        up_to = request.data.get("up_to")
        if up_to:
            up_to = date.fromisoformat(up_to)
        created = recurring.generate_due(up_to)
        serializer = TransactionSerializer(
            created, many=True, context={"request": request}
        )
        return Response(
            {"created": len(created), "transactions": serializer.data},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="generate-all-due")
    def generate_all_due(self, request):
        """Generate due instances for all active templates of this user."""
        up_to = request.data.get("up_to")
        if up_to:
            up_to = date.fromisoformat(up_to)
        total = 0
        for recurring in self.get_queryset().filter(is_active=True):
            total += len(recurring.generate_due(up_to))
        return Response({"created": total}, status=status.HTTP_201_CREATED)


class BudgetViewSet(OwnerViewSet):
    queryset = Budget.objects.all()
    serializer_class = BudgetSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("category")
        month = self.request.query_params.get("month")
        if month:
            qs = qs.filter(month=month)
        return qs


class GoalViewSet(OwnerViewSet):
    queryset = Goal.objects.all()
    serializer_class = GoalSerializer


class GoalContributionViewSet(OwnerViewSet):
    queryset = GoalContribution.objects.all()
    serializer_class = GoalContributionSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("goal")
        goal = self.request.query_params.get("goal")
        if goal:
            qs = qs.filter(goal_id=goal)
        return qs


# ---------------------------------------------------------------------------
# CSV import
# ---------------------------------------------------------------------------

class CsvImportViewSet(viewsets.ModelViewSet):
    queryset = CsvImport.objects.all()
    serializer_class = CsvImportSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "delete"]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user).select_related(
            "account"
        )

    def create(self, request, *args, **kwargs):
        """Upload a CSV -> parse it -> return the preview (rows with
        per-row errors and duplicate flags). Nothing is imported yet."""
        upload = request.FILES.get("file")
        if not upload:
            return Response(
                {"file": ["A CSV file is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not upload.name.lower().endswith(".csv"):
            return Response(
                {"file": ["Only .csv files are accepted."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if upload.size > settings.CSV_UPLOAD_MAX_BYTES:
            return Response(
                {"file": ["File is too large (max 5 MB)."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account = get_object_or_404(
            Account, pk=request.data.get("account"), user=request.user
        )
        try:
            text = upload.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return Response(
                {"file": ["File must be UTF-8 encoded CSV."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        mapping = None
        raw_mapping = request.data.get("mapping")
        if raw_mapping:
            import json

            try:
                mapping = json.loads(raw_mapping)
            except (ValueError, TypeError):
                return Response(
                    {"mapping": ["Mapping must be a JSON object."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        rows, mapping, header_errors = services.parse_csv_text(
            text, request.user, account, mapping
        )
        if header_errors:
            return Response(
                {"file": header_errors}, status=status.HTTP_400_BAD_REQUEST
            )
        import_session = CsvImport.objects.create(
            user=request.user,
            file=upload,
            account=account,
            mapping=mapping,
            rows=rows,
        )
        serializer = self.get_serializer(import_session)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """Import the selected valid rows from a previewed session."""
        import_session = self.get_object()
        if import_session.status != CsvImport.Status.PREVIEW:
            return Response(
                {"detail": "This import has already been processed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        selected = request.data.get("selected")
        if selected is not None:
            selected = [int(r) for r in selected]
        created, skipped = services.import_rows(
            request.user, import_session.account, import_session.rows, selected
        )
        import_session.status = CsvImport.Status.IMPORTED
        import_session.created_count = len(created)
        import_session.skipped_count = skipped
        import_session.save(
            update_fields=["status", "created_count", "skipped_count", "updated_at"]
        )
        return Response(
            {
                "created": len(created),
                "skipped": skipped,
                "transaction_ids": [tx.id for tx in created],
            },
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# Dashboard & reports
# ---------------------------------------------------------------------------

class DashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        start = date.fromisoformat(start) if start else None
        end = date.fromisoformat(end) if end else None
        summary = services.dashboard_summary(request.user, start, end)
        summary["recent_transactions"] = TransactionSerializer(
            summary["recent_transactions"], many=True, context={"request": request}
        ).data
        return Response(summary)


class ReportsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        start = date.fromisoformat(start) if start else today.replace(day=1)
        end = date.fromisoformat(end) if end else today
        totals = services.period_totals(request.user, start, end)
        length = (end - start).days + 1
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=length - 1)
        previous = services.period_totals(request.user, prev_start, prev_end)
        return Response(
            {
                "period": {"start": start.isoformat(), "end": end.isoformat()},
                "income": totals["income"],
                "expenses": totals["expenses"],
                "net": totals["net"],
                "previous_period": {
                    "start": prev_start.isoformat(),
                    "end": prev_end.isoformat(),
                    "income": previous["income"],
                    "expenses": previous["expenses"],
                    "net": previous["net"],
                },
                "spending_by_category": services.spending_by_category(
                    request.user, start, end
                ),
                "monthly_series": services.monthly_series(
                    request.user, start, end
                ),
            }
        )


class ReportExportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        start = date.fromisoformat(start) if start else today.replace(day=1)
        end = date.fromisoformat(end) if end else today
        totals = services.period_totals(request.user, start, end)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="report.csv"'
        writer = csv.writer(response)
        writer.writerow(["metric", "amount"])
        writer.writerow(["period_start", start.isoformat()])
        writer.writerow(["period_end", end.isoformat()])
        writer.writerow(["income", totals["income"]])
        writer.writerow(["expenses", totals["expenses"]])
        writer.writerow(["net", totals["net"]])
        writer.writerow([])
        writer.writerow(["category", "spent"])
        for row in services.spending_by_category(request.user, start, end):
            writer.writerow([row["category"], row["total"]])
        return response


# ---------------------------------------------------------------------------
# Auth (session + CSRF) and profile
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([permissions.AllowAny])
@ensure_csrf_cookie
def csrf_view(request):
    return Response({"detail": "CSRF cookie set."})


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    login(request, user)
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(
        request,
        username=serializer.validated_data["username"],
        password=serializer.validated_data["password"],
    )
    if user is None:
        return Response(
            {"detail": "Invalid username or password."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    login(request, user)
    return Response(UserSerializer(user).data)


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def insforge_login_view(request):
    """Log in with an InsForge access token (Google/GitHub OAuth).

    The React app signs the user in against InsForge in the browser
    and sends the resulting access token here. The token is verified
    once (RS256 vs the project's JWKS) and the Django user is found
    or created by ``insforge_sub``; then a normal Django session
    starts, exactly as after a password login. The token itself is
    never logged and never stored.

    Dormant until configured: with INSFORGE_AUTH_ENABLED off (or no
    INSFORGE_BASE_URL) this answers 503. Email collision with an
    unlinked Django account answers 409 — the user signs in with
    their password instead; the link is never made silently.
    """
    if not getattr(
        settings, "INSFORGE_AUTH_ENABLED", False
    ) or not getattr(settings, "INSFORGE_BASE_URL", ""):
        return Response(
            {"detail": "InsForge sign-in is not enabled."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    token = request.data.get("access_token")
    if not token or not isinstance(token, str):
        return Response(
            {"detail": "access_token is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        user = resolve_user(verify_token(token))
    except InsforgeEmailCollision as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    except InsforgeAuthError:
        return Response(
            {"detail": "Invalid or expired InsForge token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    login(request, user)
    return Response(UserSerializer(user).data)


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response({"detail": "Logged out."})


@api_view(["GET"])
def me_view(request):
    return Response(UserSerializer(request.user).data)


class ProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(ProfileSerializer(request.user.profile).data)

    def patch(self, request):
        serializer = ProfileSerializer(
            request.user.profile, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
