"""
Self-tuning meta-weight optimizer (champion-challenger shadow testing).
See spec §2 SELF-TUNING section for the full design rationale and guardrails.

Concept: beyond per-model inverse-error weighting (ensemble.py), this layer
periodically searches over different meta-weightings of the three signal groups
(recent same-weekday / medium-window same-weekday / year-ago) to find which
blend would have predicted past actuals most accurately.  The best candidate
runs in silent shadow mode alongside the live champion; it becomes the new
champion only when all guardrails pass.  Invisible to end users.

Meta-weight config: (w_recent, w_medium, w_year)
  w_recent — weight on last RECENT_N same-weekday observations
  w_medium — weight on last MEDIUM_N same-weekday observations
  w_year   — weight on the year-over-year forecast signal
  The three must sum to 1.0; never extreme values (bounded range).

Pure functions — no DB, no I/O.  State persistence is the caller's job.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from app.engine.forecasting import year_over_year_forecast

# ---------------------------------------------------------------------------
# Constants — guardrails (all non-negotiable per spec §2)
# ---------------------------------------------------------------------------

MIN_TOTAL_DAYS: int = 84
"""Thin-data guard: at least 12 full weeks of logged days required before ANY
tuning or switching.  With fewer days there is insufficient data to both train
AND validate out-of-sample.  The current ~26-day dataset fails this check so
the system stays on DEFAULT_CONFIG unconditionally."""

MIN_HOLDOUT_DAYS: int = 21
"""Days held out strictly for out-of-sample validation — 3 full weeks, giving
3 observations per weekday.  The tuner NEVER tunes on these days; they exist
solely to prove a candidate's value on data it has not seen."""

MIN_TRAIN_DAYS: int = MIN_TOTAL_DAYS - MIN_HOLDOUT_DAYS
"""Minimum in-sample training data after the holdout is carved out."""

MIN_SHADOW_DAYS: int = 14
"""Shadow period: the challenger must beat the champion consistently over at
least this many live days before adoption is considered.  A few days is not
enough — overfitting shows up exactly in short windows.  2 full weeks is the
meaningful period the spec requires."""

SWITCH_MARGIN_RATIO: float = 0.05
"""Challenger must beat champion out-of-sample MAE by at least this fraction
(5%) before it is worth the risk of a switch.  A trivial margin does not
justify strategy-flipping."""

ROLLBACK_MARGIN_RATIO: float = 0.02
"""Safety floor / instant rollback: if the adopted challenger (now champion)
underperforms live vs the previous champion by this fraction (2%), snap back
immediately.  Never let a bad tune persist."""

# ---------------------------------------------------------------------------
# Observation window sizes for the two same-weekday signals
# ---------------------------------------------------------------------------

RECENT_N: int = 4
"""Same-weekday observations used for the 'recent' signal (last ~4 weeks)."""

MEDIUM_N: int = 8
"""Same-weekday observations used for the 'medium' signal (last ~8 weeks)."""

# ---------------------------------------------------------------------------
# Bounded candidate configs — anti-domination guard
# Each weight stays in [0.10, 0.75]; no extreme blends.
# The same guard that stopped the linear_trend 915 blow-up.
# ---------------------------------------------------------------------------

CANDIDATE_CONFIGS: list[tuple[float, float, float]] = [
    # (w_recent, w_medium, w_year)
    (0.60, 0.30, 0.10),  # default / safe baseline
    (0.50, 0.40, 0.10),
    (0.70, 0.20, 0.10),
    (0.50, 0.30, 0.20),
    (0.40, 0.40, 0.20),
    (0.60, 0.20, 0.20),
    (0.50, 0.25, 0.25),
    (0.45, 0.35, 0.20),
]

DEFAULT_CONFIG: tuple[float, float, float] = (0.60, 0.30, 0.10)
"""The safe starting champion config — moderate recency-bias, no year-ago
weight unless/until data proves it worth more."""


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------


def _same_weekday_obs(
    dates: list[date],
    values: list[float],
    target_date: date,
    n: int,
) -> float | None:
    """Mean of the last *n* same-weekday observations strictly before target_date.

    Returns None when no same-weekday observations exist before target_date.
    When fewer than n observations exist, uses all that are available.
    """
    wd = target_date.weekday()
    matching = [
        v for d, v in zip(dates, values)
        if d < target_date and d.weekday() == wd
    ]
    if not matching:
        return None
    return float(np.mean(matching[-n:]))


# ---------------------------------------------------------------------------
# Meta-weighted prediction — the single model this tuner optimises
# ---------------------------------------------------------------------------


def meta_predict(
    dates: list[date],
    values: list[float],
    target_date: date,
    config: tuple[float, float, float],
) -> float | None:
    """Meta-weighted prediction for target_date using only data before target_date.

    config = (w_recent, w_medium, w_year) — weights summing to 1.

    Signals:
      recent — mean of last RECENT_N same-weekday obs (short recency window)
      medium — mean of last MEDIUM_N same-weekday obs (broader history)
      year   — year_over_year_forecast (may be None with < 1 year of data)

    When a signal is unavailable, its weight is redistributed proportionally
    among the remaining signals.  Returns None only when ALL signals fail
    (no same-weekday history at all — extremely early in business life).
    """
    w_recent, w_medium, w_year = config

    recent = _same_weekday_obs(dates, values, target_date, RECENT_N)
    medium = _same_weekday_obs(dates, values, target_date, MEDIUM_N)
    year = year_over_year_forecast(dates, values, target_date)

    signals: list[float] = []
    weights: list[float] = []
    if recent is not None:
        signals.append(recent)
        weights.append(w_recent)
    if medium is not None:
        signals.append(medium)
        weights.append(w_medium)
    if year is not None:
        signals.append(year)
        weights.append(w_year)

    if not signals:
        return None

    total_w = sum(weights)
    normalized = [w / total_w for w in weights]
    return float(np.dot(signals, normalized))


# ---------------------------------------------------------------------------
# Data-sufficiency check — the thin-data guard
# ---------------------------------------------------------------------------


def has_enough_data(dates: list[date]) -> bool:
    """True only when there are at least MIN_TOTAL_DAYS distinct logged days.

    Below this threshold the system stays on DEFAULT_CONFIG.  With the current
    ~26-day dataset this always returns False, so no tuning or switching occurs.
    """
    return len(dates) >= MIN_TOTAL_DAYS


# ---------------------------------------------------------------------------
# Out-of-sample evaluation
# ---------------------------------------------------------------------------


def evaluate_config_oos_mae(
    config: tuple[float, float, float],
    train_dates: list[date],
    train_values: list[float],
    holdout_dates: list[date],
    holdout_values: list[float],
) -> float | None:
    """Out-of-sample MAE for a config on holdout data.

    Critically: predictions are computed using ONLY train_dates/train_values —
    the holdout data is never seen by the predictor.  This is the non-negotiable
    anti-overfit defence: a weighting that merely fits history cannot win here.

    Returns None when the config produces fewer than 3 valid predictions on the
    holdout set — treat such a config as unusable for evaluation.
    """
    errors: list[float] = []
    for target_d, actual in zip(holdout_dates, holdout_values):
        pred = meta_predict(train_dates, train_values, target_d, config)
        if pred is not None:
            errors.append(abs(actual - pred))

    if len(errors) < 3:
        return None
    return float(np.mean(errors))


# ---------------------------------------------------------------------------
# Champion-challenger search
# ---------------------------------------------------------------------------


def find_best_challenger(
    dates: list[date],
    values: list[float],
    current_champion: tuple[float, float, float],
) -> tuple[tuple[float, float, float], float] | None:
    """Search for a challenger config that beats the champion out-of-sample.

    Returns (challenger_config, challenger_oos_mae) if one is found, or None if:
      - thin-data guard fires (fewer than MIN_TOTAL_DAYS logged days)
      - no candidate beats the champion by >= SWITCH_MARGIN_RATIO on holdout
      - champion itself cannot be evaluated on holdout (degenerate data)

    Out-of-sample design: sorted chronologically, then split as
      train  = all days except the last MIN_HOLDOUT_DAYS
      holdout = the last MIN_HOLDOUT_DAYS days
    Candidate configs are evaluated using ONLY train data to predict holdout.
    The holdout is strictly unseen during the search — this is what makes it
    out-of-sample.  A config cannot win by overfitting history.
    """
    if not has_enough_data(dates):
        return None

    paired = sorted(zip(dates, values), key=lambda x: x[0])
    sorted_dates = [p[0] for p in paired]
    sorted_vals = [p[1] for p in paired]

    train_dates = sorted_dates[:-MIN_HOLDOUT_DAYS]
    train_vals = sorted_vals[:-MIN_HOLDOUT_DAYS]
    holdout_dates = sorted_dates[-MIN_HOLDOUT_DAYS:]
    holdout_vals = sorted_vals[-MIN_HOLDOUT_DAYS:]

    champion_mae = evaluate_config_oos_mae(
        current_champion, train_dates, train_vals, holdout_dates, holdout_vals
    )
    if champion_mae is None:
        return None

    best_config: tuple[float, float, float] | None = None
    best_mae: float = champion_mae

    for cfg in CANDIDATE_CONFIGS:
        if cfg == current_champion:
            continue
        mae = evaluate_config_oos_mae(cfg, train_dates, train_vals, holdout_dates, holdout_vals)
        if mae is None:
            continue
        if mae < best_mae:
            best_mae = mae
            best_config = cfg

    if best_config is None:
        return None

    # When the champion is already near-perfect (MAE < 1e-9 — floating-point zero),
    # relative improvement is meaningless and the comparison is unreliable.
    # No switch needed: the current blend is already producing optimal predictions.
    if champion_mae < 1e-9:
        return None

    # Must beat champion by a real margin — not a trivial fraction
    improvement = (champion_mae - best_mae) / champion_mae
    if improvement < SWITCH_MARGIN_RATIO:
        return None

    return (best_config, best_mae)


# ---------------------------------------------------------------------------
# Shadow comparison
# ---------------------------------------------------------------------------


def compare_in_shadow(
    champion: tuple[float, float, float],
    challenger: tuple[float, float, float],
    history_dates: list[date],
    history_values: list[float],
    shadow_dates: list[date],
    shadow_values: list[float],
) -> tuple[float, float] | None:
    """Compare champion vs challenger on the live shadow period.

    For each shadow day, both configs are evaluated using all data available
    before that day (history + prior shadow days) — a rolling walk-forward
    evaluation.  Returns (champion_mae, challenger_mae), or None when fewer
    than 3 valid prediction pairs exist (not enough signal to compare).

    shadow_dates/values are the recent live days since the challenger was
    launched; they are NOT part of the original training split.
    """
    champ_errors: list[float] = []
    chall_errors: list[float] = []

    for i, (target_d, actual) in enumerate(zip(shadow_dates, shadow_values)):
        ctx_dates = history_dates + shadow_dates[:i]
        ctx_vals = history_values + shadow_values[:i]

        c_pred = meta_predict(ctx_dates, ctx_vals, target_d, champion)
        ch_pred = meta_predict(ctx_dates, ctx_vals, target_d, challenger)

        if c_pred is not None and ch_pred is not None:
            champ_errors.append(abs(actual - c_pred))
            chall_errors.append(abs(actual - ch_pred))

    if len(champ_errors) < 3:
        return None

    return float(np.mean(champ_errors)), float(np.mean(chall_errors))


def should_switch(
    champion_mae: float,
    challenger_mae: float,
    shadow_days_count: int,
) -> bool:
    """True when challenger earns adoption: wins by a real margin over a meaningful period.

    Both conditions must hold:
    1. shadow_days_count >= MIN_SHADOW_DAYS — enough time to distinguish signal
       from noise.  A few days is not enough; the spec is explicit on this.
    2. Challenger beats champion by >= SWITCH_MARGIN_RATIO — a real margin,
       not a trivial fraction.
    """
    if shadow_days_count < MIN_SHADOW_DAYS:
        return False
    if champion_mae == 0:
        return False
    improvement = (champion_mae - challenger_mae) / champion_mae
    return improvement >= SWITCH_MARGIN_RATIO


def should_rollback(
    former_champion_mae: float,
    current_champion_mae: float,
) -> bool:
    """Safety floor: snap back when the adopted challenger performs worse live.

    If the new champion's live MAE exceeds the former champion's MAE by
    >= ROLLBACK_MARGIN_RATIO, revert immediately.  Never let a bad tune persist.

    Returns False when former_champion_mae is zero (degenerate — can't compare).
    """
    if former_champion_mae == 0:
        return False
    degradation = (current_champion_mae - former_champion_mae) / former_champion_mae
    return degradation >= ROLLBACK_MARGIN_RATIO


# ---------------------------------------------------------------------------
# Developer-visible log builder
# ---------------------------------------------------------------------------


def build_log_entry(
    event: str,
    champion_config: tuple[float, float, float],
    challenger_config: tuple[float, float, float] | None,
    champion_mae: float | None,
    challenger_mae: float | None,
    shadow_days: int | None,
    details: str,
) -> dict:
    """Build a structured log entry for insertion into TunerLog.

    Pure function — no DB access.  Returns a dict with every required field
    so the developer can reconstruct what happened, why, and when.

    event is one of: "challenger_proposed", "shadow_comparison",
                      "switch", "rollback", "no_change", "thin_data".
    """
    return {
        "event": event,
        "champion_config": list(champion_config),
        "challenger_config": list(challenger_config) if challenger_config is not None else None,
        "champion_mae": champion_mae,
        "challenger_mae": challenger_mae,
        "shadow_days": shadow_days,
        "details": details,
    }
