"""Batch B regression tests.

- Credit-card accounts may open with a negative balance (the amount
  already owed); every other account type still may not.
- Transfer legs appear in dashboard Recent activity, still flagged
  ``is_transfer`` and still excluded from income/expense totals.
- A transfer's note is copied onto both ledger legs, so account
  history (which serialises the legs) carries it.

Run:  DATABASE_URL= .venv/bin/python manage.py test core
"""

from datetime import date
from decimal import Decimal

from .models import Account, Transfer
from .tests import ApiTestCase

D = Decimal


class NegativeOpeningBalanceTests(ApiTestCase):
    def test_credit_card_may_open_negative_via_api(self):
        res = self.client_a.post(
            "/api/accounts/",
            {
                "name": "HDFC Card",
                "type": "credit_card",
                "currency": "INR",
                "opening_balance": "-1250.50",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["opening_balance"], "-1250.50")
        self.assertEqual(res.data["balance"], "-1250.50")

    def test_negative_opening_balance_rejected_for_other_types(self):
        for account_type in ("checking", "savings", "cash"):
            res = self.client_a.post(
                "/api/accounts/",
                {
                    "name": f"Negative {account_type}",
                    "type": account_type,
                    "currency": "INR",
                    "opening_balance": "-1.00",
                },
                format="json",
            )
            self.assertEqual(res.status_code, 400, account_type)
            self.assertIn("opening_balance", res.data, account_type)

    def test_negative_opening_balance_still_counts_in_balance(self):
        # Opening -500, then a 200.00 expense on the card: balance -700.
        res = self.client_a.post(
            "/api/accounts/",
            {
                "name": "Owed Card",
                "type": "credit_card",
                "currency": "INR",
                "opening_balance": "-500.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        card_id = res.data["id"]
        res = self.client_a.post(
            "/api/transactions/",
            {
                "account": card_id,
                "category": self.groceries.id,
                "type": "expense",
                "amount": "200.00",
                "date": "2026-11-10",
                "merchant": "BigBasket",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        res = self.client_a.get(f"/api/accounts/{card_id}/")
        self.assertEqual(res.data["balance"], "-700.00")

    def test_changing_type_to_checking_with_negative_opening_rejected(self):
        res = self.client_a.post(
            "/api/accounts/",
            {
                "name": "Switch Card",
                "type": "credit_card",
                "currency": "INR",
                "opening_balance": "-100.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        res = self.client_a.patch(
            f"/api/accounts/{res.data['id']}/",
            {"type": "checking"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("opening_balance", res.data)


class TransferVisibilityTests(ApiTestCase):
    def _make_transfer(self):
        return Transfer.objects.create(
            user=self.user_a,
            source_account=self.checking,
            destination_account=self.savings,
            amount=D("200.00"),
            date=date(2026, 11, 10),
            note="monthly save",
        )

    def test_transfer_legs_appear_in_dashboard_recent_activity(self):
        self._make_transfer()
        res = self.client_a.get(
            "/api/dashboard/",
            {"start": "2026-11-01", "end": "2026-11-30"},
        )
        self.assertEqual(res.status_code, 200)
        legs = [
            r
            for r in res.data["recent_transactions"]
            if r["is_transfer"]
        ]
        self.assertEqual(len(legs), 2)
        self.assertEqual(
            {r["merchant"] for r in legs},
            {"Transfer to Savings", "Transfer from Checking"},
        )
        # Totals still exclude the transfer entirely.
        self.assertEqual(res.data["income"], "0.00")
        self.assertEqual(res.data["expenses"], "0.00")
        self.assertEqual(res.data["net"], "0.00")

    def test_transfer_note_is_on_both_legs_in_account_history(self):
        self._make_transfer()
        res = self.client_a.get(f"/api/accounts/{self.checking.id}/history/")
        legs = [r for r in res.data["results"] if r["is_transfer"]]
        self.assertEqual(len(legs), 1)
        self.assertEqual(legs[0]["notes"], "monthly save")
        res = self.client_a.get(f"/api/accounts/{self.savings.id}/history/")
        legs = [r for r in res.data["results"] if r["is_transfer"]]
        self.assertEqual(len(legs), 1)
        self.assertEqual(legs[0]["notes"], "monthly save")

    def test_transfer_legs_listed_with_include_transfers(self):
        self._make_transfer()
        res = self.client_a.get(
            "/api/transactions/", {"include_transfers": "true"}
        )
        self.assertEqual(len(res.data["results"]), 2)
        self.assertTrue(all(r["is_transfer"] for r in res.data["results"]))
        self.assertTrue(all(r["notes"] == "monthly save" for r in res.data["results"]))
