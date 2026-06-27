"""
DEV-ONLY: synthetic catch-up data generator for testing.

SAFETY GATES — ALL three must pass before any data is written:

  Gate 1  DEV_CATCHUP_ENABLED env var must be exactly "true".
          Never set this in your production Render deployment.

  Gate 2  DEV_TESTING_BUSINESS_ID env var must name the target business ID.
          The function refuses to touch any business with a different ID, even
          if it somehow receives a valid admin key.

  Gate 3  X-Admin-Key header must match ADMIN_KEY (manual HTTP endpoint only).
          The startup auto-trigger is server-internal and skips this gate.

Why a real user can NEVER trigger this in production:
  - Gate 1 is absent from the prod Render env → every call returns 403 silently.
  - Gate 2 requires knowing the exact business ID; it is not in any user flow.
  - Gate 3 requires the admin secret, which is never sent to the frontend.
"""

from __future__ import annotations

import logging
import os
import random
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_key
from app.db import SessionLocal
from app.models import Business, DayRecord, Product, SaleEvent, SaleRecord

log = logging.getLogger(__name__)

router = APIRouter(prefix="/dev", tags=["Dev (testing only)"])

_ENV_FLAG = "DEV_CATCHUP_ENABLED"
_ENV_BIZ_ID = "DEV_TESTING_BUSINESS_ID"
_NOISE = 0.14           # base Gaussian σ for normal-variation days
_SURPRISE_PROB = 0.06   # ~6% of days are surprising (unusually quiet or busy)

# Used only when history is too thin to infer a pattern
_FALLBACK_BASE: dict[int, int] = {
    0: 18, 1: 20, 2: 22, 3: 24, 4: 28, 5: 38, 6: 30,
}


# ── Safety gates ──────────────────────────────────────────────────────────────

def _require_dev_flag() -> None:
    """Gate 1: env flag must be explicitly "true"."""
    if os.environ.get(_ENV_FLAG, "").strip().lower() != "true":
        raise HTTPException(
            403,
            f"Dev catch-up is disabled. Set {_ENV_FLAG}=true in the environment "
            "(testing environment only — never in production).",
        )


def _get_testing_biz_id() -> int:
    """Gate 2: the target business ID must be explicitly declared in the env."""
    raw = os.environ.get(_ENV_BIZ_ID, "").strip()
    if not raw:
        raise HTTPException(
            403,
            f"{_ENV_BIZ_ID} is not set. Explicitly declare which business is the "
            "test business to prevent accidental writes to real accounts.",
        )
    try:
        return int(raw)
    except ValueError:
        raise HTTPException(403, f"{_ENV_BIZ_ID} must be an integer, got: {raw!r}")


def _assert_biz_is_allowed(actual_id: int, allowed_id: int) -> None:
    """Redundant hard-stop: refuse if the resolved business isn't the declared test business."""
    if actual_id != allowed_id:
        raise HTTPException(
            403,
            f"Dev catch-up is hard-scoped to business_id={allowed_id}. "
            f"Refusing to write to business_id={actual_id}.",
        )


# ── Pattern helpers ───────────────────────────────────────────────────────────

def _infer_weekday_base(records: list[DayRecord]) -> dict[int, float]:
    """Average customers per weekday from existing history."""
    buckets: dict[int, list[int]] = {d: [] for d in range(7)}
    for r in records:
        buckets[r.date.weekday()].append(r.customers)
    return {
        wd: sum(vals) / len(vals) if vals else float(_FALLBACK_BASE[wd])
        for wd, vals in buckets.items()
    }


def _infer_product_ratios(records: list[DayRecord], db: Session) -> dict[int, float]:
    """Return {product_id: avg_units_per_customer} derived from SaleRecord history."""
    dr_ids = [r.id for r in records]
    if not dr_ids:
        return {}
    rows = db.query(SaleRecord).filter(SaleRecord.day_record_id.in_(dr_ids)).all()
    cust_map: dict[int, int] = {r.id: r.customers for r in records}
    unit_sums: dict[int, float] = {}
    cust_totals: dict[int, int] = {}
    for row in rows:
        unit_sums[row.product_id] = unit_sums.get(row.product_id, 0.0) + row.units_sold
        cust_totals[row.product_id] = (
            cust_totals.get(row.product_id, 0) + cust_map.get(row.day_record_id, 0)
        )
    return {
        pid: unit_sums[pid] / cust_totals[pid]
        for pid in unit_sums
        if cust_totals.get(pid, 0) > 0
    }


def _open_hours(settings: dict) -> list[int]:
    opening = int(settings.get("opening_hour", 9))
    closing = int(settings.get("closing_hour", 20))
    return list(range(opening, closing))


def _hour_weights(hours: list[int]) -> list[float]:
    """Bell-shaped weight peaking 60% through the day (slightly afternoon-heavy for a spa)."""
    n = len(hours)
    if n == 0:
        return []
    mid = n * 0.6
    raw = [1.0 - abs(i - mid) / max(n, 1) for i in range(n)]
    total = sum(raw)
    return [w / total for w in raw]


def _noisy(base: float, rng: random.Random) -> int:
    """Realistic noise: bell-curve most days, occasional genuine surprises."""
    if rng.random() < _SURPRISE_PROB:
        # Surprise day: genuinely unusual (quiet or very busy)
        if rng.random() < 0.5:
            factor = rng.uniform(0.35, 0.60)   # surprisingly quiet
        else:
            factor = rng.uniform(1.50, 2.00)   # unusually busy
    else:
        # Normal day: Gaussian noise, softly capped to avoid runaway drift
        factor = max(0.60, min(1.50, rng.gauss(1.0, _NOISE)))
    return max(1, round(base * factor))


def _rand_ts(d: date, hour: int, rng: random.Random) -> datetime:
    """Naive local datetime within the given hour (no tzinfo — matches how taps are stored)."""
    return datetime(d.year, d.month, d.day, hour, rng.randint(0, 59), rng.randint(0, 59))


# ── Core generation (no safety gates — callers must enforce them) ─────────────

def _run_catchup(db: Session, biz_id: int) -> dict:
    """
    Generate DayRecords + SaleRecords + SaleEvents for every open day from
    (last logged day + 1) through yesterday, skipping days that already exist.
    """
    biz = db.get(Business, biz_id)
    if biz is None:
        raise ValueError(f"Business {biz_id} not found in the database.")

    settings = biz.settings or {}
    open_days: set[int] = set(int(d) for d in settings.get("opening_days", list(range(7))))
    open_hours = _open_hours(settings)
    hw = _hour_weights(open_hours)
    rng = random.Random()

    products = db.query(Product).filter_by(business_id=biz_id).all()

    existing = (
        db.query(DayRecord)
        .filter_by(business_id=biz_id)
        .order_by(DayRecord.date)
        .all()
    )
    existing_dates: set[date] = {r.date for r in existing}

    today = date.today()
    yesterday = today - timedelta(days=1)

    # If no history exists, seed from 90 days ago so the forecast has material to work with
    last_logged: date = max(existing_dates, default=today - timedelta(days=91))

    if last_logged >= yesterday:
        return {
            "status": "up_to_date",
            "days_generated": 0,
            "days_skipped": 0,
            "generated": [],
            "skipped": [],
        }

    gap_days = [
        last_logged + timedelta(days=i)
        for i in range(1, (yesterday - last_logged).days + 1)
    ]
    missing = [d for d in gap_days if d.weekday() in open_days and d not in existing_dates]

    if not missing:
        return {
            "status": "up_to_date",
            "days_generated": 0,
            "days_skipped": 0,
            "generated": [],
            "skipped": [],
        }

    wd_base = _infer_weekday_base(existing)
    product_ratios = _infer_product_ratios(existing, db)
    # Fall back to an even split across products if no SaleRecord history yet
    if not product_ratios and products:
        product_ratios = {p.id: 0.5 for p in products}

    generated: list[str] = []
    skipped: list[str] = []

    for d in missing:
        if d in existing_dates:
            skipped.append(str(d))
            continue

        customers = _noisy(wd_base.get(d.weekday(), float(_FALLBACK_BASE[d.weekday()])), rng)

        # DayRecord ───────────────────────────────────────────────────────────
        try:
            dr = DayRecord(business_id=biz_id, date=d, customers=customers)
            db.add(dr)
            db.flush()  # get dr.id before adding children
        except IntegrityError:
            db.rollback()
            skipped.append(str(d))
            continue

        # SaleRecords (daily product totals) ──────────────────────────────────
        for pid, ratio in product_ratios.items():
            units = max(0.0, round(customers * ratio * (1 + rng.uniform(-0.15, 0.15)), 1))
            if units > 0:
                db.add(SaleRecord(day_record_id=dr.id, product_id=pid, units_sold=units))

        # SaleEvents (timestamped taps within open hours) ─────────────────────
        if open_hours and hw:
            # One customer-arrival tap per customer (product_id=None)
            for _ in range(customers):
                hour = rng.choices(open_hours, weights=hw, k=1)[0]
                db.add(SaleEvent(
                    business_id=biz_id,
                    product_id=None,
                    timestamp=_rand_ts(d, hour, rng),
                    quantity=1.0,
                ))
            # Product taps matching the SaleRecord ratios
            for pid, ratio in product_ratios.items():
                n_taps = max(0, round(customers * ratio * (1 + rng.uniform(-0.15, 0.15))))
                for _ in range(n_taps):
                    hour = rng.choices(open_hours, weights=hw, k=1)[0]
                    db.add(SaleEvent(
                        business_id=biz_id,
                        product_id=pid,
                        timestamp=_rand_ts(d, hour, rng),
                        quantity=1.0,
                    ))

        db.commit()
        existing_dates.add(d)
        generated.append(str(d))

    log.warning(
        "DEV CATCHUP: generated=%d skipped=%d biz_id=%d",
        len(generated), len(skipped), biz_id,
    )
    return {
        "status": "ok",
        "days_generated": len(generated),
        "days_skipped": len(skipped),
        "generated": generated,
        "skipped": skipped,
    }


# ── HTTP endpoint (Gate 3: admin key required) ────────────────────────────────

@router.post("/catchup", dependencies=[Depends(require_admin_key)])
def dev_catchup_endpoint(db: Session = Depends(get_db)):
    """
    Manually trigger synthetic data catch-up.

    Required headers: X-Admin-Key matching ADMIN_KEY env var.
    Required env vars: DEV_CATCHUP_ENABLED=true, DEV_TESTING_BUSINESS_ID=<id>.
    """
    _require_dev_flag()           # Gate 1
    biz_id = _get_testing_biz_id()  # Gate 2
    # Gate 3 is the require_admin_key dependency above
    try:
        return _run_catchup(db, biz_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.get("/catchup/status", dependencies=[Depends(require_admin_key)])
def dev_catchup_status(db: Session = Depends(get_db)):
    """Return how many days would be generated without writing anything."""
    _require_dev_flag()
    biz_id = _get_testing_biz_id()

    biz = db.get(Business, biz_id)
    if biz is None:
        raise HTTPException(404, f"Business {biz_id} not found")

    settings = biz.settings or {}
    open_days: set[int] = set(int(d) for d in settings.get("opening_days", list(range(7))))

    existing_dates: set[date] = {
        r.date
        for r in db.query(DayRecord).filter_by(business_id=biz_id).all()
    }

    today = date.today()
    yesterday = today - timedelta(days=1)
    last_logged = max(existing_dates, default=today - timedelta(days=91))

    missing = [
        last_logged + timedelta(days=i)
        for i in range(1, (yesterday - last_logged).days + 1)
        if (last_logged + timedelta(days=i)).weekday() in open_days
        and (last_logged + timedelta(days=i)) not in existing_dates
    ]

    return {
        "last_logged": str(last_logged) if existing_dates else None,
        "yesterday": str(yesterday),
        "days_to_generate": len(missing),
        "first_missing": str(missing[0]) if missing else None,
        "last_missing": str(missing[-1]) if missing else None,
    }


# ── Frontend auto-trigger (no admin key — env-var gates only) ────────────────

@router.post("/catchup/auto")
def dev_catchup_auto(db: Session = Depends(get_db)):
    """
    Lightweight catch-up called by the frontend on every app load.

    No admin key required — Gates 1 and 2 (env vars) are sufficient.
    Returns 403 silently in production where DEV_CATCHUP_ENABLED is absent,
    so the frontend can fire-and-forget without error handling.
    """
    if os.environ.get(_ENV_FLAG, "").strip().lower() != "true":
        raise HTTPException(403, "Dev catch-up not enabled.")
    raw = os.environ.get(_ENV_BIZ_ID, "").strip()
    if not raw:
        raise HTTPException(403, f"{_ENV_BIZ_ID} not set.")
    try:
        biz_id = int(raw)
    except ValueError:
        raise HTTPException(403, f"{_ENV_BIZ_ID} must be an integer.")
    try:
        return _run_catchup(db, biz_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


# ── Startup auto-trigger ──────────────────────────────────────────────────────

def maybe_catchup_on_startup() -> None:
    """
    Called during server lifespan startup. Silently no-ops in production
    (where DEV_CATCHUP_ENABLED is not set). When enabled, fills gaps so the
    app has current data the moment it wakes from Render's free-tier sleep.
    """
    if os.environ.get(_ENV_FLAG, "").strip().lower() != "true":
        return
    # Don't run against in-memory test databases (conftest.py patches DATABASE_URL
    # to sqlite:///:memory: before app imports; we must not pollute test data).
    if ":memory:" in os.environ.get("DATABASE_URL", ""):
        return
    raw = os.environ.get(_ENV_BIZ_ID, "").strip()
    if not raw:
        log.warning(
            "DEV CATCHUP: %s=true but %s is not set — skipping startup catch-up.",
            _ENV_FLAG, _ENV_BIZ_ID,
        )
        return
    try:
        biz_id = int(raw)
    except ValueError:
        log.warning("DEV CATCHUP: %s=%r is not an integer — skipping.", _ENV_BIZ_ID, raw)
        return

    db = SessionLocal()
    try:
        result = _run_catchup(db, biz_id)
        if result["days_generated"] > 0:
            log.warning(
                "DEV CATCHUP (startup): generated %d days for business_id=%d.",
                result["days_generated"], biz_id,
            )
    except Exception:
        log.exception("DEV CATCHUP (startup): error — skipping silently so the server still starts.")
    finally:
        db.close()
