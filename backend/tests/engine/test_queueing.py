"""Known-answer tests for engine.queueing."""
import pytest
from app.engine.queueing import (
    effective_service_time,
    erlang_c,
    expected_wait_minutes,
    marginal_note,
    min_servers,
    queue_length,
    utilisation,
    OVERLOADED,
    UTILISATION_CAP,
)


# ── min_servers ───────────────────────────────────────────────────────────────

def test_zero_arrivals_returns_one():
    assert min_servers(0, 5) == 1


def test_negative_arrivals_returns_one():
    assert min_servers(-5, 5) == 1


def test_zero_service_time_returns_one():
    assert min_servers(10, 0) == 1


def test_one_server_sufficient():
    # λ=10/hr, μ=60/5=12/hr, raw=10/(12·0.85)=0.98 → ceil=1
    assert min_servers(10, 5) == 1


def test_two_servers_needed():
    # λ=15/hr, μ=12/hr, raw=15/(12·0.85)=1.47 → ceil=2
    assert min_servers(15, 5) == 2


def test_slow_service_needs_more_staff():
    # λ=12/hr, μ=60/10=6/hr, raw=12/(6·0.85)=2.35 → ceil=3
    assert min_servers(12, 10) == 3


def test_high_traffic_many_servers():
    # λ=60/hr, μ=12/hr, raw=60/(12·0.85)=5.88 → ceil=6
    assert min_servers(60, 5) == 6


def test_result_always_positive():
    assert min_servers(0.001, 60) >= 1


# ── utilisation ───────────────────────────────────────────────────────────────

def test_utilisation_one_server():
    # λ=10, service=5min → μ=12/hr, ρ=10/12
    assert abs(utilisation(10, 5, 1) - 10 / 12) < 1e-6


def test_utilisation_two_servers():
    # λ=10, service=5min → μ=12/hr, ρ=10/24
    assert abs(utilisation(10, 5, 2) - 10 / 24) < 1e-6


def test_utilisation_zero_servers_returns_zero():
    assert utilisation(10, 5, 0) == 0.0


def test_min_servers_result_keeps_utilisation_below_cap():
    # For any reasonable input the recommended c must satisfy ρ < CAP
    for lam in [5, 10, 20, 50, 100]:
        for svc in [2, 5, 10, 15]:
            c = min_servers(lam, svc)
            rho = utilisation(lam, svc, c)
            assert rho < UTILISATION_CAP, (
                f"λ={lam}, svc={svc}, c={c}, ρ={rho:.3f} ≥ {UTILISATION_CAP}"
            )


# ── effective_service_time ────────────────────────────────────────────────────

def test_eff_svc_empty_mix_returns_default():
    assert effective_service_time([], 8.0) == 8.0


def test_eff_svc_zero_qty_returns_default():
    # All quantities zero → falls back to default
    assert effective_service_time([(0.0, 30.0)], 8.0) == 8.0


def test_eff_svc_all_none_overrides_use_default():
    # No product overrides → result equals default
    mix = [(10.0, None), (5.0, None)]
    assert effective_service_time(mix, 8.0) == 8.0


def test_eff_svc_single_product_override():
    # Only one product with an explicit time → result is that time
    mix = [(10.0, 15.0)]
    assert abs(effective_service_time(mix, 8.0) - 15.0) < 1e-9


def test_eff_svc_equal_quantities_averages_times():
    # 10 units at 20 min, 10 units at default (10 min) → avg = 15
    mix = [(10.0, 20.0), (10.0, None)]
    assert abs(effective_service_time(mix, 10.0) - 15.0) < 1e-9


def test_eff_svc_weighted_by_quantity():
    # 4 units at 5 min + 1 unit at 25 min → (4*5 + 1*25) / 5 = 45/5 = 9.0
    mix = [(4.0, 5.0), (1.0, 25.0)]
    assert abs(effective_service_time(mix, 5.0) - 9.0) < 1e-9


def test_eff_svc_spa_example():
    # Spa: 2 massages (60 min) + 8 express treatments (10 min), default 30 min
    # weighted = (2*60 + 8*10) / 10 = (120 + 80) / 10 = 20.0
    mix = [(2.0, 60.0), (8.0, 10.0)]
    assert abs(effective_service_time(mix, 30.0) - 20.0) < 1e-9


def test_eff_svc_ignores_zero_qty_items():
    # A product with qty=0 must not affect the result
    mix = [(5.0, 10.0), (0.0, 60.0)]
    assert abs(effective_service_time(mix, 5.0) - 10.0) < 1e-9


# ── staffing recommendation end-to-end ───────────────────────────────────────
# These tests exercise the full path from arrival rate + product mix → staff count,
# matching the calculation the /hourly-analytics endpoint performs.

def test_staffing_cafe_peak_hour():
    # Busy café: 20 customers/hr, 5-min service each → μ=12/hr
    # raw = 20 / (12 × 0.85) = 1.96 → 2 staff
    assert min_servers(20, 5) == 2


def test_staffing_weighted_mix_spa():
    # Spa with product mix: 4 massages (60 min) + 2 express (10 min) in one hour
    # effective_service_time = (4×60 + 2×10) / 6 = 260/6 ≈ 43.3 min
    # μ = 60 / 43.3 ≈ 1.385/hr; λ = 6/hr; raw = 6 / (1.385 × 0.85) ≈ 5.1 → 6 staff
    mix = [(4.0, 60.0), (2.0, 10.0)]
    eff = effective_service_time(mix, 5.0)
    assert abs(eff - (4 * 60 + 2 * 10) / 6) < 1e-9
    assert min_servers(6, eff) == 6


def test_staffing_mixed_service_times_fewer_staff_than_flat_average():
    # If most customers take a short service time, weighted mix gives fewer staff
    # than the naive long-service-time estimate would.
    # 9 quick (5 min) + 1 long (50 min) out of 10 customers
    # eff = (9×5 + 1×50) / 10 = 95/10 = 9.5 min
    # Flat 50-min estimate for λ=10: min_servers(10, 50) >> min_servers(10, 9.5)
    mix = [(9.0, 5.0), (1.0, 50.0)]
    eff = effective_service_time(mix, 5.0)
    assert abs(eff - 9.5) < 1e-9
    assert min_servers(10, eff) < min_servers(10, 50.0)


def test_staffing_default_only_business_no_product_overrides():
    # A business that doesn't set per-product times just uses the default.
    # mix of (qty, None) should give same staff count as passing default directly.
    mix = [(5.0, None), (3.0, None), (2.0, None)]
    default_svc = 8.0
    eff = effective_service_time(mix, default_svc)
    assert eff == default_svc
    assert min_servers(10, eff) == min_servers(10, default_svc)


# ── erlang_c ──────────────────────────────────────────────────────────────────

def test_erlang_c_overloaded_returns_one():
    # ρ ≥ 1 → every customer waits
    assert erlang_c(100, 5, 1) == 1.0   # λ=100, μ=12, ρ=100/12 >> 1


def test_erlang_c_zero_arrivals():
    assert erlang_c(0, 5, 2) == 0.0


def test_erlang_c_in_range():
    # λ=20/hr, svc=5min → μ=12/hr, c=2, ρ=20/24≈0.833 → C should be ∈ (0,1)
    c = erlang_c(20, 5, 2)
    assert 0.0 < c < 1.0


def test_erlang_c_more_servers_lower_probability():
    # With more servers the probability of waiting decreases
    assert erlang_c(20, 5, 3) < erlang_c(20, 5, 2)


def test_erlang_c_single_server_equals_utilisation():
    # For M/M/1, Erlang C = ρ  (when c=1, ρ<1)
    # Verify: λ=6, svc=5 → μ=12, ρ=0.5; C(1,0.5) should ≈ 0.5
    lam, svc, c = 6.0, 5.0, 1
    mu = 60.0 / svc
    rho = lam / (c * mu)
    assert abs(erlang_c(lam, svc, c) - rho) < 1e-9


# ── expected_wait_minutes ─────────────────────────────────────────────────────

def test_expected_wait_overloaded():
    # Overloaded system → OVERLOADED sentinel
    assert expected_wait_minutes(100, 5, 1) == OVERLOADED


def test_expected_wait_zero_arrivals():
    assert expected_wait_minutes(0, 5, 2) == 0.0


def test_expected_wait_positive():
    # Busy café: λ=20, svc=5, c=2 (ρ≈0.83) → some positive wait
    w = expected_wait_minutes(20, 5, 2)
    assert w > 0.0
    assert w < OVERLOADED


def test_expected_wait_more_servers_reduces_wait():
    # Adding servers always reduces (or keeps equal) expected wait
    w2 = expected_wait_minutes(20, 5, 2)
    w3 = expected_wait_minutes(20, 5, 3)
    assert w3 < w2


def test_expected_wait_low_traffic_near_zero():
    # Very light traffic → wait approaches zero
    w = expected_wait_minutes(1, 5, 5)
    assert w < 0.1


def test_expected_wait_cafe_known_case():
    # λ=20, svc=5min, c=2: verify against hand-computed value
    # μ=12, a=20/12=1.667, ρ=0.833
    # C ≈ 0.757, Wq_hours = 0.757/(2*12-20) = 0.757/4 = 0.189 hr = 11.3 min
    w = expected_wait_minutes(20, 5, 2)
    assert abs(w - 11.3) < 0.2


# ── queue_length ──────────────────────────────────────────────────────────────

def test_queue_length_overloaded():
    assert queue_length(100, 5, 1) == OVERLOADED


def test_queue_length_zero_arrivals():
    assert queue_length(0, 5, 2) == 0.0


def test_queue_length_positive():
    lq = queue_length(20, 5, 2)
    assert lq > 0.0
    assert lq < OVERLOADED


def test_queue_length_littles_law():
    # Lq = λ · Wq_hours  ↔  Lq = λ/60 · Wq_min  (λ in per-hour, Wq in min)
    lam, svc, c = 20.0, 5.0, 2
    lq = queue_length(lam, svc, c)
    wq_min = expected_wait_minutes(lam, svc, c)
    assert abs(lq - lam * wq_min / 60.0) < 1e-6


def test_queue_length_more_servers_shorter_queue():
    assert queue_length(20, 5, 3) < queue_length(20, 5, 2)


# ── marginal_note ─────────────────────────────────────────────────────────────

def test_marginal_note_mentions_adding():
    # The note should always explain what happens when you add 1 person
    note = marginal_note(20, 5, 2)
    assert "3rd" in note or "adding" in note.lower() or "3" in note


def test_marginal_note_mentions_removing_when_c_gt_1():
    # For c>1 the note also addresses removing 1 person
    note = marginal_note(20, 5, 2)
    assert "fewer" in note.lower() or "1 fewer" in note.lower() or "overload" in note.lower()


def test_marginal_note_no_remove_when_c_equals_1():
    # When c=1 there is nothing to remove — note should not mention "fewer"
    note = marginal_note(5, 5, 1)
    assert "fewer" not in note.lower()


def test_marginal_note_overload_warning():
    # When removing 1 person would overload, the note must warn
    # λ=20, svc=5 → c=2 is minimum recommended; c-1=1 gives ρ=20/12>1
    note = marginal_note(20, 5, 2)
    assert "overload" in note.lower() or "keep at least" in note.lower()


def test_marginal_note_short_queue_message():
    # Very light traffic (c well above minimum) → note flags short queue
    note = marginal_note(1, 5, 5)
    assert "short" in note.lower() or "little effect" in note.lower() or "already" in note.lower()


def test_marginal_note_no_data():
    note = marginal_note(0, 5, 2)
    assert "not enough" in note.lower() or "data" in note.lower()


def test_marginal_note_cuts_wait_phrasing():
    # A well-loaded system with room to add staff should use "cuts" phrasing
    note = marginal_note(20, 5, 2)
    assert "cut" in note.lower() or "from" in note.lower()
