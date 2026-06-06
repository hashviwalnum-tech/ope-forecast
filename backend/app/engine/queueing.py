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

# Sentinel for an overloaded system (ρ ≥ 1) — used in public-facing outputs
# instead of float('inf') so that API/JSON serialisation is safe.
OVERLOADED = 9999.0


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


def erlang_c(
    arrivals_per_hour: float,
    avg_service_time_minutes: float,
    servers: int,
) -> float:
    """Erlang C: probability that an arriving customer has to wait (M/M/c).

    Returns a value in [0, 1].  Returns 1.0 when the system is overloaded
    (ρ ≥ 1), meaning every customer waits.  Returns 0.0 for degenerate inputs.
    """
    if arrivals_per_hour <= 0 or avg_service_time_minutes <= 0 or servers <= 0:
        return 0.0
    mu = 60.0 / avg_service_time_minutes
    a = arrivals_per_hour / mu          # total offered load (dimensionless)
    rho = a / servers                   # per-server utilisation
    if rho >= 1.0:
        return 1.0

    # Poisson sum: Σ_{k=0}^{c-1} a^k / k!
    poisson_sum = sum(a**k / math.factorial(k) for k in range(servers))
    # Erlang term: a^c / c! · 1/(1−ρ)
    erlang_term = (a**servers / math.factorial(servers)) / (1.0 - rho)
    return erlang_term / (poisson_sum + erlang_term)


def expected_wait_minutes(
    arrivals_per_hour: float,
    avg_service_time_minutes: float,
    servers: int,
) -> float:
    """Expected time a customer spends *waiting in queue* (minutes), M/M/c.

    Does not include service time itself.  Returns OVERLOADED (9999.0) when
    the system is saturated (ρ ≥ 1).  Returns 0.0 for degenerate inputs.
    """
    if arrivals_per_hour <= 0 or avg_service_time_minutes <= 0 or servers <= 0:
        return 0.0
    mu = 60.0 / avg_service_time_minutes
    rho = arrivals_per_hour / (servers * mu)
    if rho >= 1.0:
        return OVERLOADED
    C = erlang_c(arrivals_per_hour, avg_service_time_minutes, servers)
    # Wq (hours) = C / (c·μ − λ);  ×60 converts to minutes
    return C / (servers * mu - arrivals_per_hour) * 60.0


def queue_length(
    arrivals_per_hour: float,
    avg_service_time_minutes: float,
    servers: int,
) -> float:
    """Average number of customers waiting in queue (M/M/c, Little's Law).

    Returns OVERLOADED (9999.0) when ρ ≥ 1.
    """
    if arrivals_per_hour <= 0 or avg_service_time_minutes <= 0 or servers <= 0:
        return 0.0
    mu = 60.0 / avg_service_time_minutes
    rho = arrivals_per_hour / (servers * mu)
    if rho >= 1.0:
        return OVERLOADED
    # Lq = λ · Wq_hours  (Little's Law)
    C = erlang_c(arrivals_per_hour, avg_service_time_minutes, servers)
    Wq_hours = C / (servers * mu - arrivals_per_hour)
    return arrivals_per_hour * Wq_hours


def _ordinal(n: int) -> str:
    """English ordinal: 1→'1st', 2→'2nd', 3→'3rd', 4→'4th', …"""
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _fmt_wait(w: float) -> str:
    """Human-readable wait: 0.3→'<1 min', 3.0→'3 min', overload→'a very long time'."""
    if w >= OVERLOADED:
        return "a very long time"
    if w < 0.5:
        return "<1 min"
    return f"{round(w)} min"


def marginal_note(
    arrivals_per_hour: float,
    avg_service_time_minutes: float,
    servers: int,
) -> str:
    """Plain-language note about what adding or removing one worker does.

    Runs the M/M/c model at c, c−1, and c+1 and compares expected wait times.
    The note is designed to be shown directly to non-technical owners.

    Examples:
        "Adding a 3rd person cuts the wait from 11 to 1 min.
         1 fewer person would overload the queue — keep at least 2."
        "With almost no queue already, adding more staff has little effect."
    """
    if arrivals_per_hour <= 0 or avg_service_time_minutes <= 0:
        return "Not enough arrival data to compare staffing levels."

    wait_c = expected_wait_minutes(arrivals_per_hour, avg_service_time_minutes, servers)
    wait_plus1 = expected_wait_minutes(arrivals_per_hour, avg_service_time_minutes, servers + 1)

    parts: list[str] = []

    # ── add-one comparison ────────────────────────────────────────────────────
    nth = _ordinal(servers + 1)
    if wait_c < 0.5:
        parts.append(
            f"The queue is already very short — a {nth} person would have little effect."
        )
    else:
        parts.append(
            f"Adding a {nth} person cuts the wait from {_fmt_wait(wait_c)} "
            f"to {_fmt_wait(wait_plus1)}."
        )

    # ── remove-one comparison (only when c > 1) ───────────────────────────────
    if servers > 1:
        mu = 60.0 / avg_service_time_minutes
        rho_minus1 = arrivals_per_hour / ((servers - 1) * mu)
        if rho_minus1 >= 1.0:
            parts.append(
                f"1 fewer person would overload the queue — keep at least {servers}."
            )
        else:
            wait_minus1 = expected_wait_minutes(
                arrivals_per_hour, avg_service_time_minutes, servers - 1
            )
            if wait_minus1 >= wait_c * 2 or wait_minus1 > 5:
                parts.append(
                    f"1 fewer person pushes the wait to {_fmt_wait(wait_minus1)}."
                )
            else:
                parts.append(
                    f"You could manage with {servers - 1} — "
                    f"wait only rises to {_fmt_wait(wait_minus1)}."
                )

    return " ".join(parts)


def min_servers_for_wait_threshold(
    arrivals_per_hour: float,
    avg_service_time_minutes: float,
    max_wait_minutes: float,
) -> int:
    """Smallest c so that expected queue wait ≤ max_wait_minutes.

    Used when the owner has set a maximum acceptable wait time.  The search
    starts from c=1; servers where ρ ≥ 1 return OVERLOADED (9999) from
    expected_wait_minutes and are naturally skipped by the ≤ check.

    Args:
        arrivals_per_hour:       average arrivals per hour (λ).
        avg_service_time_minutes: average service time per customer.
        max_wait_minutes:        owner's target: "nobody waits longer than X".

    Returns:
        Integer ≥ 1.
    """
    if arrivals_per_hour <= 0 or avg_service_time_minutes <= 0:
        return 1

    for c in range(1, 201):
        if expected_wait_minutes(arrivals_per_hour, avg_service_time_minutes, c) <= max_wait_minutes:
            return c
    return 201  # safety fallback; practically unreachable for reasonable inputs


def min_servers_for_queue_threshold(
    arrivals_per_hour: float,
    avg_service_time_minutes: float,
    max_queue_length: float,
) -> int:
    """Smallest c so that expected queue length ≤ max_queue_length.

    Used when the owner has set a maximum number of people they want waiting in
    line at any given time.  queue_length() returns OVERLOADED for ρ ≥ 1, so
    unstable staffing levels are naturally rejected by the ≤ check.

    Args:
        arrivals_per_hour:       average arrivals per hour (λ).
        avg_service_time_minutes: average service time per customer.
        max_queue_length:        owner's target: "no more than N people in line".

    Returns:
        Integer ≥ 1.
    """
    if arrivals_per_hour <= 0 or avg_service_time_minutes <= 0:
        return 1

    for c in range(1, 201):
        try:
            if queue_length(arrivals_per_hour, avg_service_time_minutes, c) <= max_queue_length:
                return c
        except (OverflowError, ValueError):
            # erlang_c can overflow for very large c with small offered load;
            # at that point the queue length is effectively 0, so the constraint
            # is satisfied.
            return c
    return 201


def effective_service_time(
    product_mix: list[tuple[float, float | None]],
    default_service_time_minutes: float,
) -> float:
    """Weighted-average service time across a product mix.

    Each element of product_mix is (quantity, service_time_minutes_or_None).
    None means the product has no override — use the business default.
    Falls back to default when the mix is empty or all quantities are zero.
    """
    total_qty = sum(qty for qty, _ in product_mix if qty > 0)
    if total_qty <= 0:
        return default_service_time_minutes
    weighted = sum(
        qty * (svc if svc is not None else default_service_time_minutes)
        for qty, svc in product_mix
        if qty > 0
    )
    return weighted / total_qty
