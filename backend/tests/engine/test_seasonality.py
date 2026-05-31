"""
Known-answer tests for engine/seasonality.py — spec section 12 case plus edge cases.
weekday convention: 0=Monday … 6=Sunday.
"""
import pytest
from app.engine.seasonality import compute_weekday_indices, seasonal_naive_forecast

MONDAY, TUESDAY, SATURDAY = 0, 1, 5


# ---------------------------------------------------------------------------
# compute_weekday_indices
# ---------------------------------------------------------------------------

def test_indices_spec_example():
    # Spec section 12: overall avg 100, Saturday avg 150 → Saturday index = 1.5.
    # Data that achieves this: Mon=75, Tue=75, Sat=150 → overall=(75+75+150)/3=100.
    observations = [75.0, 75.0, 150.0]
    weekdays     = [MONDAY, TUESDAY, SATURDAY]
    indices = compute_weekday_indices(observations, weekdays)
    assert indices[SATURDAY] == pytest.approx(1.5)


def test_indices_spec_example_apply_to_base():
    # Saturday forecast = base × index = 200 × 1.5 = 300  (spec section 12)
    observations = [75.0, 75.0, 150.0]
    weekdays     = [MONDAY, TUESDAY, SATURDAY]
    index = compute_weekday_indices(observations, weekdays)[SATURDAY]
    assert 200.0 * index == pytest.approx(300.0)


def test_indices_below_average_day():
    observations = [75.0, 75.0, 150.0]
    weekdays     = [MONDAY, TUESDAY, SATURDAY]
    indices = compute_weekday_indices(observations, weekdays)
    # Mon and Tue each average 75, overall avg 100 → index 0.75
    assert indices[MONDAY]   == pytest.approx(0.75)
    assert indices[TUESDAY]  == pytest.approx(0.75)


def test_indices_uniform_data():
    # All days identical → every index should be 1.0
    observations = [100.0, 100.0, 100.0]
    weekdays     = [MONDAY, TUESDAY, 2]
    indices = compute_weekday_indices(observations, weekdays)
    for idx in indices.values():
        assert idx == pytest.approx(1.0)


def test_indices_multiple_observations_per_weekday():
    # Two Mondays at 80 and 120 → Monday avg 100; one Saturday at 150
    # overall avg = (80 + 120 + 150) / 3 = 116.67
    observations = [80.0, 120.0, 150.0]
    weekdays     = [MONDAY, MONDAY, SATURDAY]
    indices = compute_weekday_indices(observations, weekdays)
    overall = (80.0 + 120.0 + 150.0) / 3
    assert indices[MONDAY]   == pytest.approx(100.0 / overall)
    assert indices[SATURDAY] == pytest.approx(150.0 / overall)


def test_indices_excludes_zero_demand_days():
    # A closed Monday (demand=0) must not distort the average
    observations = [0.0, 100.0, 100.0]
    weekdays     = [MONDAY, TUESDAY, 2]
    indices = compute_weekday_indices(observations, weekdays)
    assert MONDAY not in indices          # closed day excluded from result
    assert indices[TUESDAY] == pytest.approx(1.0)
    assert indices[2]       == pytest.approx(1.0)


def test_indices_all_zeros_raises():
    with pytest.raises(ValueError):
        compute_weekday_indices([0.0, 0.0], [MONDAY, TUESDAY])


def test_indices_mismatched_lengths():
    with pytest.raises(ValueError):
        compute_weekday_indices([100.0, 200.0], [MONDAY])


# ---------------------------------------------------------------------------
# seasonal_naive_forecast
# ---------------------------------------------------------------------------

def test_seasonal_naive_all_mondays():
    observations = [100.0, 110.0, 120.0, 50.0, 60.0]
    weekdays     = [MONDAY, MONDAY, MONDAY, TUESDAY, TUESDAY]
    result = seasonal_naive_forecast(observations, weekdays, target_weekday=MONDAY)
    assert result == pytest.approx((100.0 + 110.0 + 120.0) / 3)


def test_seasonal_naive_last_n():
    observations = [80.0, 100.0, 120.0]
    weekdays     = [MONDAY, MONDAY, MONDAY]
    # last 2 same-weekday observations: (100 + 120) / 2 = 110
    assert seasonal_naive_forecast(observations, weekdays, MONDAY, n=2) == pytest.approx(110.0)


def test_seasonal_naive_n1():
    observations = [80.0, 100.0, 120.0]
    weekdays     = [MONDAY, MONDAY, MONDAY]
    assert seasonal_naive_forecast(observations, weekdays, MONDAY, n=1) == pytest.approx(120.0)


def test_seasonal_naive_ignores_other_weekdays():
    # Saturday observations must not influence the Monday forecast
    observations = [999.0, 100.0, 200.0]
    weekdays     = [SATURDAY, MONDAY, MONDAY]
    assert seasonal_naive_forecast(observations, weekdays, MONDAY) == pytest.approx(150.0)


def test_seasonal_naive_no_matching_weekday():
    with pytest.raises(ValueError):
        seasonal_naive_forecast([100.0], [MONDAY], target_weekday=SATURDAY)


def test_seasonal_naive_mismatched_lengths():
    with pytest.raises(ValueError):
        seasonal_naive_forecast([100.0, 200.0], [MONDAY], target_weekday=MONDAY)


# ---------------------------------------------------------------------------
# Spec section 9: missing open days are absent, never zero
# ---------------------------------------------------------------------------

def test_missing_open_days_are_absent_not_zero():
    """Un-logged open days must be absent from the computation, not zero.

    Spec section 9: 'A missing day means no data, never zero customers.'

    Scenario: three Mondays were logged (100, 110, 120). Two further Mondays
    were simply not entered by the owner. The engine receives only the three
    logged values — absent days are not in the list at all. The forecast must
    equal the mean of the three known values (110), not the mean one would get
    by treating the two gaps as zero-customer days (~66).
    """
    # Only the three logged Mondays appear; the two missing Mondays are absent.
    observations = [100.0, 110.0, 120.0, 90.0, 95.0]
    weekdays     = [MONDAY, MONDAY, MONDAY, TUESDAY, TUESDAY]

    result = seasonal_naive_forecast(observations, weekdays, MONDAY)

    expected_correct = (100.0 + 110.0 + 120.0) / 3        # = 110.0
    wrong_if_zeros   = (100.0 + 0.0 + 110.0 + 0.0 + 120.0) / 5  # ≈ 66.0

    assert result == pytest.approx(expected_correct), (
        f"Got {result:.1f}, expected {expected_correct:.1f}. "
        "Missing days may be treated as zero."
    )
    assert result != pytest.approx(wrong_if_zeros), (
        "Result matches the wrong answer — gaps are being filled with zero."
    )
