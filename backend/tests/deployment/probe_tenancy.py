"""
Ask the LIVE deployment whether one business's data can reach another.

``probe_rls`` checks the database's own last line of defence — that the
published anon key cannot read a table.  This checks the line in front of it:
the API itself, running on Render against Postgres, with two real signed-in
accounts.  Neither had ever been exercised outside SQLite and a stubbed login.

It signs up two throwaway accounts through the real Supabase auth endpoint,
gives one of them a business with data, and then tries every way one tenant
could ask for the other's:

  * no token at all
  * a valid token for the wrong tenant, naming the other's business id
  * deleting, reading and writing the other's business by id

Every business it creates is deleted again at the end.  The two Supabase
users remain — removing a user needs the service-role key, which this script
deliberately does not hold.  They own nothing once the businesses are gone.

    python -m tests.deployment.probe_tenancy                (from backend/)
    python -m tests.deployment.probe_tenancy --api http://localhost:8000

Exit code 0 = every isolation check held. 1 = at least one did not.
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

DEFAULT_API = "https://ope-forecast-dj78.onrender.com"
TIMEOUT = 60


# --------------------------------------------------------------------------
# plumbing
# --------------------------------------------------------------------------

def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def request(url: str, method: str = "GET", body=None, headers=None):
    """Returns (status, parsed-body-or-text). Never raises on an HTTP error."""
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, headers=h, data=data)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read().decode()
            try:
                return r.status, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, raw
    except Exception as e:                      # network, DNS, timeout
        return 0, f"{type(e).__name__}: {e}"


def _clock_drift(server_time) -> float | None:
    """Seconds between the backend's idea of now and this machine's."""
    if not isinstance(server_time, str):
        return None
    try:
        from datetime import datetime, timezone
        then = datetime.fromisoformat(server_time)
        if then.tzinfo is None:
            then = then.replace(tzinfo=timezone.utc)
        return abs((datetime.now(timezone.utc) - then).total_seconds())
    except ValueError:
        return None


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.notes: list[str] = []

    def check(self, ok: bool, name: str, detail: str = "") -> bool:
        mark = "  ok  " if ok else " FAIL "
        line = f"[{mark}] {name}"
        if detail:
            line += f"  - {detail}"
        print(line)
        if not ok:
            self.failures.append(name)
        return ok

    def note(self, text: str) -> None:
        print(f"[ note ] {text}")
        self.notes.append(text)


# --------------------------------------------------------------------------
# accounts
# --------------------------------------------------------------------------

class Tenant:
    def __init__(self, supabase: str, key: str, label: str) -> None:
        self.label = label
        self.email = f"ope-livecheck-{label}-{secrets.token_hex(4)}@example.com"
        self.password = "Lv" + secrets.token_urlsafe(16) + "9!"
        self.supabase = supabase
        self.key = key
        self.token: str | None = None
        self.business_id: int | None = None
        self.owned: list[int] = []

    def _auth(self, path: str, body: dict):
        return request(f"{self.supabase}{path}", "POST", body, {"apikey": self.key})

    def sign_up(self):
        return self._auth("/auth/v1/signup",
                          {"email": self.email, "password": self.password})

    def log_in(self):
        status, body = self._auth("/auth/v1/token?grant_type=password",
                                  {"email": self.email, "password": self.password})
        if status == 200 and isinstance(body, dict):
            self.token = body.get("access_token")
        return status, body

    def headers(self, business_id: int | None = None) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self.token}"}
        if business_id is not None:
            h["X-Business-Id"] = str(business_id)
        return h


# --------------------------------------------------------------------------
# the probe
# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=DEFAULT_API, help="backend base URL")
    ap.add_argument("--env", default="../mobile/.env",
                    help="file holding SUPABASE_URL and ANON_KEY")
    ap.add_argument("--keep", action="store_true",
                    help="skip cleanup (leaves the throwaway businesses behind)")
    args = ap.parse_args()
    api = args.api.rstrip("/")

    env_path = (Path(__file__).resolve().parents[2] / args.env).resolve()
    if not env_path.exists():
        print(f"No env file at {env_path}.")
        return 2
    env = load_env(env_path)
    supabase = next((env[k].rstrip("/") for k in env if k.endswith("SUPABASE_URL")), None)
    anon = next((env[k] for k in env if k.endswith("SUPABASE_ANON_KEY")), None)
    if not supabase or not anon:
        print(f"{env_path} has no SUPABASE_URL / SUPABASE_ANON_KEY.")
        return 2

    r = Report()
    print(f"Backend  {api}")
    print(f"Supabase {supabase}")
    print()

    status, health = request(f"{api}/health")
    if not r.check(status == 200, "backend is reachable", f"GET /health -> {status}"):
        return 1

    # The simulated clock is refused by three guards in app.clock, all pinned by
    # unit tests. Unit tests prove the code refuses; only this proves that THIS
    # deployment refuses. A backend inventing dates would corrupt every forecast
    # silently.
    reported = health.get("clock") if isinstance(health, dict) else None
    if reported is None:
        r.note("This backend predates the clock field on /health, so whether the "
               "simulated clock is off could not be checked from outside.")
    else:
        r.check(reported == "live",
                "the test-only simulated clock is NOT active in production",
                f"clock={reported}")
        drift = _clock_drift(health.get("server_time"))
        r.check(drift is not None and drift < 120,
                "the backend's clock agrees with real time",
                f"{drift:.0f}s apart" if drift is not None else "unreadable")

    reporting = health.get("error_reporting") if isinstance(health, dict) else None
    if reporting is False:
        r.note("SENTRY_DSN is not set on this deployment: crashes are logged to "
               "the console and reported nowhere. A beta user hitting one gives "
               "up quietly and no one finds out.")
    elif reporting is True:
        r.check(True, "errors are reported to the monitoring service",
                "SENTRY_DSN is set")

    # -- how signup actually behaves on this project ------------------------
    _, settings = request(f"{supabase}/auth/v1/settings", headers={"apikey": anon})
    if isinstance(settings, dict):
        if settings.get("mailer_autoconfirm"):
            r.note("Supabase has mailer_autoconfirm ON: signups are confirmed "
                   "instantly and NO confirmation email is sent. Anyone can "
                   "register an address they do not own.")
        if settings.get("disable_signup"):
            r.note("Signup is disabled on this project.")

    a = Tenant(supabase, anon, "a")
    b = Tenant(supabase, anon, "b")

    for t in (a, b):
        status, body = t.sign_up()
        if not r.check(status in (200, 201), f"tenant {t.label}: signup accepted",
                       f"{status} {str(body)[:80]}"):
            return 1
        status, _ = t.log_in()
        if not r.check(status == 200 and bool(t.token),
                       f"tenant {t.label}: login returns a token", str(status)):
            return 1

    try:
        return run_checks(r, api, a, b)
    finally:
        if not args.keep:
            cleanup(r, api, a, b)
        print()
        if r.failures:
            print(f"{len(r.failures)} check(s) FAILED: " + ", ".join(r.failures))
        else:
            print("Every isolation check held.")
        if r.notes:
            print()
            print("Worth knowing:")
            for n in r.notes:
                print(f"  - {n}")


def run_checks(r: Report, api: str, a: Tenant, b: Tenant) -> int:
    # -- each tenant gets a business ---------------------------------------
    for t, name in ((a, "Live check A"), (b, "Live check B")):
        status, body = request(f"{api}/businesses", "POST",
                               {"name": name, "timezone": "Asia/Jerusalem"},
                               t.headers())
        if not r.check(status == 201 and isinstance(body, dict),
                       f"tenant {t.label}: can create its own business",
                       f"{status} {str(body)[:90]}"):
            return 1
        t.business_id = body["id"]
        t.owned.append(body["id"])

    # Both tenants get a second location. B needs one so the delete below is not
    # stopped by the "cannot delete your only location" rule before it reaches
    # the ownership check, which is the thing actually being tested; A needs one
    # so that at cleanup the business holding data is the deletable one, and what
    # survives in the live database is an empty shell.
    for t in (a, b):
        status, body = request(f"{api}/businesses", "POST",
                               {"name": f"Live check {t.label.upper()} spare",
                                "timezone": "Asia/Jerusalem"},
                               t.headers())
        if r.check(status == 201, f"tenant {t.label}: can add a second location",
                   str(status)):
            t.owned.append(body["id"])

    r.check(a.business_id != b.business_id, "the two businesses are distinct",
            f"A={a.business_id} B={b.business_id}")

    # -- A puts real data behind its own login ------------------------------
    status, _ = request(f"{api}/products", "POST",
                        {"name": "Live check loaf", "unit": "loaf", "lead_time_days": 2},
                        a.headers(a.business_id))
    r.check(status == 201, "tenant a: can create a product", str(status))

    today = date.today()
    written = 0
    for i in range(1, 22):
        d = today - timedelta(days=i)
        status, _ = request(f"{api}/day-records", "POST",
                            {"date": d.isoformat(), "customers": 40 + (i % 7) * 5},
                            a.headers(a.business_id))
        if status == 201:
            written += 1
    r.check(written >= 14, "tenant a: can write day records",
            f"{written} of 21 accepted")

    # -- no token at all ----------------------------------------------------
    for path in ("/businesses", "/day-records", "/products", "/forecast"):
        status, _ = request(f"{api}{path}")
        r.check(status == 401, f"anonymous request to {path} is refused", str(status))

    # -- B, signed in, asks for A's business by id ---------------------------
    status, body = request(f"{api}/businesses/me", headers=b.headers(a.business_id))
    got_id = body.get("id") if isinstance(body, dict) else body
    r.check(status == 200 and got_id != a.business_id,
            "tenant b naming A's business id gets its OWN business back",
            f"{status}, id={got_id}")

    status, body = request(f"{api}/day-records", headers=b.headers(a.business_id))
    rows = body if isinstance(body, list) else []
    foreign = [row for row in rows if row.get("business_id") == a.business_id]
    r.check(status == 200 and not foreign,
            "tenant b cannot read A's day records via the business-id header",
            f"{len(rows)} row(s) returned, {len(foreign)} of them A's")

    status, body = request(f"{api}/products", headers=b.headers(a.business_id))
    rows = body if isinstance(body, list) else []
    r.check(status == 200 and not rows,
            "tenant b cannot read A's products via the business-id header",
            f"{len(rows)} row(s) returned")

    # -- B tries to destroy A's business ------------------------------------
    status, body = request(f"{api}/businesses/{a.business_id}", "DELETE",
                           headers=b.headers())
    r.check(status == 404,
            "tenant b, past its own delete guard, still cannot delete A's business",
            f"{status} {str(body)[:60]}")

    status, body = request(f"{api}/businesses", headers=a.headers())
    still_there = isinstance(body, list) and any(x.get("id") == a.business_id for x in body)
    r.check(still_there, "A's business survived B's delete attempt")

    # -- B tries to write into A's business ---------------------------------
    probe_date = (today - timedelta(days=40)).isoformat()
    status, _ = request(f"{api}/day-records", "POST",
                        {"date": probe_date, "customers": 999},
                        b.headers(a.business_id))
    if status == 201:
        _, rows = request(f"{api}/day-records", headers=a.headers(a.business_id))
        landed = isinstance(rows, list) and any(
            x.get("date") == probe_date and x.get("customers") == 999 for x in rows)
        r.check(not landed, "a write B aimed at A's business did not land in A's data")
    else:
        r.check(True, "a write B aimed at A's business did not land in A's data",
                f"refused outright ({status})")

    # -- a forecast comes back for A, on Postgres ---------------------------
    status, body = request(f"{api}/forecast", headers=a.headers(a.business_id))
    ok = status == 200 and isinstance(body, dict)
    r.check(ok, "a forecast runs against Postgres for A", str(status))
    if ok:
        print(f"          {json.dumps(body)[:160]}")

    return 1 if r.failures else 0


def cleanup(r: Report, api: str, *tenants: Tenant) -> None:
    """Delete every throwaway business the API will let go of.

    One empty shell per tenant survives: the API refuses to delete an account's
    last location, by design, and that rule is not worth a back door. The
    surviving rows hold no records — the data-bearing one is always deleted
    first — and the SQL to remove them is printed below.
    """
    print()
    left_behind: list[int] = []
    for t in tenants:
        # data-bearing business first, so whatever survives is the empty one
        for bid in sorted(t.owned, key=lambda x: x != t.business_id):
            status, _ = request(f"{api}/businesses/{bid}", "DELETE", headers=t.headers())
            if status in (204, 404):
                r.check(True, f"tenant {t.label}: business {bid} deleted", str(status))
            else:
                left_behind.append(bid)
                r.check(bid != t.business_id,
                        f"tenant {t.label}: the business holding data was deleted",
                        f"business {bid} could not be removed ({status})")
    if left_behind:
        ids = ", ".join(str(i) for i in left_behind)
        r.note(f"Empty placeholder business(es) {ids} remain — the API will not "
               f"delete an account's last location. To remove them: "
               f"DELETE FROM businesses WHERE id IN ({ids});")
    r.note("The throwaway Supabase users remain (deleting a user needs the "
           "service-role key). They own no data.")


if __name__ == "__main__":
    sys.exit(main())
