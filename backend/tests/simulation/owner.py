"""
The simulated owner: a person operating the burger restaurant through the app.

Everything here is *behaviour*, not data injection — it decides what a real owner
would tap, type and read on a given simulated day, and does it through the API.
The generator tells it what actually happened in the world; this module is the
only bridge between the two, and it passes nothing but observable numbers.

Day shape (business local time):
  09:00–16:59   taps, on days the owner is tapping
  17:05         close: log the day, review anything Ope flagged, place orders
  17:20         read tomorrow's forecast and write it down for scoring
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from tests.simulation.generator import (
    PROMOS,
    SERVING_HOURS,
    TIMEZONE,
    DayOutcome,
    Promo,
)
from tests.simulation.harness import ApiError, Ope
from tests.simulation.menu import MENU, MenuItem

OUT_DIR = Path(__file__).resolve().parents[3] / "docs" / "simulation"

# Weekdays the shop is open: Mon–Fri and Sunday (Saturday closed).
OPENING_DAYS = [0, 1, 2, 3, 4, 6]
OPENING_HOUR = 9
CLOSING_HOUR = 17


@dataclass
class Issue:
    """Something the app did that a real owner would notice as wrong or confusing."""
    day: str
    where: str
    detail: str

    def as_dict(self) -> dict:
        return {"day": self.day, "where": self.where, "detail": self.detail}


@dataclass
class OwnerState:
    business_id: int | None = None
    product_ids: dict[str, int] = field(default_factory=dict)     # menu key → product id
    forecasts: list[dict] = field(default_factory=list)           # every prediction Ope made
    actuals: dict[str, int] = field(default_factory=dict)         # iso date → customers
    issues: list[Issue] = field(default_factory=list)
    promos_created: dict[str, int] = field(default_factory=dict)  # label → period id
    pending_log: list[tuple[str, DayOutcome]] = field(default_factory=list)  # late-logged days


class SimulatedOwner:
    def __init__(self, ope: Ope, state: OwnerState | None = None, verbose: bool = False):
        self.ope = ope
        self.s = state or OwnerState()
        self.verbose = verbose

    # ── plumbing ─────────────────────────────────────────────────────────────

    def note(self, day: date, where: str, detail: str) -> None:
        self.s.issues.append(Issue(day.isoformat(), where, detail))
        if self.verbose:
            print(f"    ! {where}: {detail}")

    def _safe(self, day: date, where: str, fn, *a, **kw):
        """Run an API call; record a failure as an issue instead of aborting the year."""
        try:
            return fn(*a, **kw)
        except ApiError as e:
            self.note(day, where, f"{e.method} {e.path} → {e.status}: {e.body}")
            return None

    # ── onboarding ───────────────────────────────────────────────────────────

    def onboard(self, day: date) -> None:
        """Day one: create the business, set it up, and enter the menu."""
        self.ope.at_local(day, 8, 0)
        biz = self.ope.post("/businesses", json={"name": "Brooklyn Burger Co"})
        self.s.business_id = biz["id"]
        self.ope.use_business(biz["id"], tz=TIMEZONE)

        self.ope.patch("/businesses/me/settings", json={
            "opening_days": OPENING_DAYS,
            "opening_hour": OPENING_HOUR,
            "closing_hour": CLOSING_HOUR,
            "timezone": TIMEZONE,
            "avg_service_time_minutes": 3.5,
            "staffing_max_wait_minutes": 6.0,
            "stock_management_enabled": True,
            "assume_orders_arrive_on_time": True,
            "onboarding_done": True,
        })

        for item in MENU:
            self.s.product_ids[item.key] = self._create_product(day, item)

        # A service's supplies are ordinary stocked products it draws down.
        for item in MENU:
            if item.product_type != "service" or not item.consumables:
                continue
            svc_id = self.s.product_ids[item.key]
            for ckey, qty in item.consumables.items():
                self._safe(day, "service consumables", self.ope.post,
                           f"/products/{svc_id}/consumables",
                           json={"consumable_product_id": self.s.product_ids[ckey],
                                 "qty_per_performance": qty})

    def _create_product(self, day: date, item: MenuItem) -> int:
        body: dict = {
            "name": item.name,
            "unit": item.unit,
            "product_type": item.product_type,
            "unit_mode": item.unit_mode,
            "price": item.price,
            "service_time_minutes": item.service_time_minutes,
        }
        if item.product_type == "stocked":
            body.update({
                "lead_time_days": item.lead_time_days,
                "shelf_life_days": item.shelf_life_days,
                "storage_capacity": item.storage_capacity,
                # A sensible opening count, well under capacity.
                "current_stock": round((item.storage_capacity or 100) * 0.55, 2),
            })
        return self.ope.post("/products", json=body)["id"]

    # ── promos ───────────────────────────────────────────────────────────────

    def declare_promos_starting(self, day: date) -> None:
        """The owner tags an ad/event in the app on the day it begins."""
        for p in PROMOS:
            if p.start != day or p.label in self.s.promos_created:
                continue
            body = {
                "start_date": p.start.isoformat(),
                "end_date": p.end.isoformat(),
                "type": p.kind,
                "label": p.label,
            }
            if p.cost is not None:
                body["cost"] = p.cost
            if p.target != "customers" and p.target in self.s.product_ids:
                body["target_product_id"] = self.s.product_ids[p.target]
            r = self.ope.try_("POST", "/periods", json=body)
            if r.status_code == 201:
                self.s.promos_created[p.label] = r.json()["id"]
            else:
                # A refusal here is meaningful — it is the free-tier cap biting.
                self.note(day, f"tag {p.kind}",
                          f"'{p.label}' refused: {r.status_code} {self._body(r)}")

    @staticmethod
    def _body(r):
        try:
            return r.json().get("detail", r.json())
        except Exception:
            return r.text[:200]

    # ── logging a day ────────────────────────────────────────────────────────

    def tap_through_day(self, o: DayOutcome) -> None:
        """The owner taps every sale as it happens — the live-capture path."""
        pids = self.s.product_ids
        for hour in o.hours:
            self.ope.at_local(o.day, hour.hour, 30)
            for _ in range(hour.customers):
                self.ope.post("/sale-events", json={"quantity": 1})
            for key, qty in hour.units.items():
                if qty:
                    self.ope.post("/sale-events",
                                  json={"product_id": pids[key], "quantity": qty})

    def log_end_of_day(self, o: DayOutcome, on_day: date | None = None) -> None:
        """The owner types the day's totals after closing (the common path).

        Hourly counts go in first, exactly as a register export would, then the
        daily total and the per-product units.
        """
        entry_day = on_day or o.day
        self.ope.at_local(entry_day, CLOSING_HOUR, 5)

        self._safe(o.day, "hourly backfill", self.ope.post, "/sale-events/backfill-hourly",
                   json={"date": o.day.isoformat(),
                         "hours": [{"hour": h.hour, "customers": h.customers} for h in o.hours]})

        dr = self._safe(o.day, "log day total", self.ope.post, "/day-records",
                        json={"date": o.day.isoformat(), "customers": o.customers})
        if dr is None:
            return
        if dr["customers"] != o.customers:
            self.note(o.day, "day total stored wrong",
                      f"entered {o.customers}, stored {dr['customers']}")

        for key, qty in o.units.items():
            self._safe(o.day, "log product units", self.ope.post, "/sales",
                       json={"day_record_id": dr["id"],
                             "product_id": self.s.product_ids[key],
                             "units_sold": qty})

    # ── evening review ───────────────────────────────────────────────────────

    def read_forecast(self, day: date) -> None:
        """The owner opens the app after close and looks at the week ahead."""
        self.ope.at_local(day, CLOSING_HOUR, 20)
        f = self._safe(day, "forecast", self.ope.get, "/forecast")
        if not f:
            return
        if f.get("status") != "ok":
            self.s.forecasts.append({"made_on": day.isoformat(), "status": f.get("status"),
                                     "message": f.get("message")})
            return
        for d in f["days"]:
            self.s.forecasts.append({
                "made_on": day.isoformat(),
                "target": d["date"],
                "horizon": (date.fromisoformat(d["date"]) - day).days,
                "predicted": d["predicted_customers"],
                "lo": d["interval_low"],
                "hi": d["interval_high"],
                "weights": d.get("model_weights") or {},
            })
        if f.get("drift_alert"):
            self.s.issues.append(Issue(day.isoformat(), "drift alert (informational)",
                                       str(f["drift_alert"])))

    def review_flags(self, day: date) -> None:
        """The owner answers whatever Ope flagged as unusual."""
        out = self._safe(day, "outliers", self.ope.get, "/outliers")
        if not out or not out.get("flags"):
            return
        for o in out["flags"]:
            # Only the two genuine disasters get excluded; everything else the
            # owner recognises as a normal busy/quiet day and keeps.
            from tests.simulation.generator import ANOMALY_DAYS
            flagged_date = date.fromisoformat(o["date"])
            action = "excluded" if flagged_date in ANOMALY_DAYS else "keep"
            self._safe(day, "resolve flag", self.ope.patch,
                       f"/day-records/{o['day_record_id']}/outlier", json={"action": action})

    # ── ordering ─────────────────────────────────────────────────────────────

    REGULARS = [
        ("Marcus (site foreman)", 4.0, 26.0, {0, 1, 2, 3, 4}),
        ("Dana from the salon",   2.0, 18.5, {1, 3}),
        ("The Ortiz family",      1.0, 74.0, {6}),
        ("Priya (studio)",        3.0, 21.0, {0, 2, 4}),
    ]

    def place_orders(self, day: date) -> None:
        """The owner checks what needs ordering and taps "I ordered this"."""
        self.ope.at_local(day, CLOSING_HOUR, 30)
        o = self._safe(day, "ordering", self.ope.get, "/ordering")
        if not o or o.get("status") != "ok":
            return
        for row in o.get("products", []):
            if not row.get("order_now"):
                continue
            qty = row.get("suggested_order_qty") or 0
            if qty <= 0:
                self.note(day, "ordering",
                          f"{row['name']}: told to order now but suggested quantity is {qty}")
                continue
            r = self.ope.try_("POST", "/orders", json={
                "product_id": row["product_id"],
                "ordered_date": day.isoformat(),
                "quantity": qty,
            })
            if r.status_code not in (201, 409):
                self.note(day, "place order",
                          f"{row['name']} qty {qty}: {r.status_code} {self._body(r)}")

    def ensure_regulars(self, day: date) -> None:
        """Create the regulars once, the first time this is called."""
        if getattr(self, "_regulars_made", None):
            return
        self._regulars_made = {}
        for name, freq, spend, _days in self.REGULARS:
            r = self._safe(day, "create regular", self.ope.post, "/regulars", json={
                "name": name, "visit_frequency_per_week": freq,
                "avg_spend": spend, "expected_lifespan_years": 3.0,
                "first_visit_date": day.isoformat(),
            })
            if r:
                self._regulars_made[name] = r["id"]

    def record_regular_visits(self, day: date, rng) -> None:
        """Regulars come in on their usual days — logged during open hours."""
        made = getattr(self, "_regulars_made", None)
        if not made:
            return
        self.ope.at_local(day, 13, 0)          # mid-service, as it really happens
        for name, _freq, spend, days in self.REGULARS:
            if day.weekday() not in days or name not in made:
                continue
            if rng.random() > 0.78:            # they miss the odd visit
                continue
            amount = round(spend * rng.uniform(0.7, 1.4), 2)
            r = self.ope.try_("POST", f"/regulars/{made[name]}/visit",
                              json={"amount_paid": amount})
            if r.status_code not in (200, 201):
                self.note(day, "record regular",
                          f"{name}: {r.status_code} {self._body(r)}")

    def declare_recurring_pattern(self, day: date) -> None:
        """The owner teaches Ope about the Friday-lunch office order."""
        if getattr(self, "_pattern_made", False):
            return
        self._pattern_made = True
        self._safe(day, "recurring pattern", self.ope.post, "/recurring-patterns", json={
            "label": "Friday office lunch orders",
            "weekdays": [4],
            "hour_start": 12,
            "hour_end": 14,
            "effect": "higher",
        })

    # ── persistence ──────────────────────────────────────────────────────────

    def dump(self, name: str) -> Path:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        path = OUT_DIR / name
        path.write_text(json.dumps({
            "business_id": self.s.business_id,
            "product_ids": self.s.product_ids,
            "actuals": self.s.actuals,
            "forecasts": self.s.forecasts,
            "issues": [i.as_dict() for i in self.s.issues],
            "promos_created": self.s.promos_created,
        }, indent=1), encoding="utf-8")
        return path
