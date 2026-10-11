"""POST /sale-events with a tap the phone queued while it had no signal.

The phone sends when the tap was made (`tapped_at`) and when it sent it
(`sent_at`). These check the server keeps that time, never counts a re-sent tap
twice, refuses a stale one in the owner's language, and lets a late tap raise
the total of a day already closed.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_business, get_tier
from app.api.deps import get_business_staff_ok
from app.db import get_db
from app.engine.limits import Tier
from app.main import app
from app.models import DayRecord, Product, SaleEvent


@pytest.fixture()
def client(db, biz):
    def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_business] = lambda: biz
    app.dependency_overrides[get_business_staff_ok] = lambda: biz
    app.dependency_overrides[get_tier] = lambda: Tier('free')
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


def _iso(ts: datetime) -> str:
    """How the phone sends a time: UTC, milliseconds, a Z."""
    return ts.strftime('%Y-%m-%dT%H:%M:%S.') + f'{ts.microsecond // 1000:03d}Z'


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_a_queued_tap_is_stored_at_the_time_it_was_made(client, db, biz):
    tapped = (_now() - timedelta(hours=2)).replace(microsecond=250000)
    r = client.post('/sale-events', json={'tapped_at': _iso(tapped), 'sent_at': _iso(_now())})
    assert r.status_code == 201, r.text
    row = db.query(SaleEvent).filter_by(business_id=biz.id).one()
    assert row.timestamp == tapped


def test_a_re_sent_tap_is_counted_once(client, db, biz):
    """The reply was lost, so the phone sends the same tap again."""
    tapped = _now() - timedelta(minutes=5)
    body = {'tapped_at': _iso(tapped), 'sent_at': _iso(_now())}
    first = client.post('/sale-events', json=body)
    second = client.post('/sale-events', json=body)
    assert first.status_code == second.status_code == 201
    assert first.json()['id'] == second.json()['id']
    assert db.query(SaleEvent).filter_by(business_id=biz.id).count() == 1


def test_two_real_taps_a_moment_apart_are_both_kept(client, db, biz):
    """Two coffees tapped in quick succession are two sales, not a repeat."""
    t1 = _now() - timedelta(minutes=5)
    t2 = t1 + timedelta(milliseconds=400)
    for t in (t1, t2):
        assert client.post('/sale-events', json={'tapped_at': _iso(t), 'sent_at': _iso(_now())}).status_code == 201
    assert db.query(SaleEvent).filter_by(business_id=biz.id).count() == 2


def test_the_same_moment_for_a_different_product_is_not_a_repeat(client, db, biz):
    product = Product(business_id=biz.id, name='Coffee', unit='cups')
    db.add(product)
    db.commit()
    t = _now() - timedelta(minutes=5)
    client.post('/sale-events', json={'tapped_at': _iso(t), 'sent_at': _iso(_now())})
    client.post('/sale-events', json={'product_id': product.id, 'tapped_at': _iso(t), 'sent_at': _iso(_now())})
    assert db.query(SaleEvent).filter_by(business_id=biz.id).count() == 2


def test_a_tap_too_old_is_refused_with_a_code(client, db, biz):
    tapped = _now() - timedelta(days=40)
    r = client.post('/sale-events', json={'tapped_at': _iso(tapped), 'sent_at': _iso(_now())})
    assert r.status_code == 422
    assert r.json()['code'] == 'tap_too_old'
    assert db.query(SaleEvent).filter_by(business_id=biz.id).count() == 0


def test_without_a_tap_time_it_happened_now(client, db, biz):
    before = _now()
    assert client.post('/sale-events', json={}).status_code == 201
    row = db.query(SaleEvent).filter_by(business_id=biz.id).one()
    assert before - timedelta(seconds=1) <= row.timestamp <= _now() + timedelta(seconds=1)


def _yesterday_at(hour: int) -> datetime:
    y = _now().date() - timedelta(days=1)
    return datetime(y.year, y.month, y.day, hour, 0, 0)


def test_a_late_tap_raises_a_closed_days_total(client, db, biz):
    """Yesterday rolled up with 1 customer; a second tap queued yesterday
    arrives today. The day's total follows the hours, as it would have."""
    db.add(SaleEvent(business_id=biz.id, product_id=None, timestamp=_yesterday_at(12), quantity=1))
    db.add(DayRecord(business_id=biz.id, date=_yesterday_at(12).date(), customers=1))
    db.commit()
    r = client.post('/sale-events', json={'tapped_at': _iso(_yesterday_at(13)), 'sent_at': _iso(_now())})
    assert r.status_code == 201, r.text
    rec = db.query(DayRecord).filter_by(business_id=biz.id).one()
    db.refresh(rec)
    assert rec.customers == 2


def test_a_late_tap_never_lowers_a_typed_total(client, db, biz):
    db.add(DayRecord(business_id=biz.id, date=_yesterday_at(12).date(), customers=50))
    db.commit()
    client.post('/sale-events', json={'tapped_at': _iso(_yesterday_at(13)), 'sent_at': _iso(_now())})
    rec = db.query(DayRecord).filter_by(business_id=biz.id).one()
    db.refresh(rec)
    assert rec.customers == 50
