"""Diff the browser's answers against the engine's.

Usage (from backend/):
    python -m tests.engine.parity.diff browser_out.json engine_out.json

Exit 0 only when every value matches. Floats are compared with a tight
tolerance because the two runtimes format and accumulate identically but not
bit-identically in every case; anything looser would let a real difference
through, so the tolerance is reported alongside the result.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

TOL = 1e-9


def compare(a, b, path: str, problems: list[str]) -> None:
    if isinstance(a, bool) or isinstance(b, bool):
        if a != b:
            problems.append(f"{path}: browser={a!r} engine={b!r}")
        return
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if a == b:
            return
        scale = max(1.0, abs(a), abs(b))
        if abs(a - b) > TOL * scale:
            problems.append(f"{path}: browser={a!r} engine={b!r} (diff {a - b:.3e})")
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                problems.append(f"{path}.{k}: missing from browser")
            elif k not in b:
                problems.append(f"{path}.{k}: missing from engine")
            else:
                compare(a[k], b[k], f"{path}.{k}", problems)
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            problems.append(f"{path}: browser has {len(a)} items, engine has {len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            compare(x, y, f"{path}[{i}]", problems)
        return
    if a != b:
        problems.append(f"{path}: browser={a!r} engine={b!r}")


def main() -> int:
    browser = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    engine = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))

    problems: list[str] = []
    compare(browser, engine, "", problems)

    counts = {k: len(v) for k, v in sorted(browser.items())}
    total = sum(counts.values())
    detail = ", ".join(f"{k} {n}" for k, n in counts.items())
    print(f"Compared {total} cases ({detail}) at tolerance {TOL:g} relative.")

    if problems:
        print(f"\n*** {len(problems)} DIFFERENCE(S) ***")
        for p in problems[:40]:
            print(f"  {p}")
        if len(problems) > 40:
            print(f"  … and {len(problems) - 40} more")
        return 1

    print("Identical: the engine returns the same numbers the browser did.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
