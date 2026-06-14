"""
Tests for batch-FIFO stock tracking (spec §5).

Covers:
1. FIFO depletion order — oldest batch consumed first.
2. Per-batch spoilage flagging — expired batches with units remaining are flagged.
3. Reorder while old stock remains — older-stock warning is generated.
4. total_remaining sums all batches.
5. batches_expiring_before filters correctly.
"""
import pytest
from datetime import date, timedelta
from app.engine.ordering import (
    BatchInfo,
    fifo_deplete,
    spoiled_or_at_risk,
    batches_expiring_before,
    total_remaining,
)

TODAY = date(2026, 6, 14)


def _batch(id: int, qty: float, arrival_offset: int, shelf_life: int | None = None) -> BatchInfo:
    arrival = TODAY + timedelta(days=arrival_offset)
    expiry = arrival + timedelta(days=shelf_life) if shelf_life is not None else None
    return BatchInfo(id=id, quantity_remaining=qty, arrival_date=arrival, expiry_date=expiry)


# ── FIFO depletion order ────────────────────────────────────────────────────

def test_fifo_depletes_oldest_first():
    """Oldest batch (earliest arrival_date) is depleted before newer batches."""
    old = _batch(1, qty=30.0, arrival_offset=-10)
    new = _batch(2, qty=50.0, arrival_offset=-3)
    updated, depleted = fifo_deplete([old, new], amount=20.0)
    updated_by_id = {b.id: b for b in updated}
    # Old batch should be partially consumed; new batch untouched
    assert updated_by_id[1].quantity_remaining == pytest.approx(10.0)
    assert updated_by_id[2].quantity_remaining == pytest.approx(50.0)
    assert depleted == pytest.approx(20.0)


def test_fifo_exhausts_old_then_continues_in_new():
    """When the old batch runs dry, depletion continues in the next-oldest batch."""
    old = _batch(1, qty=10.0, arrival_offset=-10)
    new = _batch(2, qty=50.0, arrival_offset=-3)
    updated, depleted = fifo_deplete([old, new], amount=30.0)
    updated_by_id = {b.id: b for b in updated}
    assert updated_by_id[1].quantity_remaining == pytest.approx(0.0)
    assert updated_by_id[2].quantity_remaining == pytest.approx(30.0)  # 50 - 20
    assert depleted == pytest.approx(30.0)


def test_fifo_stops_when_stock_insufficient():
    """If total stock is less than the amount requested, depletion stops at 0."""
    b = _batch(1, qty=5.0, arrival_offset=-5)
    updated, depleted = fifo_deplete([b], amount=20.0)
    assert updated[0].quantity_remaining == pytest.approx(0.0)
    assert depleted == pytest.approx(5.0)


def test_fifo_deplete_zero_amount():
    """Depleting zero leaves all batches unchanged."""
    b = _batch(1, qty=10.0, arrival_offset=-1)
    updated, depleted = fifo_deplete([b], amount=0.0)
    assert updated[0].quantity_remaining == pytest.approx(10.0)
    assert depleted == pytest.approx(0.0)


def test_fifo_deplete_negative_amount_raises():
    b = _batch(1, qty=10.0, arrival_offset=-1)
    with pytest.raises(ValueError):
        fifo_deplete([b], amount=-1.0)


def test_fifo_preserves_input_order_independence():
    """Depletion result is the same regardless of input list order."""
    b1 = _batch(1, qty=30.0, arrival_offset=-10)
    b2 = _batch(2, qty=30.0, arrival_offset=-5)
    updated_forward, _ = fifo_deplete([b1, b2], amount=20.0)
    updated_reversed, _ = fifo_deplete([b2, b1], amount=20.0)
    by_id_f = {b.id: b for b in updated_forward}
    by_id_r = {b.id: b for b in updated_reversed}
    assert by_id_f[1].quantity_remaining == pytest.approx(by_id_r[1].quantity_remaining)
    assert by_id_f[2].quantity_remaining == pytest.approx(by_id_r[2].quantity_remaining)


# ── Per-batch spoilage flagging ─────────────────────────────────────────────

def test_expired_batch_with_remaining_units_is_flagged():
    """A batch whose expiry_date <= today with units left is marked spoiled."""
    expired = _batch(1, qty=10.0, arrival_offset=-20, shelf_life=10)  # expired 10 days ago
    result = spoiled_or_at_risk([expired], TODAY)
    assert len(result) == 1
    assert result[0].id == 1


def test_not_expired_batch_is_not_flagged():
    """A batch that expires in the future is not flagged as spoiled."""
    fresh = _batch(1, qty=10.0, arrival_offset=-2, shelf_life=14)  # expires in 12 days
    result = spoiled_or_at_risk([fresh], TODAY)
    assert result == []


def test_expired_zero_remaining_is_not_flagged():
    """A depleted expired batch (quantity_remaining=0) is not flagged."""
    depleted = BatchInfo(
        id=1, quantity_remaining=0.0,
        arrival_date=TODAY - timedelta(days=20),
        expiry_date=TODAY - timedelta(days=10),
    )
    result = spoiled_or_at_risk([depleted], TODAY)
    assert result == []


def test_no_expiry_batch_never_spoils():
    """Batches with expiry_date=None are never considered spoiled."""
    no_shelf = _batch(1, qty=10.0, arrival_offset=-100, shelf_life=None)
    result = spoiled_or_at_risk([no_shelf], TODAY)
    assert result == []


def test_mixed_batches_only_expired_flagged():
    """Only the expired batch in a mixed list is flagged."""
    expired = _batch(1, qty=5.0, arrival_offset=-20, shelf_life=5)
    fresh = _batch(2, qty=20.0, arrival_offset=-2, shelf_life=14)
    result = spoiled_or_at_risk([expired, fresh], TODAY)
    assert len(result) == 1
    assert result[0].id == 1


# ── Reorder while old stock remains ────────────────────────────────────────

def test_batches_expiring_before_warns_about_old_stock():
    """When ordering (cutoff = today + lead_time), older batches expiring before then are flagged."""
    lead_time = 7
    cutoff = TODAY + timedelta(days=lead_time)
    old_expiring_soon = _batch(1, qty=20.0, arrival_offset=-10, shelf_life=12)
    # expiry = -10 + 12 = +2 days from today → expires before cutoff (day +7)
    still_good = _batch(2, qty=30.0, arrival_offset=-5, shelf_life=30)
    # expiry = -5 + 30 = +25 days from today → OK

    at_risk = batches_expiring_before([old_expiring_soon, still_good], cutoff)
    assert len(at_risk) == 1
    assert at_risk[0].id == 1


def test_batches_expiring_before_no_shelf_life_not_included():
    """Batches with no shelf life are never in the 'expiring soon' list."""
    no_shelf = _batch(1, qty=10.0, arrival_offset=-5, shelf_life=None)
    at_risk = batches_expiring_before([no_shelf], TODAY + timedelta(days=14))
    assert at_risk == []


def test_batches_expiring_before_empty_when_all_fine():
    """No warning when all batches expire well after the reorder cutoff."""
    fresh = _batch(1, qty=10.0, arrival_offset=-1, shelf_life=60)
    at_risk = batches_expiring_before([fresh], TODAY + timedelta(days=7))
    assert at_risk == []


# ── total_remaining ─────────────────────────────────────────────────────────

def test_total_remaining_sums_all_batches():
    b1 = _batch(1, qty=10.0, arrival_offset=-5)
    b2 = _batch(2, qty=25.0, arrival_offset=-2)
    assert total_remaining([b1, b2]) == pytest.approx(35.0)


def test_total_remaining_empty():
    assert total_remaining([]) == pytest.approx(0.0)
