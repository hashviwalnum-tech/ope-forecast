"""The currency list the pickers are built from.

Served by the backend rather than duplicated in each client so there is one
list: the same codes the settings endpoint validates against are the ones the
web and mobile pickers offer. A second copy in the frontend would drift, and
the failure would be an owner picking a currency the API then rejects.

Deliberately unauthenticated: it is the static ISO 4217 table, identical for
everyone and carrying no user data. Onboarding needs it before a business
exists, and it can be cached hard.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.engine import currency as currency_engine

router = APIRouter(prefix="/currencies", tags=["Currencies"])


class CurrencyRead(BaseModel):
    code: str
    #: English name. Clients localise from the code where they can (browsers
    #: know every one of these in every language Ope speaks) and fall back to
    #: this, so the list itself never needs translating.
    name: str
    #: Decimal places this currency is written with: JPY 0, USD 2, KWD 3.
    minor_units: int


class CurrencyListResponse(BaseModel):
    currencies: list[CurrencyRead]
    #: What a client should propose when it cannot tell from the locale. A
    #: suggestion for the picker, never applied to a business on its own.
    default: str


@router.get("", response_model=CurrencyListResponse)
def list_currencies() -> CurrencyListResponse:
    return CurrencyListResponse(
        currencies=[CurrencyRead(**row) for row in currency_engine.listing()],
        default=currency_engine.DEFAULT_CURRENCY,
    )
