from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from app import clock


@dataclass
class CheckoutResult:
    checkout_url: str   # URL to redirect user to for payment; stub returns a stub-success route


@dataclass
class SubscriptionStatus:
    subscription_id: str
    status: str         # "active" | "cancelled" | "expired" | "unknown"
    renewal_at: datetime | None


class PaymentProvider(Protocol):
    """Abstraction over payment processors (Paddle, Google Play, etc.)."""
    def start_checkout(self, user_id: str, plan: str, success_url: str, cancel_url: str) -> CheckoutResult: ...
    def cancel_subscription(self, subscription_id: str) -> bool: ...
    def get_status(self, subscription_id: str) -> SubscriptionStatus: ...
    def verify_webhook(self, payload: bytes, signature: str) -> dict: ...


class StubPaymentProvider:
    """Stub: simulates instant success. Swap for real SDK when processor keys are provided."""
    def start_checkout(self, user_id: str, plan: str, success_url: str, cancel_url: str) -> CheckoutResult:
        return CheckoutResult(checkout_url=success_url + "?stub=1&plan=" + plan)

    def cancel_subscription(self, subscription_id: str) -> bool:
        return True

    def get_status(self, subscription_id: str) -> SubscriptionStatus:
        from datetime import timezone, timedelta
        return SubscriptionStatus(
            subscription_id=subscription_id,
            status="active",
            renewal_at=clock.now_utc() + timedelta(days=30),
        )

    def verify_webhook(self, payload: bytes, signature: str) -> dict:
        return {}


# Active provider — swap this import when real keys arrive
payment_provider: PaymentProvider = StubPaymentProvider()
