"""
Known-answer tests for engine/ordering.py — spec section 12 cases plus edge cases.
"""
import math
import pytest
from app.engine.ordering import (
    demand_over_lead_time,
    safety_stock,
    reorder_point,
    economic_order_quantity,
    service_level_z,
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
