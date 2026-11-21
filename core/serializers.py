"""Serializers. Every writable serializer runs the model's ``full_clean``
so the ownership/type rules in ``models.py`` are enforced at the API,
not just in the Django admin. Foreign-key choices are always scoped to
the requesting user.
"""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import (
    ZERO,
    Account,
    Budget,
    Category,
    CsvImport,
    Goal,
    GoalContribution,
    Profile,
    RecurringTransaction,
    Transaction,
    Transfer,
)

User = get_user_model()


class CleanModelMixin:
    """Run ``Model.full_clean()`` during serializer validation."""

    def validate(self, attrs):
        attrs = super().validate(attrs)
        model = self.Meta.model
        instance = self.instance or model()
        for key, value in attrs.items():
            setattr(instance, key, value)
        request = self.context.get("request")
        if (
            hasattr(instance, "user_id")
            and not instance.user_id
            and request
            and request.user.is_authenticated
        ):
            instance.user = request.user
        try:
            instance.full_clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict)
        return attrs


class _UserScopedMixin:
    """Restrict FK dropdowns to objects owned by the requesting user."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            user = request.user
            for name in getattr(self, "user_scoped_fields", ()):
                field = self.fields.get(name)
                if field is not None:
                    field.queryset = field.queryset.filter(user=user)


class ProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model = Profile
        fields = ["username", "email", "default_currency"]


class AccountSerializer(CleanModelMixin, _UserScopedMixin, serializers.ModelSerializer):
    balance = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id",
            "name",
            "type",
            "currency",
            "opening_balance",
            "balance",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["balance", "created_at", "updated_at"]

    def get_balance(self, obj):
        income = getattr(obj, "_income", None)
        expense = getattr(obj, "_expense", None)
        if income is not None and expense is not None:
            value = obj.opening_balance + income - expense
        else:
            value = obj.balance()
        from .services import money_str

        return money_str(value)


class CategorySerializer(CleanModelMixin, _UserScopedMixin, serializers.ModelSerializer):
    user_scoped_fields = ("parent",)
    children = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            "id",
            "name",
            "type",
            "parent",
            "children",
            "is_default",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["is_default", "created_at", "updated_at"]

    def get_children(self, obj):
        return [
            {"id": c.id, "name": c.name, "type": c.type}
            for c in obj.children.all()
        ]


class TransactionSerializer(
    CleanModelMixin, _UserScopedMixin, serializers.ModelSerializer
):
    user_scoped_fields = ("account", "category")
    account_name = serializers.CharField(source="account.name", read_only=True)
    category_name = serializers.CharField(
        source="category.name", read_only=True, default=None
    )

    class Meta:
        model = Transaction
        fields = [
            "id",
            "account",
            "account_name",
            "category",
            "category_name",
            "type",
            "amount",
            "date",
            "merchant",
            "notes",
            "is_transfer",
            "transfer",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["is_transfer", "transfer", "created_at", "updated_at"]


class TransferSerializer(
    CleanModelMixin, _UserScopedMixin, serializers.ModelSerializer
):
    user_scoped_fields = ("source_account", "destination_account")
    source_account_name = serializers.CharField(
        source="source_account.name", read_only=True
    )
    destination_account_name = serializers.CharField(
        source="destination_account.name", read_only=True
    )

    class Meta:
        model = Transfer
        fields = [
            "id",
            "source_account",
            "source_account_name",
            "destination_account",
            "destination_account_name",
            "amount",
            "date",
            "note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    # NOTE: no create() override needed — OwnerViewSet.perform_create
    # supplies the user, and the post_save signal creates the ledger legs.


class RecurringTransactionSerializer(
    CleanModelMixin, _UserScopedMixin, serializers.ModelSerializer
):
    user_scoped_fields = ("account", "category")

    class Meta:
        model = RecurringTransaction
        fields = [
            "id",
            "account",
            "category",
            "type",
            "amount",
            "merchant",
            "notes",
            "frequency",
            "start_date",
            "next_due",
            "end_date",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class BudgetSerializer(CleanModelMixin, _UserScopedMixin, serializers.ModelSerializer):
    user_scoped_fields = ("category",)
    category_name = serializers.CharField(source="category.name", read_only=True)
    spent = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    percent_used = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = Budget
        fields = [
            "id",
            "category",
            "category_name",
            "month",
            "limit",
            "spent",
            "remaining",
            "percent_used",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "spent",
            "remaining",
            "percent_used",
            "status",
            "created_at",
            "updated_at",
        ]

    def _progress(self, obj):
        if not hasattr(obj, "_progress_cache"):
            obj._progress_cache = obj.progress()
        return obj._progress_cache

    def get_spent(self, obj):
        from .services import money_str

        return money_str(self._progress(obj)[0])

    def get_remaining(self, obj):
        from .services import money_str

        return money_str(self._progress(obj)[1])

    def get_percent_used(self, obj):
        return self._progress(obj)[2]

    def get_status(self, obj):
        return self._progress(obj)[3]


class GoalContributionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoalContribution
        fields = ["id", "goal", "amount", "date", "note", "created_at"]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        goal = attrs.get("goal") or (self.instance.goal if self.instance else None)
        if goal and request and goal.user_id != request.user.id:
            raise serializers.ValidationError(
                {"goal": "Goal must belong to the same user."}
            )
        return attrs


class GoalSerializer(CleanModelMixin, _UserScopedMixin, serializers.ModelSerializer):
    user_scoped_fields = ("account",)
    account_name = serializers.CharField(
        source="account.name", read_only=True, default=None
    )
    current_amount = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Goal
        fields = [
            "id",
            "name",
            "target_amount",
            "target_date",
            "account",
            "account_name",
            "current_amount",
            "remaining_amount",
            "progress_percent",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "current_amount",
            "remaining_amount",
            "progress_percent",
            "created_at",
            "updated_at",
        ]

    def get_current_amount(self, obj):
        from .services import money_str

        return money_str(obj.current_amount())

    def get_remaining_amount(self, obj):
        from .services import money_str

        return money_str(obj.remaining_amount())

    def get_progress_percent(self, obj):
        return obj.progress_percent()


class CsvImportSerializer(serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    valid_count = serializers.SerializerMethodField()
    error_count = serializers.SerializerMethodField()
    duplicate_count = serializers.SerializerMethodField()

    class Meta:
        model = CsvImport
        fields = [
            "id",
            "file",
            "file_name",
            "account",
            "status",
            "mapping",
            "rows",
            "valid_count",
            "error_count",
            "duplicate_count",
            "created_count",
            "skipped_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "status",
            "mapping",
            "rows",
            "created_count",
            "skipped_count",
            "created_at",
            "updated_at",
        ]

    def get_file_name(self, obj):
        return obj.file.name.split("/")[-1] if obj.file else None

    def _rows(self, obj):
        return obj.rows or []

    def get_valid_count(self, obj):
        return sum(
            1 for r in self._rows(obj) if not r["errors"] and not r["is_duplicate"]
        )

    def get_error_count(self, obj):
        return sum(1 for r in self._rows(obj) if r["errors"])

    def get_duplicate_count(self, obj):
        return sum(1 for r in self._rows(obj) if r["is_duplicate"])


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("A user with that username exists.")
        return value

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "date_joined"]
