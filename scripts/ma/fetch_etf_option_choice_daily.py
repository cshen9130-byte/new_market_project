#!/usr/bin/env python3
"""Load SSE ETF option closes from Choice and store the rolling front-month ATM IV.

Sina drops an expiry soon after it dies, so the website's own daily line falls
through to the next month and misses the expiry-week spike. Choice sector
121001 still returns those contracts. EMBLSIMPV is empty for these ETF options,
so the implied vol is the same call/put Black-Scholes average the site uses.

Writes only:
  public.raw_etf_option_contract_daily
  public.raw_etf_atm_iv_daily
"""
from __future__ import annotations

import math
import os
import sys
from datetime import date, datetime
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
from EmQuantAPI import c

ROOT = Path("/root/new_market_project")
START = "2024-01-01"
UNDERLYINGS = {
    "50ETF": "510050",
    "300ETF": "510300",
    "500ETF": "510500",
}
RATE = 0.018
BATCH = 20


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def login() -> None:
    extra = os.environ.get("EMQ_OPTIONS_EXTRA", "")
    options = f"UserName={os.environ['EMQ_USERNAME']},PassWord={os.environ['EMQ_PASSWORD']},TestLatency=0,ForceLogin=0"
    if extra:
        options += "," + extra
    result = c.start(options)
    if result.ErrorCode != 0:
        raise SystemExit(f"Choice login failed: {result.ErrorMsg}")


def iso(value: str) -> str:
    text = str(value).replace("/", "-")
    parts = text.split("-")
    if len(parts) != 3:
        return text[:10]
    year, month, day = (int(part) for part in parts)
    return f"{year:04d}-{month:02d}-{day:02d}"


def fourth_wednesday(year: int, month: int) -> str:
    first = date(year, month, 1)
    day = 1 + (2 - first.weekday()) % 7 + 21
    return date(year, month, day).isoformat()


def parse_name(name: str, snapshot: str) -> tuple[str, str, float, str, str] | None:
    prefix = next((item for item in UNDERLYINGS if name.startswith(item)), None)
    if prefix is None:
        return None
    side_at = name.find("购")
    side = "call"
    if side_at < 0:
        side_at = name.find("沽")
        side = "put"
    if side_at < 0:
        return None
    month_at = name.find("月", side_at)
    if month_at < 0:
        return None
    try:
        month = int(name[side_at + 1:month_at])
        strike = int(name[month_at + 1:]) / 1000
    except ValueError:
        return None
    if not 1 <= month <= 12 or strike <= 0:
        return None
    snap = date.fromisoformat(snapshot)
    year = snap.year if month >= snap.month else snap.year + 1
    expire = fourth_wednesday(year, month)
    yymm = f"{year % 100:02d}{month:02d}"
    return UNDERLYINGS[prefix], side, strike, expire, yymm


def snapshot_dates() -> list[str]:
    data = c.tradedates(START, date.today().isoformat(), "Market=CNSESH")
    if data.ErrorCode != 0:
        raise SystemExit(f"tradedates failed: {data.ErrorMsg}")
    days = [iso(item) for item in data.Data or []]
    picked: list[str] = []
    by_month: dict[str, list[str]] = {}
    for day in days:
        by_month.setdefault(day[:7], []).append(day)
    for month_days in by_month.values():
        tenth = min(month_days, key=lambda day: abs(int(day[8:10]) - 10))
        picked.append(tenth)
        if month_days[-1] != tenth:
            picked.append(month_days[-1])
    return sorted(set(picked))


def choose_expire(month: int, last_seen: date) -> str:
    best: date | None = None
    for year in (last_seen.year - 1, last_seen.year, last_seen.year + 1):
        exp = date.fromisoformat(fourth_wednesday(year, month))
        if exp < last_seen and (last_seen - exp).days > 25:
            continue
        if best is None or abs((exp - last_seen).days) < abs((best - last_seen).days):
            best = exp
    if best is None:
        best = date.fromisoformat(fourth_wednesday(last_seen.year, month))
    return best.isoformat()


def month_of(name: str) -> int | None:
    side_at = name.find("购")
    if side_at < 0:
        side_at = name.find("沽")
    month_at = name.find("月", max(side_at, 0) + 1)
    if side_at < 0 or month_at < 0:
        return None
    try:
        month = int(name[side_at + 1:month_at])
    except ValueError:
        return None
    return month if 1 <= month <= 12 else None


def yymm_of(expire: str, month: int) -> str:
    return f"{int(expire[:4]) % 100:02d}{month:02d}"


def collect_contracts() -> dict[str, tuple[str, str, str, float, str, str]]:
    seen: dict[str, dict] = {}
    for day in snapshot_dates():
        data = c.sector("121001", day)
        if data.ErrorCode != 0:
            print("sector", day, data.ErrorCode, data.ErrorMsg, flush=True)
            continue
        rows = [str(item) for item in (data.Data or [])]
        for i in range(0, len(rows) - 1, 2):
            code, name = rows[i], rows[i + 1]
            if ".SH" not in code:
                continue
            parsed = parse_name(name, day)
            month = month_of(name)
            if parsed is None or month is None:
                continue
            underlying, side, strike, _expire, _yymm = parsed
            slot = seen.setdefault(code, {
                "underlying": underlying, "name": name, "side": side, "strike": strike,
                "month": month, "last": day,
            })
            slot["last"] = day
            slot["name"] = name
        print("snapshot", day, "contracts", len(seen), flush=True)
    found: dict[str, tuple[str, str, str, float, str, str]] = {}
    for code, slot in seen.items():
        expire = choose_expire(int(slot["month"]), date.fromisoformat(slot["last"]))
        found[code] = (
            slot["underlying"], slot["name"], slot["side"], slot["strike"],
            expire, yymm_of(expire, int(slot["month"])),
        )
    return found


def fetch_closes(codes: list[str], end: str) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    opts = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"
    for i in range(0, len(codes), BATCH):
        batch = codes[i:i + BATCH]
        data = c.csd(",".join(batch), "CLOSE", START, end, opts)
        if data.ErrorCode != 0:
            print("csd", i, data.ErrorCode, data.ErrorMsg, flush=True)
            continue
        dates = [iso(item) for item in (data.Dates or [])]
        for code in batch:
            series = (data.Data or {}).get(code)
            if not series:
                continue
            closes = series[0]
            saved: dict[str, float] = {}
            for day, close in zip(dates, closes):
                try:
                    value = float(close)
                except (TypeError, ValueError):
                    continue
                if value > 0:
                    saved[day] = value
            if saved:
                out[code] = saved
        print("closes", min(i + BATCH, len(codes)), "/", len(codes), flush=True)
    return out


def norm_cdf(x: float) -> float:
    t = 1 / (1 + 0.2316419 * abs(x))
    d = 0.3989422804014327 * math.exp(-0.5 * x * x)
    p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    return 1 - p if x >= 0 else p


def bs(spot: float, strike: float, tenor: float, sigma: float, side: str) -> float:
    if tenor <= 0 or sigma <= 0:
        return max(spot - strike, 0) if side == "call" else max(strike - spot, 0)
    root = math.sqrt(tenor)
    d1 = (math.log(spot / strike) + (RATE + 0.5 * sigma * sigma) * tenor) / (sigma * root)
    d2 = d1 - sigma * root
    df = math.exp(-RATE * tenor)
    if side == "call":
        return spot * norm_cdf(d1) - strike * df * norm_cdf(d2)
    return strike * df * norm_cdf(-d2) - spot * norm_cdf(-d1)


def implied_vol(price: float, spot: float, strike: float, tenor: float, side: str) -> float | None:
    intrinsic = max(spot - strike, 0) if side == "call" else max(strike - spot, 0)
    if price <= 0 or price < intrinsic * 0.99:
        return None
    lo, hi = 1e-4, 5.0
    if (bs(spot, strike, tenor, lo, side) - price) * (bs(spot, strike, tenor, hi, side) - price) > 0:
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if bs(spot, strike, tenor, mid, side) - price > 0:
            hi = mid
        else:
            lo = mid
    pct = (lo + hi) / 2 * 100
    if pct < 1 or pct > 150:
        return None
    return pct


def year_fraction(day: str, expire: str) -> float:
    start = datetime.fromisoformat(day + "T15:00:00")
    end = datetime.fromisoformat(expire + "T15:00:00")
    return max((end - start).total_seconds(), 30 * 60) / (365 * 24 * 3600)


def build_atm(contracts, closes, spots) -> list[tuple]:
    by_underlying: dict[str, dict[str, list]] = {}
    for code, (underlying, _name, side, strike, expire, yymm) in contracts.items():
        series = closes.get(code)
        if not series:
            continue
        book = by_underlying.setdefault(underlying, {})
        key = f"{yymm}|{strike}"
        slot = book.setdefault(key, {"yymm": yymm, "strike": strike, "expire": expire, "call": {}, "put": {}})
        slot[side].update(series)
    points: list[tuple] = []
    for underlying, book in by_underlying.items():
        spot = spots.get(underlying) or {}
        months: dict[str, dict] = {}
        for slot in book.values():
            month = months.setdefault(slot["yymm"], {"expire": slot["expire"], "strikes": {}})
            month["strikes"].setdefault(slot["strike"], {"call": {}, "put": {}})
            month["strikes"][slot["strike"]]["call"].update(slot["call"])
            month["strikes"][slot["strike"]]["put"].update(slot["put"])
        for day, px in sorted(spot.items()):
            alive = [item for item in months.values() if item["expire"] >= day]
            if not alive:
                continue
            month = min(alive, key=lambda item: item["expire"])
            tenor = year_fraction(day, month["expire"])
            ranked = sorted(month["strikes"].items(), key=lambda item: abs(item[0] - px))
            for strike, pair in ranked:
                call_px = pair["call"].get(day)
                put_px = pair["put"].get(day)
                if call_px is None or put_px is None:
                    continue
                call_iv = implied_vol(call_px, px, strike, tenor, "call")
                put_iv = implied_vol(put_px, px, strike, tenor, "put")
                if call_iv is None or put_iv is None:
                    continue
                mid = (call_iv + put_iv) / 2
                if abs(call_iv - put_iv) > max(8, mid * 0.35):
                    continue
                yymm = next(key for key, slot in months.items() if slot is month)
                points.append((day, underlying, yymm, strike, round(mid, 2)))
                break
    return points


def rebuild_from_db() -> None:
    """Recompute expiry from the last traded day, then rebuild ATM from stored closes.

    The ETF spot is not in the option table, so this still logs into Choice for
    the three underlying closes only.
    """
    load_env()
    login()
    end = date.today().isoformat()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute("""
            SELECT trade_date, contract, underlying, contract_name, side, strike, close
            FROM public.raw_etf_option_contract_daily
            WHERE underlying IN ('510050', '510300', '510500')
        """)
        loaded = cur.fetchall()
    meta: dict[str, dict] = {}
    closes: dict[str, dict[str, float]] = {}
    for trade_date, contract, underlying, name, side, strike, close in loaded:
        day = trade_date.isoformat()
        slot = meta.setdefault(contract, {
            "underlying": underlying, "name": name, "side": side,
            "strike": float(strike), "last": trade_date,
        })
        if trade_date > slot["last"]:
            slot["last"] = trade_date
            slot["name"] = name
        closes.setdefault(contract, {})[day] = float(close)
    contracts: dict[str, tuple[str, str, str, float, str, str]] = {}
    updates = []
    for contract, slot in meta.items():
        month = month_of(str(slot["name"]))
        if month is None:
            continue
        expire = choose_expire(month, slot["last"])
        yymm = yymm_of(expire, month)
        contracts[contract] = (slot["underlying"], slot["name"], slot["side"], slot["strike"], expire, yymm)
        updates.append((expire, yymm, contract))
    sample = contracts.get("10012036.SH")
    print("sample 10012036", sample, "last", None if "10012036.SH" not in meta else meta["10012036.SH"]["last"], flush=True)
    spots_raw = fetch_closes([f"{code}.SH" for code in sorted(set(UNDERLYINGS.values()))], end)
    spots = {code.split(".")[0]: series for code, series in spots_raw.items()}
    print("spot days", {code: len(series) for code, series in spots.items()}, "510500@2026-07-20", (spots.get("510500") or {}).get("2026-07-20"), flush=True)
    atm = build_atm(contracts, closes, spots)
    july = [item for item in atm if item[1] == "510500" and "2026-07-15" <= item[0] <= "2026-07-24"]
    print("rows", len(loaded), "contracts", len(contracts), "atm", len(atm), flush=True)
    print("july", july, flush=True)
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE public.raw_etf_option_contract_daily SET expire_day = %s, yymm = %s WHERE contract = %s",
            updates,
        )
        cur.execute("DELETE FROM public.raw_etf_atm_iv_daily WHERE underlying IN ('510050', '510300', '510500')")
        if atm:
            execute_values(cur, """
                INSERT INTO public.raw_etf_atm_iv_daily
                  (trade_date, underlying, yymm, strike, close)
                VALUES %s
            """, atm, page_size=1000)
    conn.commit()
    conn.close()
    c.stop()


def main() -> None:
    if "--rebuild" in sys.argv:
        rebuild_from_db()
        return
    load_env()
    login()
    end = date.today().isoformat()
    contracts = collect_contracts()
    print("unique", len(contracts), flush=True)
    spots_raw = fetch_closes([f"{code}.SH" for code in sorted(set(UNDERLYINGS.values()))], end)
    spots = {code.split(".")[0]: series for code, series in spots_raw.items()}
    closes = fetch_closes(sorted(contracts), end)
    rows = []
    for code, (underlying, name, side, strike, expire, yymm) in contracts.items():
        for day, close in (closes.get(code) or {}).items():
            rows.append((day, code, underlying, name, side, expire, strike, yymm, close))
    atm = build_atm(contracts, closes, spots)
    print("rows", len(rows), "atm", len(atm), flush=True)
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.raw_etf_option_contract_daily (
                trade_date date NOT NULL,
                contract text NOT NULL,
                underlying text NOT NULL,
                contract_name text,
                side text,
                expire_day date,
                strike numeric,
                yymm text,
                close numeric,
                source text NOT NULL DEFAULT 'emquant',
                fetched_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (trade_date, contract)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.raw_etf_atm_iv_daily (
                trade_date date NOT NULL,
                underlying text NOT NULL,
                yymm text,
                strike numeric,
                close numeric NOT NULL,
                source text NOT NULL DEFAULT 'emquant-atm',
                fetched_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (trade_date, underlying)
            )
        """)
        if rows:
            execute_values(cur, """
                INSERT INTO public.raw_etf_option_contract_daily
                  (trade_date, contract, underlying, contract_name, side, expire_day, strike, yymm, close)
                VALUES %s
                ON CONFLICT (trade_date, contract) DO UPDATE
                  SET close = EXCLUDED.close,
                      expire_day = EXCLUDED.expire_day,
                      yymm = EXCLUDED.yymm,
                      contract_name = EXCLUDED.contract_name,
                      side = EXCLUDED.side,
                      strike = EXCLUDED.strike,
                      fetched_at = now()
            """, rows, page_size=2000)
        if atm:
            execute_values(cur, """
                INSERT INTO public.raw_etf_atm_iv_daily
                  (trade_date, underlying, yymm, strike, close)
                VALUES %s
                ON CONFLICT (trade_date, underlying) DO UPDATE
                  SET yymm = EXCLUDED.yymm, strike = EXCLUDED.strike,
                      close = EXCLUDED.close, fetched_at = now()
            """, atm, page_size=1000)
    conn.commit()
    conn.close()
    july = [item for item in atm if item[0] == "2026-07-20" and item[1] == "510500"]
    print("july20", july, flush=True)
    c.stop()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("failed", exc, file=sys.stderr)
        raise
