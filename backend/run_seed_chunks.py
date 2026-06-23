"""
Applies all seed_chunk_*.sql files to Supabase in order.
Run from backend/: python run_seed_chunks.py

Reads DATABASE_URL from backend/.env — the same URL the app already uses.
"""
import sys
from pathlib import Path

# ── Load DATABASE_URL — env var takes priority over .env ─────────────────────
import os
database_url = os.environ.get("DATABASE_URL")

if not database_url:
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s.startswith("DATABASE_URL"):
                database_url = s.split("=", 1)[1].strip().strip('"').strip("'")
                break

if not database_url:
    sys.exit(
        "ERROR: No DATABASE_URL found.\n"
        "Set it via environment variable:\n"
        '  $env:DATABASE_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"\n'
        "  python run_seed_chunks.py"
    )

if database_url.startswith("sqlite"):
    sys.exit(
        "ERROR: DATABASE_URL points to SQLite (local dev), not Supabase.\n"
        "Get your Postgres URL from: Supabase Dashboard → Project Settings → Database → URI\n"
        "Then run:\n"
        '  $env:DATABASE_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"\n'
        "  python run_seed_chunks.py"
    )

# ── Find chunk files ──────────────────────────────────────────────────────────
here = Path(__file__).parent
chunk_files = sorted(here.glob("seed_chunk_*.sql"))
if not chunk_files:
    sys.exit("No seed_chunk_*.sql files found — run: python gen_seed_chunks.py first")

print(f"Found {len(chunk_files)} chunk files.")

# ── Connect ───────────────────────────────────────────────────────────────────
try:
    from sqlalchemy import create_engine, text
except ImportError:
    sys.exit("sqlalchemy not installed — activate venv first: venv\\Scripts\\activate")

engine = create_engine(database_url)
print("Connecting...", end=" ", flush=True)
try:
    with engine.connect() as probe:
        probe.execute(text("SELECT 1"))
    print("OK")
except Exception as e:
    sys.exit(f"FAILED\n{e}")

# ── Execute chunks (raw connection so multi-statement SQL works) ───────────────
# Note: chunks 001-002 must succeed or the rest will break (FKs / missing tables)
STOP_EARLY_THRESHOLD = 5   # abort if any of the first N chunks fail

for i, fpath in enumerate(chunk_files, 1):
    sql = fpath.read_text(encoding="utf-8").strip()
    if not sql:
        print(f"  [{i:03d}/{len(chunk_files)}] {fpath.name}  (empty, skipped)")
        continue

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(sql)
        raw.commit()
        cur.close()
        print(f"  [{i:03d}/{len(chunk_files)}] {fpath.name}  OK")
    except Exception as e:
        raw.rollback()
        print(f"  [{i:03d}/{len(chunk_files)}] {fpath.name}  FAILED: {e}")
        raw.close()
        if i <= STOP_EARLY_THRESHOLD:
            sys.exit(f"\nAborted — critical chunk {i} failed (see error above).")
        # For later chunks (events/records), print and continue so you can see all failures
        continue
    finally:
        raw.close()

# ── Verify ────────────────────────────────────────────────────────────────────
print("\n─── Verifying row counts ───")
EXPECT = {
    "products":     (5,    "expect 5, max service_time should be 120 min"),
    "day_records":  (627,  "expect 627"),
    "sale_records": (3119, "expect 3119 (multiple products per day)"),
    "sale_events":  (27723,"expect 27723 (avg 1.61 services/customer)"),
}

with engine.connect() as conn:
    prod_count, max_svc = conn.execute(text(
        "SELECT COUNT(*), MAX(service_time_minutes) FROM products WHERE business_id = 1"
    )).fetchone()
    dr_count = conn.execute(text(
        "SELECT COUNT(*) FROM day_records WHERE business_id = 1"
    )).scalar()
    sr_count = conn.execute(text(
        "SELECT COUNT(*) FROM sale_records "
        "WHERE day_record_id IN (SELECT id FROM day_records WHERE business_id = 1)"
    )).scalar()
    ev_count = conn.execute(text(
        "SELECT COUNT(*) FROM sale_events WHERE business_id = 1"
    )).scalar()

rows = [
    ("products",     prod_count, f"(max service_time {max_svc} min — expect 120)"),
    ("day_records",  dr_count,   ""),
    ("sale_records", sr_count,   ""),
    ("sale_events",  ev_count,   ""),
]
all_ok = True
for table, got, note in rows:
    exp = EXPECT[table][0]
    status = "OK" if got == exp else f"MISMATCH (expected {exp})"
    if got != exp:
        all_ok = False
    print(f"  {table:<14}: {got:>6}  {status}  {note}")

print()
if all_ok:
    print("All counts match — data loaded successfully.")
else:
    print("Some counts don't match. Check the failed chunks above and re-run.")
