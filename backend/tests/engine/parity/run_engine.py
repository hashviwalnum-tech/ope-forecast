"""Run the Python engine over the shared parity cases and emit its answers.

Usage (from backend/):
    python -m tests.engine.parity.run_engine cases.json > engine_out.json

The browser side is run by tests/engine/parity/run_browser.mjs. Both write the
same shape, so the two files can be compared value by value.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

from app.engine.planning import (
    BudgetItem, Option, compare_options, frame_order, plan_budget,
)


def main() -> int:
    cases = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out: dict[str, list] = {}

    out["decision"] = [
        asdict(compare_options(
            [Option(name=o["name"], best=o["best"], likely=o["likely"], worst=o["worst"])
             for o in case["options"]],
            case["alpha"],
        ))
        for case in cases["decision"]
    ]

    out["framing"] = [
        asdict(frame_order(
            order_more=case["order_more"],
            order_less=case["order_less"],
            sell_price=case["sell_price"],
            cost_price=case["cost_price"],
            expected_demand=case["expected_demand"],
        ))
        for case in cases["framing"]
    ]

    out["budget"] = [
        asdict(plan_budget(
            case["budget"],
            [BudgetItem(name=i["name"], cost=i["cost"], profit=i["profit"],
                        max_qty=i["max_qty"])
             for i in case["items"]],
        ))
        for case in cases["budget"]
    ]

    json.dump(out, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
