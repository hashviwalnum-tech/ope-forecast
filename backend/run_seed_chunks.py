"""
Applies all seed_chunk_*.sql files to Supabase in order.
Run from backend/: python run_seed_chunks.py

Reads DATABASE_URL from backend/.env — the same URL the app already uses.
Tip: use the Supabase connection POOLER URL (port 6543, transaction mode)
     instead of the direct URL (port 5432) for more stable bulk loads.
     Find it at: Supabase Dashboard → Settings → Database → Connection Pooling
     → "Transaction" mode → copy the connection string.
"""
import sys
import time
from pathlib import Path
import os

# ── Load DATABASE_URL — env var takes priority over .env ─────────────────────
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
        "Get your Postgres URL from: Supabase Dashboard → Settings → Database → URI\n"
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
print("  Chunk 001 will DELETE all existing data for business_id=1 — safe to re-run.\n")

# ── psycopg2 import ───────────────────────────────────────────────────────────
try:
    import psycopg2
except ImportError:
    sys.exit("psycopg2 not installed — activate venv first: venv\\Scripts\\activate")

MAX_RETRIES = 3
RETRY_DELAY = 5       # seconds between retry attempts
STOP_EARLY_THRESHOLD = 5   # abort if any of the first N chunks fail


def open_conn():
    """Fresh psycopg2 connection each call — no pool, no stale sockets."""
    return psycopg2.connect(database_url)


# ── Probe connection ──────────────────────────────────────────────────────────
print("Connecting...", end=" ", flush=True)
try:
    _c = open_conn()
    _c.cursor().execute("SELECT 1")
    _c.close()
    print("OK\n")
except Exception as e:
    sys.exit(f"FAILED\n{e}")

# ── Execute chunks ────────────────────────────────────────────────────────────
failed_chunks = []

for i, fpath in enumerate(chunk_files, 1):
    sql = fpath.read_text(encoding="utf-8").strip()
    if not sql:
        print(f"  [{i:03d}/{len(chunk_files)}] {fpath.name}  (empty, skipped)")
        continue

    success = False
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            conn = open_conn()
            try:
                cur = conn.cursor()
                cur.execute(sql)
                conn.commit()
                cur.close()
                success = True
            finally:
                conn.close()
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES:
                print(
                    f"  [{i:03d}/{len(chunk_files)}] {fpath.name}"
                    f"  attempt {attempt} FAILED: {e}"
                    f"  (retrying in {RETRY_DELAY}s...)"
                )
                time.sleep(RETRY_DELAY)
            else:
                print(
                    f"  [{i:03d}/{len(chunk_files)}] {fpath.name}"
                    f"  FAILED after {MAX_RETRIES} attempts: {e}"
                )

        if success:
            break

    if success:
        print(f"  [{i:03d}/{len(chunk_files)}] {fpath.name}  OK")
    else:
        failed_chunks.append(fpath.name)
        if i <= STOP_EARLY_THRESHOLD:
            sys.exit(f"\nAborted — critical chunk {i} failed (see above).")

if failed_chunks:
    print(f"\nChunks that failed after {MAX_RETRIES} retries: {', '.join(failed_chunks)}")

# ── Verify ────────────────────────────────────────────────────────────────────
print("\n─── Verifying row counts ───")
EXPECT = {
    "products":     (5,    "expect 5, max service_time should be 120 min"),
    "day_records":  (627,  "expect 627"),
    "sale_records": (3119, "expect 3119 (multiple products per day)"),
    "sale_events":  (27723,"expect 27723 (avg 1.61 services/customer)"),
}

try:
    conn = open_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*), MAX(service_time_minutes) FROM products WHERE business_id = 1")
    prod_count, max_svc = cur.fetchone()
    cur.execute("SELECT COUNT(*) FROM day_records WHERE business_id = 1")
    dr_count = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM sale_records "
        "WHERE day_record_id IN (SELECT id FROM day_records WHERE business_id = 1)"
    )
    sr_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM sale_events WHERE business_id = 1")
    ev_count = cur.fetchone()[0]
    cur.close()
    conn.close()
except Exception as e:
    sys.exit(f"\nVerification query failed: {e}")

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
