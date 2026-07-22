"""Parse China ETF/index option contract names."""

from __future__ import annotations

import re
from datetime import date, datetime

import pandas as pd

CALL_PUT_PATTERN = re.compile(r"(购|沽|购[AB]?|沽[AB]?)")
STRIKE_PATTERN = re.compile(r"(\d{3,5})(?:[A-Z])?$")
EXPIRY_PATTERN = re.compile(r"(\d{1,2})月|(\d{4})年(\d{1,2})月")


def parse_option_name(name: str) -> dict:
    """Extract option type, strike, and expiry month from Chinese contract name."""
    text = str(name).strip()
    option_type = None
    type_match = CALL_PUT_PATTERN.search(text)
    if type_match:
        token = type_match.group(1)
        option_type = "call" if token.startswith("购") else "put"

    strike = None
    strike_match = STRIKE_PATTERN.search(text.split("月")[-1] if "月" in text else text)
    if strike_match:
        strike = int(strike_match.group(1)) / 1000.0

    expiry_month = None
    expiry_year = None
    month_match = EXPIRY_PATTERN.search(text)
    if month_match:
        if month_match.group(1):
            expiry_month = int(month_match.group(1))
        elif month_match.group(2) and month_match.group(3):
            expiry_year = int(month_match.group(2))
            expiry_month = int(month_match.group(3))

    return {
        "option_type": option_type,
        "strike": strike,
        "expiry_month": expiry_month,
        "expiry_year": expiry_year,
    }


def _resolve_expiry_date(row: pd.Series, reference: date | None = None) -> pd.Timestamp | pd.NaT:
    if pd.notna(row.get("expiry_date")):
        return pd.to_datetime(row["expiry_date"])

    ref = reference or datetime.now().date()
    month = row.get("expiry_month")
    if pd.isna(month):
        return pd.NaT

    year = row.get("expiry_year")
    if pd.isna(year):
        year = ref.year
        if int(month) < ref.month:
            year += 1

    try:
        return pd.Timestamp(year=int(year), month=int(month), day=1) + pd.offsets.MonthEnd(0)
    except ValueError:
        return pd.NaT


def enrich_option_frame(df: pd.DataFrame, reference: date | None = None) -> pd.DataFrame:
    """Add parsed fields and moneyness to an option snapshot dataframe."""
    if df.empty:
        return df

    out = df.reset_index(drop=True).copy()
    parsed = df["option_name"].map(parse_option_name).apply(pd.Series).reset_index(drop=True)

    for col in parsed.columns:
        if col not in out.columns:
            out[col] = parsed[col]
        elif col in ("strike", "option_type"):
            out[col] = out[col].combine_first(parsed[col])
        else:
            out[col] = out[col].fillna(parsed[col])

    if "expiry_date" not in out.columns:
        out["expiry_date"] = pd.NaT

    resolved = out.apply(lambda row: _resolve_expiry_date(row, reference), axis=1)
    out["expiry_date"] = pd.to_datetime(out["expiry_date"], errors="coerce")
    out["expiry_date"] = out["expiry_date"].fillna(resolved)

    ref_ts = pd.Timestamp(reference or datetime.now().date())
    out["days_to_expiry"] = (out["expiry_date"] - ref_ts).dt.days

    if "underlying_price" in out.columns and "strike" in out.columns:
        out["moneyness"] = out["strike"] / out["underlying_price"]
    else:
        out["moneyness"] = pd.NA

    return out
