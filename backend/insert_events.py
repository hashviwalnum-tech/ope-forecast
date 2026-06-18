"""
Inserts sale_events for business_id=1 via Supabase REST API.
Uses the same deterministic seed as gen_seed_chunks.py.
RLS is disabled on sale_events so anon key is sufficient.
"""
import random
import json
import sys
from datetime import date, datetime, timedelta

import urllib.request
import urllib.error
import ssl

_ctx = ssl.create_default_context()

random.seed(42)

SUPABASE_URL  = "https://nyktzxkkoworphvnurrp.supabase.co"
ANON_KEY      = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55a3R6eGtrb3dvcnBodm51cnJwIiwicm9sZSI6Im"
    "Fub24iLCJpYXQiOjE3ODAxNDYyNDUsImV4cCI6MjA5NTcyMjI0NX0"
    ".7OdJCGIBr_8z6YGaovt9B-zR5WqCsm3I5etspbzUId8"
)
HEADERS = {
    "apikey":        ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",
}

BUSINESS_ID = 1
PRODUCT_ID  = 2
START_DATE  = date(2024, 6, 17)
END_DATE    = date(2026, 6, 18)
OPEN_DAYS   = {0, 1, 2, 3, 4, 6}

BASE: dict[int, int] = {0:22, 1:26, 2:28, 3:32, 4:45, 6:36}
SEASONAL = {1:0.72,2:0.75,3:0.85,4:0.95,5:1.00,
            6:1.05,7:1.22,8:1.18,9:1.02,10:0.95,11:0.88,12:1.18}
NOISE=0.15; PROD_PCT=0.85; YOY=0.10
HOURS=list(range(9,19)); HW=[5,8,14,12,8,6,9,15,12,11]


def is_dst(d):
    def last_sun(yr, mo):
        s = date(yr+1,1,1) if mo==12 else date(yr,mo+1,1)
        last = s - timedelta(days=1)
        return last - timedelta(days=(last.weekday()+1)%7)
    return last_sun(d.year,3) <= d < last_sun(d.year,10)

def to_utc_str(d, h, m):
    off = 3 if is_dst(d) else 2
    dt = datetime(d.year,d.month,d.day,h,m) - timedelta(hours=off)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")

def pick_hour():
    r = random.random()*100; c=0.0
    for h,w in zip(HOURS,HW):
        c+=w
        if r<c: return h
    return HOURS[-1]

def yr(d): return 1.0+YOY if d>=date(2025,6,17) else 1.0


# Replay exactly the same random sequence as gen_seed_chunks.py
# (must skip the day_record + sale_record randomness first)
events = []

cur = START_DATE
while cur <= END_DATE:
    if cur.weekday() in OPEN_DAYS:
        cust = max(5, round(
            BASE[cur.weekday()] * SEASONAL[cur.month] * yr(cur) * (1+random.uniform(-NOISE,NOISE))
        ))
        units = max(0, round(cust * (PROD_PCT + random.uniform(-0.05, 0.05))))

        flags = [True]*units + [False]*(cust-units)
        random.shuffle(flags)
        for wp in flags:
            h, m = pick_hour(), random.randint(0, 59)
            events.append({
                "business_id": BUSINESS_ID,
                "product_id":  PRODUCT_ID if wp else None,
                "timestamp":   to_utc_str(cur, h, m),
                "quantity":    1.0,
            })
    cur += timedelta(days=1)

print(f"Generated {len(events)} events", flush=True)


# ── Batch-insert via Supabase REST API ────────────────────────────────────────
BATCH = 500
url   = f"{SUPABASE_URL}/rest/v1/sale_events"
total_inserted = 0

for i in range(0, len(events), BATCH):
    batch = events[i:i+BATCH]
    body  = json.dumps(batch).encode("utf-8")
    req   = urllib.request.Request(url, data=body, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ctx) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        print(f"\nERROR at batch {i//BATCH+1}: HTTP {e.code}", file=sys.stderr)
        print(e.read().decode()[:500], file=sys.stderr)
        sys.exit(1)
    total_inserted += len(batch)
    print(f"  Inserted {total_inserted}/{len(events)}", end="\r", flush=True)

print(f"\nDone — {total_inserted} sale_events inserted.")
