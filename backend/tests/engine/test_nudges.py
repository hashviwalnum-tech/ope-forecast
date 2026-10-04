"""Known-answer tests for engine/nudges.py.

The nudge engine had no tests of its own. It also produced only an English
sentence, so every non-English owner read their one daily heads-up in English.
Each nudge now carries the numbers behind it as `params`, which the clients
turn into a sentence in the owner's language; the English `message` stays for
the Telegram bot.
"""
from app.engine.nudges import (
    Nudge, compute_forecast_nudge, compute_stock_nudge, pick_top_nudge,
)


# ── forecast nudges ───────────────────────────────────────────────────────

def test_twenty_percent_busier_than_usual_is_a_busy_nudge():
    n = compute_forecast_nudge(tomorrow_predicted=60, tomorrow_weekday="Saturday", weekday_mean=50.0)
    assert n is not None and n.type == "busy_tomorrow"
    assert n.params == {"predicted": 60, "usual": 50}
    assert "~60" in n.message and "~50" in n.message


def test_ordinary_variation_is_not_nudged():
    # 19% over the usual is normal fluctuation for a small business.
    assert compute_forecast_nudge(59, "Saturday", 50.0) is None
    assert compute_forecast_nudge(41, "Saturday", 50.0) is None


def test_twenty_percent_quieter_than_usual_is_a_slow_nudge():
    n = compute_forecast_nudge(40, "Monday", 50.0)
    assert n is not None and n.type == "slow_tomorrow"
    assert n.params == {"predicted": 40, "usual": 50}


def test_no_history_means_no_forecast_nudge():
    assert compute_forecast_nudge(40, "Monday", 0.0) is None


# ── stock nudges ──────────────────────────────────────────────────────────

def test_order_now_beats_approaching_and_names_every_product():
    n = compute_stock_nudge([
        {"name": "Milk", "order_now": True},
        {"name": "Oat milk", "order_now": True},
        {"name": "Beans", "approaching_reorder": True},
    ])
    assert n is not None and n.type == "low_stock" and n.priority == 3
    assert n.params == {"names": ["Milk", "Oat milk"]}


def test_approaching_products_are_named():
    n = compute_stock_nudge([{"name": "Beans", "approaching_reorder": True}])
    assert n is not None and n.type == "approaching_stock"
    assert n.params == {"names": ["Beans"]}


def test_untracked_stock_never_produces_an_alert():
    # No starting count means Ope does not know the stock — it must not invent
    # a shortage.
    assert compute_stock_nudge([{"name": "Milk", "order_now": True, "stock_untracked": True}]) is None


# ── picking one ───────────────────────────────────────────────────────────

def test_the_most_urgent_nudge_wins():
    slow = Nudge(type="slow_tomorrow", message="", priority=1)
    low = Nudge(type="low_stock", message="", priority=3)
    assert pick_top_nudge([slow, low]) is low
    assert pick_top_nudge([]) is None
