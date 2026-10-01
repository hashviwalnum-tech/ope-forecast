"""Moving the old admin override onto the Subscription row.

Before billing, ``PATCH /businesses/me/tier`` pinned a tier by writing
``settings["tier"]`` plus ``settings["tier_admin_override"]`` onto every
business the account owned.  That had two faults: it lived on businesses rather
than the account, and a pinned "free" could take premium away from someone who
was paying.  A grant is now two columns on the Subscription row and can only
add premium.

This runs at startup and is idempotent: it converts a "premium" override into a
grant with no end date, drops a "free" override (a grant never takes premium
away), and removes both keys so it never runs for that business again.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app import clock
from app.models import Business
from app.models.subscription import Subscription

log = logging.getLogger(__name__)


def migrate_admin_overrides(db: Session) -> int:
    """Returns how many accounts gained a grant."""
    granted_users: set[str] = set()
    for biz in db.query(Business).all():
        settings = biz.settings or {}
        if "tier_admin_override" not in settings:
            continue
        if settings.get("tier_admin_override") and settings.get("tier") == "premium" and biz.user_id:
            granted_users.add(biz.user_id)
        cleaned = {k: v for k, v in settings.items() if k not in ("tier_admin_override", "tier")}
        biz.settings = cleaned
        flag_modified(biz, "settings")

    for user_id in granted_users:
        sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
        if sub is None:
            # No row means the account never opened its subscription — give it
            # the trial it would have had, plus the grant.
            from app.models.subscription import TRIAL_DAYS
            now = clock.now_utc()
            sub = Subscription(user_id=user_id, tier="trial", trial_started_at=now,
                               trial_ends_at=now + timedelta(days=TRIAL_DAYS),
                               subscription_status="none")
            db.add(sub)
        sub.manual_grant = True
        sub.manual_grant_ends_at = None
    db.commit()
    return len(granted_users)


def migrate_admin_overrides_to_grants(engine) -> None:
    from sqlalchemy.orm import sessionmaker
    db = sessionmaker(bind=engine)()
    try:
        n = migrate_admin_overrides(db)
        if n:
            log.info("Moved %d admin tier override(s) to Subscription grants", n)
    except Exception as e:                          # never fatal at startup
        db.rollback()
        log.error("Admin-override migration failed: %s", e)
    finally:
        db.close()
