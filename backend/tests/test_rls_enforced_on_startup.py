"""
A new table must be protected by existing, not by someone remembering.

Row-level security was enabled on the original tables and then missed on every
table added afterwards — eight of them, including `subscriptions` (which the
entitlement system reads from) and `telegram_links` (which holds the one-time
code binding a Telegram chat to a business). All were readable and writable with
the anon key that ships inside every web bundle and every mobile build.

`create_all` will happily create a brand-new table with no RLS, so the gap
reopens the moment a model is added. `_enforce_rls` closes it on every boot.
"""
from __future__ import annotations

from unittest.mock import MagicMock

from app.main import _enforce_rls
from app.models import Base


def test_every_model_gets_rls_enabled_on_postgres():
    """One ALTER per table the app defines — including any added tomorrow."""
    statements: list[str] = []

    conn = MagicMock()
    conn.execute.side_effect = lambda stmt: statements.append(str(stmt))
    engine = MagicMock()
    engine.dialect.name = "postgresql"
    engine.connect.return_value.__enter__.return_value = conn

    _enforce_rls(engine)

    covered = {t.name for t in Base.metadata.sorted_tables}
    assert covered, "no models registered — the guard would be vacuous"
    for name in covered:
        assert any(f'"{name}" ENABLE ROW LEVEL SECURITY' in s for s in statements), (
            f"{name} would ship readable with the public anon key"
        )


def test_the_tables_that_were_actually_exposed_are_covered():
    """Named explicitly so a future refactor cannot quietly drop them."""
    was_open = {
        "subscriptions", "telegram_links", "order_records", "stock_batches",
        "service_consumables", "regular_daily_spends", "tuner_state", "tuner_log",
    }
    known = {t.name for t in Base.metadata.sorted_tables}
    missing = was_open - known
    assert not missing, f"these were found open in production and are not registered: {missing}"


def test_it_does_nothing_on_sqlite():
    """Local dev and the test suite run on SQLite, which has no RLS."""
    engine = MagicMock()
    engine.dialect.name = "sqlite"
    _enforce_rls(engine)
    engine.connect.assert_not_called()


def test_a_failure_on_one_table_never_takes_the_api_down():
    """A permissions problem must be logged loudly, not crash startup — an API
    that will not boot is worse than one table needing attention."""
    conn = MagicMock()
    conn.execute.side_effect = PermissionError("must be owner of table")
    engine = MagicMock()
    engine.dialect.name = "postgresql"
    engine.connect.return_value.__enter__.return_value = conn

    _enforce_rls(engine)      # must not raise


def test_it_does_not_use_force_which_would_lock_out_the_backend():
    """FORCE applies RLS to the table owner too, cutting this backend off from
    its own data. The backend connects as the Postgres role and is meant to
    bypass RLS — that is what makes 'RLS on, no policies' the right setting."""
    statements: list[str] = []
    conn = MagicMock()
    conn.execute.side_effect = lambda stmt: statements.append(str(stmt))
    engine = MagicMock()
    engine.dialect.name = "postgresql"
    engine.connect.return_value.__enter__.return_value = conn

    _enforce_rls(engine)
    assert statements
    assert not any("FORCE" in s.upper() for s in statements)
