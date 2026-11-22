"""Data model for the Personal Finance Dashboard.

Amount convention (see README): every money value is a positive
``Decimal`` stored with two decimal places, plus a separate ``type``
field (``income`` / ``expense``). Transfers are a separate model; creating
one writes two linked Transaction rows (out of the source, into the
destination) flagged ``is_transfer=True``, so they move balances without
ever counting as income or spending in reports.

Balances are never stored: ``Account.balance`` is computed from the
opening balance plus the transaction ledger, so edits and deletes can
never leave a stale total behind.
"""

from datetime import date, timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q, Sum
from django.utils import timezone

User = get_user_model()

MONEY_MAX_DIGITS = 12
MONEY_DECIMAL_PLACES = 2
ZERO = Decimal("0.00")

# ---------------------------------------------------------------------------
# Default categories, created for every new user (see signals.py).
# (name, kind, parent_name or None)
# ---------------------------------------------------------------------------
DEFAULT_CATEGORIES = [
    ("Salary", "income", None),
    ("Freelance", "income", None),
    ("Interest", "income", None),
    ("Other Income", "income", None),
    ("Food", "expense", None),
    ("Groceries", "expense", "Food"),
    ("Restaurants", "expense", "Food"),
    ("Housing", "expense", None),
    ("Rent", "expense", "Housing"),
    ("Utilities", "expense", "Housing"),
    ("Transport", "expense", None),
    ("Entertainment", "expense", None),
    ("Shopping", "expense", None),
    ("Healthcare", "expense", None),
    ("Education", "expense", None),
    ("Subscriptions", "expense", None),
    ("Other Expense", "expense", None),
]


class Profile(models.Model):
    """Per-user preferences (default currency for new accounts)."""

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="profile"
    )
    default_currency = models.CharField(max_length=3, default="INR")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile({self.user.username})"


class InsforgeIdentity(models.Model):
    """One row per Django user that has signed in via InsForge OAuth.

    ``sub`` is the InsForge user id — the ``sub`` claim of the JWT.
    It is the stable anchor: emails can change, the sub cannot.
    ``email`` is a copy of the token's email at link time; the live
    email always comes from the token. See core/insforge_auth.py.
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="insforge_identity"
    )
    sub = models.CharField(
        max_length=255,
        unique=True,
        help_text="InsForge user id (the JWT 'sub' claim).",
    )
    email = models.EmailField(
        blank=True,
        default="",
        help_text="Email from the InsForge token at link time.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"InsforgeIdentity({self.user.username}, {self.sub})"


class Account(models.Model):
    """A bank account, wallet, or credit card owned by the user."""

    class Type(models.TextChoices):
        CHECKING = "checking", "Checking"
        SAVINGS = "savings", "Savings"
        CREDIT_CARD = "credit_card", "Credit Card"
        CASH = "cash", "Cash"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="accounts"
    )
    name = models.CharField(max_length=100)
    type = models.CharField(
        max_length=20, choices=Type.choices, default=Type.CHECKING
    )
    currency = models.CharField(max_length=3, default="INR")
    opening_balance = models.DecimalField(
        max_digits=MONEY_MAX_DIGITS,
        decimal_places=MONEY_DECIMAL_PLACES,
        default=ZERO,
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        super().clean()
        # A negative opening balance means "amount already owed" — only
        # a credit card may start in the red. Every other account type
        # must open at zero or above. (The old MinValueValidator(0) on
        # this field blocked negative credit-card openings entirely,
        # even though the balance itself already supports going
        # negative via expenses.)
        if (
            self.opening_balance is not None
            and self.opening_balance < ZERO
            and self.type != self.Type.CREDIT_CARD
        ):
            raise ValidationError(
                {
                    "opening_balance": (
                        "A negative opening balance is only allowed for "
                        "credit-card accounts (it means the amount owed)."
                    )
                }
            )

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"], name="unique_account_name_per_user"
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.currency})"

    def balance(self):
        """Current balance, computed from the ledger (never stored).

        balance = opening + income - expenses, where transfers are already
        part of the ledger (out of source, into destination). For a credit
        card a negative balance means "amount owed".
        """
        agg = self.transactions.aggregate(
            income=Sum("amount", filter=Q(type=Transaction.Type.INCOME)),
            expense=Sum("amount", filter=Q(type=Transaction.Type.EXPENSE)),
        )
        return (
            self.opening_balance
            + (agg["income"] or ZERO)
            - (agg["expense"] or ZERO)
        )


class Category(models.Model):
    """An income or expense category, optionally nested under a parent."""

    class Type(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="categories"
    )
    name = models.CharField(max_length=100)
    type = models.CharField(max_length=10, choices=Type.choices)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["type", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name", "type"],
                name="unique_category_name_per_user_type",
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.type})"

    def clean(self):
        super().clean()
        if self.parent_id:
            if self.parent_id == self.pk:
                raise ValidationError("A category cannot be its own parent.")
            if self.parent.user_id != self.user_id:
                raise ValidationError("Parent category must belong to the same user.")
            if self.parent.type != self.type:
                raise ValidationError(
                    "Parent category must have the same type (income/expense)."
                )


class Transaction(models.Model):
    """One income or expense entry. Amounts are always positive Decimals;
    the ``type`` field says which direction the money moved."""

    class Type(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="transactions"
    )
    account = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="transactions"
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    type = models.CharField(max_length=10, choices=Type.choices)
    amount = models.DecimalField(
        max_digits=MONEY_MAX_DIGITS,
        decimal_places=MONEY_DECIMAL_PLACES,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    date = models.DateField(default=timezone.now)
    merchant = models.CharField(max_length=200, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    # True for the two legs of a Transfer; excluded from income/expense
    # totals in dashboards and reports.
    is_transfer = models.BooleanField(default=False)
    transfer = models.ForeignKey(
        "Transfer",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="legs",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["user", "date"]),
            models.Index(fields=["user", "account", "date"]),
            models.Index(fields=["user", "category", "date"]),
        ]

    def __str__(self):
        return f"{self.type} {self.amount} on {self.date}"

    def clean(self):
        super().clean()
        if self.account_id and self.account.user_id != self.user_id:
            raise ValidationError("Account must belong to the same user.")
        if self.category_id:
            if self.category.user_id != self.user_id:
                raise ValidationError("Category must belong to the same user.")
            if self.category.type != self.type:
                raise ValidationError(
                    "Category type must match the transaction type."
                )


class Transfer(models.Model):
    """Money moved between two of the user's accounts.

    Implemented as two linked Transaction rows (see Transaction.is_transfer)
    so balances stay consistent and the move never inflates income or
    spending. Both legs are created/updated/deleted together.
    """

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="transfers"
    )
    source_account = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="transfers_out"
    )
    destination_account = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="transfers_in"
    )
    amount = models.DecimalField(
        max_digits=MONEY_MAX_DIGITS,
        decimal_places=MONEY_DECIMAL_PLACES,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    date = models.DateField(default=timezone.now)
    note = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.amount} {self.source_account} -> {self.destination_account}"

    def clean(self):
        super().clean()
        if self.source_account_id and self.destination_account_id:
            if self.source_account_id == self.destination_account_id:
                raise ValidationError(
                    "Source and destination accounts must be different."
                )
            if self.source_account.user_id != self.user_id:
                raise ValidationError("Source account must belong to the same user.")
            if (
                self.destination_account.user_id != self.user_id
            ):
                raise ValidationError(
                    "Destination account must belong to the same user."
                )
            if self.source_account.currency != self.destination_account.currency:
                raise ValidationError(
                    "Transfers are only supported between accounts with the "
                    "same currency in v1."
                )

    def sync_legs(self):
        """(Re)create the two ledger legs for this transfer.

        Called automatically on every save (see signals.py), so the legs
        exist no matter how the Transfer was created — API, admin, or
        shell. Deleting the Transfer deletes the legs via CASCADE.
        """
        self.legs.all().delete()
        Transaction.objects.create(
            user=self.user,
            account=self.source_account,
            category=None,
            type=Transaction.Type.EXPENSE,
            amount=self.amount,
            date=self.date,
            merchant=f"Transfer to {self.destination_account.name}",
            notes=self.note,
            is_transfer=True,
            transfer=self,
        )
        Transaction.objects.create(
            user=self.user,
            account=self.destination_account,
            category=None,
            type=Transaction.Type.INCOME,
            amount=self.amount,
            date=self.date,
            merchant=f"Transfer from {self.source_account.name}",
            notes=self.note,
            is_transfer=True,
            transfer=self,
        )


class RecurringTransaction(models.Model):
    """A template (rent, salary, ...) that generates Transaction rows on
    its schedule. Generation is explicit: the API endpoint creates every
    due instance up to today and advances ``next_due``."""

    class Frequency(models.TextChoices):
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        YEARLY = "yearly", "Yearly"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="recurring_transactions"
    )
    account = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="recurring_transactions"
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recurring_transactions",
    )
    type = models.CharField(max_length=10, choices=Transaction.Type.choices)
    amount = models.DecimalField(
        max_digits=MONEY_MAX_DIGITS,
        decimal_places=MONEY_DECIMAL_PLACES,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    merchant = models.CharField(max_length=200, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    frequency = models.CharField(
        max_length=10, choices=Frequency.choices, default=Frequency.MONTHLY
    )
    start_date = models.DateField(default=timezone.now)
    next_due = models.DateField(default=timezone.now)
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["next_due"]

    def __str__(self):
        return f"{self.frequency} {self.type} {self.amount} ({self.merchant})"

    def clean(self):
        super().clean()
        if self.account_id and self.account.user_id != self.user_id:
            raise ValidationError("Account must belong to the same user.")
        if self.category_id:
            if self.category.user_id != self.user_id:
                raise ValidationError("Category must belong to the same user.")
            if self.category.type != self.type:
                raise ValidationError(
                    "Category type must match the recurring transaction type."
                )
        if self.end_date and self.end_date < self.start_date:
            raise ValidationError("End date cannot be before the start date.")

    def _advance(self, current):
        if self.frequency == self.Frequency.DAILY:
            return current + timedelta(days=1)
        if self.frequency == self.Frequency.WEEKLY:
            return current + timedelta(weeks=1)
        if self.frequency == self.Frequency.MONTHLY:
            return current + relativedelta(months=1)
        return current + relativedelta(years=1)

    def due_dates(self, up_to):
        """Every due date from ``next_due`` up to ``up_to`` (inclusive).

        Capped at 365 occurrences per call so a long-dormant template
        cannot flood the ledger in one request.
        """
        dates = []
        current = self.next_due
        while current <= up_to and len(dates) < 365:
            if self.end_date and current > self.end_date:
                break
            dates.append(current)
            current = self._advance(current)
        return dates

    def generate_due(self, up_to=None):
        """Create Transaction rows for every due occurrence up to ``up_to``
        (default: today) and advance ``next_due`` past them. Returns the
        list of created transactions. No-op when inactive or nothing due.
        """
        if not self.is_active:
            return []
        up_to = up_to or date.today()
        dates = self.due_dates(up_to)
        created = []
        for due in dates:
            created.append(
                Transaction.objects.create(
                    user=self.user,
                    account=self.account,
                    category=self.category,
                    type=self.type,
                    amount=self.amount,
                    date=due,
                    merchant=self.merchant,
                    notes=self.notes,
                )
            )
        if dates:
            # Advance past the last generated date, honouring end_date.
            nxt = self._advance(dates[-1])
            if self.end_date and nxt > self.end_date:
                self.is_active = False
            self.next_due = nxt
            self.save(update_fields=["next_due", "is_active", "updated_at"])
        return created


class Budget(models.Model):
    """A monthly spending limit for one category. Budgets are per-month
    and do NOT carry forward (blueprint: carry-forward only if explicitly
    supported — it is not, in v1)."""

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="budgets"
    )
    category = models.ForeignKey(
        Category, on_delete=models.CASCADE, related_name="budgets"
    )
    # First day of the month this budget applies to.
    month = models.DateField()
    limit = models.DecimalField(
        max_digits=MONEY_MAX_DIGITS,
        decimal_places=MONEY_DECIMAL_PLACES,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-month", "category__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "category", "month"],
                name="unique_budget_per_user_category_month",
            )
        ]

    def __str__(self):
        return f"{self.category} {self.month:%Y-%m}: {self.limit}"

    def clean(self):
        super().clean()
        if self.category_id:
            if self.category.user_id != self.user_id:
                raise ValidationError("Category must belong to the same user.")
            if self.category.type != Category.Type.EXPENSE:
                raise ValidationError("Budgets only apply to expense categories.")
        if self.month and self.month.day != 1:
            raise ValidationError("Budget month must be the first day of a month.")

    def spent(self):
        """Expense transactions in this category during this month,
        excluding transfer legs."""
        start = self.month
        end = start + relativedelta(months=1) - timedelta(days=1)
        agg = Transaction.objects.filter(
            user=self.user,
            category=self.category,
            type=Transaction.Type.EXPENSE,
            is_transfer=False,
            date__gte=start,
            date__lte=end,
        ).aggregate(total=Sum("amount"))
        return agg["total"] or ZERO

    def progress(self):
        """(spent, remaining, percent_used, status) for this budget."""
        spent = self.spent()
        remaining = self.limit - spent
        percent = float(spent / self.limit * 100) if self.limit else 0.0
        threshold = Decimal(str(settings.BUDGET_NEAR_THRESHOLD))
        if spent > self.limit:
            status = "over"
        elif spent >= self.limit * threshold:
            status = "near"
        else:
            status = "ok"
        return spent, remaining, round(percent, 2), status


class Goal(models.Model):
    """A savings target. Contributions are tracked separately and do not
    move money between accounts (v1); they record progress toward the
    target."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="goals")
    name = models.CharField(max_length=100)
    target_amount = models.DecimalField(
        max_digits=MONEY_MAX_DIGITS,
        decimal_places=MONEY_DECIMAL_PLACES,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    target_date = models.DateField(null=True, blank=True)
    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="goals",
        help_text="Optional account the savings sit in (informational).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["target_date", "name"]

    def __str__(self):
        return f"{self.name} ({self.target_amount})"

    def clean(self):
        super().clean()
        if self.account_id and self.account.user_id != self.user_id:
            raise ValidationError("Account must belong to the same user.")

    def current_amount(self):
        agg = self.contributions.aggregate(total=Sum("amount"))
        return agg["total"] or ZERO

    def remaining_amount(self):
        return max(self.target_amount - self.current_amount(), ZERO)

    def progress_percent(self):
        if not self.target_amount:
            return 0.0
        return round(float(self.current_amount() / self.target_amount * 100), 2)


class GoalContribution(models.Model):
    """One contribution toward a Goal."""

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="goal_contributions"
    )
    goal = models.ForeignKey(
        Goal, on_delete=models.CASCADE, related_name="contributions"
    )
    amount = models.DecimalField(
        max_digits=MONEY_MAX_DIGITS,
        decimal_places=MONEY_DECIMAL_PLACES,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    date = models.DateField(default=timezone.now)
    note = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.amount} -> {self.goal.name}"

    def clean(self):
        super().clean()
        if self.goal_id and self.goal.user_id != self.user_id:
            raise ValidationError("Goal must belong to the same user.")


class CsvImport(models.Model):
    """One CSV import session: upload -> preview -> confirm.

    The parsed rows (with per-row validation errors and duplicate flags)
    are stored as JSON so the preview/confirm steps do not need the file
    to be re-uploaded.
    """

    class Status(models.TextChoices):
        PREVIEW = "preview", "Preview"
        IMPORTED = "imported", "Imported"
        FAILED = "failed", "Failed"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="csv_imports"
    )
    file = models.FileField(upload_to="imports/%Y/%m/")
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="csv_imports",
        help_text="Account the imported transactions belong to.",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PREVIEW
    )
    # Column mapping: {"date": "Date", "amount": "Amount", ...} — CSV header
    # names for each transaction field.
    mapping = models.JSONField(default=dict)
    # Preview rows: [{"row": 2, "data": {...raw values...},
    #   "errors": [...], "is_duplicate": bool, "selected": bool}]
    rows = models.JSONField(default=list)
    created_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"CSV import {self.pk} ({self.status})"
