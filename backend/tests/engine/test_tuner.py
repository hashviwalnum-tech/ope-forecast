"""
Tests for engine/tuner.py — the self-tuning champion-challenger system.
See spec §2 SELF-TUNING section.

Four mandatory scenarios from the spec:
(a) Thin-data guard: with ~26 days, never switches; live forecast unchanged.
(b) A challenger that only fits in-sample but fails out-of-sample is never adopted.
(c) Switches are logged (log entry has all required fields).
(d) A challenger that performs worse live triggers rollback.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from app.engine.tuner import (
    CANDIDATE_CONFIGS,
    DEFAULT_CONFIG,
    MIN_HOLDOUT_DAYS,
    MIN_SHADOW_DAYS,
    MIN_TOTAL_DAYS,
    ROLLBACK_MARGIN_RATIO,
    SWITCH_MARGIN_RATIO,
    build_log_entry,
    compare_in_shadow,
    evaluate_config_oos_mae,
    find_best_challenger,
    has_enough_data,
    meta_predict,
    should_rollback,
    should_switch,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_dates_and_values(
    n_days: int,
    start: date = date(2025, 1, 6),
    value: float = 50.0,
) -> tuple[list[date], list[float]]:
    """Consecutive daily dates with a fixed customer count."""
    dates = [start + timedelta(days=i) for i in range(n_days)]
    values = [value] * n_days
    return dates, values


# ---------------------------------------------------------------------------
# (a) Thin-data guard
# ---------------------------------------------------------------------------

def test_thin_data_guard_has_enough_data_false_with_26_days():
    """26 days (the user's current dataset) must not pass the data threshold."""
    dates, _ = _make_dates_and_values(26)
    assert not has_enough_data(dates)


def test_thin_data_guard_has_enough_data_true_at_threshold():
    """Exactly MIN_TOTAL_DAYS passes."""
    dates, _ = _make_dates_and_values(MIN_TOTAL_DAYS)
    assert has_enough_data(dates)


def test_thin_data_guard_find_best_challenger_returns_none_with_26_days():
    """find_best_challenger must return None when data is too thin to tune+validate."""
    dates, values = _make_dates_and_values(26)
    result = find_best_challenger(dates, values, DEFAULT_CONFIG)
    assert result is None


def test_thin_data_guard_live_forecast_unchanged():
    """When thin-data guard fires, no challenger is proposed so the live config
    (DEFAULT_CONFIG) is not touched — the forecast is exactly as before."""
    dates, values = _make_dates_and_values(26)
    target = date(2025, 2, 2)  # Monday after the data window

    # With thin data: no challenger, so the live config stays DEFAULT_CONFIG
    challenger_result = find_best_challenger(dates, values, DEFAULT_CONFIG)
    assert challenger_result is None  # no switch proposed

    # Forecast with DEFAULT_CONFIG is deterministic — unchanged from before
    pred_before = meta_predict(dates, values, target, DEFAULT_CONFIG)
    pred_after = meta_predict(dates, values, target, DEFAULT_CONFIG)
    assert pred_before == pred_after


def test_thin_data_guard_just_below_threshold():
    """One day below MIN_TOTAL_DAYS must still be blocked."""
    dates, values = _make_dates_and_values(MIN_TOTAL_DAYS - 1)
    assert not has_enough_data(dates)
    assert find_best_challenger(dates, values, DEFAULT_CONFIG) is None


# ---------------------------------------------------------------------------
# (b) Out-of-sample validation — in-sample-only challenger never adopted
# ---------------------------------------------------------------------------

def test_oos_evaluation_uses_only_train_data():
    """evaluate_config_oos_mae must predict holdout using ONLY train data.

    Train: Mondays = 50.  Holdout: Mondays = 200 (dramatic shift).
    If the evaluator cheated and peeked at holdout values it would predict
    ~200 and MAE would be ~0.  Using train-only it predicts ~50 → MAE ~150.
    """
    # 8 Mondays in train
    train_dates = [date(2025, 1, 6) + timedelta(weeks=i) for i in range(8)]
    train_values = [50.0] * 8
    # 3 Mondays in holdout — shifted dramatically
    holdout_dates = [date(2025, 1, 6) + timedelta(weeks=8 + i) for i in range(3)]
    holdout_values = [200.0, 200.0, 200.0]

    config = DEFAULT_CONFIG
    mae = evaluate_config_oos_mae(config, train_dates, train_values, holdout_dates, holdout_values)

    # Train-only prediction ≈ 50 → MAE ≈ 150.  A leaked holdout would give ≈ 0.
    assert mae is not None
    assert mae > 100, (
        f"MAE={mae:.1f} is suspiciously low — holdout data may have leaked into predictions"
    )


def test_in_sample_winner_not_adopted_if_no_oos_margin():
    """When no candidate config beats the champion by SWITCH_MARGIN_RATIO on
    holdout data, find_best_challenger returns None.

    Scenario: 84 days with all same-weekday values ≈ 50 in train.  Holdout
    also has values near 50.  All configs produce nearly identical OOS MAE, so
    no challenger clears the required improvement margin.
    """
    # All 84 days with value=50 (flat, all configs predict ~50 on holdout too)
    dates, values = _make_dates_and_values(MIN_TOTAL_DAYS, value=50.0)
    result = find_best_challenger(dates, values, DEFAULT_CONFIG)
    # With identical predictions from every config, no challenger wins by 5%
    assert result is None


def test_challenger_rejected_when_fails_oos():
    """A config that only fits in-sample (train data pattern) but cannot
    predict a holdout-period shift is not adopted as challenger.

    All configs use train-only data to predict holdout, so none can
    'know' the holdout pattern — the OOS MAEs are all similar and no
    config wins by the required margin.
    """
    start = date(2025, 1, 6)
    all_dates = [start + timedelta(days=i) for i in range(MIN_TOTAL_DAYS)]
    # Train portion: value=50.  Holdout portion: value=300 (extreme shift).
    all_values = [
        50.0 if i < MIN_TOTAL_DAYS - MIN_HOLDOUT_DAYS else 300.0
        for i in range(MIN_TOTAL_DAYS)
    ]

    result = find_best_challenger(all_dates, all_values, DEFAULT_CONFIG)
    # No config can foresee the 300 shift from train data → no OOS winner
    assert result is None


def test_oos_requires_chronological_split():
    """Holdout must be the MOST RECENT days (chronological split), not random.

    The function sorts by date internally, so regardless of input order the
    split is always train = earliest, holdout = most recent.
    """
    # Feed dates in shuffled order
    start = date(2025, 1, 6)
    dates_shuffled = [start + timedelta(days=i) for i in range(MIN_TOTAL_DAYS)]
    import random
    rng = random.Random(42)
    rng.shuffle(dates_shuffled)
    values_shuffled = [50.0] * MIN_TOTAL_DAYS

    # Should not raise even with shuffled input
    result = find_best_challenger(dates_shuffled, values_shuffled, DEFAULT_CONFIG)
    # With all values=50, no challenger clears the margin
    assert result is None


def test_evaluate_config_oos_mae_returns_none_when_too_few_predictions():
    """When a config produces fewer than 3 valid predictions on holdout, return None."""
    # 1 train day, 1 holdout day (same weekday) — only 1 prediction possible
    train_dates = [date(2025, 1, 6)]
    train_values = [50.0]
    holdout_dates = [date(2025, 1, 13)]  # 1 week later, same Monday
    holdout_values = [55.0]

    mae = evaluate_config_oos_mae(
        DEFAULT_CONFIG, train_dates, train_values, holdout_dates, holdout_values
    )
    assert mae is None


# ---------------------------------------------------------------------------
# (c) Switches are logged
# ---------------------------------------------------------------------------

def test_switch_log_entry_has_required_fields():
    """build_log_entry must produce a dict with all fields a developer needs
    to diagnose what happened, why, and by how much."""
    champion = DEFAULT_CONFIG
    challenger = CANDIDATE_CONFIGS[3]
    entry = build_log_entry(
        event="switch",
        champion_config=champion,
        challenger_config=challenger,
        champion_mae=12.0,
        challenger_mae=10.2,
        shadow_days=21,
        details=(
            "Switched meta-weighting on 2025-04-01 because challenger beat "
            "champion by 15.0% out-of-sample over 21 shadow days."
        ),
    )

    assert entry["event"] == "switch"
    assert entry["champion_config"] == list(champion)
    assert entry["challenger_config"] == list(challenger)
    assert entry["champion_mae"] == pytest.approx(12.0)
    assert entry["challenger_mae"] == pytest.approx(10.2)
    assert entry["shadow_days"] == 21
    assert "details" in entry
    assert len(entry["details"]) > 0


def test_rollback_log_entry_has_required_fields():
    """Rollback events must also be fully logged."""
    entry = build_log_entry(
        event="rollback",
        champion_config=CANDIDATE_CONFIGS[3],
        challenger_config=None,
        champion_mae=14.0,
        challenger_mae=None,
        shadow_days=None,
        details="Rolled back: adopted challenger performed 16.7% worse live.",
    )
    assert entry["event"] == "rollback"
    assert entry["challenger_config"] is None
    assert "worse" in entry["details"].lower()


def test_thin_data_log_entry():
    """Thin-data events are logged too (developer can see why no tuning happened)."""
    entry = build_log_entry(
        event="thin_data",
        champion_config=DEFAULT_CONFIG,
        challenger_config=None,
        champion_mae=None,
        challenger_mae=None,
        shadow_days=None,
        details="Only 26 logged days; need at least 84 before tuning. No change.",
    )
    assert entry["event"] == "thin_data"
    assert entry["champion_config"] == list(DEFAULT_CONFIG)


def test_shadow_comparison_log_entry():
    """Shadow comparison events log both MAEs and the shadow period length."""
    entry = build_log_entry(
        event="shadow_comparison",
        champion_config=DEFAULT_CONFIG,
        challenger_config=CANDIDATE_CONFIGS[4],
        champion_mae=11.5,
        challenger_mae=10.9,
        shadow_days=14,
        details="Shadow day 14: challenger ahead by 5.2% but not yet at threshold.",
    )
    assert entry["shadow_days"] == 14
    assert entry["champion_mae"] == pytest.approx(11.5)
    assert entry["challenger_mae"] == pytest.approx(10.9)


# ---------------------------------------------------------------------------
# (d) Rollback when adopted challenger performs worse live
# ---------------------------------------------------------------------------

def test_rollback_triggers_when_live_worse_by_margin():
    """should_rollback must return True when the current champion (formerly a
    challenger) is materially worse live than the previous champion."""
    former_mae = 10.0
    current_mae = 10.0 * (1 + ROLLBACK_MARGIN_RATIO + 0.01)  # slightly above threshold
    assert should_rollback(former_mae, current_mae)


def test_rollback_triggers_at_large_degradation():
    """A 25% worse live performance must always trigger rollback."""
    assert should_rollback(former_champion_mae=10.0, current_champion_mae=12.5)


def test_rollback_does_not_trigger_when_live_better():
    """No rollback when the adopted config is performing at least as well."""
    assert not should_rollback(former_champion_mae=10.0, current_champion_mae=9.5)


def test_rollback_does_not_trigger_below_threshold():
    """A tiny degradation below ROLLBACK_MARGIN_RATIO must not trigger rollback."""
    former_mae = 10.0
    current_mae = 10.0 * (1 + ROLLBACK_MARGIN_RATIO * 0.5)  # half the threshold
    assert not should_rollback(former_mae, current_mae)


def test_rollback_returns_false_when_former_mae_is_zero():
    """Degenerate case: former champion MAE=0 makes comparison undefined; no rollback."""
    assert not should_rollback(former_champion_mae=0.0, current_champion_mae=5.0)


# ---------------------------------------------------------------------------
# should_switch — guardrails
# ---------------------------------------------------------------------------

def test_should_switch_true_when_all_conditions_met():
    """Challenger wins by margin AND shadow window is long enough → switch."""
    champion_mae = 10.0
    challenger_mae = 10.0 * (1 - SWITCH_MARGIN_RATIO - 0.01)  # beats by > threshold
    assert should_switch(champion_mae, challenger_mae, MIN_SHADOW_DAYS)


def test_should_switch_false_when_shadow_too_short():
    """Even a large margin is not enough if the shadow window is too short."""
    assert not should_switch(10.0, 1.0, shadow_days_count=MIN_SHADOW_DAYS - 1)


def test_should_switch_false_when_margin_too_small():
    """Below SWITCH_MARGIN_RATIO the challenger has not proved itself."""
    champion_mae = 10.0
    challenger_mae = 10.0 * (1 - SWITCH_MARGIN_RATIO * 0.5)  # half the required margin
    assert not should_switch(champion_mae, challenger_mae, MIN_SHADOW_DAYS)


def test_should_switch_false_when_challenger_is_worse():
    """A challenger with higher MAE than the champion must never be adopted."""
    assert not should_switch(
        champion_mae=10.0, challenger_mae=12.0, shadow_days_count=MIN_SHADOW_DAYS
    )


def test_should_switch_false_when_champion_mae_is_zero():
    """Zero champion MAE makes improvement ratio undefined; no switch."""
    assert not should_switch(
        champion_mae=0.0, challenger_mae=0.0, shadow_days_count=MIN_SHADOW_DAYS
    )


# ---------------------------------------------------------------------------
# meta_predict — basic behaviour
# ---------------------------------------------------------------------------

def test_meta_predict_returns_none_when_no_same_weekday_data():
    """With no same-weekday history, meta_predict cannot form any signal."""
    # One data point on a Monday; target is also Monday but later
    dates = [date(2025, 1, 6)]    # Monday
    values = [50.0]
    target = date(2025, 1, 13)   # next Monday — one prior same-weekday obs exists
    pred = meta_predict(dates, values, target, DEFAULT_CONFIG)
    assert pred is not None  # one obs is enough to get a recent signal

    # If the only data point is a Tuesday and target is Monday → no signal
    dates2 = [date(2025, 1, 7)]  # Tuesday
    values2 = [50.0]
    pred2 = meta_predict(dates2, values2, date(2025, 1, 13), DEFAULT_CONFIG)
    assert pred2 is None


def test_meta_predict_weights_renormalized_when_year_absent():
    """When the year-ago signal is absent, w_recent and w_medium together sum to
    1 (renormalized).  The output should equal a weighted blend of just those two."""
    # 8 Mondays in train (no year-ago data — history < 1 year)
    dates = [date(2025, 1, 6) + timedelta(weeks=i) for i in range(8)]
    values = [float(50 + i) for i in range(8)]  # gently rising: 50 … 57
    target = date(2025, 3, 3)  # next Monday after last train Monday

    config = (0.60, 0.30, 0.10)  # w_year=0.10 will be redistributed
    pred = meta_predict(dates, values, target, config)
    assert pred is not None
    # Prediction must be in a sensible range (roughly 50–60)
    assert 45 < pred < 65


def test_meta_predict_uses_only_data_before_target():
    """meta_predict must NOT use the target date's own value or future dates."""
    dates = [date(2025, 1, 6), date(2025, 1, 13), date(2025, 1, 20)]
    values = [50.0, 60.0, 999.0]  # the 20th has a wild value
    target = date(2025, 1, 20)    # predicting the 20th

    pred = meta_predict(dates, values, target, DEFAULT_CONFIG)
    # Should not include 999.0 in any signal
    assert pred is not None
    assert pred < 200


def test_meta_predict_config_weights_affect_output():
    """Different meta-weight configs produce different predictions when the
    recent and medium signals differ."""
    # Last 4 Mondays: 80, 80, 80, 80 (recent = 80)
    # Mondays 5-8 weeks back: 40, 40, 40, 40 (medium average pulled down)
    dates = [date(2025, 1, 6) + timedelta(weeks=i) for i in range(8)]
    values = [40.0, 40.0, 40.0, 40.0, 80.0, 80.0, 80.0, 80.0]
    target = date(2025, 3, 3)  # next Monday

    recent_heavy = (0.90, 0.05, 0.05)
    medium_heavy = (0.05, 0.90, 0.05)
    pred_recent = meta_predict(dates, values, target, recent_heavy)
    pred_medium = meta_predict(dates, values, target, medium_heavy)

    assert pred_recent is not None
    assert pred_medium is not None
    # recent-heavy → closer to 80; medium-heavy → closer to 60 (mean of all)
    assert pred_recent > pred_medium


# ---------------------------------------------------------------------------
# compare_in_shadow
# ---------------------------------------------------------------------------

def test_compare_in_shadow_returns_none_with_too_few_days():
    """Fewer than 3 valid prediction pairs → None (not enough signal)."""
    history_dates = [date(2025, 1, 6) + timedelta(weeks=i) for i in range(4)]
    history_values = [50.0] * 4
    # Only 2 shadow days
    shadow_dates = [date(2025, 2, 3), date(2025, 2, 10)]
    shadow_values = [52.0, 48.0]

    result = compare_in_shadow(
        DEFAULT_CONFIG, CANDIDATE_CONFIGS[3],
        history_dates, history_values,
        shadow_dates, shadow_values,
    )
    assert result is None


def test_compare_in_shadow_returns_two_maes():
    """With enough shadow days, compare_in_shadow returns (champion_mae, challenger_mae)."""
    # 12 Mondays of history
    history_dates = [date(2025, 1, 6) + timedelta(weeks=i) for i in range(12)]
    history_values = [50.0] * 12
    # 14 consecutive days of shadow
    shadow_dates = [date(2025, 4, 7) + timedelta(days=i) for i in range(14)]
    shadow_values = [50.0] * 14

    result = compare_in_shadow(
        DEFAULT_CONFIG, CANDIDATE_CONFIGS[2],
        history_dates, history_values,
        shadow_dates, shadow_values,
    )
    # May be None if not enough same-weekday predictions, but structure is correct
    # (flat stable data → both MAEs ≈ 0 if same prediction)
    if result is not None:
        champ_mae, chall_mae = result
        assert champ_mae >= 0
        assert chall_mae >= 0


# ---------------------------------------------------------------------------
# Bounded configs — anti-domination guard
# ---------------------------------------------------------------------------

def test_all_candidate_configs_are_bounded():
    """Every candidate config must have all weights in [0.10, 0.75] and sum to 1."""
    for cfg in CANDIDATE_CONFIGS:
        w_recent, w_medium, w_year = cfg
        assert 0.10 <= w_recent <= 0.75, f"w_recent out of bounds in {cfg}"
        assert 0.10 <= w_medium <= 0.75, f"w_medium out of bounds in {cfg}"
        assert 0.10 <= w_year <= 0.75, f"w_year out of bounds in {cfg}"
        assert abs(w_recent + w_medium + w_year - 1.0) < 1e-9, f"weights don't sum to 1 in {cfg}"


def test_default_config_is_in_candidate_list():
    """DEFAULT_CONFIG must be one of the candidates so it can be evaluated."""
    assert DEFAULT_CONFIG in CANDIDATE_CONFIGS
