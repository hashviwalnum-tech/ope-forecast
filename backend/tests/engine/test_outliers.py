"""
Known-answer unit tests for engine/outliers.py.

Detection algorithm: median ± k·MAD (leave-one-out) per weekday.
k=3.5, MIN_SAME_WEEKDAY=4.
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
    """MIN_SAME_WEEKDAY observations: the spike should be flagged."""
    obs = [100.0] * (MIN_SAME_WEEKDAY - 1) + [9999.0]
    wds = [0] * MIN_SAME_WEEKDAY
    results = detect_outliers(obs, wds)
    assert len(results) == 1
    assert results[0].day_index == MIN_SAME_WEEKDAY - 1
    assert results[0].direction == "high"


def test_high_outlier_flagged():
    # 5 Mondays: four normal, one spike
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
    # 4 Mondays (normal) + 4 Tuesdays (spike on last)
    obs = [100.0, 100.0, 100.0, 100.0,   # Mon Mon Mon Mon
           100.0, 100.0, 100.0, 9000.0]  # Tue Tue Tue Tue
    wds = [0, 1, 0, 1, 0, 1, 0, 1]
    results = detect_outliers(obs, wds)
    flagged_weekdays = {r.weekday for r in results}
    assert 0 not in flagged_weekdays, "Monday should not be flagged"
    assert 1 in flagged_weekdays, "Tuesday spike should be flagged"


def test_known_answer_median_mad():
    """
    Reference set for index 4: [100, 110, 90, 105]
      sorted:  [90, 100, 105, 110]
      median:  (100 + 105) / 2 = 102.5
      |deviations|: [12.5, 2.5, 2.5, 7.5]
      sorted:  [2.5, 2.5, 7.5, 12.5]
      MAD:     (2.5 + 7.5) / 2 = 5.0

    Threshold = 102.5 + 3.5 × 5.0 = 120.0
    Value 1000.0 >> 120.0 → flagged.
    """
    obs = [100.0, 110.0, 90.0, 105.0, 1000.0]
    wds = [0,     0,     0,    0,     0     ]
    results = detect_outliers(obs, wds)
    assert len(results) == 1
    r = results[0]
    assert r.weekday_median == 102.5
    assert r.weekday_mad == 5.0


def test_uniform_weekday_not_flagged():
    """Identical reference values with no deviation in the candidate → not flagged.
    The proportional floor keeps the threshold > 0 but a value equal to the
    reference median is nowhere near it."""
    obs = [50.0] * 6   # all the same — no spike
    wds = [0] * 6
    assert detect_outliers(obs, wds) == []


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
