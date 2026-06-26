"""
Known-answer unit tests for engine/outliers.py.

Detection algorithm: IQR Tukey fences per weekday (leave-one-out).
Flags only below Q1 − 1.5·IQR or above Q3 + 1.5·IQR.
"""
import pytest

from app.engine.outliers import (
    MIN_SAME_WEEKDAY,
    OutlierResult,
    detect_outliers,
    weekday_median,
)


# ── detect_outliers ──────────────────────────────────────────────────────────

def test_no_flags_below_min_observations():
    """Fewer than MIN_SAME_WEEKDAY observations for a weekday → nothing flagged."""
    obs = [100.0, 1000.0, 5.0]          # 3 Mondays — not enough
    wds = [0,     0,      0   ]
    assert detect_outliers(obs, wds) == []


def test_exactly_min_observations_required():
    """MIN_SAME_WEEKDAY observations: a spike should be flagged."""
    obs = [100.0] * (MIN_SAME_WEEKDAY - 1) + [9999.0]
    wds = [0] * MIN_SAME_WEEKDAY
    results = detect_outliers(obs, wds)
    assert len(results) == 1
    assert results[0].day_index == MIN_SAME_WEEKDAY - 1
    assert results[0].direction == "high"


def test_high_outlier_flagged():
    obs = [100.0, 110.0, 90.0, 105.0, 1000.0]
    wds = [0,     0,     0,    0,     0     ]
    results = detect_outliers(obs, wds)
    assert len(results) == 1
    assert results[0].day_index == 4
    assert results[0].direction == "high"
    assert results[0].value == 1000.0


def test_low_outlier_flagged():
    obs = [100.0, 110.0, 90.0, 105.0, 3.0]
    wds = [0,     0,     0,    0,     0  ]
    results = detect_outliers(obs, wds)
    assert len(results) == 1
    assert results[0].direction == "low"
    assert results[0].value == 3.0


def test_normal_spread_not_flagged():
    obs = [95.0, 100.0, 105.0, 98.0, 102.0]
    wds = [0,    0,     0,     0,    0     ]
    assert detect_outliers(obs, wds) == []


def test_weekdays_independent():
    """A spike on weekday 1 must not affect weekday 0 detection."""
    obs = [100.0, 100.0, 100.0, 100.0,   # Mon Mon Mon Mon
           100.0, 100.0, 100.0, 9000.0]  # Tue Tue Tue Tue
    wds = [0, 1, 0, 1, 0, 1, 0, 1]
    results = detect_outliers(obs, wds)
    flagged_weekdays = {r.weekday for r in results}
    assert 0 not in flagged_weekdays, "Monday should not be flagged"
    assert 1 in flagged_weekdays, "Tuesday spike should be flagged"


def test_known_answer_iqr():
    """
    IQR known-answer test.
    Reference set for index 4 (value=1000): [100, 110, 90, 105]
      sorted:  [90, 100, 105, 110]
      Q1 (np.percentile, linear): 90 + 0.75*(100-90) = 97.5
      Q3 (np.percentile, linear): 105 + 0.25*(110-105) = 106.25
      IQR: 8.75
      upper fence: 106.25 + 1.5*8.75 = 119.375
      1000.0 >> 119.375 → flagged.
    """
    import numpy as np
    obs = [100.0, 110.0, 90.0, 105.0, 1000.0]
    wds = [0,     0,     0,    0,     0     ]
    results = detect_outliers(obs, wds)
    assert len(results) == 1
    r = results[0]
    ref = np.array([100.0, 110.0, 90.0, 105.0])
    assert r.weekday_median == pytest.approx(round(float(np.median(ref)), 1))
    assert r.weekday_iqr == pytest.approx(
        round(float(np.percentile(ref, 75) - np.percentile(ref, 25)), 2)
    )


def test_uniform_weekday_not_flagged():
    """Identical values with no deviation in the candidate → not flagged.
    The IQR=0 floor keeps the threshold > 0 but a value equal to the
    reference median is well within it."""
    obs = [50.0] * 6
    wds = [0] * 6
    assert detect_outliers(obs, wds) == []


# ── §12 test cases: ordinary variation NOT flagged; genuine extreme IS flagged ──

def test_spec_ordinary_variation_not_flagged():
    """
    §12: a weekday history with natural spread where 43 is a low but ordinary day.

    History: [40, 45, 48, 50, 52, 55, 60, 65] (representative of a moderately
    variable business).  Reference Q1≈47.25, Q3≈56.25, IQR≈9, lower fence≈33.75.
    43 > 33.75 → must NOT be flagged.
    """
    history = [40.0, 45.0, 48.0, 50.0, 52.0, 55.0, 60.0, 65.0, 43.0]
    wds = [0] * len(history)   # all the same weekday
    results = detect_outliers(history, wds)
    flagged_values = [r.value for r in results]
    assert 43.0 not in flagged_values, (
        "43 should NOT be flagged — it is within normal variation for this weekday"
    )


def test_spec_genuine_extreme_flagged():
    """
    §12: 1500 vs a ~54 average must be flagged.

    Same moderately-variable history; 1500 is so far outside the fence
    (upper ≈ 70) that no reasonable IQR threshold should miss it.
    """
    history = [40.0, 45.0, 48.0, 50.0, 52.0, 55.0, 60.0, 65.0, 1500.0]
    wds = [0] * len(history)
    results = detect_outliers(history, wds)
    flagged_values = [r.value for r in results]
    assert 1500.0 in flagged_values, (
        "1500 should be flagged — it is a genuine extreme vs the ~54 mean"
    )
    flagged = next(r for r in results if r.value == 1500.0)
    assert flagged.direction == "high"


def test_recurring_pattern_expected_bump_not_flagged():
    """
    A weekday with a consistent recurring bump: the fence is already centred on
    the bumped distribution.  A day at the typical bumped level must NOT flag.

    Wednesdays run 40-45 (school trip pattern).  A Wednesday of 43 is squarely
    in the middle of that range.

    Reference [40,41,42,43,44,45] → Q1≈41.25, Q3≈43.75, IQR=2.5,
    lower fence≈37.5, upper fence≈47.5.  43 is within → not flagged.
    """
    obs = [40.0, 41.0, 42.0, 43.0, 44.0, 45.0, 43.0]
    wds = [2] * 7
    results = detect_outliers(obs, wds)
    assert 6 not in {r.day_index for r in results}, (
        "A day at the typical pattern level (43, within 40-45) must not be flagged"
    )


def test_recurring_pattern_unexpectedly_low_is_flagged():
    """
    A pattern weekday that comes in far below the expected bump must still flag.

    Wednesdays normally run 40-45.  A Wednesday at 25 (trip cancelled?) is
    genuinely anomalous — below the lower fence of 37.5.
    """
    obs = [40.0, 41.0, 42.0, 43.0, 44.0, 45.0, 25.0]
    wds = [2] * 7
    results = detect_outliers(obs, wds)
    flagged = {r.day_index for r in results}
    assert 6 in flagged, (
        "A day far below the pattern expectation (25 vs 40-45) must be flagged"
    )
    assert next(r for r in results if r.day_index == 6).direction == "low"


def test_recurring_pattern_far_above_bump_is_flagged():
    """
    A pattern weekday that far exceeds even the expected bump must still flag.

    Wednesdays normally run 40-45.  A Wednesday at 80 exceeds the upper fence
    of 47.5 — it is anomalous even relative to the bumped expectation.
    """
    obs = [40.0, 41.0, 42.0, 43.0, 44.0, 45.0, 80.0]
    wds = [2] * 7
    results = detect_outliers(obs, wds)
    flagged = {r.day_index for r in results}
    assert 6 in flagged, (
        "A day far above even the expected bump (80 vs 40-45) must be flagged"
    )
    assert next(r for r in results if r.day_index == 6).direction == "high"


def test_empty_inputs():
    assert detect_outliers([], []) == []


def test_mismatched_lengths_raises():
    with pytest.raises(ValueError, match="same length"):
        detect_outliers([1.0, 2.0], [0])


# ── weekday_median ───────────────────────────────────────────────────────────

def test_weekday_median_known_answer():
    """median([100, 200, 150, 130, 120]) = 130.0"""
    obs = [100.0, 200.0, 150.0, 130.0, 120.0]
    wds = [0,     0,     0,     0,     0    ]
    assert weekday_median(obs, wds, 0) == 130.0


def test_weekday_median_even_count():
    """median([100, 200]) = 150.0"""
    obs = [100.0, 200.0]
    wds = [0,     0    ]
    assert weekday_median(obs, wds, 0) == 150.0


def test_weekday_median_missing_weekday_raises():
    obs = [100.0, 100.0]
    wds = [0,     0    ]
    with pytest.raises(ValueError):
        weekday_median(obs, wds, 1)


def test_weekday_median_filters_correctly():
    """Only the target weekday's values should be included."""
    obs = [50.0, 200.0, 50.0, 200.0]
    wds = [0,    1,     0,    1    ]
    assert weekday_median(obs, wds, 0) == 50.0
    assert weekday_median(obs, wds, 1) == 200.0
