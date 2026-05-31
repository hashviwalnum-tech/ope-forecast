"""
Staffing/capacity engine: M/M/c queue math for shift recommendations.
Pure functions only — no DB, no framework imports.

Key formula:  utilisation ρ = λ / (c · μ)
  λ  = arrivals per hour (taps)
  μ  = 60 / avg_service_time_minutes  (customers served per hour per server)
  c  = number of servers/registers

We keep ρ below UTILISATION_CAP (85%).  Above ~85%, queue length grows
exponentially even in the idealised M/M/c model, so the cap is conservative
and appropriate for real small-business settings.
"""
from __future__ import annotations

import math

UTILISATION_CAP = 0.85  # keep servers below 85% busy


def min_servers(arrivals_per_hour: float, avg_service_time_minutes: float) -> int:
    """Minimum servers so ρ = λ/(c·μ) < UTILISATION_CAP.

    Args:
        arrivals_per_hour:       average taps/customers arriving in that hour (λ).
        avg_service_time_minutes: average minutes to serve one customer.

    Returns:
        Integer ≥ 1.
    """
    if arrivals_per_hour <= 0 or avg_service_time_minutes <= 0:
        return 1
    mu = 60.0 / avg_service_time_minutes          # completions per hour per server
    raw = arrivals_per_hour / (mu * UTILISATION_CAP)
    return max(1, math.ceil(raw))


def utilisation(
    arrivals_per_hour: float,
    avg_service_time_minutes: float,
    servers: int,
) -> float:
    """Traffic intensity ρ = λ / (c · μ).  Returns 0.0 for invalid inputs."""
    if servers <= 0 or avg_service_time_minutes <= 0:
        return 0.0
    mu = 60.0 / avg_service_time_minutes
    return arrivals_per_hour / (servers * mu)
