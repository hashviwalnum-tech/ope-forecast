"""
The harness: drives the real Ope API through simulated time.

Everything the simulated owner does goes through the **actual HTTP endpoints the
web app calls** — the ASGI app is exercised end to end (routing, Pydantic
validation, dependencies, business rules, the exception handler), just without a
socket in the middle.  Nothing is inserted straight into a table, and no engine
function is called directly to seed state.

The only thing bypassed is identity: `get_current_user` is overridden to return a
fixed user id instead of verifying a Supabase JWT.  That is a property of the
harness, not of the app, and it changes no business logic — every request is
still scoped through `get_business` exactly as a real one is.

SAFETY
------
`bootstrap()` refuses to run unless `DATABASE_URL` names a local SQLite file
under `backend/sim/`.  It will not start against Postgres, Supabase or anything
that is not the throwaway simulation database.
"""
from __future__ import annotations

import os
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Request

BACKEND_DIR = Path(__file__).resolve().parents[2]
SIM_DIR = BACKEND_DIR / "sim"
SIM_DB = SIM_DIR / "sim.db"

SIM_USER_ID = "00000000-0000-4000-8000-00000000ope1"
SIM_USER_ID_B = "00000000-0000-4000-8000-00000000ope2"   # second account, for isolation tests
SIM_ADMIN_KEY = "simulation-admin-key-not-a-secret"


class ApiError(RuntimeError):
    """A non-2xx response from the app, with enough context to diagnose it."""

    def __init__(self, method: str, path: str, status: int, body: Any, payload: Any = None):
        self.method, self.path, self.status, self.body, self.payload = method, path, status, body, payload
        super().__init__(f"{method} {path} → {status}: {body!r}" + (f"  payload={payload!r}" if payload else ""))


def _guard_database_url() -> None:
    url = os.environ.get("DATABASE_URL", "")
    if not url.startswith("sqlite"):
        raise RuntimeError(
            f"REFUSING TO RUN: DATABASE_URL is {url!r}. The simulation may only "
            "ever write to a local SQLite file."
        )
    for forbidden in ("supabase", "postgres", "render", "amazonaws"):
        if forbidden in url.lower():
            raise RuntimeError(f"REFUSING TO RUN: DATABASE_URL mentions {forbidden!r}.")
    if "sim.db" not in url:
        raise RuntimeError(f"REFUSING TO RUN: DATABASE_URL is not the simulation database ({url!r}).")


def prepare_env(fresh: bool = True) -> None:
    """Point the process at the simulation database.  Must run BEFORE importing app.*"""
    SIM_DIR.mkdir(parents=True, exist_ok=True)
    if fresh and SIM_DB.exists():
        SIM_DB.unlink()
    os.environ["DATABASE_URL"] = f"sqlite:///{SIM_DB.as_posix()}"
    os.environ["OPE_SIMULATED_CLOCK"] = "true"
    os.environ.setdefault("SUPABASE_URL", "https://simulation.invalid")
    os.environ.setdefault("BOT_SERVICE_KEY", "simulation-bot-key")
    os.environ["ADMIN_KEY"] = SIM_ADMIN_KEY
    os.environ.pop("RENDER", None)
    os.environ.pop("SENTRY_DSN", None)
    os.environ.pop("DEV_CATCHUP_ENABLED", None)
    _guard_database_url()


class Ope:
    """A thin, honest client for the running app."""

    def __init__(self, client, clock_mod, user_id: str = SIM_USER_ID):
        self._c = client
        self._clock = clock_mod
        self.user_id = user_id
        self.business_id: int | None = None
        self.tz = "UTC"

    # ── time ────────────────────────────────────────────────────────────────
    def at(self, moment: datetime) -> "Ope":
        """Make the app believe `moment` is now (aware, or naive-as-UTC)."""
        self._clock.freeze(moment)
        return self

    def at_local(self, day: date, hour: int, minute: int = 0) -> "Ope":
        """Make the app believe it is `hour:minute` on `day` in the business's own timezone."""
        self._clock.freeze(datetime(day.year, day.month, day.day, hour, minute,
                                    tzinfo=ZoneInfo(self.tz)))
        return self

    def now_local(self) -> datetime:
        return self._clock.now_local({"timezone": self.tz})

    # ── requests ────────────────────────────────────────────────────────────
    def _headers(self, admin: bool = False) -> dict[str, str]:
        h = {"X-Sim-User": self.user_id}
        if self.business_id is not None:
            h["X-Business-Id"] = str(self.business_id)
        if admin:
            h["X-Admin-Key"] = SIM_ADMIN_KEY
        return h

    def _call(self, method: str, path: str, *, json=None, params=None,
              expect: tuple[int, ...] = (200, 201, 204), admin: bool = False, raw: bool = False):
        r = self._c.request(method, path, json=json, params=params, headers=self._headers(admin))
        if raw:
            return r
        if r.status_code not in expect:
            try:
                body = r.json()
            except Exception:
                body = r.text[:400]
            raise ApiError(method, path, r.status_code, body, json)
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    def get(self, path, **kw):    return self._call("GET", path, **kw)
    def post(self, path, **kw):   return self._call("POST", path, **kw)
    def put(self, path, **kw):    return self._call("PUT", path, **kw)
    def patch(self, path, **kw):  return self._call("PATCH", path, **kw)
    def delete(self, path, **kw): return self._call("DELETE", path, expect=(204, 200), **kw)

    def try_(self, method: str, path: str, **kw):
        """Make a call and return the raw response — for testing that limits BLOCK."""
        return self._call(method, path, raw=True, **kw)

    # ── convenience ─────────────────────────────────────────────────────────
    def set_tier(self, tier: str) -> None:
        self.patch("/businesses/me/tier", json={"tier": tier}, admin=True)

    def use_business(self, business_id: int, tz: str | None = None) -> None:
        self.business_id = business_id
        if tz:
            self.tz = tz


def bootstrap(fresh: bool = True):
    """Prepare the environment, import the app, and return (Ope, app, clock)."""
    prepare_env(fresh=fresh)

    from fastapi.testclient import TestClient          # noqa: E402
    from app import clock as clock_mod                 # noqa: E402
    from app.api.deps import get_current_user          # noqa: E402
    from app.db import get_db                          # noqa: E402
    from app.main import app                           # noqa: E402

    _guard_database_url()

    def _sim_user(request: Request) -> str:
        # Identity only — every downstream scoping rule still applies.
        return request.headers.get("X-Sim-User", SIM_USER_ID)

    app.dependency_overrides[get_current_user] = _sim_user

    client = TestClient(app)
    client.__enter__()          # runs lifespan → create_all + migrations
    return Ope(client, clock_mod), app, clock_mod


def teardown(ope: Ope) -> None:
    try:
        ope._c.__exit__(None, None, None)
    except Exception:
        pass
