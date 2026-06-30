from datetime import datetime
from pydantic import BaseModel


class SubscriptionRead(BaseModel):
    user_id: str
    tier: str                           # raw tier: "trial" | "premium" | "free"
    effective_tier: str                 # computed: "premium" | "free"
    trial_started_at: datetime | None
    trial_ends_at: datetime | None
    trial_days_remaining: int | None
    subscription_status: str            # "none" | "active" | "cancelled" | "expired"
    subscription_provider: str | None
    renewal_at: datetime | None
    model_config = {"from_attributes": True}


class CheckoutRequest(BaseModel):
    plan: str   # "monthly" | "annual"
    success_url: str
    cancel_url: str


class CheckoutResponse(BaseModel):
    checkout_url: str


class WebhookEvent(BaseModel):
    provider: str
    raw: dict
