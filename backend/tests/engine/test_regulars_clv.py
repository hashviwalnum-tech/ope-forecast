"""Known-answer tests for Regular CLV computation and RecurringPattern weekday logic."""


def _clv(visit_frequency_per_week: float, avg_spend: float, expected_lifespan_years: float) -> float:
    return round(visit_frequency_per_week * 52.0 * avg_spend * expected_lifespan_years, 2)


def _recurring_weekdays(patterns: list[dict]) -> set[int]:
    result: set[int] = set()
    for p in patterns:
        for wd in (p.get("weekdays") or []):
            result.add(int(wd))
    return result


# ── CLV tests ─────────────────────────────────────────────────────────────────

def test_clv_basic():
    # 2 visits/week, $10/visit, 3-year lifespan → 2*52*10*3 = 3120
    assert _clv(2.0, 10.0, 3.0) == 3120.0


def test_clv_weekly_coffee():
    # Daily regular (7/week), $5/visit, 2-year lifespan → 7*52*5*2 = 3640
    assert _clv(7.0, 5.0, 2.0) == 3640.0


def test_clv_occasional():
    # 0.5 visits/week (biweekly), $50/visit, 5-year lifespan → 0.5*52*50*5 = 6500
    assert _clv(0.5, 50.0, 5.0) == 6500.0


def test_clv_zero_spend():
    # Zero avg spend → CLV is zero
    assert _clv(3.0, 0.0, 3.0) == 0.0


# ── RecurringPattern weekday coverage tests ───────────────────────────────────

def test_recurring_weekdays_basic():
    patterns = [{"weekdays": [6]}, {"weekdays": [4]}]
    assert _recurring_weekdays(patterns) == {4, 6}


def test_recurring_weekdays_overlap():
    # Overlapping weekdays — union, no duplicates
    patterns = [{"weekdays": [0, 6]}, {"weekdays": [6, 5]}]
    assert _recurring_weekdays(patterns) == {0, 5, 6}


def test_recurring_weekdays_empty():
    assert _recurring_weekdays([]) == set()


def test_recurring_weekdays_missing_key():
    # Patterns with no weekdays key are safely skipped
    patterns = [{"label": "orphan"}, {"weekdays": [2]}]
    assert _recurring_weekdays(patterns) == {2}


def test_recurring_weekday_prevents_flagging():
    # Simulate the handler logic: if a day's weekday is in recurring_weekdays, skip flagging
    recurring = {6}  # Sundays
    flagged = []
    detected_indices = {0, 1, 2}  # pretend outlier detection found these
    day_weekdays = {0: 6, 1: 3, 2: 6}  # index → weekday; 0 and 2 are Sundays

    for i in detected_indices:
        wd = day_weekdays[i]
        if wd not in recurring:
            flagged.append(i)

    assert flagged == [1]  # only index 1 (Thursday) is flagged; Sundays skipped


# ── Outlier resolution action mapping tests ──────────────────────────────────

def _resolve_action(action: str, current_status: str | None = "flagged") -> dict:
    """Simulate the resolve_outlier handler logic (pure function version)."""
    VALID = {"keep", "excluded", "event", "ad", "recurring"}
    assert action in VALID

    result = {"outlier_status": current_status, "period_created": None, "pattern_created": None}

    if action == "recurring":
        result["outlier_status"] = "kept"
        result["pattern_created"] = "weekday_bump"
    elif action == "ad":
        result["outlier_status"] = "event"   # excluded from normal baseline
        result["period_created"] = "ad"
    else:
        result["outlier_status"] = action    # 'keep', 'excluded', 'event'

    return result


def test_resolve_action_event():
    r = _resolve_action("event")
    assert r["outlier_status"] == "event"
    assert r["period_created"] is None


def test_resolve_action_ad_excludes_from_baseline():
    r = _resolve_action("ad")
    # 'ad' days are excluded from the normal baseline (same mechanism as 'event')
    assert r["outlier_status"] == "event"


def test_resolve_action_ad_creates_period():
    r = _resolve_action("ad")
    assert r["period_created"] == "ad"


def test_resolve_action_fluke():
    r = _resolve_action("excluded")
    assert r["outlier_status"] == "excluded"
    assert r["period_created"] is None


def test_resolve_action_recurring_creates_pattern():
    r = _resolve_action("recurring")
    assert r["outlier_status"] == "kept"
    assert r["pattern_created"] == "weekday_bump"


def test_resolve_action_keep():
    r = _resolve_action("keep")
    assert r["outlier_status"] == "keep"
