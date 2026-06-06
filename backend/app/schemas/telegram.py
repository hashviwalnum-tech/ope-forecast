from pydantic import BaseModel


class TelegramLinkCodeResponse(BaseModel):
    code: str
    expires_in_minutes: int = 60


class TelegramLinkStatus(BaseModel):
    linked: bool
    chat_id: str | None = None
    has_pending_code: bool = False


class TelegramRedeemRequest(BaseModel):
    code: str
    chat_id: str


class TelegramRedeemResponse(BaseModel):
    ok: bool
    business_name: str


class BotLogSaleRequest(BaseModel):
    product_name: str
    quantity: float = 1.0


class BotLogSaleResponse(BaseModel):
    ok: bool
    product: str
    quantity: float
    timestamp: str
