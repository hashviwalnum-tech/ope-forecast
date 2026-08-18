"""The advanced planning toolbox (spec §7.5), served from the engine.

Thin handlers: validate, call `app.engine.planning`, return. No maths here.

These are calculators over numbers the owner types in — hypotheticals, not
business history — so nothing is read from or written to the database. They
still require a login, because they do real work per request and an open
compute endpoint is a surface worth not having.

The limits below exist only to bound that work. The engine has no limits of its
own by design: it is a pure function, and a caller's ceiling is not its concern.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.engine import planning

# The login requirement is declared on the router, not appended afterwards:
# router-level dependencies apply to routes registered after they are set, so
# adding them at the bottom of the file would silently protect nothing.
router = APIRouter(
    prefix="/planning",
    tags=["Planning toolbox"],
    dependencies=[Depends(get_current_user)],
)

# The UI offers at most 3 options and 6 items; these leave headroom without
# letting a request ask for an unbounded amount of work.
MAX_OPTIONS = 20
MAX_ITEMS = 20
MAX_MONEY = 1_000_000_000.0
MAX_QTY = 1_000_000.0


# ── "Which option is better?" ───────────────────────────────────────────────


class OptionIn(BaseModel):
    name: str = Field(max_length=200)
    best: float = Field(ge=-MAX_MONEY, le=MAX_MONEY)
    likely: float = Field(ge=-MAX_MONEY, le=MAX_MONEY)
    worst: float = Field(ge=-MAX_MONEY, le=MAX_MONEY)


class DecisionRequest(BaseModel):
    options: list[OptionIn] = Field(max_length=MAX_OPTIONS)
    #: Optimism, 0 (cautious) to 1 (bold). The engine clamps out-of-range values.
    optimism: float = Field(default=0.5, ge=0, le=1)


class OptionScoresOut(BaseModel):
    name: str
    ev: float
    maximin: float
    maximax: float
    hurwicz: float


class DecisionResponse(BaseModel):
    scores: list[OptionScoresOut]
    #: Options whose three estimates are out of order. When this is non-empty
    #: the client should show it and NOT present the winners below as advice.
    inverted: list[str]
    safest: str | None
    on_average: str | None
    boldest: str | None
    at_confidence: str | None


@router.post("/decision", response_model=DecisionResponse)
def compare_options(body: DecisionRequest) -> DecisionResponse:
    result = planning.compare_options(
        [planning.Option(name=o.name, best=o.best, likely=o.likely, worst=o.worst)
         for o in body.options],
        body.optimism,
    )
    return DecisionResponse(
        scores=[OptionScoresOut(**vars(s)) for s in result.scores],
        inverted=result.inverted,
        safest=result.safest,
        on_average=result.on_average,
        boldest=result.boldest,
        at_confidence=result.at_confidence,
    )


# ── "How does this ordering decision feel?" ─────────────────────────────────


class FramingRequest(BaseModel):
    order_more: float = Field(ge=0, le=MAX_QTY)
    order_less: float = Field(ge=0, le=MAX_QTY)
    sell_price: float = Field(ge=0, le=MAX_MONEY)
    cost_price: float = Field(ge=0, le=MAX_MONEY)
    expected_demand: float = Field(ge=0, le=MAX_QTY)


class FramingResponse(BaseModel):
    margin: float
    more_upside: float
    less_upside: float
    more_downside: float
    more_unsold: float
    less_missed: float
    less_short: float


@router.post("/framing", response_model=FramingResponse)
def frame_order(body: FramingRequest) -> FramingResponse:
    result = planning.frame_order(
        order_more=body.order_more,
        order_less=body.order_less,
        sell_price=body.sell_price,
        cost_price=body.cost_price,
        expected_demand=body.expected_demand,
    )
    return FramingResponse(**vars(result))


# ── "Get the most from my budget" ───────────────────────────────────────────


class BudgetItemIn(BaseModel):
    name: str = Field(max_length=200)
    cost: float = Field(ge=0, le=MAX_MONEY)
    profit: float = Field(ge=0, le=MAX_MONEY)
    max_qty: float = Field(ge=0, le=MAX_QTY)


class BudgetRequest(BaseModel):
    #: None or 0 means "no budget" — take everything worth taking.
    budget: float | None = Field(default=None, ge=0, le=MAX_MONEY)
    items: list[BudgetItemIn] = Field(max_length=MAX_ITEMS)


class AllocationOut(BaseModel):
    name: str
    qty: int
    spend: float
    earn: float


class BudgetResponse(BaseModel):
    allocation: list[AllocationOut]
    total_spend: float
    total_earn: float
    #: True when the answer is a good guess rather than the provably best one.
    approximate: bool


@router.post("/budget", response_model=BudgetResponse)
def plan_budget(body: BudgetRequest) -> BudgetResponse:
    plan = planning.plan_budget(
        body.budget,
        [planning.BudgetItem(name=i.name, cost=i.cost, profit=i.profit, max_qty=i.max_qty)
         for i in body.items],
    )
    return BudgetResponse(
        allocation=[AllocationOut(**vars(a)) for a in plan.allocation],
        total_spend=plan.total_spend,
        total_earn=plan.total_earn,
        approximate=plan.approximate,
    )
