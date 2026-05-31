"""
Monthly aggregation engine.
Pure functions — no DB, no framework imports.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date as date_type

_MONTH_NAMES = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]


def monthly_summary(
    day_data: list[tuple[date_type, float]],
) -> list[dict]:
    """Aggregate clean daily observations into per-month summaries.

    Args:
        day_data: list of (date, effective_customers).  Missing days must be
                  absent — they are NOT zero-filled.  Outlier replacement and
                  event/closed-day exclusion must be applied by the caller
                  before passing data here.

    Returns:
        Sorted ascending list of dicts, one per calendar month that contains
        at least one observation:
            year, month, month_label, total_customers, logged_days,
            avg_daily_customers, mom_pct_change (None for the first month).
        mom_pct_change uses avg_daily_customers so months with different
        numbers of logged days are comparable.
    """
    if not day_data:
        return []

    buckets: dict[tuple[int, int], list[float]] = defaultdict(list)
    for d, customers in day_data:
        buckets[(d.year, d.month)].append(customers)

    months: list[dict] = []
    for (year, month) in sorted(buckets.keys()):
        values = buckets[(year, month)]
        total = sum(values)
        logged = len(values)
        avg = total / logged
        months.append({
            'year': year,
            'month': month,
            'month_label': f"{_MONTH_NAMES[month]} {year}",
            'total_customers': round(total, 1),
            'logged_days': logged,
            'avg_daily_customers': round(avg, 1),
            'mom_pct_change': None,
        })

    for i in range(1, len(months)):
        prev_avg = months[i - 1]['avg_daily_customers']
        if prev_avg > 0:
            change = (months[i]['avg_daily_customers'] - prev_avg) / prev_avg * 100
            months[i]['mom_pct_change'] = round(change, 1)

    return months
