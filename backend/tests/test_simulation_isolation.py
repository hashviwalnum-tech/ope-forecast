"""
Anti-self-deception guard (mission brief §4.1).

The simulation generator is the answer key.  If any module under
``backend/app/`` ever imports it — or reads one of its constants — the whole
year-long test becomes worthless, because the thing being graded would have
access to the marking scheme.

This test fails loudly if that ever happens.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"

_FORBIDDEN = re.compile(
    r"^\s*(?:from|import)\s+.*\b(?:tests?\.simulation|simulation\.generator|simulation\.menu)\b",
    re.MULTILINE,
)


def test_app_never_imports_the_simulation_generator():
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if _FORBIDDEN.search(text):
            offenders.append(str(path.relative_to(APP_DIR.parent)))
    assert not offenders, (
        "Application code must never import the simulation generator "
        f"(the answer key). Offending files: {offenders}"
    )


def test_generator_lives_outside_the_app_package():
    gen = APP_DIR.parent / "tests" / "simulation" / "generator.py"
    assert gen.exists(), "generator.py must live in backend/tests/simulation/"
    assert not (APP_DIR / "simulation").exists(), (
        "No simulation package may exist inside backend/app/"
    )
