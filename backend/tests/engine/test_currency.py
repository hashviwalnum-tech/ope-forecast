"""Known-answer tests for ISO 4217 handling (spec §11, §12).

The point of this module is that no screen assumes two decimal places. These
tests pin the currencies where that assumption is actually wrong.
"""
from app.engine import currency as c


# ── precision ───────────────────────────────────────────────────────────────

def test_most_currencies_use_two_places():
    for code in ("USD", "EUR", "ILS", "GBP", "INR", "BRL", "ZAR"):
        assert c.minor_units(code) == 2


def test_the_zero_decimal_currencies():
    """Yen and won have no subunit at all — ¥1200, never ¥1200.00."""
    for code in ("JPY", "KRW", "CLP", "ISK", "VND", "XOF", "XAF", "XPF",
                 "BIF", "DJF", "GNF", "KMF", "PYG", "RWF", "UGX", "VUV"):
        assert c.minor_units(code) == 0, f"{code} should have no decimal places"


def test_the_three_decimal_currencies():
    """The Gulf dinars are written to three places."""
    for code in ("KWD", "BHD", "OMR", "JOD", "IQD", "LYD", "TND"):
        assert c.minor_units(code) == 3, f"{code} should have three decimal places"


def test_an_unknown_code_falls_back_rather_than_raising():
    """Settings are free-form JSON, so a display path can meet anything."""
    assert c.minor_units("ZZZ") == 2
    assert c.minor_units(None) == 2
    assert c.minor_units("") == 2


# ── rounding ────────────────────────────────────────────────────────────────

def test_quantize_uses_the_currency_not_a_fixed_two_places():
    assert c.quantize(1200.4, "JPY") == 1200          # not 1200.40
    assert c.quantize(1200.456, "USD") == 1200.46
    assert c.quantize(1200.4567, "KWD") == 1200.457   # three places, not two


def test_quantize_leaves_whole_amounts_alone():
    assert c.quantize(50, "USD") == 50
    assert c.quantize(50, "JPY") == 50


# ── validation ──────────────────────────────────────────────────────────────

def test_is_supported_accepts_real_codes_in_any_case():
    assert c.is_supported("ils")
    assert c.is_supported("  JPY  ")
    assert c.is_supported("USD")


def test_is_supported_rejects_anything_else():
    assert not c.is_supported("ZZZ")
    assert not c.is_supported("US")
    assert not c.is_supported("")
    assert not c.is_supported(None)
    assert not c.is_supported("DOLLARS")


def test_resolve_never_returns_an_unusable_currency():
    assert c.resolve("ILS") == "ILS"
    assert c.resolve("ils") == "ILS"
    assert c.resolve(None) == c.DEFAULT_CURRENCY
    assert c.resolve("ZZZ") == c.DEFAULT_CURRENCY


# ── the list itself ─────────────────────────────────────────────────────────

def test_the_launch_market_and_the_common_currencies_are_present():
    # Ope launches in Israel; these are the ones an early owner might pick.
    for code in ("ILS", "USD", "EUR", "GBP", "JPY", "INR", "AUD", "CAD"):
        assert code in c.CURRENCIES


def test_metals_funds_and_placeholder_codes_are_not_offered():
    """Real ISO 4217 entries, but nonsense as a business currency."""
    for code in ("XAU", "XAG", "XPT", "XPD", "XDR", "XTS", "XXX",
                 "CLF", "MXV", "USN", "UYI", "UYW", "CHE", "CHW", "BOV", "COU"):
        assert code not in c.CURRENCIES, f"{code} should not be in the picker"


def test_every_code_is_three_upper_case_letters():
    for code in c.CURRENCIES:
        assert len(code) == 3 and code.isalpha() and code.isupper(), code


def test_listing_is_sorted_and_carries_the_precision():
    rows = c.listing()
    assert [r["code"] for r in rows] == sorted(c.CURRENCIES)
    assert len(rows) == len(c.CURRENCIES)
    by_code = {r["code"]: r for r in rows}
    assert by_code["JPY"]["minor_units"] == 0
    assert by_code["KWD"]["minor_units"] == 3
    assert by_code["ILS"]["minor_units"] == 2
    assert by_code["ILS"]["name"]


def test_the_default_is_itself_a_supported_currency():
    assert c.is_supported(c.DEFAULT_CURRENCY)
