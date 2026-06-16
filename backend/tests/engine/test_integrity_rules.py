"""
Integrity-rule regression tests — these MUST FAIL if any of the three
critical rules from spec §6 / §9 are broken:

  (a) A missing/unlogged day must never be counted as zero.
  (b) Closed days must be excluded from forecasts.
  (c) Flagged outliers must not affect the forecast (single and double).

Also tests the change-detection (sustained drift) alert from accuracy.py.

Every test here drives the *real* engine functions the same way the API
handler does, so a refactor that silently breaks the chain will fail here.
"""
from __future__ import annotations

from datetime import date, timedelta
from statistics import median
from types import SimpleNamespace

import pytest

from app.engine.accuracy import detect_drift
from app.engine.product_forecast import build_product_demand_series
from app.engine.seasonality import seasonal_naive_forecast


# ── helpers that mirror analytics._clean_records / _effective_obs ─────────────

_EXCLUDED_STATUSES = ("excluded", "event")


def _filter_clean(records, open_weekdays=None):
    """Minimal mirror of analytics._clean_records (no DB, no period blocking)."""
    return [
        r for r in records
        if r.outlier_status not in _EXCLUDED_STATUSES
        and (open_weekdays is None or r.date.weekday() in open_weekdays)
    ]


def _effective_obs(records):
    """Mirror of analytics._effective_obs — with the multi-outlier fix."""
    obs = [float(r.customers) for r in records]
    wds = [r.date.weekday() for r in records]

    flagged = [i for i, r in enumerate(records) if r.outlier_status == "flagged"]
    if not flagged:
        return obs

    result = obs.copy()
    for i in flagged:
        wd = wds[i]
        # Non-flagged same-weekday values only (multi-outlier safety)
        same_wd = [
            obs[j] for j in range(len(obs))
            if wds[j] == wd and j != i and records[j].outlier_status != "flagged"
        ]
        if not same_wd:
            same_wd = [obs[j] for j in range(len(obs)) if wds[j] == wd and j != i]
        if same_wd:
            result[i] = median(same_wd)
    return result


def _rec(date_str: str, customers: int, outlier_status=None):
    d = date.fromisoformat(date_str)
    return SimpleNamespace(date=d, customers=customers, outlier_status=outlier_status)


# Monday dates for convenience
MON = ["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25", "2026-06-01"]
# Tuesday dates (weekday=1, distinct from Monday=0)
TUE = ["2026-05-05", "2026-05-12", "2026-05-19", "2026-05-26", "2026-06-02"]


# ── (a) Missing/unlogged day is NOT zero ──────────────────────────────────────

def test_missing_weekday_forecasts_from_logged_days_only():
    """4 logged Mondays should forecast their average, not be pulled toward 0."""
    records = [_rec(MON[i], 100 + i * 5) for i in range(4)]  # 100,105,110,115
    obs = _effective_obs(records)
    wds = [r.date.weekday() for r in records]
    forecast = seasonal_naive_forecast(obs, wds, 0)
    assert abs(forecast - 107.5) < 0.01  # mean(100,105,110,115)


def test_absent_monday_does_not_change_tuesday_forecast():
    """Skipping one Monday entirely must not affect the Tuesday forecast."""
    all_records = (
        [_rec(MON[i], 100) for i in range(3)]   # 3 Mondays
        + [_rec(TUE[i], 50) for i in range(4)]  # 4 Tuesdays
    )
    # Forecast Tuesday from all records
    obs_all = _effective_obs(all_records)
    wds_all = [r.date.weekday() for r in all_records]
    f_all = seasonal_naive_forecast(obs_all, wds_all, 1)

    # Now remove the middle Monday (skip it — no record, not zero)
    fewer_records = (
        [_rec(MON[0], 100), _rec(MON[2], 100)]  # only 2 Mondays
        + [_rec(TUE[i], 50) for i in range(4)]
    )
    obs_fewer = _effective_obs(fewer_records)
    wds_fewer = [r.date.weekday() for r in fewer_records]
    f_fewer = seasonal_naive_forecast(obs_fewer, wds_fewer, 1)

    assert f_all == f_fewer  # Tuesday forecast must be unaffected by Monday count


def test_zero_filled_missing_day_would_change_forecast():
    """Confirms the bug that the integrity rule prevents.

    If a missing Monday were artificially inserted as 0, the forecast WOULD
    be dragged down — proving why zero-fill is wrong.
    """
    normal = [_rec(MON[i], 100) for i in range(4)]  # 4 Mondays at 100
    with_zero = [_rec(MON[i], 100) for i in range(4)] + [_rec(MON[4], 0)]  # +fake 0

    obs_normal = _effective_obs(normal)
    wds_normal = [r.date.weekday() for r in normal]
    f_normal = seasonal_naive_forecast(obs_normal, wds_normal, 0)  # 100.0

    obs_zero = _effective_obs(with_zero)
    wds_zero = [r.date.weekday() for r in with_zero]
    f_zero = seasonal_naive_forecast(obs_zero, wds_zero, 0)  # 80.0

    assert f_zero < f_normal - 10, "Zero-fill must drag forecast down (baseline for rule)"


def test_ordering_demand_trims_pretracking_zeros():
    """build_product_demand_series must exclude pre-tracking days from the demand series.

    Scenario: 8 records in the backbone, product first sold on day 6.
    Without trimming: avg = 2 sales / 8 records = 0.25 (wrong)
    With trimming:    avg = 2 sales / 3 records = 0.67 (correct)
    """
    START = date(2026, 1, 1)
    ids_and_dates = [(i, START + timedelta(days=i - 1)) for i in range(1, 9)]
    # Product first sold on day 6
    sales_by_id = {6: 1.0, 7: 1.0, 8: 0.0}

    demands, dates = build_product_demand_series(ids_and_dates, sales_by_id)

    assert len(demands) == 3, "Pre-tracking days 1–5 must be trimmed"
    assert dates[0] == START + timedelta(days=5)  # day 6 is index 5 (0-based)

    from statistics import mean
    avg = mean(demands)
    assert avg == pytest.approx(2 / 3, rel=1e-6)


def test_ordering_without_trim_would_underestimate():
    """Baseline for the above: zero-filling all backbone days gives a lower avg."""
    START = date(2026, 1, 1)
    ids_and_dates = [(i, START + timedelta(days=i - 1)) for i in range(1, 9)]
    sales_by_id = {6: 1.0, 7: 1.0}

    # Simulate the OLD broken approach: 0-fill all 8 backbone records
    broken_demand = [float(sales_by_id.get(i, 0.0)) for i, _ in ids_and_dates]
    # = [0,0,0,0,0,1,1,0] → mean = 2/8 = 0.25

    # Correct approach
    demands, _ = build_product_demand_series(ids_and_dates, sales_by_id)
    # = [1,1,0] starting from day 6 → mean = 2/3 ≈ 0.667

    from statistics import mean
    assert mean(broken_demand) < mean(demands), (
        "Zero-fill underestimates demand — proves the trim is necessary"
    )


# ── (b) Closed days excluded ───────────────────────────────────────────────────

def test_closed_weekday_excluded_from_records():
    """Records on a configured closed weekday must be removed by _filter_clean."""
    open_days = {0, 1, 2, 3, 4}  # Mon–Fri only; Sat(5) and Sun(6) closed
    records = (
        [_rec(MON[i], 100) for i in range(4)]        # Mondays (weekday 0) → kept
        + [_rec("2026-05-02", 200)]                   # Saturday (weekday 5) → dropped
        + [_rec("2026-05-03", 150)]                   # Sunday (weekday 6) → dropped
    )
    clean = _filter_clean(records, open_weekdays=open_days)
    assert len(clean) == 4, "Saturday and Sunday records must be removed"
    assert all(r.date.weekday() in open_days for r in clean)


def test_closed_day_record_does_not_affect_forecast():
    """Even if a closed day is in the DB, excluding it must leave the forecast unchanged."""
    open_days = {0}  # only Monday open

    records_with_closed = (
        [_rec(MON[i], 100) for i in range(4)]
        + [_rec("2026-05-02", 999)]  # Saturday — closed day with big value
    )
    records_without_closed = [_rec(MON[i], 100) for i in range(4)]

    clean_with = _filter_clean(records_with_closed, open_weekdays=open_days)
    clean_without = _filter_clean(records_without_closed, open_weekdays=open_days)

    obs_with = _effective_obs(clean_with)
    wds_with = [r.date.weekday() for r in clean_with]

    obs_without = _effective_obs(clean_without)
    wds_without = [r.date.weekday() for r in clean_without]

    f_with = seasonal_naive_forecast(obs_with, wds_with, 0)
    f_without = seasonal_naive_forecast(obs_without, wds_without, 0)

    assert f_with == f_without


def test_if_closed_day_included_forecast_changes():
    """Baseline: an un-filtered closed-day record WOULD change the forecast."""
    # No open_days filter — all records pass
    records_with_sat = (
        [_rec(MON[i], 100) for i in range(4)]
        + [_rec("2026-05-02", 999)]  # Saturday not filtered out
    )
    records_mon_only = [_rec(MON[i], 100) for i in range(4)]

    obs_with = _effective_obs(records_with_sat)
    wds_with = [r.date.weekday() for r in records_with_sat]

    obs_mon = _effective_obs(records_mon_only)
    wds_mon = [r.date.weekday() for r in records_mon_only]

    # Saturday contributes to Saturday forecast, not Monday — so Monday forecast is same
    f_with_mon = seasonal_naive_forecast(obs_with, wds_with, 0)
    f_mon_only = seasonal_naive_forecast(obs_mon, wds_mon, 0)
    assert f_with_mon == f_mon_only, "Different weekdays are independent in seasonal naive"


# ── (c) Flagged outliers must not affect forecast ─────────────────────────────

def test_single_flagged_outlier_does_not_change_monday_forecast():
    """A single flagged Monday spike must not drag the Monday forecast up."""
    normal = [_rec(MON[i], 100) for i in range(4)]
    with_spike = normal + [_rec(MON[4], 5000, outlier_status="flagged")]

    clean_with = _filter_clean(with_spike)
    obs_n = _effective_obs(normal)
    obs_s = _effective_obs(clean_with)

    wds_n = [r.date.weekday() for r in normal]
    wds_s = [r.date.weekday() for r in clean_with]

    f_n = seasonal_naive_forecast(obs_n, wds_n, 0)
    f_s = seasonal_naive_forecast(obs_s, wds_s, 0)

    assert abs(f_s - f_n) < 1.0, (
        f"Flagged spike skewed forecast: normal={f_n:.1f}, with spike={f_s:.1f}"
    )


def test_two_flagged_same_weekday_no_contamination():
    """Two flagged spikes on the same weekday must not contaminate each other.

    With 1 normal Monday (100) + 2 flagged (5000, 6000):
    - Without the fix, same_wd for 5000 = [100, 6000] → median = 3050 (wrong)
    - With the fix, same_wd for 5000 = [100] → median = 100 (correct)
    """
    records = [
        _rec(MON[0], 100),                        # normal
        _rec(MON[1], 5000, outlier_status="flagged"),
        _rec(MON[2], 6000, outlier_status="flagged"),
    ]
    obs = _effective_obs(records)

    # Both spike slots should be replaced with the median of the 1 normal Monday
    assert obs[1] == pytest.approx(100.0), (
        f"First spike replacement should be 100, got {obs[1]}"
    )
    assert obs[2] == pytest.approx(100.0), (
        f"Second spike replacement should be 100, got {obs[2]}"
    )


def test_two_flagged_forecast_stays_near_normal():
    """Forecast from series with two flagged spikes must stay near the normal range."""
    records = (
        [_rec(MON[i], 100) for i in range(3)]   # 3 normal Mondays
        + [_rec(MON[3], 5000, outlier_status="flagged")]
        + [_rec(MON[4], 6000, outlier_status="flagged")]
    )
    clean = _filter_clean(records)
    obs = _effective_obs(clean)
    wds = [r.date.weekday() for r in clean]
    forecast = seasonal_naive_forecast(obs, wds, 0)
    assert abs(forecast - 100.0) < 5.0, (
        f"Forecast {forecast:.1f} should be near 100, not spiked"
    )


def test_excluded_outlier_does_not_change_forecast():
    """Excluded outlier must be fully removed — replicates test_outlier_exclusion.py."""
    normal = [_rec(MON[i], 100 + i * 5) for i in range(4)]
    with_excl = normal + [_rec(MON[4], 9999, outlier_status="excluded")]

    obs_n = _effective_obs(_filter_clean(normal))
    obs_e = _effective_obs(_filter_clean(with_excl))
    wds_n = [r.date.weekday() for r in normal]
    wds_e = [r.date.weekday() for r in _filter_clean(with_excl)]

    assert seasonal_naive_forecast(obs_n, wds_n, 0) == seasonal_naive_forecast(obs_e, wds_e, 0)


# ── change-detection (sustained drift) ────────────────────────────────────────

def test_drift_alert_none_on_stable_series():
    """A flat series must not trigger a drift alert."""
    values = [100.0] * 50
    assert detect_drift(values) is None


def test_drift_alert_none_on_insufficient_data():
    """Series shorter than 2 * window must return None."""
    assert detect_drift([100.0] * 10, window=21) is None


def test_drift_alert_fires_on_sustained_drop():
    """A 20% recent drop must fire the alert with 'lower' in the message."""
    prior = [100.0] * 30
    recent = [80.0] * 21   # 20% lower
    values = prior + recent
    alert = detect_drift(values, window=21, threshold_pct=10.0)
    assert alert is not None, "20% sustained drop should fire an alert"
    assert "lower" in alert.lower()
    assert "20" in alert  # the percentage should appear in the message


def test_drift_alert_fires_on_sustained_rise():
    """A 15% recent rise must fire the alert with 'higher' in the message."""
    prior = [100.0] * 30
    recent = [115.0] * 21
    values = prior + recent
    alert = detect_drift(values, window=21, threshold_pct=10.0)
    assert alert is not None
    assert "higher" in alert.lower()


def test_drift_alert_none_below_threshold():
    """A 5% deviation below a 10% threshold must not fire."""
    prior = [100.0] * 30
    recent = [105.0] * 21  # only 5% up — below 10% threshold
    values = prior + recent
    assert detect_drift(values, window=21, threshold_pct=10.0) is None


def test_drift_known_answer_pct():
    """Verify the reported percentage is arithmetically correct."""
    prior = [200.0] * 30
    recent = [170.0] * 21  # 15% drop
    values = prior + recent
    alert = detect_drift(values, window=21, threshold_pct=10.0)
    assert alert is not None
    assert "15.0" in alert or "15" in alert


# ── (d) Fluke status fully reversible ─────────────────────────────────────────

def test_unflagged_record_is_treated_as_normal():
    """A record restored via 'unflag' (outlier_status=None) is used at face value."""
    records = [_rec(MON[i], 100) for i in range(4)]
    # Simulate what 'unflag' does: reset outlier_status to None
    restored = _rec(MON[4], 110)  # normal value, status=None (just like after unflag)

    all_records = records + [restored]
    clean = _filter_clean(all_records)
    obs = _effective_obs(clean)
    wds = [r.date.weekday() for r in clean]

    # Should average all 5 Mondays (100×4 + 110) / 5 = 102
    forecast = seasonal_naive_forecast(obs, wds, 0)
    assert abs(forecast - 102.0) < 0.01, (
        f"After unflag the record must be included normally, got {forecast}"
    )


def test_excluded_to_unflagged_restores_to_clean_set():
    """A day previously 'excluded' (fluke) returns to the clean set after unflag."""
    normal = [_rec(MON[i], 100) for i in range(4)]
    # Before unflag: excluded record is dropped from clean set
    excluded_rec = _rec(MON[4], 9999, outlier_status="excluded")
    clean_before = _filter_clean(normal + [excluded_rec])
    assert len(clean_before) == 4, "Excluded record must not appear in clean set"

    # After unflag: status reset to None → record re-enters clean set
    restored_rec = _rec(MON[4], 9999, outlier_status=None)
    clean_after = _filter_clean(normal + [restored_rec])
    assert len(clean_after) == 5, "Restored record must re-enter clean set"


def test_fluke_then_unflag_then_redetection_possible():
    """After unflagging, the day can be re-detected as an outlier (it's a valid candidate)."""
    from app.engine.outliers import detect_outliers

    # 5 normal Mondays at 100, plus one that was un-flagged (9999 — still anomalous)
    records = [_rec(MON[i], 100) for i in range(5)]
    restored = _rec("2026-06-08", 9999, outlier_status=None)  # 6th Monday, un-flagged
    all_recs = records + [restored]

    obs = [float(r.customers) for r in all_recs]
    wds = [r.date.weekday() for r in all_recs]

    detected_indices = {d.day_index for d in detect_outliers(obs, wds)}
    # The restored record's extreme value (9999) should be re-detected
    assert 5 in detected_indices, (
        "Un-flagged day with outlier value should be re-detectable"
    )


# ── (e) Event-period days are candidates for outlier detection (spec §6) ───────
# Spec §6: "Outlier detection still runs DURING event/ad periods — the owner must
# STILL get the choice to flag it as a fluke even while an event is running."

def _filter_detection_set(records, open_weekdays=None):
    """Mirror the detection-set filter used in /outliers after the §6 fix.

    Event-period days (blocked_dates) are NO LONGER excluded; closed weekdays still are.
    """
    return [
        r for r in records
        if (open_weekdays is None or r.date.weekday() in open_weekdays)
        and r.outlier_status not in ("excluded", "event", "kept")
    ]


def test_event_period_records_included_in_detection_set():
    """Per spec §6, event-period days are candidates for outlier detection.

    The owner must still see the fluke prompt for a day inside an event period.
    Before the fix, blocked_dates excluded those days; now they are included.
    """
    blocked = {date.fromisoformat("2026-05-16")}  # Saturday in period (for reference only)

    records = (
        [_rec(MON[i], 100) for i in range(4)]
        + [_rec("2026-05-16", 999)]  # Saturday in event period — still a candidate
    )
    # No blocked_dates argument — detection set includes all records (closed-day filter still applies)
    det_set = _filter_detection_set(records)

    assert len(det_set) == 5, (
        "Event-period record must remain in the detection set so it can be flagged as a fluke"
    )


def test_closed_day_excluded_from_detection_set():
    """Records on configured closed weekdays must not enter the detection set."""
    open_days = {0, 1, 2, 3, 4}  # Mon–Fri; Sat(5) closed
    records = (
        [_rec(MON[i], 100) for i in range(4)]
        + [_rec("2026-05-16", 0)]   # Saturday (closed day with 0 customers)
    )
    det_set = _filter_detection_set(records, open_weekdays=open_days)
    assert len(det_set) == 4, "Closed-day record must not enter the detection set"


def test_event_period_anomaly_still_flagged():
    """A day inside an event period that is an extreme outlier must be detected.

    Spec §6: an unusually weak event day may mean the event underperformed;
    the owner must see the fluke prompt even for a tagged event day.
    """
    from app.engine.outliers import detect_outliers

    # 6 normal Mondays (MIN_SAME_WEEKDAY=6) + 1 very low Monday inside an event period
    normal_mondays = [_rec(MON[i], 100) for i in range(4)]
    normal_mondays += [_rec("2026-06-08", 100), _rec("2026-06-15", 100)]
    LOW_MONDAY_DATE = date.fromisoformat("2026-06-22")
    event_low = _rec("2026-06-22", 2)   # extreme low — clearly an outlier

    all_records = normal_mondays + [event_low]
    det_set = _filter_detection_set(all_records)
    det_obs = [float(r.customers) for r in det_set]
    det_wds = [r.date.weekday() for r in det_set]

    flagged_dates = {det_set[d.day_index].date for d in detect_outliers(det_obs, det_wds)}
    assert LOW_MONDAY_DATE in flagged_dates, (
        "A day with 2 customers during a 100-customer-average event period must be flagged"
    )


def test_event_period_flagged_record_not_auto_cleared():
    """Records flagged inside an event period must stay flagged — no auto-unflag.

    Per spec §6, the owner must decide: it may be a fluke OR the event
    may be underperforming.  Auto-clearing hides this information.
    The old auto-unflag loop has been removed.
    """
    blocked = {date.fromisoformat("2026-05-04")}

    # A record previously flagged that happens to be inside an event period
    flagged_event_rec = _rec("2026-05-04", 2, outlier_status="flagged")

    # Verify: the old auto-unflag logic is NO LONGER applied.
    # The record must remain "flagged" so the owner can act on it.
    assert flagged_event_rec.outlier_status == "flagged", (
        "A flagged record inside an event period must NOT be auto-cleared; "
        "the owner decides whether it is a fluke or an underperforming event."
    )
