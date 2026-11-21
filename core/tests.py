"""Test suite for the Personal Finance Dashboard backend.

Run:  DATABASE_URL= .venv/bin/python manage.py test core
Covers: auth, accounts + balances, transactions CRUD/filters,
transfers (never income/spending), recurring generation, categories,
budgets, goals, CSV import/export, dashboard/reports, per-user isolation.
"""

import json
import time
from datetime import date
from decimal import Decimal
from unittest import mock

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from jwt.algorithms import RSAAlgorithm
from rest_framework.test import APIClient

from .models import (
    Account,
    Budget,
    Category,
    Goal,
    GoalContribution,
    InsforgeIdentity,
    RecurringTransaction,
    Transaction,
    Transfer,
)

User = get_user_model()

D = Decimal


class ApiTestCase(TestCase):
    """Base: two users with accounts, ready-to-use API clients."""

    def setUp(self):
        self.user_a = User.objects.create_user(
            "alice", password="password123", email="alice@example.com"
        )
        self.user_b = User.objects.create_user(
            "bob", password="password123", email="bob@example.com"
        )
        self.client_a = APIClient()
        self.client_a.force_authenticate(user=self.user_a)
        self.client_b = APIClient()
        self.client_b.force_authenticate(user=self.user_b)
        self.anon = APIClient()

        self.checking = Account.objects.create(
            user=self.user_a,
            name="Checking",
            type="checking",
            opening_balance=D("1000.00"),
        )
        self.savings = Account.objects.create(
            user=self.user_a,
            name="Savings",
            type="savings",
            opening_balance=D("500.00"),
        )
        self.groceries = Category.objects.get(
            user=self.user_a, name="Groceries"
        )
        self.salary = Category.objects.get(user=self.user_a, name="Salary")
        self.rent = Category.objects.get(user=self.user_a, name="Rent")

    def tx(self, **kwargs):
        defaults = {
            "user": self.user_a,
            "account": self.checking,
            "type": "expense",
            "amount": D("10.00"),
            "date": date(2026, 11, 10),
        }
        defaults.update(kwargs)
        return Transaction.objects.create(**defaults)


class AuthTests(ApiTestCase):
    def test_register_creates_user_profile_and_defaults_and_logs_in(self):
        res = self.anon.post(
            "/api/auth/register/",
            {"username": "carol", "password": "password123"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        user = User.objects.get(username="carol")
        self.assertTrue(hasattr(user, "profile"))
        self.assertEqual(
            Category.objects.filter(user=user, is_default=True).count(), 17
        )
        # The register response logged the client in (session cookie set).
        self.assertIn("sessionid", res.cookies)

    def test_register_duplicate_username_rejected(self):
        res = self.anon.post(
            "/api/auth/register/",
            {"username": "alice", "password": "password123"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_login_logout_me_flow(self):
        res = self.anon.post(
            "/api/auth/login/",
            {"username": "alice", "password": "password123"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        res = self.anon.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "alice")
        res = self.anon.post("/api/auth/logout/")
        self.assertEqual(res.status_code, 200)
        res = self.anon.get("/api/auth/me/")
        self.assertEqual(res.status_code, 403)

    def test_login_wrong_password_rejected(self):
        res = self.anon.post(
            "/api/auth/login/",
            {"username": "alice", "password": "wrong"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_unauthenticated_api_access_denied(self):
        for url in ("/api/accounts/", "/api/transactions/", "/api/dashboard/"):
            self.assertIn(
                self.anon.get(url).status_code, (401, 403), url
            )

    def test_csrf_endpoint_sets_cookie(self):
        res = self.anon.get("/api/auth/csrf/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("csrftoken", res.cookies)


class AccountTests(ApiTestCase):
    def test_create_and_list_accounts_with_computed_balance(self):
        res = self.client_a.post(
            "/api/accounts/",
            {
                "name": "Cash Wallet",
                "type": "cash",
                "currency": "INR",
                "opening_balance": "250.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["balance"], "250.00")
        res = self.client_a.get("/api/accounts/")
        self.assertEqual(len(res.data["results"]), 3)

    def test_balance_reflects_income_expenses_and_transfers(self):
        self.tx(type="income", category=self.salary, amount=D("2000.00"))
        self.tx(category=self.groceries, amount=D("120.50"))
        Transfer.objects.create(
            user=self.user_a,
            source_account=self.checking,
            destination_account=self.savings,
            amount=D("300.00"),
            date=date(2026, 11, 11),
        )
        res = self.client_a.get(f"/api/accounts/{self.checking.id}/")
        self.assertEqual(res.data["balance"], "2579.50")
        res = self.client_a.get(f"/api/accounts/{self.savings.id}/")
        self.assertEqual(res.data["balance"], "800.00")

    def test_duplicate_account_name_rejected(self):
        res = self.client_a.post(
            "/api/accounts/",
            {"name": "Checking", "type": "checking"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_account_history_includes_transfer_legs(self):
        Transfer.objects.create(
            user=self.user_a,
            source_account=self.checking,
            destination_account=self.savings,
            amount=D("50.00"),
            date=date(2026, 11, 12),
        )
        res = self.client_a.get(f"/api/accounts/{self.checking.id}/history/")
        merchants = [r["merchant"] for r in res.data["results"]]
        self.assertIn("Transfer to Savings", merchants)

    def test_user_b_cannot_see_or_touch_user_a_account(self):
        res = self.client_b.get(f"/api/accounts/{self.checking.id}/")
        self.assertEqual(res.status_code, 404)
        res = self.client_b.get("/api/accounts/")
        self.assertEqual(res.data["results"], [])


class CategoryTests(ApiTestCase):
    def test_defaults_seeded_on_signup(self):
        names = set(
            Category.objects.filter(user=self.user_a).values_list(
                "name", flat=True
            )
        )
        for expected in (
            "Salary",
            "Groceries",
            "Food",
            "Restaurants",
            "Housing",
            "Rent",
            "Transport",
        ):
            self.assertIn(expected, names)

    def test_parent_child_relationship(self):
        food = Category.objects.get(user=self.user_a, name="Food")
        groceries = Category.objects.get(user=self.user_a, name="Groceries")
        self.assertEqual(groceries.parent, food)
        res = self.client_a.get("/api/categories/?parent=null")
        parents = [c["name"] for c in res.data["results"]]
        self.assertIn("Food", parents)
        self.assertNotIn("Groceries", parents)

    def test_create_custom_category_and_type_mismatch_parent_rejected(self):
        res = self.client_a.post(
            "/api/categories/",
            {"name": "Pet Food", "type": "expense"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        food = Category.objects.get(user=self.user_a, name="Food")
        res = self.client_a.post(
            "/api/categories/",
            {"name": "Side Hustle", "type": "income", "parent": food.id},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_seed_defaults_is_idempotent(self):
        res = self.client_a.post("/api/categories/seed-defaults/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["default_categories"], 17)
        res = self.client_a.post("/api/categories/seed-defaults/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            Category.objects.filter(user=self.user_a).count(), 17
        )


class TransactionTests(ApiTestCase):
    def test_create_list_and_detail(self):
        res = self.client_a.post(
            "/api/transactions/",
            {
                "account": self.checking.id,
                "category": self.groceries.id,
                "type": "expense",
                "amount": "45.25",
                "date": "2026-11-10",
                "merchant": "BigBasket",
                "notes": "weekly shop",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["merchant"], "BigBasket")
        self.assertEqual(res.data["account_name"], "Checking")
        res = self.client_a.get("/api/transactions/")
        self.assertEqual(len(res.data["results"]), 1)

    def test_edit_updates_balance_and_delete_restores_it(self):
        tx = self.tx(amount=D("100.00"))
        res = self.client_a.get(f"/api/accounts/{self.checking.id}/")
        self.assertEqual(res.data["balance"], "900.00")
        res = self.client_a.patch(
            f"/api/transactions/{tx.id}/", {"amount": "150.00"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        res = self.client_a.get(f"/api/accounts/{self.checking.id}/")
        self.assertEqual(res.data["balance"], "850.00")
        res = self.client_a.delete(f"/api/transactions/{tx.id}/")
        self.assertEqual(res.status_code, 204)
        res = self.client_a.get(f"/api/accounts/{self.checking.id}/")
        self.assertEqual(res.data["balance"], "1000.00")

    def test_amount_must_be_positive(self):
        res = self.client_a.post(
            "/api/transactions/",
            {
                "account": self.checking.id,
                "type": "expense",
                "amount": "0",
                "date": "2026-11-10",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        res = self.client_a.post(
            "/api/transactions/",
            {
                "account": self.checking.id,
                "type": "expense",
                "amount": "-5",
                "date": "2026-11-10",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_category_type_must_match_transaction_type(self):
        res = self.client_a.post(
            "/api/transactions/",
            {
                "account": self.checking.id,
                "category": self.salary.id,  # income category
                "type": "expense",
                "amount": "10",
                "date": "2026-11-10",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_filters_by_date_account_category_type_and_search(self):
        self.tx(category=self.groceries, amount=D("10.00"), date=date(2026, 11, 5))
        self.tx(category=self.rent, amount=D("500.00"), date=date(2026, 11, 1))
        self.tx(
            type="income",
            category=self.salary,
            amount=D("2000.00"),
            date=date(2026, 11, 3),
            merchant="Acme Corp",
        )
        self.tx(
            category=self.groceries,
            amount=D("25.00"),
            date=date(2026, 10, 20),
            merchant="BigBasket",
        )
        base = "/api/transactions/"
        self.assertEqual(len(self.client_a.get(base).data["results"]), 4)
        self.assertEqual(
            len(
                self.client_a.get(
                    base, {"start": "2026-11-01", "end": "2026-11-30"}
                ).data["results"]
            ),
            3,
        )
        self.assertEqual(
            len(
                self.client_a.get(base, {"type": "income"}).data["results"]
            ),
            1,
        )
        self.assertEqual(
            len(
                self.client_a.get(
                    base, {"category": self.groceries.id}
                ).data["results"]
            ),
            2,
        )
        self.assertEqual(
            len(
                self.client_a.get(base, {"search": "bigbasket"}).data["results"]
            ),
            1,
        )
        self.assertEqual(
            len(
                self.client_a.get(
                    base, {"account": self.savings.id}
                ).data["results"]
            ),
            0,
        )

    def test_transfer_legs_excluded_by_default_included_on_request(self):
        Transfer.objects.create(
            user=self.user_a,
            source_account=self.checking,
            destination_account=self.savings,
            amount=D("70.00"),
            date=date(2026, 11, 10),
        )
        self.assertEqual(
            len(self.client_a.get("/api/transactions/").data["results"]), 0
        )
        res = self.client_a.get(
            "/api/transactions/", {"include_transfers": "true"}
        )
        self.assertEqual(len(res.data["results"]), 2)
        self.assertTrue(all(r["is_transfer"] for r in res.data["results"]))

    def test_user_b_cannot_access_user_a_transaction(self):
        tx = self.tx()
        res = self.client_b.get(f"/api/transactions/{tx.id}/")
        self.assertEqual(res.status_code, 404)
        res = self.client_b.patch(
            f"/api/transactions/{tx.id}/", {"amount": "1.00"}, format="json"
        )
        self.assertEqual(res.status_code, 404)

    def test_transaction_export_csv(self):
        self.tx(merchant="BigBasket", amount=D("10.00"))
        res = self.client_a.get("/api/transactions/export/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res["Content-Type"])
        content = res.content.decode()
        self.assertIn("BigBasket", content)
        self.assertIn("date,type,amount,account,category,merchant,notes", content)


class TransferTests(ApiTestCase):
    def test_create_moves_money_both_sides(self):
        res = self.client_a.post(
            "/api/transfers/",
            {
                "source_account": self.checking.id,
                "destination_account": self.savings.id,
                "amount": "200.00",
                "date": "2026-11-10",
                "note": "monthly save",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(
            self.client_a.get(f"/api/accounts/{self.checking.id}/").data[
                "balance"
            ],
            "800.00",
        )
        self.assertEqual(
            self.client_a.get(f"/api/accounts/{self.savings.id}/").data[
                "balance"
            ],
            "700.00",
        )

    def test_transfer_does_not_count_as_income_or_spending(self):
        Transfer.objects.create(
            user=self.user_a,
            source_account=self.checking,
            destination_account=self.savings,
            amount=D("200.00"),
            date=date(2026, 11, 10),
        )
        res = self.client_a.get(
            "/api/dashboard/",
            {"start": "2026-11-01", "end": "2026-11-30"},
        )
        self.assertEqual(res.data["income"], "0.00")
        self.assertEqual(res.data["expenses"], "0.00")
        self.assertEqual(res.data["net"], "0.00")

    def test_same_account_and_cross_currency_rejected(self):
        res = self.client_a.post(
            "/api/transfers/",
            {
                "source_account": self.checking.id,
                "destination_account": self.checking.id,
                "amount": "10.00",
                "date": "2026-11-10",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        usd = Account.objects.create(
            user=self.user_a,
            name="USD Wallet",
            type="cash",
            currency="USD",
            opening_balance=D("0.00"),
        )
        res = self.client_a.post(
            "/api/transfers/",
            {
                "source_account": self.checking.id,
                "destination_account": usd.id,
                "amount": "10.00",
                "date": "2026-11-10",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_edit_and_delete_reverse_correctly(self):
        transfer = Transfer.objects.create(
            user=self.user_a,
            source_account=self.checking,
            destination_account=self.savings,
            amount=D("100.00"),
            date=date(2026, 11, 10),
        )
        res = self.client_a.patch(
            f"/api/transfers/{transfer.id}/",
            {"amount": "150.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            self.client_a.get(f"/api/accounts/{self.checking.id}/").data[
                "balance"
            ],
            "850.00",
        )
        res = self.client_a.delete(f"/api/transfers/{transfer.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(
            self.client_a.get(f"/api/accounts/{self.checking.id}/").data[
                "balance"
            ],
            "1000.00",
        )
        self.assertEqual(Transaction.objects.filter(is_transfer=True).count(), 0)


class RecurringTests(ApiTestCase):
    def _make_monthly(self, **kwargs):
        defaults = {
            "user": self.user_a,
            "account": self.checking,
            "category": self.rent,
            "type": "expense",
            "amount": D("500.00"),
            "merchant": "Landlord",
            "frequency": "monthly",
            "start_date": date(2026, 10, 1),
            "next_due": date(2026, 10, 1),
        }
        defaults.update(kwargs)
        return RecurringTransaction.objects.create(**defaults)

    def test_generate_due_creates_instances_and_advances_next_due(self):
        rec = self._make_monthly()
        res = self.client_a.post(
            f"/api/recurring/{rec.id}/generate-due/",
            {"up_to": "2026-12-15"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["created"], 3)
        rec.refresh_from_db()
        self.assertEqual(rec.next_due, date(2027, 1, 1))
        self.assertEqual(
            Transaction.objects.filter(merchant="Landlord").count(), 3
        )

    def test_generate_due_is_idempotent(self):
        rec = self._make_monthly()
        self.client_a.post(
            f"/api/recurring/{rec.id}/generate-due/",
            {"up_to": "2026-12-15"},
            format="json",
        )
        res = self.client_a.post(
            f"/api/recurring/{rec.id}/generate-due/",
            {"up_to": "2026-12-15"},
            format="json",
        )
        self.assertEqual(res.data["created"], 0)

    def test_inactive_template_and_end_date(self):
        inactive = self._make_monthly(is_active=False)
        res = self.client_a.post(
            f"/api/recurring/{inactive.id}/generate-due/",
            {"up_to": "2026-12-15"},
            format="json",
        )
        self.assertEqual(res.data["created"], 0)
        ending = self._make_monthly(end_date=date(2026, 10, 31))
        res = self.client_a.post(
            f"/api/recurring/{ending.id}/generate-due/",
            {"up_to": "2026-12-15"},
            format="json",
        )
        self.assertEqual(res.data["created"], 1)
        ending.refresh_from_db()
        self.assertFalse(ending.is_active)

    def test_generate_all_due(self):
        self._make_monthly()
        self._make_monthly(merchant="Salary", type="income", category=self.salary)
        res = self.client_a.post(
            "/api/recurring/generate-all-due/",
            {"up_to": "2026-10-31"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["created"], 2)


class BudgetTests(ApiTestCase):
    def test_progress_ok_near_over(self):
        budget = Budget.objects.create(
            user=self.user_a,
            category=self.groceries,
            month=date(2026, 11, 1),
            limit=D("100.00"),
        )
        self.tx(category=self.groceries, amount=D("50.00"))
        res = self.client_a.get(f"/api/budgets/{budget.id}/")
        self.assertEqual(res.data["spent"], "50.00")
        self.assertEqual(res.data["remaining"], "50.00")
        self.assertEqual(res.data["percent_used"], 50.0)
        self.assertEqual(res.data["status"], "ok")
        self.tx(category=self.groceries, amount=D("35.00"))
        res = self.client_a.get(f"/api/budgets/{budget.id}/")
        self.assertEqual(res.data["status"], "near")
        self.tx(category=self.groceries, amount=D("20.00"))
        res = self.client_a.get(f"/api/budgets/{budget.id}/")
        self.assertEqual(res.data["status"], "over")
        self.assertEqual(res.data["remaining"], "-5.00")

    def test_budget_scoped_to_its_month(self):
        budget = Budget.objects.create(
            user=self.user_a,
            category=self.groceries,
            month=date(2026, 11, 1),
            limit=D("100.00"),
        )
        self.tx(
            category=self.groceries, amount=D("90.00"), date=date(2026, 10, 15)
        )
        res = self.client_a.get(f"/api/budgets/{budget.id}/")
        self.assertEqual(res.data["spent"], "0.00")

    def test_budget_requires_expense_category_and_first_of_month(self):
        res = self.client_a.post(
            "/api/budgets/",
            {
                "category": self.salary.id,
                "month": "2026-11-01",
                "limit": "100.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        res = self.client_a.post(
            "/api/budgets/",
            {
                "category": self.groceries.id,
                "month": "2026-11-15",
                "limit": "100.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_duplicate_budget_same_month_rejected(self):
        Budget.objects.create(
            user=self.user_a,
            category=self.groceries,
            month=date(2026, 11, 1),
            limit=D("100.00"),
        )
        res = self.client_a.post(
            "/api/budgets/",
            {
                "category": self.groceries.id,
                "month": "2026-11-01",
                "limit": "200.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)


class GoalTests(ApiTestCase):
    def test_goal_progress_and_remaining(self):
        goal = Goal.objects.create(
            user=self.user_a,
            name="Emergency fund",
            target_amount=D("10000.00"),
            target_date=date(2027, 6, 30),
        )
        res = self.client_a.get(f"/api/goals/{goal.id}/")
        self.assertEqual(res.data["current_amount"], "0.00")
        self.assertEqual(res.data["remaining_amount"], "10000.00")
        self.assertEqual(res.data["progress_percent"], 0.0)
        GoalContribution.objects.create(
            user=self.user_a, goal=goal, amount=D("2500.00")
        )
        res = self.client_a.get(f"/api/goals/{goal.id}/")
        self.assertEqual(res.data["current_amount"], "2500.00")
        self.assertEqual(res.data["remaining_amount"], "7500.00")
        self.assertEqual(res.data["progress_percent"], 25.0)

    def test_contribution_via_api_and_goal_isolation(self):
        goal = Goal.objects.create(
            user=self.user_a, name="Bike", target_amount=D("5000.00")
        )
        res = self.client_a.post(
            "/api/goal-contributions/",
            {"goal": goal.id, "amount": "1000.00", "date": "2026-11-10"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        res = self.client_b.post(
            "/api/goal-contributions/",
            {"goal": goal.id, "amount": "1000.00", "date": "2026-11-10"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        res = self.client_b.get(f"/api/goals/{goal.id}/")
        self.assertEqual(res.status_code, 404)


class CsvImportTests(ApiTestCase):
    CSV_OK = (
        "Date,Description,Amount\n"
        "2026-11-05,BigBasket,-120.50\n"
        "2026-11-06,Acme Corp,2000.00\n"
        "2026-11-07,Coffee Shop,-45.00\n"
    )

    def _upload(self, content, name="txns.csv", **extra):
        data = {"account": self.checking.id, **extra}
        data["file"] = SimpleUploadedFile(
            name, content.encode(), content_type="text/csv"
        )
        return self.client_a.post("/api/csv-imports/", data, format="multipart")

    def test_upload_preview_auto_mapping_and_sign_inference(self):
        res = self._upload(self.CSV_OK)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "preview")
        self.assertEqual(res.data["mapping"]["date"], "Date")
        self.assertEqual(res.data["mapping"]["amount"], "Amount")
        self.assertEqual(res.data["mapping"]["merchant"], "Description")
        self.assertEqual(res.data["valid_count"], 3)
        self.assertEqual(res.data["error_count"], 0)
        rows = res.data["rows"]
        self.assertEqual(rows[0]["parsed"]["type"], "expense")
        self.assertEqual(rows[0]["parsed"]["amount"], "120.50")
        self.assertEqual(rows[1]["parsed"]["type"], "income")

    def test_preview_flags_invalid_rows_and_duplicates(self):
        # Existing transaction that the file duplicates.
        self.tx(
            merchant="BigBasket",
            amount=D("120.50"),
            date=date(2026, 11, 5),
        )
        content = (
            "Date,Description,Amount\n"
            "2026-11-05,BigBasket,-120.50\n"
            "2026-11-05,BigBasket,-120.50\n"
            "not-a-date,Shop,-10.00\n"
            "2026-11-08,Shop,abc\n"
            "2026-11-09,Good Shop,-30.00\n"
        )
        res = self._upload(content)
        self.assertEqual(res.status_code, 201)
        rows = {r["row"]: r for r in res.data["rows"]}
        self.assertTrue(rows[2]["is_duplicate"])  # matches existing txn
        self.assertTrue(rows[3]["is_duplicate"])  # duplicate within file
        self.assertTrue(rows[4]["errors"])  # bad date
        self.assertTrue(rows[5]["errors"])  # bad amount
        self.assertFalse(rows[6]["errors"])
        self.assertFalse(rows[6]["is_duplicate"])
        self.assertEqual(res.data["valid_count"], 1)
        self.assertEqual(res.data["error_count"], 2)
        self.assertEqual(res.data["duplicate_count"], 2)

    def test_confirm_imports_only_valid_selected_rows(self):
        res = self._upload(self.CSV_OK)
        import_id = res.data["id"]
        res = self.client_a.post(f"/api/csv-imports/{import_id}/confirm/")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["created"], 3)
        self.assertEqual(res.data["skipped"], 0)
        self.assertEqual(
            Transaction.objects.filter(user=self.user_a).count(), 3
        )
        # Confirming again is rejected.
        res = self.client_a.post(f"/api/csv-imports/{import_id}/confirm/")
        self.assertEqual(res.status_code, 400)

    def test_confirm_with_explicit_row_selection(self):
        res = self._upload(self.CSV_OK)
        import_id = res.data["id"]
        res = self.client_a.post(
            f"/api/csv-imports/{import_id}/confirm/",
            {"selected": [2]},
            format="json",
        )
        self.assertEqual(res.data["created"], 1)
        self.assertEqual(res.data["skipped"], 2)

    def test_non_csv_file_rejected(self):
        res = self._upload("a,b\n1,2\n", name="txns.txt")
        self.assertEqual(res.status_code, 400)

    def test_unmappable_csv_rejected(self):
        res = self._upload("Foo,Bar\n1,2\n")
        self.assertEqual(res.status_code, 400)

    def test_explicit_mapping_used(self):
        content = "TxnDate,Payee,Value\n2026-11-05,Shop,-10.00\n"
        res = self._upload(
            content,
            mapping='{"date": "TxnDate", "amount": "Value", "merchant": "Payee"}',
        )
        # Header aliases already cover these names; explicit mapping must
        # still parse the single row.
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["valid_count"], 1)

    def test_import_assigns_categories_by_name(self):
        content = "Date,Description,Amount,Category\n2026-11-05,Shop,-10.00,Groceries\n"
        res = self._upload(content)
        import_id = res.data["id"]
        self.client_a.post(f"/api/csv-imports/{import_id}/confirm/")
        tx = Transaction.objects.get(user=self.user_a)
        self.assertEqual(tx.category, self.groceries)


class DashboardTests(ApiTestCase):
    def _seed_november(self):
        self.tx(
            type="income",
            category=self.salary,
            amount=D("5000.00"),
            date=date(2026, 11, 3),
            merchant="Acme",
        )
        self.tx(category=self.groceries, amount=D("120.00"), date=date(2026, 11, 5))
        self.tx(category=self.rent, amount=D("800.00"), date=date(2026, 11, 1))
        self.tx(category=self.groceries, amount=D("60.00"), date=date(2026, 10, 20))
        Budget.objects.create(
            user=self.user_a,
            category=self.groceries,
            month=date(2026, 11, 1),
            limit=D("200.00"),
        )

    def test_dashboard_totals_and_category_breakdown(self):
        self._seed_november()
        res = self.client_a.get(
            "/api/dashboard/",
            {"start": "2026-11-01", "end": "2026-11-30"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["income"], "5000.00")
        self.assertEqual(res.data["expenses"], "920.00")
        self.assertEqual(res.data["net"], "4080.00")
        self.assertEqual(res.data["total_balances"], {"INR": "5520.00"})
        by_cat = {
            r["category"]: r["total"]
            for r in res.data["spending_by_category"]
        }
        self.assertEqual(by_cat["Rent"], "800.00")
        self.assertEqual(by_cat["Groceries"], "120.00")
        budgets = res.data["budgets"]
        self.assertEqual(len(budgets), 1)
        self.assertEqual(budgets[0]["spent"], "120.00")
        self.assertEqual(budgets[0]["status"], "ok")
        self.assertEqual(len(res.data["recent_transactions"]), 4)

    def test_dashboard_monthly_series_and_period_comparison(self):
        self._seed_november()
        res = self.client_a.get(
            "/api/dashboard/",
            {"start": "2026-10-01", "end": "2026-11-30"},
        )
        series = {r["month"]: r for r in res.data["monthly_series"]}
        self.assertEqual(series["2026-10-01"]["expenses"], "60.00")
        self.assertEqual(series["2026-11-01"]["income"], "5000.00")
        prev = res.data["previous_period"]
        self.assertEqual(prev["expenses"], "0.00")

    def test_reports_endpoint_and_export(self):
        self._seed_november()
        res = self.client_a.get(
            "/api/reports/", {"start": "2026-11-01", "end": "2026-11-30"}
        )
        self.assertEqual(res.data["income"], "5000.00")
        self.assertEqual(res.data["previous_period"]["expenses"], "60.00")
        res = self.client_a.get(
            "/api/reports/export/",
            {"start": "2026-11-01", "end": "2026-11-30"},
        )
        self.assertEqual(res.status_code, 200)
        content = res.content.decode()
        self.assertIn("5000.00", content)
        self.assertIn("Groceries,120.00", content)


class ProfileTests(ApiTestCase):
    def test_get_and_patch_profile(self):
        res = self.client_a.get("/api/profile/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["default_currency"], "INR")
        res = self.client_a.patch(
            "/api/profile/", {"default_currency": "USD"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["default_currency"], "USD")


class IsolationTests(ApiTestCase):
    """Spot-checks that every resource type 404s across users."""

    def test_all_detail_endpoints_isolated(self):
        tx = self.tx()
        transfer = Transfer.objects.create(
            user=self.user_a,
            source_account=self.checking,
            destination_account=self.savings,
            amount=D("10.00"),
            date=date(2026, 11, 10),
        )
        goal = Goal.objects.create(
            user=self.user_a, name="X", target_amount=D("100.00")
        )
        budget = Budget.objects.create(
            user=self.user_a,
            category=self.groceries,
            month=date(2026, 11, 1),
            limit=D("100.00"),
        )
        rec = RecurringTransaction.objects.create(
            user=self.user_a,
            account=self.checking,
            type="expense",
            amount=D("10.00"),
            frequency="monthly",
            start_date=date(2026, 11, 1),
            next_due=date(2026, 11, 1),
        )
        urls = [
            f"/api/transactions/{tx.id}/",
            f"/api/transfers/{transfer.id}/",
            f"/api/goals/{goal.id}/",
            f"/api/budgets/{budget.id}/",
            f"/api/recurring/{rec.id}/",
            f"/api/categories/{self.groceries.id}/",
        ]
        for url in urls:
            self.assertEqual(self.client_b.get(url).status_code, 404, url)
        # And B's lists are empty.
        for url in ("/api/transactions/", "/api/transfers/", "/api/goals/"):
            self.assertEqual(
                self.client_b.get(url).data["results"], [], url
            )


# ---------------------------------------------------------------------------
# InsForge OAuth login (POST /api/auth/insforge/)
# ---------------------------------------------------------------------------


@override_settings(
    INSFORGE_AUTH_ENABLED=True,
    INSFORGE_BASE_URL="https://test.insforge.app",
)
class InsforgeAuthTests(ApiTestCase):
    """The login-time bridge: a verified InsForge JWT starts a Django
    session. Tokens are minted here with a real RS256 keypair generated
    in-test; the JWKS fetch is mocked (no network) so the real
    signature/expiry/kid verification path is exercised.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._private_key = rsa.generate_private_key(
            public_exponent=65537, key_size=2048
        )
        cls._other_key = rsa.generate_private_key(
            public_exponent=65537, key_size=2048
        )
        jwk = json.loads(
            RSAAlgorithm.to_jwk(cls._private_key.public_key())
        )
        jwk.update({"kid": "test-key-1", "alg": "RS256", "use": "sig"})
        cls._jwk = jwk

    def setUp(self):
        super().setUp()
        self._jwks_patcher = mock.patch(
            "core.insforge_auth._fetch_jwks", return_value=[self._jwk]
        )
        self._jwks_patcher.start()
        self.addCleanup(self._jwks_patcher.stop)

    def _mint(self, sub="insforge-sub-1", email="carol@example.com",
              exp=None, kid="test-key-1", key=None, alg="RS256"):
        now = int(time.time())
        payload = {
            "sub": sub,
            "email": email,
            "role": "authenticated",
            "iat": now,
            "exp": now + 900 if exp is None else exp,
        }
        if email is None:
            del payload["email"]
        return jwt.encode(
            payload,
            key if key is not None else self._private_key,
            algorithm=alg,
            headers={"kid": kid},
        )

    def _post_token(self, token):
        return self.anon.post(
            "/api/auth/insforge/", {"access_token": token}, format="json"
        )

    def test_valid_token_creates_user_and_starts_session(self):
        res = self._post_token(self._mint())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "carol")
        self.assertIn("sessionid", res.cookies)
        user = User.objects.get(username="carol")
        self.assertTrue(hasattr(user, "profile"))
        self.assertEqual(
            Category.objects.filter(user=user, is_default=True).count(), 17
        )
        self.assertFalse(user.has_usable_password())
        identity = InsforgeIdentity.objects.get(user=user)
        self.assertEqual(identity.sub, "insforge-sub-1")
        self.assertEqual(identity.email, "carol@example.com")

    def test_same_token_twice_returns_same_user(self):
        token = self._mint()
        self.assertEqual(self._post_token(token).status_code, 200)
        res = self._post_token(token)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["id"], User.objects.get(username="carol").id)
        self.assertEqual(User.objects.filter(username="carol").count(), 1)
        self.assertEqual(InsforgeIdentity.objects.count(), 1)

    def test_session_works_after_insforge_login(self):
        self.assertEqual(self._post_token(self._mint()).status_code, 200)
        res = self.anon.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "carol")
        res = self.anon.get("/api/dashboard/")
        self.assertEqual(res.status_code, 200)

    def test_expired_token_rejected(self):
        # Expired well past the 60s clock-skew leeway (INSFORGE_JWT_LEEWAY).
        token = self._mint(exp=int(time.time()) - 120)
        self.assertEqual(self._post_token(token).status_code, 401)

    def test_wrong_signature_rejected(self):
        token = self._mint(key=self._other_key)
        self.assertEqual(self._post_token(token).status_code, 401)

    def test_hs256_token_rejected(self):
        token = self._mint(alg="HS256", key="shared-secret")
        self.assertEqual(self._post_token(token).status_code, 401)

    def test_unknown_kid_rejected(self):
        token = self._mint(kid="rotated-away-key")
        self.assertEqual(self._post_token(token).status_code, 401)

    def test_malformed_token_rejected(self):
        self.assertEqual(self._post_token("not-a-jwt").status_code, 401)

    def test_missing_token_returns_400(self):
        res = self.anon.post("/api/auth/insforge/", {}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_email_collision_returns_409(self):
        # alice@example.com already belongs to an unlinked Django user.
        token = self._mint(sub="insforge-sub-2", email="alice@example.com")
        res = self._post_token(token)
        self.assertEqual(res.status_code, 409)
        self.assertFalse(
            InsforgeIdentity.objects.filter(sub="insforge-sub-2").exists()
        )

    def test_token_without_email_still_creates_user(self):
        res = self._post_token(self._mint(email=None))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "user")

    def test_disabled_flag_returns_503(self):
        with override_settings(INSFORGE_AUTH_ENABLED=False):
            res = self._post_token(self._mint())
        self.assertEqual(res.status_code, 503)
