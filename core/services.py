"""Service layer: CSV import parsing and dashboard/report aggregates.

Kept out of views so the logic is testable without HTTP. Nothing here
logs transaction details — only counts and row numbers.
"""

import csv
import io
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from dateutil import parser as date_parser
from dateutil.relativedelta import relativedelta
from django.db.models import Q, Sum
from django.utils import timezone

from .models import ZERO, Category, Transaction

# CSV columns we understand. ``mapping`` maps a transaction field to the
# exact header text used in the uploaded file.
CSV_FIELDS = ("date", "amount", "type", "merchant", "category", "notes")

# Header names we recognise automatically (lowercased, stripped).
HEADER_ALIASES = {
    "date": {"date", "transaction date", "txn date", "posted date"},
    "amount": {"amount", "value", "price", "total"},
    "type": {"type", "transaction type", "debit/credit", "dr/cr"},
    "merchant": {"merchant", "payee", "description", "name", "narration"},
    "category": {"category", "category name"},
    "notes": {"notes", "note", "memo", "remarks"},
}

DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%Y/%m/%d",
)


def detect_mapping(headers):
    """Guess {field: header} from the file's header row."""
    lowered = {h.strip().lower(): h for h in headers if h and h.strip()}
    mapping = {}
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in lowered:
                mapping[field] = lowered[alias]
                break
    return mapping


def parse_date(raw):
    """Parse a date string; returns (date | None, error | None)."""
    text = str(raw).strip()
    if not text:
        return None, "date is required"
    for fmt in DATE_FORMATS:
        try:
            from datetime import datetime

            return datetime.strptime(text, fmt).date(), None
        except ValueError:
            continue
    try:
        return date_parser.parse(text, dayfirst=True).date(), None
    except (ValueError, OverflowError):
        return None, f"unrecognised date: {raw!r}"


_AMOUNT_CLEAN = re.compile(r"[₹$€£,\s]")


def parse_amount(raw):
    """Parse an amount; returns (Decimal | None, error | None).

    Accepts currency symbols, thousands separators and parentheses for
    negatives, e.g. "(1,250.50)" -> -1250.50. A negative amount means an
    expense (the caller infers the type from the sign when the CSV has
    no type column).
    """
    text = str(raw).strip()
    if not text:
        return None, "amount is required"
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1]
    text = _AMOUNT_CLEAN.sub("", text)
    try:
        value = Decimal(text).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None, f"unrecognised amount: {raw!r}"
    if negative:
        value = -value
    if value == 0:
        return None, "amount must not be zero"
    return value, None


def parse_type(raw):
    """Normalise a type value; returns ('income'|'expense'|None, error)."""
    text = str(raw).strip().lower()
    if not text:
        return None, None
    if text in ("income", "credit", "cr", "in", "deposit"):
        return "income", None
    if text in ("expense", "debit", "dr", "out", "withdrawal", "spending"):
        return "expense", None
    return None, f"unrecognised type: {raw!r}"


def money_str(value):
    """Render any Decimal as a 2-decimal string.

    Money is always returned as a 2-decimal string in JSON/CSV output —
    never a float, never a bare integer-looking string — so the frontend
    and CSV consumers see exact values.
    """
    return str(Decimal(str(value)).quantize(Decimal("0.01")))


def _norm_amount(value):
    """Normalise any Decimal/str amount to a 2-decimal string so keys
    compare equal regardless of how the value was written ('100' vs
    '100.00')."""
    return str(Decimal(str(value)).quantize(Decimal("0.01")))


def _duplicate_keys(user, account, rows):
    """Mark rows that duplicate another row in the file or an existing
    transaction. Key: (account, date, amount, merchant-lowercased); a
    same date+amount on the same account with a different merchant is
    still flagged as a likely duplicate.
    """
    seen_exact = set()
    seen_amount_date = set()
    existing = list(
        Transaction.objects.filter(user=user, account=account).values_list(
            "date", "amount", "merchant"
        )
    )
    existing_keys = {
        (str(d), _norm_amount(a), (m or "").strip().lower())
        for d, a, m in existing
    }
    existing_amount_date = {(str(d), _norm_amount(a)) for d, a, _ in existing}
    for row in rows:
        parsed = row.get("parsed", {})
        if row["errors"]:
            continue
        key = (
            str(parsed.get("date")),
            _norm_amount(parsed.get("amount")),
            (parsed.get("merchant") or "").strip().lower(),
        )
        amount_date = (str(parsed.get("date")), _norm_amount(parsed.get("amount")))
        duplicate = (
            key in seen_exact
            or key in existing_keys
            or amount_date in seen_amount_date
            or amount_date in existing_amount_date
        )
        row["is_duplicate"] = bool(duplicate)
        seen_exact.add(key)
        seen_amount_date.add(amount_date)


def parse_csv_text(text, user, account, mapping=None):
    """Parse CSV text into preview rows.

    Returns (rows, mapping, header_errors). Each row is a dict:
    {"row": <csv line number>, "data": {header: raw value},
     "parsed": {field: normalised value}, "errors": [...],
     "is_duplicate": bool, "selected": bool}.
    Only rows without errors and not flagged as duplicates are selected
    by default.
    """
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []
    if not headers:
        return [], {}, ["empty file: no header row found"]
    mapping = mapping or detect_mapping(headers)
    missing = [f for f in ("date", "amount") if f not in mapping]
    if missing:
        return [], mapping, [
            f"could not map required column(s): {', '.join(missing)}"
        ]

    rows = []
    for line_no, raw in enumerate(reader, start=2):
        data = {h: (raw.get(h) or "") for h in headers}
        errors = []
        parsed = {}

        value = data.get(mapping["date"], "")
        parsed_date, err = parse_date(value)
        if err:
            errors.append(err)
        else:
            parsed["date"] = parsed_date.isoformat()

        value = data.get(mapping["amount"], "")
        amount, err = parse_amount(value)
        if err:
            errors.append(err)
        else:
            parsed["amount"] = str(abs(amount))
            parsed["_signed_amount"] = str(amount)

        tx_type = None
        if "type" in mapping:
            tx_type, err = parse_type(data.get(mapping["type"], ""))
            if err:
                errors.append(err)
        if tx_type is None and amount is not None:
            tx_type = "expense" if amount < 0 else "income"
        parsed["type"] = tx_type

        parsed["merchant"] = (data.get(mapping.get("merchant", ""), "") or "").strip()
        parsed["notes"] = (data.get(mapping.get("notes", ""), "") or "").strip()
        parsed["category"] = (data.get(mapping.get("category", ""), "") or "").strip()

        rows.append(
            {
                "row": line_no,
                "data": data,
                "parsed": parsed,
                "errors": errors,
                "is_duplicate": False,
                "selected": not errors,
            }
        )

    _duplicate_keys(user, account, rows)
    for row in rows:
        if row["is_duplicate"]:
            row["selected"] = False
    return rows, mapping, []


def resolve_category(user, name, tx_type):
    """Find (or create) a category by name for the user and type."""
    name = (name or "").strip()
    if not name:
        name = "Other Income" if tx_type == "income" else "Other Expense"
    category, _ = Category.objects.get_or_create(
        user=user, name=name, type=tx_type
    )
    return category


def import_rows(user, account, rows, selected=None):
    """Create Transaction rows from parsed preview rows.

    ``selected`` is an optional list of CSV line numbers to import; by
    default every row flagged ``selected`` in the preview is imported.
    Rows with errors or flagged as duplicates are never imported.
    Returns (created_transactions, skipped_count).
    """
    created = []
    skipped = 0
    for row in rows:
        if selected is not None and row["row"] not in selected:
            skipped += 1
            continue
        if row["errors"] or row["is_duplicate"] or not row.get("selected", True):
            skipped += 1
            continue
        parsed = row["parsed"]
        created.append(
            Transaction.objects.create(
                user=user,
                account=account,
                category=resolve_category(user, parsed.get("category"), parsed["type"]),
                type=parsed["type"],
                amount=Decimal(parsed["amount"]),
                date=date.fromisoformat(parsed["date"]),
                merchant=parsed.get("merchant", ""),
                notes=parsed.get("notes", ""),
            )
        )
    return created, skipped


# ---------------------------------------------------------------------------
# Dashboard / reports
# ---------------------------------------------------------------------------

def _month_start(d):
    return d.replace(day=1)


def _month_range(start, end):
    """Yield (year, month) pairs covering [start, end]."""
    current = _month_start(start)
    last = _month_start(end)
    while current <= last:
        yield current.year, current.month
        current = current + relativedelta(months=1)


def period_totals(user, start, end):
    """Income, expenses and net cash flow for [start, end], excluding
    transfer legs."""
    agg = Transaction.objects.filter(
        user=user, is_transfer=False, date__gte=start, date__lte=end
    ).aggregate(
        income=Sum("amount", filter=Q(type="income")),
        expense=Sum("amount", filter=Q(type="expense")),
    )
    income = agg["income"] or ZERO
    expense = agg["expense"] or ZERO
    return {
        "income": money_str(income),
        "expenses": money_str(expense),
        "net": money_str(income - expense),
    }


def spending_by_category(user, start, end):
    """Expense totals per category for [start, end] (uncategorised
    grouped under 'Uncategorized')."""
    qs = (
        Transaction.objects.filter(
            user=user,
            type="expense",
            is_transfer=False,
            date__gte=start,
            date__lte=end,
        )
        .values("category__name")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )
    return [
        {
            "category": row["category__name"] or "Uncategorized",
            "total": money_str(row["total"]),
        }
        for row in qs
    ]


def monthly_series(user, start, end):
    """Income vs expenses per month covering [start, end]."""
    series = []
    for year, month in _month_range(start, end):
        m_start = date(year, month, 1)
        m_end = m_start + relativedelta(months=1) - timedelta(days=1)
        totals = period_totals(user, m_start, m_end)
        series.append(
            {
                "month": m_start.isoformat(),
                "income": totals["income"],
                "expenses": totals["expenses"],
                "net": totals["net"],
            }
        )
    return series


def dashboard_summary(user, start=None, end=None):
    """Everything the dashboard screen needs for one period."""
    today = timezone.now().date()
    end = end or today
    start = start or _month_start(today)

    accounts = list(user.accounts.filter(is_active=True))
    balances = {}
    for account in accounts:
        balances.setdefault(account.currency, ZERO)
        balances[account.currency] += account.balance()
    totals = period_totals(user, start, end)

    # Previous period of the same length, immediately before this one.
    length = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)
    previous = period_totals(user, prev_start, prev_end)

    # Recent activity includes transfer legs (flagged is_transfer=True)
    # so transfers are visible here, marked as transfers. Income,
    # expenses and net above still exclude them (see period_totals).
    recent = list(
        Transaction.objects.filter(user=user)
        .select_related("account", "category")
        .order_by("-date", "-created_at")[:10]
    )
    budgets = []
    for budget in user.budgets.filter(month=_month_start(end)).select_related(
        "category"
    ):
        spent, remaining, percent, status = budget.progress()
        budgets.append(
            {
                "budget_id": budget.id,
                "category": budget.category.name,
                "limit": money_str(budget.limit),
                "spent": money_str(spent),
                "remaining": money_str(remaining),
                "percent_used": percent,
                "status": status,
            }
        )

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "total_balances": {k: money_str(v) for k, v in balances.items()},
        # Real account count: total_balances is keyed by currency, so
        # len(total_balances) is the number of currencies, not accounts
        # (4 INR accounts used to show as "1 account").
        "account_count": len(accounts),
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
        "spending_by_category": spending_by_category(user, start, end),
        "monthly_series": monthly_series(user, start, end),
        "recent_transactions": recent,
        "budgets": budgets,
    }
