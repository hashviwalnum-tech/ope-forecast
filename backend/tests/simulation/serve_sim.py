"""
Serve the real Ope API against the finished simulated year, for the UI pass.

This is the same FastAPI app the web client talks to in production, with two
test-side adjustments and nothing else:

  * identity — any bearer token maps to the simulation's user, because there is
    no Supabase project behind a local run;
  * the clock is frozen just after the simulated year ends, so every screen shows
    a business with a full year of history rather than one that stopped a year ago.

Both live here in the test package; no application code is changed.

    python -m tests.simulation.serve_sim          (from backend/)
    → http://localhost:8000
"""
from __future__ import annotations

import os
from datetime import timedelta

# Imported at module level so FastAPI can resolve the annotation on _sim_user:
# `from __future__ import annotations` makes annotations strings, and FastAPI
# looks them up in module globals, not in the enclosing function's scope.
from fastapi import Request

from tests.simulation.generator import YEAR_DAYS, YEAR_START
from tests.simulation.harness import SIM_USER_ID, prepare_env


def main() -> None:
    prepare_env(fresh=False)          # points at backend/sim/sim.db, enables the clock
    os.environ["ALLOWED_ORIGINS"] = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173"
    )

    import uvicorn

    from app import clock
    from app.api.deps import get_current_user
    from app.main import app

    def _sim_user(request: Request) -> str:
        return SIM_USER_ID

    app.dependency_overrides[get_current_user] = _sim_user

    end = YEAR_START + timedelta(days=YEAR_DAYS)
    from zoneinfo import ZoneInfo
    from datetime import datetime
    clock.freeze(datetime(end.year, end.month, end.day, 18, 30,
                          tzinfo=ZoneInfo("America/New_York")))

    print(f"Serving the simulated business; the app believes it is {end} 18:30 New York.")
    print("http://localhost:8000/health")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
