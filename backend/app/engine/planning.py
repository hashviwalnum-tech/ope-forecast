"""The maths behind the advanced planning toolbox (spec §7.5).

Moved here from the browser. It ran in the web app, which meant the mobile app
would have had to reimplement four sets of decision rules from scratch and keep
them in step by hand — exactly what the API-first rule in CLAUDE.md exists to
prevent. The web app now calls the API for these; mobile inherits them free.

Pure functions: no DB, no framework, no I/O. Input validation and limits belong
to the route handlers, not here.

Three of the toolbox's four tools have maths. The fourth, "my action list", is
a checklist stored on the device with nothing to compute, so it has no engine
counterpart and no endpoint.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# ── Decision under uncertainty ──────────────────────────────────────────────


@dataclass(frozen=True)
class Option:
    """One course of action, with the owner's three estimates for it."""
    name: str
    best: float
    likely: float
    worst: float


@dataclass(frozen=True)
class OptionScores:
    name: str
    #: Weighted average of the three estimates — the "on average" answer.
    ev: float
    #: Worst case. Maximin picks the option whose worst case is least bad.
    maximin: float
    #: Best case. Maximax picks the option with the highest ceiling.
    maximax: float
    #: Hurwicz: alpha*best + (1-alpha)*worst.
    hurwicz: float


# Weights for the three-point estimate.
#
# The textbook PERT weighting is (worst + 4*likely + best) / 6. This uses 1-2-1
# instead, which leans less hard on the middle guess — deliberate, since an
# owner's "most likely" is a gut figure rather than a measured mode. Both are
# weighted averages of the same three numbers; neither is a true expected
# value, because that would need real probabilities. The UI says "on average"
# rather than claiming more than that.
W_WORST = 0.25
W_LIKELY = 0.5
W_BEST = 0.25


def score_option(option: Option, alpha: float) -> OptionScores:
    """Score one option. `alpha` is optimism, 0 (cautious) to 1 (bold)."""
    a = min(1.0, max(0.0, alpha))
    return OptionScores(
        name=option.name,
        ev=W_WORST * option.worst + W_LIKELY * option.likely + W_BEST * option.best,
        maximin=option.worst,
        maximax=option.best,
        hurwicz=a * option.best + (1 - a) * option.worst,
    )


def find_inverted_options(options: list[Option]) -> list[str]:
    """Options whose three estimates are out of order.

    A best case below the worst case, or a likely outside the two. Without this
    the tool answers confidently on nonsense: "playing safe" reads the
    worst-case field, so an owner who filled the columns the wrong way round is
    told to pick the option with the highest *best* case as the safe one — the
    exact opposite of the advice they asked for.
    """
    return [
        o.name for o in options
        if o.best < o.worst or o.likely > o.best or o.likely < o.worst
    ]


def _leader(scores: list[OptionScores], attr: str) -> str | None:
    """The highest-scoring option on one criterion; first wins a tie."""
    if not scores:
        return None
    best = scores[0]
    for s in scores[1:]:
        if getattr(s, attr) > getattr(best, attr):
            best = s
    return best.name


@dataclass(frozen=True)
class DecisionResult:
    scores: list[OptionScores]
    #: Names of options whose estimates are out of order — answer nothing else.
    inverted: list[str]
    safest: str | None       # maximin
    on_average: str | None   # weighted three-point estimate
    boldest: str | None      # maximax
    at_confidence: str | None  # Hurwicz at the owner's chosen optimism


def compare_options(options: list[Option], alpha: float) -> DecisionResult:
    """Score every option and name the winner under each way of deciding."""
    inverted = find_inverted_options(options)
    scores = [score_option(o, alpha) for o in options]
    return DecisionResult(
        scores=scores,
        inverted=inverted,
        safest=_leader(scores, "maximin"),
        on_average=_leader(scores, "ev"),
        boldest=_leader(scores, "maximax"),
        at_confidence=_leader(scores, "hurwicz"),
    )


# ── Gain vs loss framing (prospect theory) ──────────────────────────────────


@dataclass(frozen=True)
class FramingResult:
    margin: float
    #: Profit from the larger order when demand shows up.
    more_upside: float
    #: Profit from the smaller order when demand shows up (capped by stock).
    less_upside: float
    #: Profit from the larger order when demand disappoints — wasted stock is
    #: subtracted, so this can still be a profit, or a real loss.
    more_downside: float
    #: Units left unsold on the larger order when demand disappoints.
    more_unsold: float
    #: Profit given up by the smaller order when demand is strong.
    less_missed: float
    #: Units of demand the smaller order could not serve.
    less_short: float


def frame_order(
    order_more: float,
    order_less: float,
    sell_price: float,
    cost_price: float,
    expected_demand: float,
) -> FramingResult:
    """Both sides of an ordering decision: what it gains, and what it costs."""
    margin = sell_price - cost_price
    more_unsold = max(0.0, order_more - expected_demand)
    less_short = max(0.0, expected_demand - order_less)
    return FramingResult(
        margin=margin,
        more_upside=min(order_more, expected_demand) * margin,
        less_upside=min(order_less, expected_demand) * margin,
        more_downside=min(order_more, expected_demand) * margin - more_unsold * cost_price,
        more_unsold=more_unsold,
        less_missed=less_short * margin,
        less_short=less_short,
    )


# ── Budget allocation (spec §7.5 "linear programming") ──────────────────────


@dataclass(frozen=True)
class BudgetItem:
    name: str
    #: Cost to buy one unit.
    cost: float
    #: Profit made on one unit sold.
    profit: float
    #: Most units worth ordering.
    max_qty: float


@dataclass(frozen=True)
class Allocation:
    name: str
    qty: int
    spend: float
    earn: float


@dataclass(frozen=True)
class BudgetPlan:
    allocation: list[Allocation]
    total_spend: float
    total_earn: float
    #: True when the answer is a good guess rather than the provably best one.
    #: Only happens on inputs far larger than a small business would type.
    approximate: bool


# Work in whole units of money so the table is an integer grid. Cents, so that
# ordinary prices land on exact grid points — a coarser grid has to round each
# unit cost UP, and that rounding accumulates over dozens of units until the
# plan quietly leaves a unit's worth of budget unspent. Only a budget larger
# than any small business would type falls back to a coarser grid, and that
# case says so via `approximate`.
MAX_CELLS = 300_000

_EMPTY_PLAN = BudgetPlan(allocation=[], total_spend=0.0, total_earn=0.0, approximate=False)


def plan_budget(budget: float | None, items: list[BudgetItem]) -> BudgetPlan:
    """Spend a budget across items for the most profit, in whole units.

    Sorting by profit-per-cost and buying greedily down the list is only
    optimal when you can buy fractions of a unit. You cannot buy two-thirds of
    a crate, and once quantities are whole numbers greedy can miss badly: with
    100, item A at 60 returning 65 (ratio 1.083) and item B at 50 returning 50
    (ratio 1.00), greedy buys one A for 65 profit and then cannot afford a B —
    while two Bs would have returned 100. That is 35% of the profit left on the
    table, presented as "what to order" with no hint it was a guess.

    This solves it exactly instead, as a bounded knapsack. Quantities are split
    into powers of two so any count up to max_qty can still be formed, which
    keeps it fast enough to answer as the owner types.
    """
    usable = [it for it in items if it.cost > 0 and it.profit > 0 and it.max_qty >= 1]
    if not usable:
        return _EMPTY_PLAN

    # No budget: nothing is scarce, so take everything worth taking.
    if budget is None or budget <= 0:
        allocation = [
            Allocation(
                name=it.name,
                qty=math.floor(it.max_qty),
                spend=math.floor(it.max_qty) * it.cost,
                earn=math.floor(it.max_qty) * it.profit,
            )
            for it in usable
        ]
        return BudgetPlan(
            allocation=allocation,
            total_spend=sum(a.spend for a in allocation),
            total_earn=sum(a.earn for a in allocation),
            approximate=False,
        )

    step = max(0.01, budget / MAX_CELLS)
    cap = math.floor(budget / step + 1e-6)

    # Round each cost UP to a whole step, so a plan can never exceed the budget.
    cells: list[tuple[int, int, int, float]] = []   # (item index, qty, cost, profit)
    for i, it in enumerate(usable):
        unit_cost = math.ceil(it.cost / step - 1e-6)
        if unit_cost <= 0 or unit_cost > cap:
            continue
        affordable = min(math.floor(it.max_qty), cap // unit_cost)
        # Powers of two, then the remainder — any quantity up to `affordable`
        # is then reachable as a sum of these, so nothing is lost by splitting.
        left = affordable
        k = 1
        while left > 0:
            take = min(k, left)
            cells.append((i, take, take * unit_cost, take * it.profit))
            left -= take
            k *= 2

    if not cells:
        return _EMPTY_PLAN

    n_cells = len(cells)
    best = [0.0] * (cap + 1)
    # took[c * n_cells + j] — whether pseudo-item j was taken at capacity c.
    # A bytearray rather than a list of bools: the table can reach tens of
    # millions of entries, and one byte each keeps that in megabytes.
    took = bytearray((cap + 1) * n_cells)

    for j, (_item, _qty, cost, profit) in enumerate(cells):
        for c in range(cap, cost - 1, -1):
            candidate = best[c - cost] + profit
            if candidate > best[c] + 1e-9:
                best[c] = candidate
                took[c * n_cells + j] = 1

    # Walk the decisions back to recover how many of each item to buy.
    qty = [0] * len(usable)
    c = cap
    for j in range(n_cells - 1, -1, -1):
        item, take, cost, _profit = cells[j]
        if c >= cost and took[c * n_cells + j]:
            qty[item] += take
            c -= cost

    allocation = [
        Allocation(name=it.name, qty=qty[i], spend=qty[i] * it.cost, earn=qty[i] * it.profit)
        for i, it in enumerate(usable)
        if qty[i] > 0
    ]
    # Biggest commitment first, so the owner reads the important line first.
    # Stable, so equal spends keep the order the items were given in.
    allocation.sort(key=lambda a: a.spend, reverse=True)

    return BudgetPlan(
        allocation=allocation,
        total_spend=sum(a.spend for a in allocation),
        total_earn=sum(a.earn for a in allocation),
        # Costs were rounded up to a whole step. At cent granularity that is
        # exact for any ordinary price; only a very large budget coarsens it.
        approximate=step > 0.01 + 1e-9,
    )
