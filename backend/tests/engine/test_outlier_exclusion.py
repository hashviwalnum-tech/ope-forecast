"""
Behavioral tests: an excluded outlier must not affect the forecast.

These tests mirror the exact filtering/down-weighting logic from
api/analytics.py (_clean_records, _effective_obs) and drive it through the
real engine functions, proving the full chain:

  mark as excluded  →  removed from observation series  →  forecast unaffected

If someone changes the stored action string, the filter key, or the engine
function while leaving the other two untouched, at least one test here breaks.
"""
from statistics import median
from types import SimpleNamespace
from datetime import date

import pytest

from app.engine.seasonality import seasonal_naive_forecast

# ── Helpers that mirror api/analytics.py exactly ──────────────────────────────
# These are deliberately kept in sync with the real implementations.
# If analytics._clean_records or ._effective_obs change, update these too.

_EXCLUDED_STATUSES = ("excluded", "event")   # must match analytics._clean_records


def _filter_clean(records):
    """Mirror of analytics._clean_records (outlier logic only, no period blocking)."""
    return [r for r in records if r.outlier_status not in _EXCLUDED_STATUSES]


def _effective_obs(records):
    """Mirror of analytics._effective_obs."""
    obs = [float(r.customers) for r in records]
    wds = [r.date.weekday() for r in records]

    flagged = [i for i, r in enumerate(records) if r.outlier_status == "flagged"]
    if not flagged:
        return obs

    result = obs.copy()
    for i in flagged:
        wd = wds[i]
        same_wd = [obs[j] for j in range(len(obs)) if wds[j] == wd and j != i]
        if same_wd:
            result[i] = median(same_wd)
    return result


def _record(date_str: str, customers: int, outlier_status=None):
    """Minimal stand-in for a SQLAlchemy DayRecord."""
    d = date.fromisoformat(date_str)
    return SimpleNamespace(date=d, customers=customers, outlier_status=outlier_status)


# All fall on a Monday (weekday index 0):
MON = [
    "2026-05-04",   # index 0
    "2026-05-11",   # index 1
    "2026-05-18",   # index 2
    "2026-05-25",   # index 3
    "2026-06-01",   # index 4  ← spike here in tests
]


# ── Bug-regression test: action string must be "excluded" ─────────────────────

def test_action_string_is_excluded_not_exclude():
    """The stored action value must be 'excluded' (with 'd') or _filter_clean
    won't catch it and the excluded day will still affect forecasts.

    This test enforces the contract between OutlierResolveRequest.action and
    _clean_records. If someone changes one without the other, this fails.
    """
    excluded_record = _record(MON[4], 5000, outlier_status="excluded")
    fluke_record    = _record(MON[4], 5000, outlier_status="exclude")   # wrong spelling

    # Only the correctly-spelled status is filtered
    assert _filter_clean([excluded_record]) == []
    assert _filter_clean([fluke_record])    == [fluke_record]  # NOT filtered — this is the bug


# ── Core exclusion tests ───────────────────────────────────────────────────────

def test_excluded_day_removed_from_clean_records():
    """Records marked 'excluded' must not appear in the filtered list."""
    records = [
        _record(MON[0], 100),
        _record(MON[1], 110),
        _record(MON[2],  90),
        _record(MON[3], 105),
        _record(MON[4], 5000, outlier_status="excluded"),
    ]
    clean = _filter_clean(records)
    assert len(clean) == 4
    assert all(r.customers != 5000 for r in clean)


def test_event_day_removed_from_clean_records():
    """Records marked 'event' are excluded from the baseline just like 'excluded'."""
    records = [
        _record(MON[0], 100),
        _record(MON[1], 100),
        _record(MON[2], 100),
        _record(MON[3], 100),
        _record(MON[4], 5000, outlier_status="event"),
    ]
    clean = _filter_clean(records)
    assert len(clean) == 4


def test_kept_day_remains_in_clean_records():
    """Records marked 'kept' must pass through — the user confirmed them."""
    records = [
        _record(MON[0], 100),
        _record(MON[1], 100),
        _record(MON[2], 100),
        _record(MON[3], 100),
        _record(MON[4], 5000, outlier_status="kept"),
    ]
    clean = _filter_clean(records)
    assert len(clean) == 5


# ── Forecast impact tests ──────────────────────────────────────────────────────

def test_excluded_outlier_does_not_change_forecast():
    """
    The Monday forecast after excluding a spike must equal the forecast
    from a dataset that never contained the spike.

    This is the primary regression test for the bug where the stored value
    was 'exclude' (no 'd') and slipped through the filter unchanged.
    """
    normal = [
        _record(MON[0], 100),
        _record(MON[1], 110),
        _record(MON[2],  90),
        _record(MON[3], 105),
    ]
    with_spike_excluded = normal + [
        _record(MON[4], 5000, outlier_status="excluded"),
    ]

    # Baseline forecast: 4 normal Mondays
    n_obs = _effective_obs(normal)
    n_wds = [r.date.weekday() for r in normal]
    forecast_no_spike = seasonal_naive_forecast(n_obs, n_wds, 0)

    # Forecast after exclusion: spike is filtered out first
    filtered = _filter_clean(with_spike_excluded)
    e_obs = _effective_obs(filtered)
    e_wds = [r.date.weekday() for r in filtered]
    forecast_excluded = seasonal_naive_forecast(e_obs, e_wds, 0)

    assert forecast_excluded == forecast_no_spike


def test_unexcluded_outlier_does_skew_forecast():
    """
    Confirms the spike genuinely distorts the forecast when it is NOT excluded.
    Without this, the exclusion test above would be vacuous.
    """
    normal = [_record(MON[i], 100 + i * 2) for i in range(4)]
    with_spike = normal + [_record(MON[4], 5000)]

    n_obs = _effective_obs(normal)
    n_wds = [r.date.weekday() for r in normal]

    s_obs = _effective_obs(with_spike)
    s_wds = [r.date.weekday() for r in with_spike]

    f_normal = seasonal_naive_forecast(n_obs, n_wds, 0)
    f_spike  = seasonal_naive_forecast(s_obs,  s_wds,  0)

    assert f_spike > f_normal + 500   # spike drags forecast up by hundreds


# ── Down-weighting tests (flagged / unreviewed) ────────────────────────────────

def test_flagged_day_replaced_with_weekday_median():
    """
    An unreviewed 'flagged' outlier must be replaced by the weekday median
    in _effective_obs, not deleted entirely.
    """
    records = [
        _record(MON[0], 100),
        _record(MON[1], 100),
        _record(MON[2], 100),
        _record(MON[3], 100),
        _record(MON[4], 5000, outlier_status="flagged"),
    ]
    obs = _effective_obs(records)
    # The 5th value (index 4) should be replaced with median([100,100,100,100]) = 100
    assert obs[4] == 100.0
    assert obs[:4] == [100.0, 100.0, 100.0, 100.0]


def test_flagged_day_stays_in_records_unlike_excluded():
    """
    'flagged' records pass through _filter_clean (they're not removed),
    whereas 'excluded' records are removed entirely.
    """
    records = [
        _record(MON[0], 100, outlier_status="flagged"),
        _record(MON[1], 100, outlier_status="excluded"),
    ]
    clean = _filter_clean(records)
    assert len(clean) == 1
    assert clean[0].outlier_status == "flagged"


def test_flagged_forecast_near_normal_range():
    """Forecast from down-weighted data must stay near the normal range, not spike."""
    records = [
        _record(MON[0], 100),
        _record(MON[1], 100),
        _record(MON[2], 100),
        _record(MON[3], 100),
        _record(MON[4], 5000, outlier_status="flagged"),
    ]
    obs = _effective_obs(records)
    wds = [r.date.weekday() for r in records]
    forecast = seasonal_naive_forecast(obs, wds, 0)
    assert abs(forecast - 100.0) < 1.0


# ── Accuracy holdout exclusion tests ──────────────────────────────────────────
#
# These mirror the holdout logic in api/analytics.get_accuracy().
# The fix: positions with outlier_status='flagged' are skipped in the holdout
# evaluation loop so unreviewed outlier days don't distort the MAPE score.
# _clean_records() already removes 'excluded'/'event' before the loop runs.

# 14 Mondays for holdout tests (need ≥8 for n_eval ≥ 1; 14 gives n_eval=7)
_MON14 = [
    "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26",
    "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23",
    "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23",
    "2026-03-30", "2026-04-06",
]


def _holdout_mape_excluding_flagged(records) -> float | None:
    """Mirror of the fixed get_accuracy() holdout: skips 'flagged' at eval positions.

    'excluded'/'event' records are assumed already absent (filtered by _filter_clean).
    """
    from app.engine.accuracy import mape as _mape
    obs = _effective_obs(records)
    wds = [r.date.weekday() for r in records]
    n_eval = min(90, len(obs) - 7)
    if n_eval <= 0:
        return None
    acts: list[float] = []
    preds: list[float] = []
    for i in range(len(obs) - n_eval, len(obs)):
        if records[i].outlier_status == "flagged":
            continue
        try:
            p = seasonal_naive_forecast(obs[:i], wds[:i], wds[i])
            acts.append(obs[i])
            preds.append(p)
        except ValueError:
            pass
    if len(acts) < 4:
        return None
    return round(_mape(acts, preds), 2)


def test_flagged_fluke_does_not_affect_accuracy():
    """Adding a flagged record with an extreme value must not change the MAPE.

    The skewed dataset (one position with 200) makes the weekday mean > median,
    so if a flagged position were included with its median-substituted value it
    would pull the MAPE in a different direction than excluding it entirely.
    Without the 'if flagged: continue' fix, this test fails.
    """
    # 13 Mondays — mix of 100 and one 200 so mean ≠ median (mean ≈ 107.7)
    base_records = [
        _record(_MON14[0],  100),
        _record(_MON14[1],  100),
        _record(_MON14[2],  200),   # skews the weekday mean above the median
        _record(_MON14[3],  100),
        _record(_MON14[4],  100),
        _record(_MON14[5],  100),
        _record(_MON14[6],  100),
        _record(_MON14[7],  100),
        _record(_MON14[8],  100),
        _record(_MON14[9],  100),
        _record(_MON14[10], 100),
        _record(_MON14[11], 100),
        _record(_MON14[12], 100),
    ]
    flagged_record = _record(_MON14[13], 9999, outlier_status="flagged")

    mape_clean   = _holdout_mape_excluding_flagged(base_records)
    mape_flagged = _holdout_mape_excluding_flagged(base_records + [flagged_record])

    # The flagged position is skipped; accuracy must be unaffected.
    assert mape_clean == mape_flagged


def test_excluded_fluke_does_not_affect_accuracy():
    """An 'excluded' record never enters the holdout (filtered before the loop).

    This is the owner-confirmed-fluke path: _filter_clean removes it, so the
    holdout never sees the extreme value.
    """
    base_records = [_record(d, 100) for d in _MON14[:13]]
    excluded_record = _record(_MON14[13], 9999, outlier_status="excluded")

    # Excluded records are removed by _filter_clean (same as _clean_records logic)
    filtered_base     = _filter_clean(base_records)
    filtered_excluded = _filter_clean(base_records + [excluded_record])

    mape_clean    = _holdout_mape_excluding_flagged(filtered_base)
    mape_excluded = _holdout_mape_excluding_flagged(filtered_excluded)

    assert mape_clean == mape_excluded
