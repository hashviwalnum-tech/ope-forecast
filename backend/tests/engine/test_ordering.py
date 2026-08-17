"""
Known-answer tests for engine/ordering.py — spec section 12 cases plus edge cases.
"""
import math
import pytest
from app.engine.ordering import (
    apply_order_constraints,
    compute_current_projected_stock,
    demand_over_lead_time,
    projected_stock_timeline,
    safety_stock,
    reorder_point,
    economic_order_quantity,
    service_level_z,
    will_stock_run_out,
)


# ---------------------------------------------------------------------------
# demand_over_lead_time
# ---------------------------------------------------------------------------

def test_demand_over_lead_time_spec_example():
    # Spec section 12: avg daily demand 50, lead time 4 days → 200
    assert demand_over_lead_time(50.0, 4) == pytest.approx(200.0)


def test_demand_over_lead_time_one_day():
    assert demand_over_lead_time(75.0, 1) == pytest.approx(75.0)


def test_demand_over_lead_time_bad_inputs():
    with pytest.raises(ValueError):
        demand_over_lead_time(50.0, 0)   # lead time must be >= 1
    with pytest.raises(ValueError):
        demand_over_lead_time(-1.0, 4)   # demand can't be negative


# ---------------------------------------------------------------------------
# safety_stock
# ---------------------------------------------------------------------------

def test_safety_stock_spec_example():
    # Spec section 12: z=1.65, σ_dLT=20 → safety stock = 33.0
    assert safety_stock(1.65, 20.0) == pytest.approx(33.0)


def test_safety_stock_zero_sigma():
    # No demand variability → no buffer needed
    assert safety_stock(1.65, 0.0) == pytest.approx(0.0)


def test_safety_stock_zero_z():
    # Service level = 50% → z = 0 → no safety stock
    assert safety_stock(0.0, 20.0) == pytest.approx(0.0)


def test_safety_stock_negative_sigma():
    with pytest.raises(ValueError):
        safety_stock(1.65, -5.0)


# ---------------------------------------------------------------------------
# reorder_point
# ---------------------------------------------------------------------------

def test_reorder_point_spec_example():
    # Spec section 12: avg=50, LT=4, z=1.65, σ_LT=20 → ROP = 200 + 33 = 233
    assert reorder_point(50.0, 4, 1.65, 20.0) == pytest.approx(233.0)


def test_reorder_point_no_uncertainty():
    # z=0 → safety stock = 0 → ROP = demand in LT only
    assert reorder_point(100.0, 3, 0.0, 50.0) == pytest.approx(300.0)


def test_reorder_point_components_match():
    # ROP must equal the sum of its two building blocks
    avg, lt, z, sigma = 40.0, 5, 1.28, 15.0
    expected = demand_over_lead_time(avg, lt) + safety_stock(z, sigma)
    assert reorder_point(avg, lt, z, sigma) == pytest.approx(expected)


# ---------------------------------------------------------------------------
# economic_order_quantity
# ---------------------------------------------------------------------------

def test_eoq_spec_example():
    # Spec section 12: D=10000, S=50, H=2 → √(2·10000·50/2) = √500000 ≈ 707
    result = economic_order_quantity(10000, 50, 2)
    assert result == pytest.approx(math.sqrt(500_000), rel=1e-9)
    assert abs(result - 707) < 1     # matches the "≈ 707" stated in the spec


def test_eoq_doubles_when_demand_quadruples():
    # EOQ scales as √D → 4× demand → 2× EOQ
    q1 = economic_order_quantity(1000, 50, 2)
    q2 = economic_order_quantity(4000, 50, 2)
    assert q2 == pytest.approx(q1 * 2, rel=1e-9)


def test_eoq_bad_inputs():
    with pytest.raises(ValueError):
        economic_order_quantity(0, 50, 2)       # zero demand
    with pytest.raises(ValueError):
        economic_order_quantity(10000, 0, 2)    # zero order cost
    with pytest.raises(ValueError):
        economic_order_quantity(10000, 50, 0)   # zero holding cost
    with pytest.raises(ValueError):
        economic_order_quantity(-1, 50, 2)      # negative demand


# ---------------------------------------------------------------------------
# service_level_z
# ---------------------------------------------------------------------------

def test_service_level_z_95():
    # 95% service level → z ≈ 1.645
    assert service_level_z(0.95) == pytest.approx(1.645, abs=0.001)


def test_service_level_z_50():
    # 50% → median → z = 0
    assert service_level_z(0.50) == pytest.approx(0.0, abs=1e-9)


def test_service_level_z_99():
    assert service_level_z(0.99) == pytest.approx(2.326, abs=0.001)


def test_service_level_z_boundary():
    with pytest.raises(ValueError):
        service_level_z(0.0)
    with pytest.raises(ValueError):
        service_level_z(1.0)
    with pytest.raises(ValueError):
        service_level_z(1.5)


# ---------------------------------------------------------------------------
# apply_order_constraints
# ---------------------------------------------------------------------------

def test_no_constraints_passthrough():
    """No storage_capacity or shelf_life_days → order unchanged, no notes."""
    order, notes, _codes = apply_order_constraints(100.0)
    assert order == pytest.approx(100.0)
    assert notes == []


def test_storage_cap_is_binding():
    """Order exceeds available storage space → capped with a note."""
    order, notes, _codes = apply_order_constraints(
        200.0, storage_capacity=150.0, current_stock=0.0
    )
    assert order == pytest.approx(150.0)
    assert len(notes) == 1
    assert "storage" in notes[0].lower()


def test_storage_cap_accounts_for_existing_stock():
    """Available space = capacity − current_stock."""
    order, notes, _codes = apply_order_constraints(
        200.0, storage_capacity=150.0, current_stock=50.0
    )
    assert order == pytest.approx(100.0)
    assert "storage" in notes[0].lower()


def test_storage_cap_none_current_stock_treated_as_zero():
    """current_stock=None should default to 0, so space = capacity."""
    order, notes, _codes = apply_order_constraints(
        200.0, storage_capacity=150.0, current_stock=None
    )
    assert order == pytest.approx(150.0)


def test_storage_not_binding_no_note():
    """Order fits within storage → no cap applied, no notes."""
    order, notes, _codes = apply_order_constraints(
        80.0, storage_capacity=150.0, current_stock=0.0
    )
    assert order == pytest.approx(80.0)
    assert notes == []


def test_shelf_life_cap_is_binding():
    """Order exceeds what can sell before spoilage → capped with a note."""
    # avg daily demand 10, shelf life 7 days → sellable = 70
    order, notes, _codes = apply_order_constraints(
        120.0, shelf_life_days=7, avg_daily_demand=10.0
    )
    assert order == pytest.approx(70.0)
    assert len(notes) == 1
    assert "spoil" in notes[0].lower()


def test_shelf_life_not_binding_no_note():
    """Order is less than the sellable window → no cap, no notes."""
    order, notes, _codes = apply_order_constraints(
        50.0, shelf_life_days=7, avg_daily_demand=10.0
    )
    assert order == pytest.approx(50.0)
    assert notes == []


def test_both_constraints_binding():
    """When both caps are tighter than the base order, both notes appear."""
    # storage cap: 80 (capacity=100, stock=20 → space=80)
    # shelf life cap: 70 (demand=10, days=7)
    # tighter cap = shelf life = 70
    order, notes, _codes = apply_order_constraints(
        200.0,
        storage_capacity=100.0,
        current_stock=20.0,
        shelf_life_days=7,
        avg_daily_demand=10.0,
    )
    assert order == pytest.approx(70.0)
    assert len(notes) == 2


def test_both_constraints_only_storage_binding():
    """Only storage binds; shelf life is looser."""
    # storage: 50 (capacity=80, stock=30 → space=50)
    # shelf life: 100 (demand=10, days=10) — not binding at 50
    order, notes, _codes = apply_order_constraints(
        90.0,
        storage_capacity=80.0,
        current_stock=30.0,
        shelf_life_days=10,
        avg_daily_demand=10.0,
    )
    assert order == pytest.approx(50.0)
    assert len(notes) == 1
    assert "storage" in notes[0].lower()


def test_shelf_life_ignored_without_avg_demand():
    """shelf_life_days set but avg_daily_demand not provided → no shelf cap."""
    order, notes, _codes = apply_order_constraints(
        200.0, shelf_life_days=7, avg_daily_demand=None
    )
    assert order == pytest.approx(200.0)
    assert notes == []


def test_stock_full_order_zero():
    """If stock already fills storage, recommended order collapses to 0."""
    order, notes, _codes = apply_order_constraints(
        50.0, storage_capacity=100.0, current_stock=100.0
    )
    assert order == pytest.approx(0.0)
    assert "storage" in notes[0].lower()


# ---------------------------------------------------------------------------
# projected_stock_timeline
# ---------------------------------------------------------------------------

def test_projected_stock_basic_depletion():
    """Stock depletes by forecast each day; can go negative (stockout)."""
    result = projected_stock_timeline(30.0, [10.0, 10.0, 10.0, 10.0], arrivals=[])
    assert result == pytest.approx([20.0, 10.0, 0.0, -10.0])


def test_projected_stock_with_arrival():
    """Arrival on day 1 adds to stock before that day's sales are deducted."""
    # Day 0: 5 - 10 = -5 (out before the order arrives)
    # Day 1: -5 + 30 - 10 = 15 (order arrived)
    # Day 2: 15 - 10 = 5
    result = projected_stock_timeline(5.0, [10.0, 10.0, 10.0], arrivals=[(1, 30)])
    assert result == pytest.approx([-5.0, 15.0, 5.0])


def test_projected_stock_multiple_arrivals():
    """Multiple arrivals on different days each add to stock."""
    result = projected_stock_timeline(0.0, [5.0, 5.0, 5.0], arrivals=[(0, 10), (2, 20)])
    # Day 0: 0 + 10 - 5 = 5
    # Day 1: 5 - 5 = 0
    # Day 2: 0 + 20 - 5 = 15
    assert result == pytest.approx([5.0, 0.0, 15.0])


def test_projected_stock_no_depletion_flat():
    """When forecast is 0 each day and no arrivals, stock stays flat."""
    result = projected_stock_timeline(50.0, [0.0, 0.0, 0.0], arrivals=[])
    assert result == pytest.approx([50.0, 50.0, 50.0])


def test_projected_stock_negative_current_raises():
    with pytest.raises(ValueError):
        projected_stock_timeline(-1.0, [5.0], arrivals=[])


# ---------------------------------------------------------------------------
# will_stock_run_out
# ---------------------------------------------------------------------------

def test_will_stock_run_out_false_all_positive():
    assert will_stock_run_out([20.0, 10.0, 5.0]) is False


def test_will_stock_run_out_true_hits_zero():
    assert will_stock_run_out([5.0, 0.0, 3.0]) is True


def test_will_stock_run_out_true_goes_negative():
    assert will_stock_run_out([5.0, -5.0]) is True


def test_will_stock_run_out_empty_list():
    assert will_stock_run_out([]) is False


# ---------------------------------------------------------------------------
# compute_current_projected_stock
# ---------------------------------------------------------------------------

def test_projected_stock_sales_draw_down():
    """Sales since baseline reduce the projected stock."""
    # 100 units on hand, sold 30 since baseline, no arrivals → 70 remaining
    assert compute_current_projected_stock(100.0, 30.0, 0.0) == pytest.approx(70.0)


def test_projected_stock_arrivals_add():
    """Arrived orders add to the projected stock."""
    # 50 units on hand, sold 20, received 40 → 70 projected
    assert compute_current_projected_stock(50.0, 20.0, 40.0) == pytest.approx(70.0)


def test_projected_stock_override_resets_baseline():
    """After a manual override the new baseline produces a fresh projection.

    Simulates the owner correcting the count: yesterday's projection was wrong
    (say 10 units), owner counts 25 actual units, sets 25 as the new baseline.
    The next projection from that new baseline correctly starts from 25.
    """
    # Override: new baseline = 25, then sold 5, no arrivals → 20 projected
    assert compute_current_projected_stock(25.0, 5.0, 0.0) == pytest.approx(20.0)


def test_projected_stock_negative_allowed():
    """Stockout: projected stock may go negative (signals the owner ran out)."""
    assert compute_current_projected_stock(10.0, 15.0, 0.0) == pytest.approx(-5.0)


def test_projected_stock_bad_baseline():
    with pytest.raises(ValueError):
        compute_current_projected_stock(-1.0, 0.0, 0.0)


def test_projected_stock_bad_sales():
    with pytest.raises(ValueError):
        compute_current_projected_stock(10.0, -1.0, 0.0)


def test_projected_stock_bad_arrivals():
    with pytest.raises(ValueError):
        compute_current_projected_stock(10.0, 0.0, -1.0)


# ── FINDING F-023: constraint notes must be translatable ─────────────────────
# The notes were English prose generated in the backend and rendered raw, so a
# Hebrew or Spanish owner read "Capped at 200 — your storage limit." in English
# on the screen they look at every day.

def test_storage_cap_emits_a_translatable_code():
    _order, notes, codes = apply_order_constraints(
        500.0, storage_capacity=300.0, current_stock=100.0
    )
    assert codes == [{"code": "storage_capped", "params": {"qty": 200}}]
    assert notes, "the English prose stays as a fallback for older clients"


def test_full_storage_emits_its_own_code():
    _order, _notes, codes = apply_order_constraints(
        500.0, storage_capacity=300.0, current_stock=300.0
    )
    assert [c["code"] for c in codes] == ["storage_full"]


def test_shelf_life_cap_emits_a_translatable_code():
    _order, _notes, codes = apply_order_constraints(
        500.0, shelf_life_days=4, avg_daily_demand=25.0
    )
    assert codes == [{"code": "shelf_life_capped", "params": {"qty": 100, "days": 4}}]


def test_no_constraints_means_no_codes():
    order, notes, codes = apply_order_constraints(500.0)
    assert order == 500.0 and notes == [] and codes == []


def test_codes_and_notes_stay_in_step():
    """Every English note must have a structured twin, or a translated client
    would silently drop a warning the English one shows."""
    _order, notes, codes = apply_order_constraints(
        500.0, storage_capacity=300.0, current_stock=100.0,
        shelf_life_days=2, avg_daily_demand=25.0,
    )
    assert len(notes) == len(codes) == 2
