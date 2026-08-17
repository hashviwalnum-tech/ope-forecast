"""
Why do the ensemble weights sit so close to a plain four-way average?

Two possible explanations, and they call for opposite responses:

  A. The four methods really are about equally skilful on this business, so an
     even split is the right answer and the mechanism is working.
  B. The re-weighting is under-reacting — real differences in per-weekday skill
     exist but are being flattened, which would be a bug.

This replays the app's own models over the observed series, walking forward and
only ever using data that came earlier, then compares:

  * each model's true long-run skill, per weekday;
  * the weights the ensemble actually assigned;
  * what several alternative weighting rules would have scored.

Everything here comes from data the app can legitimately see — the logged daily
totals — never from the generator.

Run AFTER run_year:  python -m tests.simulation.analyse_weights
"""
from __future__ import annotations

import json
import statistics
from datetime import date
from pathlib import Path

import numpy as np

from tests.simulation.harness import prepare_env

prepare_env(fresh=False)          # analytics imports app.db, which needs DATABASE_URL

from app.api.analytics import (   # noqa: E402
    _exp_for_weekday,
    _linear_trend_for_weekday,
    _wma_for_weekday,
    _cap_linear_trend,
)
from app.engine.ensemble import model_weights   # noqa: E402
from app.engine.seasonality import seasonal_naive_forecast   # noqa: E402
from tests.simulation.score import load_state   # noqa: E402

OUT_DIR = Path(__file__).resolve().parents[3] / "docs" / "simulation"
_WD = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MODELS = ["seasonal_naive", "wma", "exp_smoothing", "linear_trend"]


def predict_all(obs: list[float], wds: list[int], wd: int) -> dict[str, float]:
    """Every model's prediction for weekday `wd`, using only obs/wds so far."""
    out: dict[str, float] = {}
    try:
        out["seasonal_naive"] = seasonal_naive_forecast(obs, wds, wd)
    except ValueError:
        pass
    p = _wma_for_weekday(obs, wds, wd)
    if p is not None:
        out["wma"] = p
    p = _exp_for_weekday(obs, wds, wd)
    if p is not None:
        out["exp_smoothing"] = p
    p = _linear_trend_for_weekday(obs, wds, wd)
    if p is not None:
        same = [v for v, w in zip(obs, wds) if w == wd]
        out["linear_trend"] = _cap_linear_trend(p, same)
    return out


def walk_forward(warmup: int = 28):
    """Every model's error on every day, predicted from prior data only."""
    state = load_state()
    series = sorted((date.fromisoformat(k), float(v)) for k, v in state["actuals"].items())
    obs = [v for _d, v in series]
    wds = [d.weekday() for d, _v in series]

    rows = []
    for i in range(warmup, len(obs)):
        preds = predict_all(obs[:i], wds[:i], wds[i])
        if len(preds) < len(MODELS):
            continue
        rows.append({"i": i, "weekday": wds[i], "actual": obs[i], "preds": preds})
    return rows, obs, wds


def main() -> None:
    rows, obs, wds = walk_forward()
    print(f"replayed {len(rows)} days where all four models could predict\n")

    # ── 1. True long-run skill per model, overall and per weekday ────────────
    def mae(vals):
        return statistics.fmean(abs(x) for x in vals)

    overall = {m: mae([r["actual"] - r["preds"][m] for r in rows]) for m in MODELS}
    print("TRUE long-run skill (MAE over the whole year, lower is better)")
    for m in sorted(overall, key=overall.get):
        print(f"   {m:<16}{overall[m]:>8.2f}")
    spread = (max(overall.values()) - min(overall.values())) / min(overall.values()) * 100
    print(f"   best-to-worst spread: {spread:.1f}%\n")

    per_wd: dict[int, dict[str, float]] = {}
    print("per weekday (MAE), and which model actually won that weekday")
    print(f"   {'day':<11}" + "".join(f"{m[:10]:>12}" for m in MODELS) + f"{'winner':>16}{'spread':>9}")
    for wd in sorted({r["weekday"] for r in rows}):
        sub = [r for r in rows if r["weekday"] == wd]
        d = {m: mae([r["actual"] - r["preds"][m] for r in sub]) for m in MODELS}
        per_wd[wd] = d
        win = min(d, key=d.get)
        sp = (max(d.values()) - min(d.values())) / min(d.values()) * 100
        print(f"   {_WD[wd]:<11}" + "".join(f"{d[m]:>12.2f}" for m in MODELS)
              + f"{win:>16}{sp:>8.1f}%")
    print()

    # ── 2. How much do the models actually disagree with each other? ─────────
    print("how much the models DISAGREE (mean |a - b| between predictions)")
    for a_i, a in enumerate(MODELS):
        for b in MODELS[a_i + 1:]:
            diff = statistics.fmean(abs(r["preds"][a] - r["preds"][b]) for r in rows)
            print(f"   {a:<16} vs {b:<16}{diff:>8.2f}")
    typical = statistics.fmean(r["actual"] for r in rows)
    print(f"   (typical day is {typical:.0f} customers)\n")

    # ── 3. What the weights would be under different rules ──────────────────
    def blend(weights_fn):
        errs = []
        for r in rows:
            w = weights_fn(r)
            pred = sum(w[m] * r["preds"][m] for m in MODELS)
            errs.append((r["actual"] - pred) / r["actual"])
        return statistics.fmean(abs(e) for e in errs) * 100

    equal = {m: 0.25 for m in MODELS}
    inv_true = dict(zip(MODELS, model_weights([overall[m] for m in MODELS])))
    inv_sq = {}
    tot = sum(1 / overall[m] ** 2 for m in MODELS)
    for m in MODELS:
        inv_sq[m] = (1 / overall[m] ** 2) / tot

    def per_wd_inv(r):
        d = per_wd[r["weekday"]]
        return dict(zip(MODELS, model_weights([d[m] for m in MODELS])))

    def best_only(r):
        d = per_wd[r["weekday"]]
        win = min(d, key=d.get)
        return {m: (1.0 if m == win else 0.0) for m in MODELS}

    print("weights each rule would assign (using perfect hindsight on skill)")
    print(f"   {'rule':<28}" + "".join(f"{m[:10]:>12}" for m in MODELS) + f"{'MAPE':>9}")
    for label, w in (("equal quarters", equal),
                     ("inverse error (as shipped)", inv_true),
                     ("inverse SQUARED error", inv_sq)):
        print(f"   {label:<28}" + "".join(f"{w[m]:>12.3f}" for m in MODELS)
              + f"{blend(lambda r, w=w: w):>8.2f}%")
    print(f"   {'inverse error, per weekday':<28}" + " " * 48 + f"{blend(per_wd_inv):>8.2f}%")
    print(f"   {'best single model per weekday':<28}" + " " * 48 + f"{blend(best_only):>8.2f}%")
    for m in MODELS:
        only = {k: (1.0 if k == m else 0.0) for k in MODELS}
        print(f"   {'only ' + m:<28}" + " " * 48 + f"{blend(lambda r, w=only: w):>8.2f}%")
    print()

    # ── 4. How noisy is the 4-point estimate the app actually uses? ──────────
    print("the app judges skill from the last 4 same-weekday holdout errors.")
    print("how stable is that judgement?  (how often the 4-point winner is the true winner)")
    hits = tot_n = 0
    for wd in per_wd:
        sub = [r for r in rows if r["weekday"] == wd]
        true_win = min(per_wd[wd], key=per_wd[wd].get)
        for k in range(4, len(sub)):
            window = sub[k - 4:k]
            est = {m: mae([r["actual"] - r["preds"][m] for r in window]) for m in MODELS}
            tot_n += 1
            hits += (min(est, key=est.get) == true_win)
    print(f"   4-point window picks the true best model {hits/tot_n*100:.1f}% of the time "
          f"(chance would be 25%)\n")

    res = {
        "n_days": len(rows),
        "true_mae_overall": {m: round(v, 3) for m, v in overall.items()},
        "best_to_worst_spread_pct": round(spread, 2),
        "true_mae_per_weekday": {_WD[wd]: {m: round(v, 3) for m, v in d.items()}
                                 for wd, d in per_wd.items()},
        "mape_equal_weights": round(blend(lambda r: equal), 3),
        "mape_inverse_error": round(blend(lambda r: inv_true), 3),
        "mape_inverse_squared": round(blend(lambda r: inv_sq), 3),
        "mape_per_weekday_inverse": round(blend(per_wd_inv), 3),
        "mape_best_single_per_weekday": round(blend(best_only), 3),
        "mape_single_model": {m: round(blend(lambda r, w={k: (1.0 if k == m else 0.0)
                                                          for k in MODELS}: w), 3)
                              for m in MODELS},
        "four_point_window_picks_true_best_pct": round(hits / tot_n * 100, 2),
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "weights_analysis.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"written: {OUT_DIR / 'weights_analysis.json'}")


if __name__ == "__main__":
    main()
