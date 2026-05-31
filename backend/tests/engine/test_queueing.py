"""Known-answer tests for engine.queueing."""
from app.engine.queueing import effective_service_time, min_servers, utilisation, UTILISATION_CAP


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
