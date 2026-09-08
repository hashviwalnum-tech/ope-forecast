"""Does the deployed app on Postgres compute what the same code computes on SQLite?

Every simulation to date ran against a local SQLite file with the login stubbed
out, because `tests/simulation/harness.py` refuses to run against anything else
and freezes the clock, which production refuses. So the engine's numbers had
never been produced by Postgres. The places the two databases genuinely differ
are worth being nervous about: `float` versus `NUMERIC` rounding, `JSON` versus
`JSONB` key order, date and timestamp handling, `ORDER BY` on ties, and whether
a failed request leaves a partial write behind.

This drives the *same* deterministic three weeks of trading through both:

  * the live deployment, over HTTPS, as a real signed-in throwaway tenant
  * a local SQLite database, in-process, through the identical endpoints

and then compares what the analytics endpoints answer. Ids, timestamps and
anything else that cannot match between two databases are normalised away
first; everything the engine computed has to be identical.

    python -m tests.deployment.probe_postgres_parity
    python -m tests.deployment.probe_postgres_parity --api http://localhost:8000

The clock is NOT frozen — production would refuse — so the fixture is anchored
to real recent dates and both sides are built within the same run.

Exit code 0 = the two agree. 1 = they do not.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

from tests.deployment.probe_tenancy import Report, Tenant, load_env, request

DEFAULT_API = "https://ope-forecast-dj78.onrender.com"

# Three weeks, so the ensemble has several of each weekday to weight; plus a
# few days beyond so the accuracy window has something to score.
DAYS = 24

BUSINESS_SETTINGS = {
    "currency": "ILS",
    "opening_hour": 8,
    "closing_hour": 18,
    "opening_days": [0, 1, 2, 3, 4, 6],       # closed Saturday
    "target_service_level": 0.95,
}

PRODUCTS = [
    {"name": "Parity loaf", "unit": "loaf", "lead_time_days": 2,
     "unit_mode": "whole", "price": 12.5, "current_stock": 40},
    {"name": "Parity coffee", "unit": "cup", "lead_time_days": 1,
     "unit_mode": "whole", "price": 9.0, "current_stock": 100},
]

# Endpoints whose answers are pure functions of the data. If Postgres and
# SQLite disagree on any of these, the engine is seeing different inputs.
COMPARED = [
    "/day-records",
    "/products",
    "/forecast",
    "/weekday-averages",
    "/ordering",
    "/accuracy",
    "/monthly-summary",
    "/product-forecast",
    "/outliers",
    "/insights",
    "/hourly-by-weekday",
]

# Keys that cannot match across two independent databases and say nothing about
# the maths: primary keys, foreign keys and wall-clock stamps.
VOLATILE_KEYS = {
    "id", "business_id", "day_record_id", "product_id", "record_id",
    "regular_id", "period_id", "order_id", "target_product_id",
    "created_at", "updated_at", "ordered_date", "expected_arrival_date",
}


# --------------------------------------------------------------------------
# the fixture — identical on both sides, derived from nothing but the dates
# --------------------------------------------------------------------------

def fixture_days(today: date) -> list[dict]:
    """A deterministic three weeks. No randomness: the two runs must match."""
    out = []
    for i in range(DAYS, 0, -1):
        d = today - timedelta(days=i)
        if d.weekday() == 5:                  # closed Saturday
            continue
        # A plain weekday shape plus a slow upward drift, so the trend model has
        # something to find and the weekday model has something to separate.
        base = [46, 44, 48, 52, 61, 0, 39][d.weekday()]
        customers = base + (DAYS - i) // 3
        out.append({
            "date": d.isoformat(),
            "customers": customers,
            "loaf": round(customers * 0.55),
            "coffee": round(customers * 0.8),
        })
    return out


def build(client, r: Report, label: str, today: date) -> bool:
    """Create a business and drive the same three weeks into it."""
    status, biz = client.post("/businesses",
                              {"name": f"Parity {label}", "timezone": "Asia/Jerusalem"})
    if not r.check(status == 201, f"{label}: business created", str(status)):
        return False
    client.business_id = biz["id"]

    status, _ = client.patch("/businesses/me/settings", BUSINESS_SETTINGS)
    if not r.check(status == 200, f"{label}: settings saved", str(status)):
        return False

    product_ids = []
    for p in PRODUCTS:
        status, body = client.post("/products", p)
        if not r.check(status == 201, f"{label}: product {p['name']} created",
                       f"{status} {str(body)[:80]}"):
            return False
        product_ids.append(body["id"])

    written = 0
    for row in fixture_days(today):
        status, rec = client.post("/day-records",
                                  {"date": row["date"], "customers": row["customers"]})
        if status != 201:
            continue
        written += 1
        for pid, key in zip(product_ids, ("loaf", "coffee")):
            client.post("/sales", {"day_record_id": rec["id"],
                                   "product_id": pid, "units_sold": row[key]})
    if not r.check(written >= 18, f"{label}: day records written", f"{written}"):
        return False

    # An event period, so the lift path and the baseline exclusion are exercised.
    start = today - timedelta(days=9)
    status, _ = client.post("/periods", {
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=1)).isoformat(),
        "type": "ad", "label": "Parity ad", "cost": 200.0,
        "target_product_id": product_ids[0],
    })
    r.check(status == 201, f"{label}: ad period created", str(status))
    return True


# --------------------------------------------------------------------------
# comparison
# --------------------------------------------------------------------------

def normalise(value):
    """Strip everything that cannot match between two databases."""
    if isinstance(value, dict):
        return {k: normalise(v) for k, v in sorted(value.items())
                if k not in VOLATILE_KEYS}
    if isinstance(value, list):
        return [normalise(v) for v in value]
    if isinstance(value, float):
        # Postgres and SQLite can differ in the last bit of a float; six places
        # is far finer than anything the app ever shows.
        return round(value, 6)
    return value


def first_difference(a, b, path: str = "") -> str | None:
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                return f"{path}.{k}: missing on Postgres"
            if k not in b:
                return f"{path}.{k}: missing on SQLite"
            d = first_difference(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: {len(a)} item(s) on Postgres, {len(b)} on SQLite"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    if a != b:
        return f"{path}: Postgres {a!r} vs SQLite {b!r}"
    return None


# --------------------------------------------------------------------------
# the two clients
# --------------------------------------------------------------------------

class LiveClient:
    """The deployed app, over HTTPS, as a real signed-in tenant."""

    def __init__(self, api: str, tenant: Tenant) -> None:
        self.api = api.rstrip("/")
        self.tenant = tenant
        self.business_id: int | None = None
        self.owned: list[int] = []

    def _headers(self):
        h = {"Authorization": f"Bearer {self.tenant.token}"}
        if self.business_id is not None:
            h["X-Business-Id"] = str(self.business_id)
        return h

    def get(self, path):
        return request(f"{self.api}{path}", headers=self._headers())

    def post(self, path, body):
        status, out = request(f"{self.api}{path}", "POST", body, self._headers())
        if path == "/businesses" and status == 201:
            self.owned.append(out["id"])
        return status, out

    def patch(self, path, body):
        return request(f"{self.api}{path}", "PATCH", body, self._headers())

    def delete(self, path):
        return request(f"{self.api}{path}", "DELETE", headers=self._headers())


class LocalClient:
    """The same code, in-process, against a throwaway SQLite file."""

    def __init__(self) -> None:
        self.business_id: int | None = None
        self.tmpdir = tempfile.mkdtemp(prefix="ope-parity-")
        db_path = Path(self.tmpdir) / "parity.db"
        os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
        os.environ.setdefault("SUPABASE_URL", "https://unused.invalid")
        os.environ.setdefault("BOT_SERVICE_KEY", "unused")

        from fastapi.testclient import TestClient
        from app.api.deps import get_current_user
        from app.db import engine
        from app.main import app
        from app.models import Base

        Base.metadata.create_all(engine)
        app.dependency_overrides[get_current_user] = lambda: "parity-local-user"
        self._client = TestClient(app)
        self._app = app

    def _headers(self):
        return ({"X-Business-Id": str(self.business_id)}
                if self.business_id is not None else {})

    def _call(self, method, path, body=None):
        fn = getattr(self._client, method)
        resp = fn(path, json=body, headers=self._headers()) if body is not None \
            else fn(path, headers=self._headers())
        try:
            return resp.status_code, resp.json()
        except ValueError:
            return resp.status_code, resp.text

    def get(self, path):
        return self._call("get", path)

    def post(self, path, body):
        return self._call("post", path, body)

    def patch(self, path, body):
        return self._call("patch", path, body)

    def close(self):
        from app.api.deps import get_current_user
        self._app.dependency_overrides.pop(get_current_user, None)


# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=DEFAULT_API)
    ap.add_argument("--env", default="../mobile/.env")
    ap.add_argument("--keep", action="store_true",
                    help="leave the throwaway live business in place")
    args = ap.parse_args()

    env_path = (Path(__file__).resolve().parents[2] / args.env).resolve()
    env = load_env(env_path) if env_path.exists() else {}
    supabase = next((env[k].rstrip("/") for k in env if k.endswith("SUPABASE_URL")), None)
    anon = next((env[k] for k in env if k.endswith("SUPABASE_ANON_KEY")), None)
    if not supabase or not anon:
        print(f"{env_path} has no SUPABASE_URL / SUPABASE_ANON_KEY.")
        return 2

    r = Report()
    today = date.today()
    print(f"Backend  {args.api}")
    print(f"Fixture  {DAYS} days ending {today - timedelta(days=1)}")
    print()

    tenant = Tenant(supabase, anon, "parity")
    status, _ = tenant.sign_up()
    if not r.check(status in (200, 201), "throwaway account signed up", str(status)):
        return 1
    status, _ = tenant.log_in()
    if not r.check(status == 200 and bool(tenant.token), "logged in", str(status)):
        return 1

    live = LiveClient(args.api, tenant)
    if not build(live, r, "postgres", today):
        return 1

    # A spare location, so the data-bearing one can be deleted at the end.
    live.post("/businesses", {"name": "Parity spare", "timezone": "Asia/Jerusalem"})

    local = LocalClient()
    try:
        if not build(local, r, "sqlite", today):
            return 1

        print()
        for path in COMPARED:
            s_live, b_live = live.get(path)
            s_local, b_local = local.get(path)
            if not r.check(s_live == s_local, f"{path}: same status code",
                           f"Postgres {s_live}, SQLite {s_local}"):
                continue
            diff = first_difference(normalise(b_live), normalise(b_local), path)
            r.check(diff is None, f"{path}: same answer", diff or "")
    finally:
        local.close()
        if not args.keep:
            print()
            for bid in sorted(live.owned, key=lambda x: x != live.business_id):
                status, _ = live.delete(f"/businesses/{bid}")
                if status in (204, 404):
                    r.check(True, f"throwaway business {bid} deleted", str(status))
                else:
                    r.check(bid != live.business_id,
                            "the business holding data was deleted",
                            f"business {bid} could not be removed ({status})")
        print()
        if r.failures:
            print(f"{len(r.failures)} check(s) FAILED: " + ", ".join(r.failures))
        else:
            print("Postgres and SQLite agree on every compared endpoint.")

    return 1 if r.failures else 0


if __name__ == "__main__":
    sys.exit(main())
