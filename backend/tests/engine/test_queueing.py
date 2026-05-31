"""Known-answer tests for engine.queueing."""
from app.engine.queueing import min_servers, utilisation, UTILISATION_CAP


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
