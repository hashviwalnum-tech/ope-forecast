"""Prove the planning maths returned the same numbers before and after the move.

The toolbox's calculations were ported from the browser to
`app.engine.planning`. "Ported faithfully" is a claim worth checking rather
than asserting, so this runs BOTH implementations over the same inputs and
compares every value:

    browser_reference.ts   the frozen browser version, run under node
    app.engine.planning    the engine that replaced it

730 cases, including the worked examples the browser tests pinned, the edge
cases (empty input, ties, negative outcomes, zero margin, a budget too small to
buy anything) and several hundred random ones from a fixed seed.

Skipped when node is unavailable, so the suite still runs on a machine with no
JavaScript toolchain — the engine's own known-answer tests in
tests/engine/test_planning.py do not depend on it.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from tests.engine.parity.diff import compare
from tests.engine.parity.generate_cases import build
from tests.engine.parity.run_engine import main as _engine_main  # noqa: F401  (documents the CLI)

HERE = Path(__file__).parent
RUN_BROWSER = HERE / "run_browser.mjs"
REFERENCE = HERE / "browser_reference.ts"


def _engine_answers(cases: dict) -> dict:
    from app.engine.planning import (
        BudgetItem, Option, compare_options, frame_order, plan_budget,
    )
    from dataclasses import asdict

    return {
        "decision": [
            asdict(compare_options(
                [Option(name=o["name"], best=o["best"], likely=o["likely"], worst=o["worst"])
                 for o in c["options"]],
                c["alpha"],
            ))
            for c in cases["decision"]
        ],
        "framing": [
            asdict(frame_order(
                order_more=c["order_more"], order_less=c["order_less"],
                sell_price=c["sell_price"], cost_price=c["cost_price"],
                expected_demand=c["expected_demand"],
            ))
            for c in cases["framing"]
        ],
        "budget": [
            asdict(plan_budget(
                c["budget"],
                [BudgetItem(name=i["name"], cost=i["cost"], profit=i["profit"],
                            max_qty=i["max_qty"])
                 for i in c["items"]],
            ))
            for c in cases["budget"]
        ],
    }


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_engine_returns_what_the_browser_did(tmp_path):
    assert REFERENCE.exists(), "the frozen browser implementation is missing"

    cases = build()
    cases_file = tmp_path / "cases.json"
    cases_file.write_text(json.dumps(cases), encoding="utf-8")

    proc = subprocess.run(
        ["node", str(RUN_BROWSER), str(cases_file)],
        capture_output=True, text=True, encoding="utf-8", timeout=300,
    )
    assert proc.returncode == 0, f"the browser reference failed to run:\n{proc.stderr}"
    browser = json.loads(proc.stdout)

    engine = _engine_answers(cases)

    problems: list[str] = []
    compare(browser, engine, "", problems)

    total = sum(len(v) for v in browser.values())
    assert total > 700, "the case set shrank — is it still exercising anything?"
    assert not problems, (
        f"the port changed {len(problems)} value(s) across {total} cases:\n  "
        + "\n  ".join(problems[:20])
    )


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_reference_is_not_quietly_the_engine():
    """A parity check that compares something to itself proves nothing.

    The reference has to be the JavaScript that actually shipped, so this
    checks it is still a TypeScript file exporting the four original functions.
    """
    src = REFERENCE.read_text(encoding="utf-8")
    for fn in ("scoreOption", "findInvertedOptions", "frameOrder", "planBudget"):
        assert f"export function {fn}" in src, f"{fn} is missing from the reference"
    assert "FROZEN" in src, "the reference lost the note saying not to edit it"


def test_the_case_set_covers_the_things_that_were_easy_to_get_wrong():
    """The random cases carry the weight, but the awkward ones must be in
    there by name — a seed change must not quietly drop them."""
    cases = build()

    # Out-of-range optimism, which the engine clamps.
    assert any(c["alpha"] > 1 or c["alpha"] < 0 for c in cases["decision"])
    # An option with its estimates the wrong way round.
    assert any(any(o["best"] < o["worst"] for o in c["options"]) for c in cases["decision"])
    # No options at all.
    assert any(c["options"] == [] for c in cases["decision"])
    # A tie, so the tie-break is compared.
    assert any(len(c["options"]) == 2 and c["options"][0]["best"] == c["options"][1]["best"]
               and c["options"][0]["worst"] == c["options"][1]["worst"]
               for c in cases["decision"])

    # Zero and negative margin.
    assert any(c["sell_price"] <= c["cost_price"] for c in cases["framing"])
    # Zero demand.
    assert any(c["expected_demand"] == 0 for c in cases["framing"])

    # No budget, an unusable item, and a budget big enough to coarsen the grid.
    assert any(c["budget"] is None for c in cases["budget"])
    assert any(any(i["cost"] == 0 or i["profit"] == 0 or i["max_qty"] == 0 for i in c["items"])
               for c in cases["budget"])
    assert any((c["budget"] or 0) >= 30_000 for c in cases["budget"])


if __name__ == "__main__":  # pragma: no cover
    sys.exit(pytest.main([__file__, "-q"]))
