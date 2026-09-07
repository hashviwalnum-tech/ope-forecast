"""Find (and optionally remove) rows left behind by the old delete cascade.

`DELETE /businesses/{id}` used to list its child tables by hand and missed seven
of them, so every location deleted before that fix left rows pointing at a
business row that no longer exists. This finds them.

Two ways to use it:

    # Report only — connects to DATABASE_URL and counts what is orphaned.
    python -m tests.deployment.find_business_orphans

    # Delete what it found, after you have looked at the report.
    python -m tests.deployment.find_business_orphans --delete

    # Print SQL instead of connecting, to paste into the Supabase SQL editor.
    python -m tests.deployment.find_business_orphans --sql

The table list is derived from the same metadata the cascade uses, so it cannot
fall out of step with it.

SAFETY: `--delete` only ever removes rows whose `business_id` matches no row in
`businesses`, or whose parent row is already gone. A live business's data can
never match that condition. It runs in one transaction and prints what it did.
"""
from __future__ import annotations

import argparse
import os
import sys


def _load_models():
    """Import the app's models. Needs DATABASE_URL and SUPABASE_URL to be set."""
    os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
    os.environ.setdefault("SUPABASE_URL", "https://unused.invalid")
    os.environ.setdefault("BOT_SERVICE_KEY", "unused")
    from app.api.business_cascade import INDIRECT, business_scoped_models
    return business_scoped_models(), INDIRECT


def build_sql() -> str:
    """SQL that reports, then deletes, every orphan — safe to paste and read."""
    direct, indirect = _load_models()
    direct_names = sorted(m.__tablename__ for m in direct)

    lines = [
        "-- Rows left behind by the old DELETE /businesses/{id}, which missed",
        "-- seven child tables. Safe to run: every condition below matches only",
        "-- rows whose owner no longer exists.",
        "--",
        "-- 1. LOOK FIRST. Every count should be 0 on a healthy database.",
        "",
    ]
    selects = []
    for t in direct_names:
        selects.append(
            "SELECT '%s' AS table_name, count(*) AS orphan_rows FROM %s\n"
            "  WHERE business_id NOT IN (SELECT id FROM businesses)" % (t, t)
        )
    for child, fk, parent in indirect:
        selects.append(
            "SELECT '%s' AS table_name, count(*) AS orphan_rows FROM %s\n"
            "  WHERE %s NOT IN (SELECT id FROM %s)"
            % (child.__tablename__, child.__tablename__, fk, parent.__tablename__)
        )
    lines.append("\nUNION ALL\n".join(selects) + "\nORDER BY orphan_rows DESC;")

    lines += [
        "",
        "",
        "-- 2. Only if step 1 showed rows worth removing, run this.",
        "BEGIN;",
    ]
    # Children of a missing parent go first, in case the parent row is itself an orphan.
    for child, fk, parent in indirect:
        lines.append(
            "DELETE FROM %s WHERE %s NOT IN (SELECT id FROM %s);"
            % (child.__tablename__, fk, parent.__tablename__)
        )
    for t in direct_names:
        lines.append(
            "DELETE FROM %s WHERE business_id NOT IN (SELECT id FROM businesses);" % t
        )
    lines += ["COMMIT;", ""]
    return "\n".join(lines)


def run(delete: bool) -> int:
    from sqlalchemy import func, select
    from app.db import SessionLocal
    from app.models import Business

    direct, indirect = _load_models()
    db = SessionLocal()
    total = 0
    try:
        live_ids = select(Business.id)
        print(f"{'table':<24} {'orphans':>8}")
        print("-" * 34)

        # Children whose parent row is gone, before the parents themselves.
        for child, fk, parent in indirect:
            col = getattr(child, fk)
            cond = col.notin_(select(parent.id))
            n = db.scalar(select(func.count()).select_from(child).where(cond)) or 0
            print(f"{child.__tablename__:<24} {n:>8}")
            total += n
            if delete and n:
                db.query(child).filter(cond).delete(synchronize_session=False)

        for model in sorted(direct, key=lambda m: m.__tablename__):
            cond = model.business_id.notin_(live_ids)
            n = db.scalar(select(func.count()).select_from(model).where(cond)) or 0
            print(f"{model.__tablename__:<24} {n:>8}")
            total += n
            if delete and n:
                db.query(model).filter(cond).delete(synchronize_session=False)

        print("-" * 34)
        print(f"{'TOTAL':<24} {total:>8}")

        if delete:
            db.commit()
            print("\nDeleted." if total else "\nNothing to delete.")
        elif total:
            print("\nRe-run with --delete to remove them.")
        else:
            print("\nNothing orphaned — the cascade is clean.")
    finally:
        db.close()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--delete", action="store_true", help="remove the orphans it finds")
    ap.add_argument("--sql", action="store_true", help="print SQL instead of connecting")
    args = ap.parse_args()

    if args.sql:
        print(build_sql())
        return 0
    if not os.environ.get("DATABASE_URL"):
        print("Set DATABASE_URL to the database you want to check.", file=sys.stderr)
        return 2
    return run(args.delete)


if __name__ == "__main__":
    raise SystemExit(main())
