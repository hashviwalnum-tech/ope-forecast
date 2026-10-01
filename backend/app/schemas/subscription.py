from datetime import datetime
from pydantic import BaseModel


class SubscriptionRead(BaseModel):
    user_id: str
    tier: str                           # raw tier: "trial" | "premium" | "free"
    effective_tier: str                 # computed: "premium" | "free"
    trial_started_at: datetime | None
    trial_ends_at: datetime | None
    trial_days_remaining: int | None
    subscription_status: str            # see app/billing/entitlement.py
    subscription_provider: str | None   # "google_play" or None
    renewal_at: datetime | None         # paid through
    manual_grant: bool
    manual_grant_ends_at: datetime | None
    # The phone hands this to Google with a purchase, tying it to this account.
    play_account_id: str
    model_config = {"from_attributes": True}


class PlayVerifyRequest(BaseModel):
    purchase_token: str
    product_id: str


class GrantRequest(BaseModel):
    user_id: str
    # None = no end date.  Otherwise premium lasts until this moment (UTC).
    ends_at: datetime | None = None
