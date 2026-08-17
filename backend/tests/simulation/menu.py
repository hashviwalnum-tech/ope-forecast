"""
The simulated burger restaurant's menu, and the product-similarity matrix that
drives substitution (spec §6.6).

This module is part of the ANSWER KEY.  Nothing under ``backend/app/`` may
import it, and no engine fix may be justified by any constant defined here.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class MenuItem:
    key: str
    name: str
    category: str                 # "main" | "side" | "drink" | "dessert" | "service"
    unit: str
    product_type: str = "stocked"   # "stocked" | "service"
    unit_mode: str = "whole"        # "whole" | "decimal"
    price: float = 0.0
    lead_time_days: int | None = 2
    shelf_life_days: int | None = None
    storage_capacity: float | None = None
    service_time_minutes: float | None = None
    base_share: float = 0.0         # share within its own category
    # For services only: {consumable_key: units_used_per_performance}
    consumables: dict[str, float] = field(default_factory=dict)


# ── The menu ──────────────────────────────────────────────────────────────────
# A realistic New York burger restaurant: four mains, three sides (one sold by
# weight to exercise decimal units), two drinks, a dessert, and one service-type
# product (a booked party package) which draws down stocked consumables.

MENU: list[MenuItem] = [
    MenuItem("classic_burger", "Classic Beef Burger", "main", "burgers",
             price=12.50, lead_time_days=2, shelf_life_days=4,
             storage_capacity=900, service_time_minutes=6.0, base_share=0.34),
    MenuItem("double_burger", "Double Beef Burger", "main", "burgers",
             price=16.00, lead_time_days=2, shelf_life_days=4,
             storage_capacity=600, service_time_minutes=7.0, base_share=0.26),
    MenuItem("chicken_burger", "Crispy Chicken Burger", "main", "burgers",
             price=13.00, lead_time_days=2, shelf_life_days=3,
             storage_capacity=500, service_time_minutes=6.0, base_share=0.25),
    MenuItem("veggie_burger", "Veggie Burger", "main", "burgers",
             price=11.50, lead_time_days=3, shelf_life_days=5,
             storage_capacity=300, service_time_minutes=5.0, base_share=0.15),

    MenuItem("fries", "Fries", "side", "portions",
             price=4.50, lead_time_days=2, shelf_life_days=30,
             storage_capacity=1400, service_time_minutes=2.0, base_share=0.62),
    MenuItem("onion_rings", "Onion Rings", "side", "portions",
             price=5.00, lead_time_days=2, shelf_life_days=30,
             storage_capacity=500, service_time_minutes=2.0, base_share=0.24),
    MenuItem("coleslaw", "Coleslaw", "side", "kg", unit_mode="decimal",
             price=9.00, lead_time_days=1, shelf_life_days=3,
             storage_capacity=60, service_time_minutes=1.5, base_share=0.14),

    MenuItem("soft_drink", "Soft Drink", "drink", "cups",
             price=3.00, lead_time_days=4, shelf_life_days=180,
             storage_capacity=2500, service_time_minutes=1.0, base_share=0.72),
    MenuItem("milkshake", "Milkshake", "drink", "cups",
             price=6.50, lead_time_days=3, shelf_life_days=10,
             storage_capacity=400, service_time_minutes=3.0, base_share=0.28),

    MenuItem("brownie_sundae", "Brownie Sundae", "dessert", "portions",
             price=7.00, lead_time_days=3, shelf_life_days=7,
             storage_capacity=350, service_time_minutes=2.5, base_share=1.0),

    MenuItem("party_package", "Birthday Party Package", "service", "bookings",
             product_type="service", price=180.00, lead_time_days=None,
             shelf_life_days=None, storage_capacity=None,
             service_time_minutes=75.0, base_share=1.0,
             consumables={"brownie_sundae": 8.0, "soft_drink": 12.0, "fries": 8.0}),
]

BY_KEY: dict[str, MenuItem] = {m.key: m for m in MENU}
MAINS = [m.key for m in MENU if m.category == "main"]
SIDES = [m.key for m in MENU if m.category == "side"]
DRINKS = [m.key for m in MENU if m.category == "drink"]
DESSERTS = [m.key for m in MENU if m.category == "dessert"]
SERVICES = [m.key for m in MENU if m.category == "service"]


# ── Similarity / substitution matrix (spec §6.6) ──────────────────────────────
# S[a][b] = how strongly a high day for product *b* pulls product *a* down.
# 1.0 would be perfect substitution; 0.0 means unrelated.  Symmetric by
# construction below.  Only non-zero pairs are listed.
_SIMILARITY_PAIRS: dict[tuple[str, str], float] = {
    # Two beef burgers — very close substitutes.
    ("classic_burger", "double_burger"): 0.70,
    # Beef vs chicken — moderately close.
    ("classic_burger", "chicken_burger"): 0.40,
    ("double_burger", "chicken_burger"): 0.35,
    # Veggie is its own crowd; mildly related to chicken, barely to beef.
    ("veggie_burger", "chicken_burger"): 0.25,
    ("veggie_burger", "classic_burger"): 0.10,
    ("veggie_burger", "double_burger"): 0.08,
    # Sides.
    ("fries", "onion_rings"): 0.55,
    ("fries", "coleslaw"): 0.20,
    ("onion_rings", "coleslaw"): 0.15,
    # Drinks.
    ("soft_drink", "milkshake"): 0.30,
    # Milkshake competes a little with dessert.
    ("milkshake", "brownie_sundae"): 0.25,
    # Cross-category: a burger and its fries are complements, not substitutes,
    # so similarity is 0 (left out) — distant products do not move together.
}


def similarity_matrix() -> dict[str, dict[str, float]]:
    """Symmetric substitution matrix over every menu key, zero diagonal."""
    keys = [m.key for m in MENU]
    s = {a: {b: 0.0 for b in keys} for a in keys}
    for (a, b), v in _SIMILARITY_PAIRS.items():
        s[a][b] = v
        s[b][a] = v
    return s


# ── Basket model ──────────────────────────────────────────────────────────────
# A customer's basket is assembled independently per category.  These rates make
# products-per-customer > 1 (a customer buys a burger AND fries AND a drink),
# which the app must tolerate (spec: products vs customers is not hard-bound),
# and leave a small share of customers buying nothing at all.
P_BUYS_MAIN = 0.88
P_BUYS_SIDE = 0.62
P_BUYS_DRINK = 0.70
P_BUYS_DESSERT = 0.18
P_BOOKS_SERVICE = 0.004

P_MAIN_QTY2 = 0.08
P_SIDE_QTY2 = 0.10
P_DRINK_QTY2 = 0.15

COLESLAW_PORTIONS = (0.25, 0.5, 1.0)
COLESLAW_PORTION_WEIGHTS = (0.45, 0.40, 0.15)

# Probability a customer buys literally nothing, given the rates above:
#   (1-.88)(1-.62)(1-.70)(1-.18)(1-.004) ≈ 0.0112  → ~1.1% of customers.
