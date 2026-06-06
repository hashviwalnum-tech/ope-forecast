"""
Shared test fixtures.

Sets up an in-memory SQLite database shared across all tests that use the
FastAPI TestClient.  The engine is patched onto app.db BEFORE app.main is
imported so every module in the app sees the same in-memory store.

Engine tests (tests/engine/*) only import from app.engine.* and are
completely unaffected by anything here.
"""
import os

# Must be set before any app module is imported (deps.py reads SUPABASE_URL
# at module level; db.py reads DATABASE_URL at module level).
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("BOT_SERVICE_KEY", "test-bot-key-abc123")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

# Patch app.db engine BEFORE importing app.main so every module that calls
# app.db.get_db() uses the in-memory test database.
import app.db as _app_db

_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

_app_db.engine = _test_engine
_app_db.SessionLocal = _TestingSession

from app.models import Base, Business, Regular  # noqa: E402  (import after env patch)
from app.models.regular_daily_spend import RegularDailySpend  # noqa: F401, E402
from app.db import get_db    # noqa: E402
from app.main import app     # noqa: E402  (triggers all router imports)


@pytest.fixture(autouse=True)
def _reset_tables():
    """Recreate all tables before each test and drop them after."""
    Base.metadata.create_all(_test_engine)
    yield
    Base.metadata.drop_all(_test_engine)


@pytest.fixture()
def db():
    """Raw SQLAlchemy session wired to the test DB."""
    session = _TestingSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def biz(db):
    """A test Business row."""
    b = Business(name="Test Biz", settings={})
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@pytest.fixture()
def regular(db, biz):
    """A test Regular row."""
    r = Regular(
        business_id=biz.id,
        name="Sarah",
        visit_frequency_per_week=3,
        avg_spend=20.0,
        expected_lifespan_years=3,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@pytest.fixture()
def client(db):
    """TestClient with get_db overridden to use the test session."""
    def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()
