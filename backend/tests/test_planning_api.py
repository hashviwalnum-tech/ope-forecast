"""The planning toolbox endpoints.

The maths itself is covered by tests/engine/test_planning.py and its parity
against the old browser version by tests/engine/parity/. What matters here is
the layer around it: that the handlers stay thin, that nonsense is rejected
before the engine sees it, and that the routes are not open to the world.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db import get_db
from app.main import app

USER = "planning-test-user"


@pytest.fixture()
def plan_client(db):
    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── the answers reach the client unchanged ──────────────────────────────────

def test_decision_returns_the_engine_scores_and_the_winners(plan_client):
    r = plan_client.post("/planning/decision", json={
        "optimism": 0.5,
        "options": [
            {"name": "Risky", "worst": -500, "likely": 100, "best": 900},
            {"name": "Safe", "worst": 0, "likely": 50, "best": 120},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["safest"] == "Safe"
    assert body["boldest"] == "Risky"
    assert body["inverted"] == []
    scores = {s["name"]: s for s in body["scores"]}
    # 0.25*-500 + 0.5*100 + 0.25*900 = 150
    assert scores["Risky"]["ev"] == pytest.approx(150)
    assert scores["Risky"]["maximin"] == -500
    assert scores["Risky"]["maximax"] == 900


def test_decision_reports_estimates_entered_the_wrong_way_round(plan_client):
    r = plan_client.post("/planning/decision", json={
        "options": [{"name": "Stay open late", "worst": 400, "likely": 250, "best": 100}],
    })
    assert r.json()["inverted"] == ["Stay open late"]


def test_framing_returns_both_sides(plan_client):
    r = plan_client.post("/planning/framing", json={
        "order_more": 80, "order_less": 50,
        "sell_price": 5, "cost_price": 2.5, "expected_demand": 65,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["margin"] == 2.5
    assert body["more_upside"] == pytest.approx(162.5)
    # Over-ordering still leaves a profit here — the UI must not call it a loss.
    assert body["more_downside"] == pytest.approx(125)
    assert body["more_unsold"] == 15
    assert body["less_missed"] == pytest.approx(37.5)


def test_budget_returns_the_exact_plan_not_the_greedy_one(plan_client):
    # The case plain greedy got 35% wrong.
    r = plan_client.post("/planning/budget", json={
        "budget": 100,
        "items": [
            {"name": "A", "cost": 60, "profit": 65, "max_qty": 1},
            {"name": "B", "cost": 50, "profit": 50, "max_qty": 2},
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["total_earn"] == pytest.approx(100)
    assert body["allocation"] == [{"name": "B", "qty": 2, "spend": 100, "earn": 100}]
    assert body["approximate"] is False


def test_budget_with_no_budget_takes_everything_worth_taking(plan_client):
    r = plan_client.post("/planning/budget", json={
        "items": [{"name": "Cake", "cost": 7, "profit": 8, "max_qty": 12}],
    })
    assert r.json()["allocation"][0]["qty"] == 12


def test_empty_input_answers_rather_than_erroring(plan_client):
    assert plan_client.post("/planning/decision", json={"options": []}).status_code == 200
    assert plan_client.post("/planning/budget", json={"items": []}).status_code == 200


# ── nonsense is refused before the engine sees it ───────────────────────────

@pytest.mark.parametrize("body", [
    {"options": [{"name": "A", "worst": 1, "likely": 2, "best": 3}], "optimism": 5},
    {"options": [{"name": "A", "worst": 1, "likely": 2, "best": 3}], "optimism": -1},
    {"options": [{"name": "A", "worst": 1, "likely": 2}]},              # missing best
    {"options": [{"name": "A", "worst": "lots", "likely": 2, "best": 3}]},
])
def test_bad_decision_input_is_a_422_not_a_500(plan_client, body):
    assert plan_client.post("/planning/decision", json=body).status_code == 422


@pytest.mark.parametrize("body", [
    {"order_more": -1, "order_less": 50, "sell_price": 5,
     "cost_price": 2.5, "expected_demand": 65},
    {"order_more": 80, "order_less": 50, "sell_price": -5,
     "cost_price": 2.5, "expected_demand": 65},
    {"order_more": 80, "order_less": 50, "sell_price": 5, "cost_price": 2.5},
])
def test_bad_framing_input_is_a_422_not_a_500(plan_client, body):
    assert plan_client.post("/planning/framing", json=body).status_code == 422


def test_an_absurdly_long_item_list_is_refused(plan_client):
    """The engine has no limits of its own — bounding the work is the handler's
    job, so a request cannot ask for an unbounded amount of it."""
    items = [{"name": f"i{i}", "cost": 1, "profit": 2, "max_qty": 5} for i in range(50)]
    r = plan_client.post("/planning/budget", json={"budget": 100, "items": items})
    assert r.status_code == 422


def test_an_absurd_budget_is_refused(plan_client):
    r = plan_client.post("/planning/budget", json={
        "budget": 1e15,
        "items": [{"name": "A", "cost": 1, "profit": 2, "max_qty": 5}],
    })
    assert r.status_code == 422


# ── the routes are not open ─────────────────────────────────────────────────

@pytest.mark.parametrize("path,body", [
    ("/planning/decision", {"options": []}),
    ("/planning/framing", {"order_more": 1, "order_less": 1, "sell_price": 1,
                           "cost_price": 1, "expected_demand": 1}),
    ("/planning/budget", {"items": []}),
])
def test_every_planning_route_requires_a_login(client, path, body):
    """They compute on request, so an open one is a surface worth not having."""
    app.dependency_overrides.pop(get_current_user, None)
    r = client.post(path, json=body)
    assert r.status_code in (401, 403), f"{path} answered {r.status_code} with no login"
