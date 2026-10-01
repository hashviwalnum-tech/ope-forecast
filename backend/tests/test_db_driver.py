"""The PostgreSQL driver must be the installed one, whatever SQLAlchemy's
default becomes. SQLAlchemy 2.1 switched it to psycopg 3 and the deploy died
on startup with ``No module named 'psycopg'``."""
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.db import with_explicit_driver


@pytest.mark.parametrize("given, expected", [
    ("postgresql://u:p@h:5432/db", "postgresql+psycopg2://u:p@h:5432/db"),
    ("postgres://u:p@h/db", "postgresql+psycopg2://u:p@h/db"),
    ("postgresql+psycopg2://u:p@h/db", "postgresql+psycopg2://u:p@h/db"),
    ("postgresql+psycopg://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
    ("sqlite:///:memory:", "sqlite:///:memory:"),
])
def test_driver_is_named(given, expected):
    assert with_explicit_driver(given) == expected


def test_a_plain_supabase_url_builds_an_engine_with_the_installed_driver():
    """This is exactly the call that crashed on Render. Building the engine
    imports the driver without connecting, so it needs no database."""
    engine = create_engine(with_explicit_driver("postgresql://u:p@localhost:5432/db"))
    assert engine.dialect.driver == "psycopg2"


def test_every_requirement_is_pinned():
    """An unpinned line is how the broken deploy happened."""
    req = Path(__file__).resolve().parents[1] / "requirements.txt"
    loose = [
        line for line in req.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
        and "==" not in line.split(";")[0]
    ]
    assert not loose, f"unpinned: {loose}"
