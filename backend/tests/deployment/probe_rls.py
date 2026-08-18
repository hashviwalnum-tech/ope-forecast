"""
Check whether the PUBLISHED anon key can reach the database.

The Supabase anon key is public by design — it is compiled into every web
bundle and every mobile build. What stops it reading the database is Row Level
Security, nothing else. This asks the live project, from outside, whether that
is actually true.

Run it against staging or production any time, and always after adding a table:

    python -m tests.deployment.probe_rls                 (from backend/)
    python -m tests.deployment.probe_rls --env ../mobile/.env

How it decides, without reading or changing any data: it attempts to INSERT an
empty row, which fails either way, and reads the error code.

    42501  -> row-level security refused it        -> PROTECTED
    23502  -> only a NOT NULL constraint refused it -> RLS is OFF, table is OPEN

Nothing is written, nothing is read, and no row can be modified.

Exit code 0 = every table protected. 1 = at least one table open.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Every table the app defines. Keep this in step with app/models/ — the whole
# point is that a NEW table is exactly what gets forgotten.
TABLES = [
    "businesses", "day_records", "sale_records", "sale_events", "products",
    "regulars", "regular_daily_spends", "periods", "recurring_patterns",
    "forecast_runs", "order_records", "stock_batches", "service_consumables",
    "booked_counts", "service_booked_counts", "subscriptions", "telegram_links",
    "tuner_state", "tuner_log",
]

RLS_BLOCKED = "42501"
CONSTRAINT_BLOCKED = {"23502", "23503", "23514", "42703", "PGRST204"}


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def probe(base: str, key: str, table: str) -> tuple[str, str]:
    """Returns (verdict, detail). Never reads or writes any row."""
    req = urllib.request.Request(
        f"{base}/rest/v1/{table}",
        method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"},
        data=b"{}",
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            return "OPEN", "an empty INSERT was accepted outright"
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode())
        except Exception:
            err = {}
        code = str(err.get("code", f"http{e.code}"))
        if code == RLS_BLOCKED:
            return "PROTECTED", "row-level security refused it"
        if code in CONSTRAINT_BLOCKED:
            return "OPEN", f"only a column constraint refused it ({code})"
        if e.code in (404, 406):
            return "ABSENT", "table not exposed / does not exist"
        return "UNKNOWN", f"{code}: {str(err.get('message', ''))[:60]}"
    except Exception as e:  # network, DNS, timeout
        return "UNKNOWN", f"{type(e).__name__}: {e}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default="../mobile/.env",
                    help="file holding SUPABASE_URL and ANON_KEY (default: ../mobile/.env)")
    args = ap.parse_args()

    env_path = (Path(__file__).resolve().parents[2] / args.env).resolve()
    if not env_path.exists():
        print(f"No env file at {env_path}.")
        print("Point --env at a file with the Supabase URL and anon key.")
        return 2
    env = load_env(env_path)

    base = next((env[k].rstrip("/") for k in env
                 if k.endswith("SUPABASE_URL")), None)
    key = next((env[k] for k in env if k.endswith("SUPABASE_ANON_KEY")), None)
    if not base or not key:
        print(f"{env_path} has no SUPABASE_URL / SUPABASE_ANON_KEY.")
        return 2

    project = base.split("//")[-1].split(".")[0]
    print(f"Probing project {project[:6]}… with the PUBLISHED anon key")
    print("(the one shipped in every web and mobile build)\n")

    open_tables, unknown = [], []
    for t in TABLES:
        verdict, detail = probe(base, key, t)
        mark = {"PROTECTED": "  ok  ", "OPEN": " OPEN ", "ABSENT": "  --  "}.get(verdict, "  ??  ")
        print(f"[{mark}] {t:<24} {detail}")
        if verdict == "OPEN":
            open_tables.append(t)
        elif verdict == "UNKNOWN":
            unknown.append(t)

    print()
    if open_tables:
        print(f"*** {len(open_tables)} TABLE(S) OPEN TO THE PUBLIC ANON KEY ***")
        for t in open_tables:
            print(f"      {t}")
        print("\nAnyone who opens the app in a browser has this key. These tables are")
        print("readable, writable and deletable by them right now.")
        print("Fix: run migrations/001_enable_rls_all_tables.sql, then re-run this.")
    else:
        print("All tables protected — the anon key cannot reach the database.")
    if unknown:
        print(f"\nCould not determine: {', '.join(unknown)}")
    return 1 if open_tables else 0


if __name__ == "__main__":
    sys.exit(main())
