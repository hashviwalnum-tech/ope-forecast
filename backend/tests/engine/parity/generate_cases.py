"""Generate the shared input cases for the browser-vs-engine parity check.

The planning maths moved from the browser to backend/app/engine/planning.py.
"Ported faithfully" is a claim worth proving rather than asserting, so both
implementations are run over the same inputs and the outputs are diffed.

Usage (from backend/):
    python -m tests.engine.parity.generate_cases > cases.json

Deterministic: the same seed gives the same cases every run, so a failure can
be reproduced exactly.
"""
from __future__ import annotations

import json
import random
import sys


def build() -> dict[str, list]:
    rng = random.Random("ope-planning-parity-v1")

    def r(lo: float, hi: float, dp: int = 2) -> float:
        return round(rng.uniform(lo, hi), dp)

    # ── decision under uncertainty ──────────────────────────────────────────
    decision: list[dict] = []

    # The worked examples the browser tests already pinned.
    decision.append({
        "alpha": 0.5,
        "options": [{"name": "A", "worst": 100, "likely": 250, "best": 400}],
    })
    for alpha in (0.0, 0.3, 0.5, 1.0, -1.0, 2.0):   # includes out-of-range
        decision.append({
            "alpha": alpha,
            "options": [{"name": "A", "worst": 100, "likely": 250, "best": 400}],
        })
    # Inverted and degenerate inputs.
    decision.append({"alpha": 0.5, "options": [
        {"name": "Stay open late", "worst": 400, "likely": 250, "best": 100}]})
    decision.append({"alpha": 0.5, "options": [
        {"name": "A", "worst": 100, "likely": 500, "best": 400}]})
    decision.append({"alpha": 0.5, "options": [
        {"name": "D", "worst": 200, "likely": 200, "best": 200}]})
    decision.append({"alpha": 0.5, "options": []})
    # Ties, so the tie-break rule is compared too.
    decision.append({"alpha": 0.5, "options": [
        {"name": "First", "worst": 10, "likely": 20, "best": 30},
        {"name": "Second", "worst": 10, "likely": 20, "best": 30}]})
    # Negative outcomes — a worst case can be a loss.
    decision.append({"alpha": 0.5, "options": [
        {"name": "Risky", "worst": -500, "likely": 100, "best": 900},
        {"name": "Safe", "worst": 0, "likely": 50, "best": 120}]})

    for _ in range(250):
        n = rng.randint(2, 3)
        opts = []
        for i in range(n):
            worst = r(-200, 300)
            likely = round(worst + rng.uniform(0, 300), 2)
            best = round(likely + rng.uniform(0, 300), 2)
            opts.append({"name": f"opt{i}", "worst": worst, "likely": likely, "best": best})
        decision.append({"alpha": round(rng.random(), 3), "options": opts})

    # ── gain vs loss framing ────────────────────────────────────────────────
    framing: list[dict] = [
        {"order_more": 80, "order_less": 50, "sell_price": 5,
         "cost_price": 2.5, "expected_demand": 65},
        {"order_more": 200, "order_less": 50, "sell_price": 5,
         "cost_price": 2.5, "expected_demand": 65},
        {"order_more": 65, "order_less": 65, "sell_price": 5,
         "cost_price": 2.5, "expected_demand": 65},
        # Margin of zero, and a negative margin (selling at a loss).
        {"order_more": 80, "order_less": 50, "sell_price": 2.5,
         "cost_price": 2.5, "expected_demand": 65},
        {"order_more": 80, "order_less": 50, "sell_price": 2,
         "cost_price": 3, "expected_demand": 65},
        # Zero demand, and zero orders.
        {"order_more": 80, "order_less": 50, "sell_price": 5,
         "cost_price": 2.5, "expected_demand": 0},
        {"order_more": 0, "order_less": 0, "sell_price": 5,
         "cost_price": 2.5, "expected_demand": 65},
    ]
    for _ in range(250):
        cost = r(0.5, 40)
        framing.append({
            "order_more": rng.randint(1, 500),
            "order_less": rng.randint(1, 500),
            "sell_price": round(cost + rng.uniform(-5, 40), 2),
            "cost_price": cost,
            "expected_demand": rng.randint(0, 500),
        })

    # ── budget allocation ───────────────────────────────────────────────────
    budget: list[dict] = [
        # The case greedy got 35% wrong.
        {"budget": 100, "items": [
            {"name": "A", "cost": 60, "profit": 65, "max_qty": 1},
            {"name": "B", "cost": 50, "profit": 50, "max_qty": 2}]},
        # The one where mixing beats loading up on the better ratio.
        {"budget": 500, "items": [
            {"name": "Flowers", "cost": 12, "profit": 13, "max_qty": 40},
            {"name": "Vases", "cost": 100, "profit": 95, "max_qty": 5}]},
        # No budget at all.
        {"budget": None, "items": [
            {"name": "Cake", "cost": 7, "profit": 8, "max_qty": 12},
            {"name": "Coffee", "cost": 3, "profit": 3.2, "max_qty": 30}]},
        # Budget too small for anything.
        {"budget": 2, "items": [{"name": "Cake", "cost": 7, "profit": 8, "max_qty": 12}]},
        # Items that must be ignored rather than treated as free.
        {"budget": 100, "items": [
            {"name": "Good", "cost": 10, "profit": 5, "max_qty": 5},
            {"name": "NoCost", "cost": 0, "profit": 5, "max_qty": 5},
            {"name": "NoProfit", "cost": 10, "profit": 0, "max_qty": 5},
            {"name": "NoQty", "cost": 10, "profit": 5, "max_qty": 0}]},
        # Nothing usable at all.
        {"budget": 100, "items": []},
        # A quantity limit that binds before the budget does.
        {"budget": 1000, "items": [{"name": "Rare", "cost": 50, "profit": 80, "max_qty": 3}]},
        # Equal spends, so the sort tie-break is compared.
        {"budget": 100, "items": [
            {"name": "X", "cost": 25, "profit": 30, "max_qty": 2},
            {"name": "Y", "cost": 50, "profit": 60, "max_qty": 1}]},
        # Large enough to coarsen the grid — exercises `approximate`.
        {"budget": 50_000, "items": [
            {"name": "Bulk", "cost": 120.55, "profit": 130.25, "max_qty": 500},
            {"name": "Small", "cost": 3.33, "profit": 3.9, "max_qty": 2000}]},
        # Fractional prices, where the cents grid matters.
        {"budget": 250, "items": [
            {"name": "A", "cost": 1.99, "profit": 2.35, "max_qty": 200},
            {"name": "B", "cost": 7.49, "profit": 8.6, "max_qty": 60}]},
    ]
    for _ in range(200):
        n = rng.randint(1, 4)
        items = [{
            "name": f"i{i}",
            "cost": r(0.5, 60),
            "profit": r(0.1, 70),
            "max_qty": rng.randint(0, 40),
        } for i in range(n)]
        budget.append({
            "budget": None if rng.random() < 0.05 else rng.randint(1, 1200),
            "items": items,
        })

    return {"decision": decision, "framing": framing, "budget": budget}


if __name__ == "__main__":
    json.dump(build(), sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")
