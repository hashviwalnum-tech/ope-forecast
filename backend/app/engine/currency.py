"""ISO 4217 currencies and their precision.

Ope stores money as a plain decimal number and never as "cents", so nothing in
the database depends on how many decimal places a currency uses. This module
is what tells the rest of the app how many places a given currency *displays*,
so no screen has to assume two.

That assumption is wrong often enough to matter: the Japanese yen and Korean
won have no decimal places at all (¥1200, never ¥1200.00), and the Kuwaiti and
Bahraini dinars have three. Ope is launching in Israel, where the shekel has
two — but the currency list is not the place to bake in one market.

Deliberately excluded: metals (XAU, XAG), special drawing rights (XDR), the
testing and "no currency" codes (XTS, XXX), and fund codes (CLF, MXV, USN…).
They are real ISO 4217 entries, but a café owner picking a currency should not
be offered gold.

Pure functions, no DB, no framework — see CLAUDE.md.
"""
from __future__ import annotations

# What a business gets when nothing is known about it. Never forced on anyone:
# the client proposes one from the browser locale, and the owner confirms.
DEFAULT_CURRENCY = "USD"

# The overwhelming majority of currencies use 2 decimal places, so only the
# exceptions are listed. Anything not named here uses DEFAULT_MINOR_UNITS.
DEFAULT_MINOR_UNITS = 2

_ZERO_DECIMAL = frozenset({
    "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
    "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
})

_THREE_DECIMAL = frozenset({
    "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
})

# code -> English name. The name is a fallback only: clients localise the name
# themselves from the code (the browser's Intl.DisplayNames knows every one of
# these in every language Ope speaks), so this list never needs translating.
CURRENCIES: dict[str, str] = {
    "AED": "United Arab Emirates Dirham",
    "AFN": "Afghan Afghani",
    "ALL": "Albanian Lek",
    "AMD": "Armenian Dram",
    "ANG": "Netherlands Antillean Guilder",
    "AOA": "Angolan Kwanza",
    "ARS": "Argentine Peso",
    "AUD": "Australian Dollar",
    "AWG": "Aruban Florin",
    "AZN": "Azerbaijani Manat",
    "BAM": "Bosnia-Herzegovina Convertible Mark",
    "BBD": "Barbadian Dollar",
    "BDT": "Bangladeshi Taka",
    "BGN": "Bulgarian Lev",
    "BHD": "Bahraini Dinar",
    "BIF": "Burundian Franc",
    "BMD": "Bermudian Dollar",
    "BND": "Brunei Dollar",
    "BOB": "Bolivian Boliviano",
    "BRL": "Brazilian Real",
    "BSD": "Bahamian Dollar",
    "BTN": "Bhutanese Ngultrum",
    "BWP": "Botswanan Pula",
    "BYN": "Belarusian Ruble",
    "BZD": "Belize Dollar",
    "CAD": "Canadian Dollar",
    "CDF": "Congolese Franc",
    "CHF": "Swiss Franc",
    "CLP": "Chilean Peso",
    "CNY": "Chinese Yuan",
    "COP": "Colombian Peso",
    "CRC": "Costa Rican Colon",
    "CUP": "Cuban Peso",
    "CVE": "Cape Verdean Escudo",
    "CZK": "Czech Koruna",
    "DJF": "Djiboutian Franc",
    "DKK": "Danish Krone",
    "DOP": "Dominican Peso",
    "DZD": "Algerian Dinar",
    "EGP": "Egyptian Pound",
    "ERN": "Eritrean Nakfa",
    "ETB": "Ethiopian Birr",
    "EUR": "Euro",
    "FJD": "Fijian Dollar",
    "FKP": "Falkland Islands Pound",
    "GBP": "British Pound",
    "GEL": "Georgian Lari",
    "GHS": "Ghanaian Cedi",
    "GIP": "Gibraltar Pound",
    "GMD": "Gambian Dalasi",
    "GNF": "Guinean Franc",
    "GTQ": "Guatemalan Quetzal",
    "GYD": "Guyanaese Dollar",
    "HKD": "Hong Kong Dollar",
    "HNL": "Honduran Lempira",
    "HTG": "Haitian Gourde",
    "HUF": "Hungarian Forint",
    "IDR": "Indonesian Rupiah",
    "ILS": "Israeli New Shekel",
    "INR": "Indian Rupee",
    "IQD": "Iraqi Dinar",
    "IRR": "Iranian Rial",
    "ISK": "Icelandic Krona",
    "JMD": "Jamaican Dollar",
    "JOD": "Jordanian Dinar",
    "JPY": "Japanese Yen",
    "KES": "Kenyan Shilling",
    "KGS": "Kyrgystani Som",
    "KHR": "Cambodian Riel",
    "KMF": "Comorian Franc",
    "KPW": "North Korean Won",
    "KRW": "South Korean Won",
    "KWD": "Kuwaiti Dinar",
    "KYD": "Cayman Islands Dollar",
    "KZT": "Kazakhstani Tenge",
    "LAK": "Laotian Kip",
    "LBP": "Lebanese Pound",
    "LKR": "Sri Lankan Rupee",
    "LRD": "Liberian Dollar",
    "LSL": "Lesotho Loti",
    "LYD": "Libyan Dinar",
    "MAD": "Moroccan Dirham",
    "MDL": "Moldovan Leu",
    "MGA": "Malagasy Ariary",
    "MKD": "Macedonian Denar",
    "MMK": "Myanmar Kyat",
    "MNT": "Mongolian Tugrik",
    "MOP": "Macanese Pataca",
    "MRU": "Mauritanian Ouguiya",
    "MUR": "Mauritian Rupee",
    "MVR": "Maldivian Rufiyaa",
    "MWK": "Malawian Kwacha",
    "MXN": "Mexican Peso",
    "MYR": "Malaysian Ringgit",
    "MZN": "Mozambican Metical",
    "NAD": "Namibian Dollar",
    "NGN": "Nigerian Naira",
    "NIO": "Nicaraguan Cordoba",
    "NOK": "Norwegian Krone",
    "NPR": "Nepalese Rupee",
    "NZD": "New Zealand Dollar",
    "OMR": "Omani Rial",
    "PAB": "Panamanian Balboa",
    "PEN": "Peruvian Sol",
    "PGK": "Papua New Guinean Kina",
    "PHP": "Philippine Peso",
    "PKR": "Pakistani Rupee",
    "PLN": "Polish Zloty",
    "PYG": "Paraguayan Guarani",
    "QAR": "Qatari Rial",
    "RON": "Romanian Leu",
    "RSD": "Serbian Dinar",
    "RUB": "Russian Ruble",
    "RWF": "Rwandan Franc",
    "SAR": "Saudi Riyal",
    "SBD": "Solomon Islands Dollar",
    "SCR": "Seychellois Rupee",
    "SDG": "Sudanese Pound",
    "SEK": "Swedish Krona",
    "SGD": "Singapore Dollar",
    "SHP": "Saint Helena Pound",
    "SLE": "Sierra Leonean Leone",
    "SOS": "Somali Shilling",
    "SRD": "Surinamese Dollar",
    "SSP": "South Sudanese Pound",
    "STN": "Sao Tome and Principe Dobra",
    "SVC": "Salvadoran Colon",
    "SYP": "Syrian Pound",
    "SZL": "Swazi Lilangeni",
    "THB": "Thai Baht",
    "TJS": "Tajikistani Somoni",
    "TMT": "Turkmenistani Manat",
    "TND": "Tunisian Dinar",
    "TOP": "Tongan Paanga",
    "TRY": "Turkish Lira",
    "TTD": "Trinidad and Tobago Dollar",
    "TWD": "New Taiwan Dollar",
    "TZS": "Tanzanian Shilling",
    "UAH": "Ukrainian Hryvnia",
    "UGX": "Ugandan Shilling",
    "USD": "US Dollar",
    "UYU": "Uruguayan Peso",
    "UZS": "Uzbekistani Som",
    "VED": "Venezuelan Bolivar Digital",
    "VES": "Venezuelan Bolivar",
    "VND": "Vietnamese Dong",
    "VUV": "Vanuatu Vatu",
    "WST": "Samoan Tala",
    "XAF": "Central African CFA Franc",
    "XCD": "East Caribbean Dollar",
    "XCG": "Caribbean Guilder",
    "XOF": "West African CFA Franc",
    "XPF": "CFP Franc",
    "YER": "Yemeni Rial",
    "ZAR": "South African Rand",
    "ZMW": "Zambian Kwacha",
    "ZWG": "Zimbabwe Gold",
}


def normalise(code: str | None) -> str | None:
    """Upper-case and trim a currency code. Returns None for anything empty."""
    if code is None:
        return None
    cleaned = code.strip().upper()
    return cleaned or None


def is_supported(code: str | None) -> bool:
    """True when `code` is a currency a business may be set to."""
    return normalise(code) in CURRENCIES


def minor_units(code: str | None) -> int:
    """How many decimal places this currency is written with.

    JPY -> 0, USD -> 2, KWD -> 3. An unknown code falls back to 2 rather than
    raising, so a display path can never crash on unexpected stored data.
    """
    c = normalise(code)
    if c in _ZERO_DECIMAL:
        return 0
    if c in _THREE_DECIMAL:
        return 3
    return DEFAULT_MINOR_UNITS


def quantize(amount: float, code: str | None) -> float:
    """Round an amount to the number of places its currency actually uses.

    ¥1200.4 is ¥1200, never ¥1200.40 — rounding to a fixed 2 places would
    invent a precision the currency does not have.
    """
    return round(float(amount), minor_units(code))


def resolve(code: str | None) -> str:
    """The currency to use, falling back to the default for missing/unknown.

    Business settings are a free-form JSON blob, so a stored value can be
    absent or stale. Display code needs an answer, not an exception.
    """
    c = normalise(code)
    return c if c in CURRENCIES else DEFAULT_CURRENCY


def listing() -> list[dict[str, object]]:
    """The picker's data: every currency with its name and precision."""
    return [
        {"code": code, "name": name, "minor_units": minor_units(code)}
        for code, name in sorted(CURRENCIES.items())
    ]
