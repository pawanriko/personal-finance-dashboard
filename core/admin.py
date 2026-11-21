"""Django admin registrations (handy for inspecting data; the API is
the primary interface)."""

from django.contrib import admin

from .models import (
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


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "default_currency")
    search_fields = ("user__username",)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "type", "currency", "opening_balance", "is_active")
    list_filter = ("type", "currency", "is_active")
    search_fields = ("name", "user__username")


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "type", "parent", "is_default")
    list_filter = ("type", "is_default")
    search_fields = ("name", "user__username")


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "date",
        "user",
        "account",
        "type",
        "amount",
        "merchant",
        "category",
        "is_transfer",
    )
    list_filter = ("type", "is_transfer", "date")
    search_fields = ("merchant", "notes", "user__username")
    date_hierarchy = "date"


@admin.register(Transfer)
class TransferAdmin(admin.ModelAdmin):
    list_display = (
        "date",
        "user",
        "source_account",
        "destination_account",
        "amount",
    )
    date_hierarchy = "date"


@admin.register(RecurringTransaction)
class RecurringTransactionAdmin(admin.ModelAdmin):
    list_display = (
        "merchant",
        "user",
        "type",
        "amount",
        "frequency",
        "next_due",
        "is_active",
    )
    list_filter = ("frequency", "type", "is_active")


@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
    list_display = ("month", "user", "category", "limit")
    list_filter = ("month",)


@admin.register(Goal)
class GoalAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "target_amount", "target_date")
    search_fields = ("name", "user__username")


@admin.register(GoalContribution)
class GoalContributionAdmin(admin.ModelAdmin):
    list_display = ("date", "user", "goal", "amount")
    date_hierarchy = "date"


@admin.register(CsvImport)
class CsvImportAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "account", "status", "created_count", "created_at")
    list_filter = ("status",)
