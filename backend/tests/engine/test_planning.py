"""Known-answer tests for the advanced planning toolbox (spec §11, §12).

Ported from web/src/lib/planningTools.test.ts when the maths moved out of the
browser. Every expected answer is worked by hand here rather than taken from
what the code returns.

Parity with the browser version it replaced is proved separately and
end-to-end by tests/engine/parity/ — 730 shared cases, diffed.
"""
from __future__ import annotations

import random

import pytest

from app.engine.planning import (
    Allocation, BudgetItem, Option, compare_options, find_inverted_options,
    frame_order, plan_budget, score_option,
)


def opt(name: str, worst: float, likely: float, best: float) -> Option:
    return Option(name=name, worst=worst, likely=likely, best=best)


def item(name: str, cost: float, profit: float, max_qty: float) -> BudgetItem:
    return BudgetItem(name=name, cost=cost, profit=profit, max_qty=max_qty)


def qty_of(plan, name: str) -> int:
    return next((a.qty for a in plan.allocation if a.name == name), 0)


# ── decision under uncertainty ──────────────────────────────────────────────

def test_maximin_is_the_worst_case_and_maximax_the_best_case():
    s = score_option(opt("A", 100, 250, 400), 0.5)
    assert s.maximin == 100
    assert s.maximax == 400


def test_the_average_weights_worst_likely_best_25_50_25():
    # 0.25*100 + 0.50*250 + 0.25*400 = 25 + 125 + 100 = 250
    assert score_option(opt("A", 100, 250, 400), 0.5).ev == 250


def test_hurwicz_at_full_optimism_is_the_best_case_and_at_zero_the_worst():
    assert score_option(opt("A", 100, 250, 400), 1).hurwicz == 400
    assert score_option(opt("A", 100, 250, 400), 0).hurwicz == 100
    # alpha=0.5 -> 0.5*400 + 0.5*100 = 250
    assert score_option(opt("A", 100, 250, 400), 0.5).hurwicz == 250
    # alpha=0.3 -> 0.3*400 + 0.7*100 = 120 + 70 = 190
    assert score_option(opt("A", 100, 250, 400), 0.3).hurwicz == pytest.approx(190)


def test_an_out_of_range_optimism_setting_is_clamped_not_extrapolated():
    assert score_option(opt("A", 100, 250, 400), 2).hurwicz == 400
    assert score_option(opt("A", 100, 250, 400), -1).hurwicz == 100


def test_estimates_entered_the_wrong_way_round_are_caught_not_answered():
    """"Playing safe" reads the worst-case field, so an owner who fills best
    and worst the wrong way round would be told to pick the option with the
    highest BEST case as the safest one."""
    assert find_inverted_options([opt("Stay open late", 400, 250, 100)]) == ["Stay open late"]
    assert find_inverted_options([opt("A", 100, 500, 400)]) == ["A"]   # likely above best
    assert find_inverted_options([opt("B", 100, 50, 400)]) == ["B"]    # likely below worst
    assert find_inverted_options([opt("C", 100, 250, 400)]) == []
    # A certain outcome is not an error.
    assert find_inverted_options([opt("D", 200, 200, 200)]) == []


def test_each_way_of_deciding_names_its_own_winner():
    result = compare_options([
        opt("Risky", -500, 100, 900),
        opt("Safe", 0, 50, 120),
    ], 0.5)
    assert result.safest == "Safe"       # least bad worst case
    assert result.boldest == "Risky"     # highest ceiling
    # Risky: 0.25*-500 + 0.5*100 + 0.25*900 = -125 + 50 + 225 = 150
    # Safe:  0.25*0    + 0.5*50  + 0.25*120 = 0 + 25 + 30 = 55
    assert result.on_average == "Risky"
    # Hurwicz at 0.5 — Risky: 200, Safe: 60
    assert result.at_confidence == "Risky"


def test_a_tie_goes_to_the_option_listed_first():
    result = compare_options([
        opt("First", 10, 20, 30),
        opt("Second", 10, 20, 30),
    ], 0.5)
    assert result.safest == "First"
    assert result.on_average == "First"
    assert result.boldest == "First"


def test_no_options_yields_no_winners_rather_than_an_error():
    result = compare_options([], 0.5)
    assert result.scores == []
    assert result.safest is None and result.boldest is None


# ── gain vs loss framing ────────────────────────────────────────────────────

def test_ordering_more_earns_more_when_demand_shows_up_capped_by_demand():
    # sell 5, cost 2.50 -> margin 2.50; demand 65
    r = frame_order(order_more=80, order_less=50, sell_price=5,
                    cost_price=2.5, expected_demand=65)
    assert r.margin == 2.5
    assert r.more_upside == 65 * 2.5      # 162.50 — only the 65 who came
    assert r.less_upside == 50 * 2.5      # 125.00 — ran out after 50


def test_the_downside_of_over_ordering_subtracts_the_cost_of_what_went_unsold():
    r = frame_order(order_more=80, order_less=50, sell_price=5,
                    cost_price=2.5, expected_demand=65)
    # 65 sold x 2.50 margin = 162.50, minus 15 unsold x 2.50 cost = 37.50 -> 125
    assert r.more_downside == 125
    assert r.more_unsold == 15
    # Still a PROFIT. The UI must not print it as a loss.
    assert r.more_downside > 0


def test_over_ordering_far_enough_really_does_turn_into_a_loss():
    r = frame_order(order_more=200, order_less=50, sell_price=5,
                    cost_price=2.5, expected_demand=65)
    # 162.50 earned, 135 unsold x 2.50 = 337.50 wasted -> -175
    assert r.more_downside == -175


def test_under_ordering_gives_up_the_margin_on_customers_turned_away():
    r = frame_order(order_more=80, order_less=50, sell_price=5,
                    cost_price=2.5, expected_demand=65)
    assert r.less_short == 15
    assert r.less_missed == 15 * 2.5      # 37.50


def test_nothing_is_missed_or_wasted_when_the_order_matches_demand_exactly():
    r = frame_order(order_more=65, order_less=65, sell_price=5,
                    cost_price=2.5, expected_demand=65)
    assert r.more_unsold == 0
    assert r.less_short == 0
    assert r.less_missed == 0
    assert r.more_downside == r.more_upside


# ── budget allocation ───────────────────────────────────────────────────────

def test_the_case_the_old_greedy_version_got_35_percent_wrong():
    # 100. A: 60 -> 65 profit (ratio 1.083). B: 50 -> 50 profit (ratio 1.00).
    # Greedy takes the better ratio first: one A for 65, then cannot afford a B.
    # Two Bs cost exactly 100 and return 100.
    plan = plan_budget(100, [item("A", 60, 65, 1), item("B", 50, 50, 2)])
    assert plan.total_earn == 100
    assert qty_of(plan, "B") == 2
    assert qty_of(plan, "A") == 0
    assert plan.total_spend <= 100


def test_a_mixed_plan_is_found_when_mixing_beats_loading_up_on_one_item():
    # 500. Flowers 12 -> 13 (ratio 1.083, up to 40). Vases 100 -> 95 (0.95, up to 5).
    # All-flowers: 40 x 12 = 480 spent, 520 profit, 20 idle.
    # 33 flowers (396) + 1 vase (100) = 496 spent, 429 + 95 = 524.
    plan = plan_budget(500, [item("Flowers", 12, 13, 40), item("Vases", 100, 95, 5)])
    assert plan.total_earn == pytest.approx(524)
    assert qty_of(plan, "Flowers") == 33
    assert qty_of(plan, "Vases") == 1
    assert plan.total_spend <= 500


@pytest.mark.parametrize("budget", [1, 7, 33, 90, 250, 1000])
def test_the_budget_is_never_exceeded(budget):
    plan = plan_budget(budget, [
        item("Cake", 7, 8, 12), item("Coffee", 3, 3.2, 30), item("Tart", 11, 12.5, 8),
    ])
    assert plan.total_spend <= budget + 1e-6


def test_a_budget_too_small_for_anything_returns_an_empty_plan():
    plan = plan_budget(2, [item("Cake", 7, 8, 12)])
    assert plan.allocation == []
    assert plan.total_earn == 0


def test_with_no_budget_set_everything_worth_ordering_is_ordered():
    plan = plan_budget(None, [item("Cake", 7, 8, 12), item("Coffee", 3, 3.2, 30)])
    assert qty_of(plan, "Cake") == 12
    assert qty_of(plan, "Coffee") == 30
    assert plan.total_earn == pytest.approx(12 * 8 + 30 * 3.2)


def test_items_with_a_missing_or_nonsensical_figure_are_left_out():
    plan = plan_budget(100, [
        item("Good", 10, 5, 5),
        item("NoCost", 0, 5, 5),
        item("NoProfit", 10, 0, 5),
        item("NoQty", 10, 5, 0),
    ])
    assert [a.name for a in plan.allocation] == ["Good"]


def test_quantity_limits_are_respected():
    # Budget would buy 20, but only 3 are available.
    plan = plan_budget(1000, [item("Rare", 50, 80, 3)])
    assert qty_of(plan, "Rare") == 3
    assert plan.total_spend == 150


def test_an_ordinary_small_business_budget_is_solved_exactly():
    plan = plan_budget(500, [item("Flowers", 12, 13, 40), item("Vases", 100, 95, 5)])
    assert plan.approximate is False


def test_a_very_large_budget_says_so_rather_than_pretending_to_be_exact():
    plan = plan_budget(50_000, [
        item("Bulk", 120.55, 130.25, 500), item("Small", 3.33, 3.9, 2000),
    ])
    assert plan.approximate is True


def test_the_biggest_commitment_is_listed_first():
    plan = plan_budget(500, [item("Flowers", 12, 13, 40), item("Vases", 100, 95, 5)])
    spends = [a.spend for a in plan.allocation]
    assert spends == sorted(spends, reverse=True)


def test_the_answer_beats_plain_greedy_across_many_random_cases():
    """Greedy is what the tool used to do. It is a valid plan, never a better one."""
    def greedy(budget: float, items: list[BudgetItem]) -> float:
        left, earn = budget, 0.0
        for it in sorted(items, key=lambda x: x.profit / x.cost, reverse=True):
            n = min(int(it.max_qty), int(left // it.cost))
            if n > 0:
                earn += n * it.profit
                left -= n * it.cost
        return earn

    rng = random.Random(12345)
    improved = 0
    for _ in range(150):
        items = [item(f"i{i}", rng.randint(1, 40), rng.randint(1, 50), rng.randint(1, 10))
                 for i in range(3)]
        budget = rng.randint(1, 300)
        plan = plan_budget(budget, items)
        g = greedy(budget, items)
        assert plan.total_spend <= budget + 1e-6, "over budget"
        assert plan.total_earn >= g - 1e-6, f"worse than greedy at budget {budget}"
        if plan.total_earn > g + 1e-6:
            improved += 1
    # If this never fired, the comparison would be proving nothing.
    assert improved > 0


def test_the_reported_totals_match_the_plan_it_printed():
    plan = plan_budget(500, [item("Flowers", 12, 13, 40), item("Vases", 100, 95, 5)])
    assert plan.total_spend == pytest.approx(sum(a.spend for a in plan.allocation))
    assert plan.total_earn == pytest.approx(sum(a.earn for a in plan.allocation))
    assert all(isinstance(a, Allocation) for a in plan.allocation)
