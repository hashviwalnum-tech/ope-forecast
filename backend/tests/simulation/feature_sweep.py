"""
Feature-by-feature sweep over the finished simulated year (mission brief §7).

Reads every surface a real owner can reach, on a business with a full year of
history, and reports what it actually returned.  Anything that errors, returns
an impossible number, or contradicts another screen is recorded as a finding
rather than glossed over.

Run AFTER run_year has completed:
    python -m tests.simulation.feature_sweep      (from backend/)
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from tests.simulation.generator import SERVING_HOURS, YEAR_DAYS, YEAR_START
from tests.simulation.harness import SIM_USER_ID_B, bootstrap, teardown
from tests.simulation.owner import OUT_DIR

END = YEAR_START + timedelta(days=YEAR_DAYS)     # the morning after the year ends

results: dict = {}
findings: list[str] = []


def fail(where: str, detail: str) -> None:
    findings.append(f"{where}: {detail}")
    print(f"   !! {where}: {detail}")


def main() -> int:
    ope, app, clock = bootstrap(fresh=False)
    ope.use_business(1, tz="America/New_York")
    ope.at_local(END, 18, 0)

    print("=" * 74)
    print(f"FEATURE SWEEP — one full year of history, as at {END}")
    print("=" * 74)

    # ── every read surface must at least answer ──────────────────────────────
    surfaces = [
        ("forecast", "/forecast"),
        ("accuracy", "/accuracy"),
        ("ordering", "/ordering"),
        ("product forecast", "/product-forecast"),
        ("weekday averages", "/weekday-averages"),
        ("hourly analytics", "/hourly-analytics"),
        ("hourly by weekday", "/hourly-by-weekday"),
        ("monthly summary", "/monthly-summary"),
        ("insights", "/insights"),
        ("lift", "/lift"),
        ("forecast history", "/forecast-history"),
        ("outliers", "/outliers"),
        ("day records", "/day-records"),
        ("products", "/products"),
        ("regulars", "/regulars"),
        ("recurring patterns", "/recurring-patterns"),
        ("periods", "/periods"),
        ("orders", "/orders"),
        ("nudges", "/nudges"),
        ("subscription", "/subscription"),
    ]
    print("\n-- every screen answers --")
    for label, path in surfaces:
        r = ope.try_("GET", path)
        if r.status_code != 200:
            fail(label, f"GET {path} -> {r.status_code} {r.text[:160]}")
            results[label] = {"http": r.status_code}
            continue
        body = r.json()
        results[label] = body
        status = body.get("status") if isinstance(body, dict) else f"{len(body)} rows"
        print(f"   {label:<20} {status}")

    check_forecast(ope)
    check_hourly(ope)
    check_ordering(ope)
    check_lift(ope)
    check_regulars(ope)
    check_insights(ope)
    check_accuracy(ope)
    check_premium(ope, clock)
    check_isolation(ope)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "feature_sweep.json").write_text(
        json.dumps({"results": results, "findings": findings}, indent=1, default=str),
        encoding="utf-8")

    print("\n" + "=" * 74)
    print(f"FINDINGS: {len(findings)}")
    for f in findings:
        print("  -", f)
    print("=" * 74)
    teardown(ope)
    return 0


# ── individual checks ────────────────────────────────────────────────────────

def check_forecast(ope) -> None:
    print("\n-- forecast --")
    f = results.get("forecast") or {}
    if f.get("status") != "ok":
        fail("forecast", f"a year of data should give a real forecast, got {f.get('status')}")
        return
    for d in f["days"]:
        print(f"   {d['date']} {d['weekday'][:3]}  {d['predicted_customers']:>4}"
              f"  [{d['interval_low']}–{d['interval_high']}]  {d['model_weights']}")
        if d["interval_low"] > d["predicted_customers"] or d["interval_high"] < d["predicted_customers"]:
            fail("forecast", f"{d['date']}: prediction sits outside its own range")
        if d["predicted_customers"] != int(d["predicted_customers"]):
            fail("forecast", f"{d['date']}: fractional customers — people are whole")
    if f.get("drift_alert"):
        print(f"   drift alert: {f['drift_alert']}")


def check_hourly(ope) -> None:
    print("\n-- busy hours & staffing --")
    h = results.get("hourly analytics") or {}
    if h.get("status") != "ok":
        fail("hourly analytics", f"status {h.get('status')}")
        return
    for s in h["hours"]:
        print(f"   {s['label']:<34} {s['avg_taps']:>4} customers/hr  "
              f"wait {s['expected_wait_minutes']:>5} min  queue {s['queue_length']}")
        if s["hour"] not in SERVING_HOURS:
            fail("hourly analytics", f"hour {s['hour']} is outside the 9–17 opening hours")
        if s["avg_taps"] != int(s["avg_taps"]):
            fail("hourly analytics", f"hour {s['hour']}: fractional customers")
        if s["recommended_staff"] > 40:
            fail("staffing", f"hour {s['hour']}: recommends {s['recommended_staff']} people")
        if s["expected_wait_minutes"] > 60:
            fail("staffing", f"hour {s['hour']}: shows a {s['expected_wait_minutes']}-minute wait "
                             "instead of saying 'severely understaffed'")
    ins = results.get("insights") or {}
    peak_i = (ins.get("peak_hour") or {}).get("hour")
    peak_h = max(h["hours"], key=lambda s: s["avg_taps"])["hour"] if h["hours"] else None
    if peak_i is not None and peak_h is not None and peak_i != peak_h:
        fail("peak hour", f"Insights says {peak_i}, the busy-hours screen says {peak_h}")
    else:
        print(f"   peak hour agrees across both screens: {peak_h}")


def check_ordering(ope) -> None:
    print("\n-- ordering --")
    o = results.get("ordering") or {}
    if o.get("status") != "ok":
        fail("ordering", f"status {o.get('status')}")
        return
    for r in o["products"]:
        print(f"   {r['name']:<24} have {str(r['projected_stock']):>8}  "
              f"order below {r['reorder_point']:>7}  "
              f"{'ORDER ' + str(r['suggested_order_qty']) if r['order_now'] else 'ok':<14}"
              f"{' | '.join(c['code'] for c in (r.get('constraint_codes') or []))}")
        if r["order_now"] and r["suggested_order_qty"] <= 0:
            fail("ordering", f"{r['name']}: says order now but suggests {r['suggested_order_qty']}")
        if r.get("constraint_notes") and not r.get("constraint_codes"):
            fail("ordering", f"{r['name']}: English note with no translatable code")
        if r["reorder_point"] < 0 or r["safety_stock_units"] < 0:
            fail("ordering", f"{r['name']}: negative reorder point or buffer")
    svc = [p for p in (results.get("product forecast") or {}).get("products", [])
           if p.get("product_type") == "service"]
    for s in svc:
        if s.get("order_now"):
            fail("ordering", f"{s['name']} is a service — it must never be reordered")
    if svc:
        print(f"   services present and never reordered: {[s['name'] for s in svc]}")


def check_lift(ope) -> None:
    print("\n-- ad & event lift --")
    l = results.get("lift") or {}
    periods = l.get("periods") or []
    print(f"   {len(periods)} promotions measured")
    for p in periods[:6]:
        print(f"   {p['label']:<28} {p['type']:<6} lift {p['pct_lift']:>7}%  "
              f"({p['total_lift_customers']:+.0f} customers)")
    if not periods:
        fail("lift", "a year with 22 tagged promotions measured none")
    overlapping = [p for p in periods if p["label"] in
                   ("Halloween week", "Halloween combo ad")]
    if len(overlapping) == 2:
        print(f"   overlapping pair both measured: "
              f"{[(p['label'], p['pct_lift']) for p in overlapping]}")
    else:
        fail("lift", "the deliberately overlapping ad/event pair was not both measured")
    sunday_ad = next((p for p in periods if p["label"] == "Sunday family deal"), None)
    if sunday_ad:
        print(f"   Sunday-only ad measured: {sunday_ad['pct_lift']}%")
    else:
        fail("lift", "the Sunday-only ad was not measured")


def check_regulars(ope) -> None:
    print("\n-- regulars & lifetime value --")
    regs = results.get("regulars") or []
    if not regs:
        fail("regulars", "no regulars recorded over a year")
        return
    for r in regs:
        prof = ope.try_("GET", f"/regulars/{r['id']}/profitability")
        if prof.status_code != 200:
            fail("regulars", f"{r['name']}: profitability -> {prof.status_code}")
            continue
        p = prof.json()
        print(f"   {r['name']:<24} visits {r['visit_count']:>4}  CLV {r['clv']:>10.0f}  "
              f"this year {p.get('this_year', 0):>9.0f}  all time {p.get('all_time', 0):>9.0f}")
        if r["visit_count"] == 0:
            fail("regulars", f"{r['name']}: visits were recorded but the count is 0")
        if p.get("all_time", 0) <= 0:
            fail("regulars", f"{r['name']}: earned nothing all time despite {r['visit_count']} visits")


def check_insights(ope) -> None:
    print("\n-- insights --")
    i = results.get("insights") or {}
    for k in ("n_days_logged", "n_months_logged", "busiest_day", "peak_hour",
              "forecast_accuracy_mape", "accuracy_trend", "yoy_growth_pct"):
        if k in i:
            print(f"   {k}: {i[k]}")
    if i.get("n_days_logged", 0) < 250:
        fail("insights", f"only {i.get('n_days_logged')} days counted after a full year")


def check_accuracy(ope) -> None:
    print("\n-- accuracy --")
    a = results.get("accuracy") or {}
    print(f"   n={a.get('n_observations')} MAD={a.get('mad')} "
          f"MAPE={a.get('mape')} tracking signal={a.get('tracking_signal')}")
    ts = a.get("tracking_signal")
    if ts is not None and abs(ts) > 4:
        print(f"   (tracking signal {ts} is past ±4 — Ope should be flagging bias)")


def check_premium(ope, clock) -> None:
    print("\n-- premium: second location --")
    ope.set_tier("premium")
    r = ope.try_("POST", "/businesses/1/copy", json={"name": "Brooklyn Burger Co — Queens"})
    if r.status_code != 201:
        fail("multi-location", f"copy -> {r.status_code} {r.text[:160]}")
        return
    new_id = r.json()["id"]
    print(f"   copied to location {new_id}")

    src_products = ope.get("/products")
    ope.use_business(new_id, tz="America/New_York")
    new_products = ope.get("/products")
    if len(new_products) != len(src_products):
        fail("multi-location", f"copied {len(new_products)} products, source has {len(src_products)}")
    src_types = sorted((p["name"], p["product_type"]) for p in src_products)
    new_types = sorted((p["name"], p["product_type"]) for p in new_products)
    if src_types != new_types:
        fail("multi-location", "product types were not preserved by the copy")
    else:
        print(f"   {len(new_products)} products copied, types preserved")

    days = ope.get("/day-records")
    if days:
        fail("multi-location", f"the new location inherited {len(days)} days of history — "
                               "settings and products copy, data must not")
    else:
        print("   no history copied (correct)")
    ope.use_business(1, tz="America/New_York")


def check_isolation(ope) -> None:
    print("\n-- data isolation between accounts --")
    original = ope.user_id
    ope.user_id = SIM_USER_ID_B
    ope.business_id = None
    r = ope.try_("GET", "/businesses")
    other = r.json() if r.status_code == 200 else []
    if other:
        fail("isolation", f"a different account can see {len(other)} businesses that aren't theirs")
    else:
        print("   a second account sees nothing belonging to the first")

    # And it must not be able to read the first account's data by guessing an id.
    ope.business_id = 1
    leaked = ope.try_("GET", "/day-records")
    if leaked.status_code == 200 and leaked.json():
        fail("isolation", "another account read business 1's day records by passing its id")
    else:
        print(f"   forcing X-Business-Id: 1 as another user -> {leaked.status_code} (no leak)")
    ope.user_id = original
    ope.business_id = 1


if __name__ == "__main__":
    raise SystemExit(main())
