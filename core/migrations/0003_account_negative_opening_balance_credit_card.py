"""Allow a negative opening balance on credit-card accounts.

The old ``MinValueValidator(0)`` on ``Account.opening_balance`` blocked
a credit card from opening with the amount already owed, even though
the page says a negative balance means "amount owed" and the computed
balance already supports going negative via expenses. The validator is
removed from the field; the rule now lives in ``Account.clean()``:
negative opening balances are allowed only for credit cards.
"""

from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_insforgeidentity"),
    ]

    operations = [
        migrations.AlterField(
            model_name="account",
            name="opening_balance",
            field=models.DecimalField(
                decimal_places=2, default=Decimal("0.00"), max_digits=12
            ),
        ),
    ]
