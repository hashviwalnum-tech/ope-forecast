"""
Proactive nudge endpoints.

GET  /nudges             — returns the current top nudge for in-app display (owner auth)
POST /nudges/send-telegram — sends nudge via Telegram for this business (owner auth)

Nudge types:
  busy_tomorrow     — tomorrow's forecast ≥20% above the weekday mean (staffing implication)
  slow_tomorrow     — tomorrow's forecast ≥20% below the weekday mean (cut staff)
  low_stock         — a product is at/past its reorder point
  approaching_stock — a product is approaching its reorder point

Frequency cap (Telegram only): one send per nudge_frequency_hours (default 24).
In-app: always computed fresh, shown passively — not spammy.
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.analytics import get_forecast as _get_forecast
from app.api.analytics import get_ordering as _get_ordering
from app.api.analytics import get_weekday_averages as _get_weekday_averages
from app.api.deps import get_business
from app.db import get_db
from app.engine.nudges import Nudge, compute_forecast_nudge, compute_stock_nudge, pick_top_nudge
from app.models import Business
from app import clock

router = APIRouter(prefix="/nudges", tags=["Nudges"])

_DEFAULT_FREQUENCY_HOURS = 24


def _utcnow() -> datetime:
    return clock.now_naive_utc()


class NudgeItem(BaseModel):
    type: str
    message: str
    priority: int


class NudgesResponse(BaseModel):
    enabled: bool
    nudge: NudgeItem | None = None


class SendTelegramResponse(BaseModel):
    sent: bool
    message: str | None = None
    reason: str | None = None   # why it was skipped, if not sent


def _compute_nudge(db: Session, biz: Business) -> Nudge | None:
    """Compute the single top nudge for a business, or None."""
    candidates: list[Nudge] = []

    # ── Stock nudge ───────────────────────────────────────────────────────────
    try:
        ordering = _get_ordering(db=db, biz=biz)
        if ordering.status == "ok" and ordering.products:
            prods = [
                {
                    "name": p.name,
                    "order_now": p.order_now,
                    "approaching_reorder": p.approaching_reorder,
                    "stock_untracked": p.stock_untracked,
                    "lead_time_days": p.lead_time_days,
                }
                for p in ordering.products
            ]
            stock = compute_stock_nudge(prods)
            if stock:
                candidates.append(stock)
    except Exception:
        pass  # ordering engine failures must not block nudges

    # ── Forecast nudge ────────────────────────────────────────────────────────
    try:
        forecast = _get_forecast(db=db, biz=biz)
        wd_avgs = _get_weekday_averages(db=db, biz=biz)

        if (
            forecast.status == "ok"
            and forecast.days
            and wd_avgs.status == "ok"
            and wd_avgs.weekdays
        ):
            tomorrow = forecast.days[0]
            wd_map = {w.weekday: w.avg_customers for w in wd_avgs.weekdays}
            wd_mean = wd_map.get(tomorrow.weekday)
            if wd_mean is not None and wd_mean > 0:
                fn = compute_forecast_nudge(
                    tomorrow_predicted=tomorrow.predicted_customers,
                    tomorrow_weekday=tomorrow.weekday,
                    weekday_mean=float(wd_mean),
                )
                if fn:
                    candidates.append(fn)
    except Exception:
        pass

    return pick_top_nudge(candidates)


def _is_frequency_capped(biz: Business) -> bool:
    """Return True if the last Telegram nudge was sent within the frequency window."""
    settings = biz.settings or {}
    last_str = settings.get("last_nudge_at")
    if not last_str:
        return False
    try:
        last_dt = datetime.fromisoformat(last_str)
    except ValueError:
        return False
    freq_hours = settings.get("nudge_frequency_hours", _DEFAULT_FREQUENCY_HOURS)
    elapsed_hours = ((_utcnow() - last_dt).total_seconds()) / 3600
    return elapsed_hours < freq_hours


def _record_nudge_sent(db: Session, biz: Business) -> None:
    """Persist the timestamp of the last sent nudge to prevent spam."""
    settings = dict(biz.settings or {})
    settings["last_nudge_at"] = _utcnow().isoformat()
    biz.settings = settings
    flag_modified(biz, "settings")
    db.commit()


def _send_telegram_message(chat_id: str, text: str, bot_token: str) -> None:
    """Send a plain-text message to a Telegram chat via the Bot API."""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Telegram API returned {resp.status}")


# ── GET /nudges ───────────────────────────────────────────────────────────────

@router.get("", response_model=NudgesResponse)
def get_nudges(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Return the current top nudge for in-app display.

    Always computed fresh; no frequency cap (in-app display is passive, not spammy).
    Returns {enabled: false} when the owner has turned off nudges in settings.
    """
    settings = biz.settings or {}
    if not settings.get("nudges_enabled", True):
        return NudgesResponse(enabled=False)

    nudge = _compute_nudge(db, biz)
    if nudge is None:
        return NudgesResponse(enabled=True, nudge=None)

    return NudgesResponse(
        enabled=True,
        nudge=NudgeItem(type=nudge.type, message=nudge.message, priority=nudge.priority),
    )


# ── POST /nudges/send-telegram ────────────────────────────────────────────────

@router.post("/send-telegram", response_model=SendTelegramResponse)
def send_telegram_nudge(
    db: Session = Depends(get_db),
    biz: Business = Depends(get_business),
):
    """Send the current top nudge to this business's linked Telegram chat.

    Respects:
    - nudges_enabled setting (skips if false)
    - frequency cap (default 24 h between sends)
    - Requires TELEGRAM_BOT_TOKEN env var and a linked Telegram chat

    Safe to call anytime; returns {sent: false, reason: ...} when skipped.
    """
    from app.models.telegram_link import TelegramLink

    settings = biz.settings or {}
    if not settings.get("nudges_enabled", True):
        return SendTelegramResponse(sent=False, reason="nudges_disabled")

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        return SendTelegramResponse(sent=False, reason="no_bot_token")

    link = db.query(TelegramLink).filter_by(business_id=biz.id).first()
    if not link or not link.chat_id:
        return SendTelegramResponse(sent=False, reason="not_linked")

    if _is_frequency_capped(biz):
        return SendTelegramResponse(sent=False, reason="frequency_cap")

    nudge = _compute_nudge(db, biz)
    if nudge is None:
        return SendTelegramResponse(sent=False, reason="nothing_to_nudge")

    try:
        _send_telegram_message(link.chat_id, f"Ope: {nudge.message}", bot_token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Telegram send failed: {e}")

    _record_nudge_sent(db, biz)
    return SendTelegramResponse(sent=True, message=nudge.message)
