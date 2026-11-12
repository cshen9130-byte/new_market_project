#!/usr/bin/env python3
"""
fetch_national_team_etf.py
==========================
Build daily 泛国家队观察池规模 / 净申赎估算 from exchange ETF share disclosures
and East Money / Sina closes, then upsert:

  raw_national_team_etf_daily
  derived_national_team_daily

Usage
-----
  python scripts/ma/fetch_national_team_etf.py
  python scripts/ma/fetch_national_team_etf.py --start 2023-01-01
  python scripts/ma/fetch_national_team_etf.py --start 2026-10-01 --end 2026-11-11
  python scripts/ma/fetch_national_team_etf.py --recent 15
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[2]
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from national_team_universe import is_national_team_etf, to_ts_code  # noqa: E402

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


INDEX_CODES = {
    "000001.SH": "index_sh",
    "000300.SH": "index_csi300",
    "000852.SH": "index_csi1000",
}

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS raw_national_team_etf_daily (
  trade_date date NOT NULL,
  ts_code text NOT NULL,
  name text,
  shares numeric,
  close numeric,
  nav numeric,
  scale numeric,
  in_pool boolean NOT NULL DEFAULT false,
  source text,
  fetched_at timestamptz DEFAULT now(),
  PRIMARY KEY (trade_date, ts_code)
);
CREATE INDEX IF NOT EXISTS idx_raw_nt_etf_pool
  ON raw_national_team_etf_daily (trade_date)
  WHERE in_pool;

CREATE TABLE IF NOT EXISTS derived_national_team_daily (
  trade_date date PRIMARY KEY,
  net_flow numeric,
  scale numeric,
  scale_chg numeric,
  purchase numeric,
  redeem numeric,
  index_sh numeric,
  index_csi300 numeric,
  index_csi1000 numeric,
  pool_count integer,
  updated_at timestamptz DEFAULT now()
);
"""


def log(msg: str) -> None:
    print(msg, flush=True)


def load_env() -> None:
    for base in (ROOT, Path.cwd(), Path(__file__).resolve().parent):
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def connect():
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )



def fetch_official_names() -> dict[str, str]:
    """East Money official ETF names, keyed by ts_code."""
    import requests
    from national_team_universe import to_ts_code

    cache = ROOT / "tmp" / "_etf_spot.csv"
    cached: dict[str, str] = {}
    if cache.is_file():
        try:
            df = pd.read_csv(cache, dtype={"f12": str})
            for rec in df.itertuples(index=False):
                code = str(getattr(rec, "f12", "")).zfill(6)
                name = str(getattr(rec, "f14", "")).strip()
                if code and name and name != "nan":
                    cached[to_ts_code(code)] = name
        except Exception:
            cached = {}

    rows = []
    total = None
    pn = 1
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"}
    try:
      while pn <= 20:
        r = requests.get(
            "https://push2.eastmoney.com/api/qt/clist/get",
            params={
                "pn": pn, "pz": 200, "po": 1, "np": 1, "fltt": 2, "invt": 2,
                "fid": "f12", "fs": "b:MK0021,b:MK0022",
                "fields": "f12,f14",
            },
            timeout=20,
            headers=headers,
        )
        data = r.json().get("data") or {}
        if total is None:
            total = data.get("total") or 0
        diff = data.get("diff") or []
        if not diff:
            break
        rows.extend(diff)
        if total and len(rows) >= total:
            break
        pn += 1
        time.sleep(0.12)
        out: dict[str, str] = {}
        for row in rows:
            code = str(row.get("f12") or "").zfill(6)
            name = str(row.get("f14") or "").strip()
            if code and name:
                out[to_ts_code(code)] = name
        if out:
            log(f"Official ETF names: {len(out)}")
            return out
    except Exception as exc:
        log(f"clist names failed: {exc}")
    if cached:
        log(f"Official ETF names from cache: {len(cached)}")
        return cached
    log("Official ETF names: 0")
    return {}


def apply_official_names(conn, names: dict[str, str]) -> int:
    if not names:
        return 0
    rows = [(name, is_national_team_etf(name), code) for code, name in names.items()]
    with conn.cursor() as cur:
        cur.executemany(
            """
            UPDATE raw_national_team_etf_daily
            SET name = %s, in_pool = %s
            WHERE ts_code = %s
            """,
            rows,
        )
    conn.commit()
    return len(rows)

def parse_date(s: str) -> date:
    return datetime.strptime(s.replace("-", "")[:8], "%Y%m%d").date()


def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(CREATE_SQL)
    conn.commit()


def existing_share_dates(conn) -> set[date]:
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT trade_date FROM raw_national_team_etf_daily")
        return {r[0] for r in cur.fetchall()}


def share_coverage(conn, dates: list[date]) -> dict[date, tuple[int, int]]:
    if not dates:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date,
                   COUNT(*) FILTER (WHERE ts_code LIKE '%%.SH') AS sh_n,
                   COUNT(*) FILTER (WHERE ts_code LIKE '%%.SZ') AS sz_n
            FROM raw_national_team_etf_daily
            WHERE trade_date = ANY(%s)
              AND shares IS NOT NULL
            GROUP BY trade_date
            """,
            (dates,),
        )
        return {r[0]: (int(r[1]), int(r[2])) for r in cur.fetchall()}


def trading_dates_from_db(conn, start: date, end: date) -> list[date]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT trade_date
            FROM raw_ashare_index_daily
            WHERE ts_code IN ('000001.SH', '000300.SH', '000852.SH')
              AND trade_date BETWEEN %s AND %s
            ORDER BY trade_date
            """,
            (start, end),
        )
        rows = [r[0] for r in cur.fetchall()]
    return rows


def trading_dates_akshare(start: date, end: date) -> list[date]:
    import akshare as ak

    df = ak.tool_trade_date_hist_sina()
    col = "trade_date" if "trade_date" in df.columns else df.columns[0]
    dates = pd.to_datetime(df[col]).dt.date
    return [d for d in dates if start <= d <= end]


def fetch_sse(day: date) -> pd.DataFrame:
    import akshare as ak

    df = ak.fund_etf_scale_sse(date=ymd(day))
    if df is None or df.empty:
        return pd.DataFrame()
    out = pd.DataFrame({
        "code": df["基金代码"].astype(str).str.zfill(6),
        "name": df["基金简称"].astype(str) if "基金简称" in df.columns else "",
        "shares": pd.to_numeric(df["基金份额"], errors="coerce"),
    })
    if "统计日期" in df.columns:
        got = pd.to_datetime(df["统计日期"], errors="coerce").dt.date
        # drop rows not actually for this date
        if got.notna().any() and (got.dropna() != day).all():
            return pd.DataFrame()
    out["ex"] = "SH"
    return out.dropna(subset=["shares"])


def fetch_szse_range(start: date, end: date) -> pd.DataFrame:
    import akshare as ak

    last_err = None
    df = None
    for attempt in range(4):
        try:
            df = ak.fund_scale_daily_szse(
                start_date=ymd(start), end_date=ymd(end), symbol="ETF"
            )
            last_err = None
            break
        except Exception as exc:
            last_err = exc
            time.sleep(1.2 * (attempt + 1))
    if last_err is not None and df is None:
        raise last_err
    if df is None or df.empty:
        return pd.DataFrame()
    date_col = "日期" if "日期" in df.columns else df.columns[0]
    out = pd.DataFrame({
        "date": pd.to_datetime(df[date_col], errors="coerce").dt.date,
        "code": df["基金代码"].astype(str).str.zfill(6),
        "name": df["基金简称"].astype(str) if "基金简称" in df.columns else "",
        "shares": pd.to_numeric(df["基金份额"], errors="coerce"),
        "ex": "SZ",
    })
    return out.dropna(subset=["date", "shares"])


def eastmoney_secid(code: str) -> str:
    c = code.split(".")[0].zfill(6)
    return f"1.{c}" if c.startswith(("5", "6")) else f"0.{c}"


def fetch_sina_hist(code: str, start: date, end: date) -> pd.DataFrame:
    import akshare as ak

    ts = to_ts_code(code)
    prefix = "sh" if ts.endswith(".SH") else "sz"
    symbol = prefix + ts.split(".")[0]
    try:
        df = ak.fund_etf_hist_sina(symbol=symbol)
    except Exception:
        return pd.DataFrame()
    if df is None or df.empty or "close" not in df.columns:
        return pd.DataFrame()
    out = pd.DataFrame({
        "trade_date": pd.to_datetime(df["date"], errors="coerce").dt.date,
        "ts_code": ts,
        "close": pd.to_numeric(df["close"], errors="coerce"),
        "name": "",
    }).dropna(subset=["trade_date", "close"])
    return out[(out["trade_date"] >= start) & (out["trade_date"] <= end)]


def fetch_kline(code: str, start: date, end: date) -> pd.DataFrame:
    import requests

    ts = to_ts_code(code)
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    params = {
        "secid": eastmoney_secid(ts),
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
        "klt": "101",
        "fqt": "0",
        "beg": ymd(start),
        "end": ymd(end),
        "lmt": 20000,
    }
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"}
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=20)
            data = (r.json().get("data") or {})
            name = data.get("name") or ""
            rows = []
            for item in data.get("klines") or []:
                parts = str(item).split(",")
                if len(parts) < 3:
                    continue
                d = datetime.strptime(parts[0][:10], "%Y-%m-%d").date()
                close = float(parts[2])
                rows.append({"trade_date": d, "ts_code": ts, "close": close, "name": name})
            return pd.DataFrame(rows)
        except Exception:
            time.sleep(0.4 * (attempt + 1))
    return pd.DataFrame()


def upsert_raw(conn, rows: list[tuple]) -> int:
    if not rows:
        return 0
    sql = """
    INSERT INTO raw_national_team_etf_daily
      (trade_date, ts_code, name, shares, close, nav, scale, in_pool, source, fetched_at)
    VALUES %s
    ON CONFLICT (trade_date, ts_code) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, raw_national_team_etf_daily.name),
      shares = COALESCE(EXCLUDED.shares, raw_national_team_etf_daily.shares),
      close = COALESCE(EXCLUDED.close, raw_national_team_etf_daily.close),
      nav = COALESCE(EXCLUDED.nav, raw_national_team_etf_daily.nav),
      scale = COALESCE(EXCLUDED.scale, raw_national_team_etf_daily.scale),
      in_pool = EXCLUDED.in_pool,
      source = COALESCE(EXCLUDED.source, raw_national_team_etf_daily.source),
      fetched_at = NOW()
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows, page_size=1000)
    conn.commit()
    return len(rows)


def fill_prices(conn, start: date, end: date) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ts_code
            FROM raw_national_team_etf_daily
            WHERE trade_date BETWEEN %s AND %s
              AND (close IS NULL OR in_pool)
            """,
            (start, end),
        )
        codes = [r[0] for r in cur.fetchall()]
    # prefer codes already in the pool or missing close
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ts_code
            FROM raw_national_team_etf_daily
            WHERE in_pool OR close IS NULL
            """
        )
        prefer = {r[0] for r in cur.fetchall()}
    codes = [c for c in codes if c in prefer] + [c for c in codes if c not in prefer]
    # always price in-pool names; skip huge off-pool set if close already present
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ts_code
            FROM raw_national_team_etf_daily
            WHERE in_pool
            """
        )
        pool_codes = [r[0] for r in cur.fetchall()]
    target = pool_codes or codes
    log(f"Fetching klines for {len(target)} ETFs {iso(start)} → {iso(end)}")
    updated = 0
    for i, code in enumerate(target, 1):
        window_start = start - timedelta(days=10)
        df = fetch_sina_hist(code, window_start, end)
        if df.empty:
            df = fetch_kline(code, window_start, end)
        if df.empty:
            log(f"  no price for {code}")
            continue
        payload = []
        for rec in df.itertuples(index=False):
            payload.append((
                rec.trade_date, rec.ts_code, rec.name or None, None, float(rec.close),
                float(rec.close), None, False, "eastmoney-kline",
            ))
        # only update close/nav/name on conflict; keep shares/in_pool
        sql = """
        INSERT INTO raw_national_team_etf_daily
          (trade_date, ts_code, name, shares, close, nav, scale, in_pool, source)
        VALUES %s
        ON CONFLICT (trade_date, ts_code) DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), raw_national_team_etf_daily.name),
          close = COALESCE(EXCLUDED.close, raw_national_team_etf_daily.close),
          nav = COALESCE(raw_national_team_etf_daily.nav, EXCLUDED.nav),
          fetched_at = NOW()
        """
        with conn.cursor() as cur:
            execute_values(cur, sql, payload, page_size=1000)
        conn.commit()
        updated += 1
        if i % 20 == 0:
            log(f"  kline {i}/{len(target)}")
        time.sleep(0.12)
    return updated


def attach_db_nav(conn, start: date, end: date) -> None:
    """Overlay official NAV from raw_etf_daily when present."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE raw_national_team_etf_daily r
            SET nav = e.value
            FROM raw_etf_daily e
            WHERE e.ticker = r.ts_code
              AND e.field = 'ORIGINALUNIT'
              AND e.trade_date = r.trade_date
              AND r.trade_date BETWEEN %s AND %s
            """,
            (start, end),
        )
    conn.commit()


def recompute_flags_and_scale(conn, start: date, end: date) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ts_code, name
            FROM raw_national_team_etf_daily
            WHERE trade_date BETWEEN %s AND %s
              AND name IS NOT NULL
            """,
            (start, end),
        )
        names = {}
        for ts_code, name in cur.fetchall():
            names.setdefault(ts_code, name)
    flags = {code: is_national_team_etf(name) for code, name in names.items()}
    rows = [(flags[c], c) for c in flags]
    with conn.cursor() as cur:
        cur.executemany(
            """
            UPDATE raw_national_team_etf_daily
            SET in_pool = %s,
                scale = shares * COALESCE(nav, close)
            WHERE ts_code = %s
              AND trade_date BETWEEN %s AND %s
            """,
            [(flag, code, start, end) for flag, code in rows],
        )
        # leftover codes with no name: leave in_pool false, still compute scale
        cur.execute(
            """
            UPDATE raw_national_team_etf_daily
            SET scale = shares * COALESCE(nav, close)
            WHERE trade_date BETWEEN %s AND %s
              AND shares IS NOT NULL
              AND COALESCE(nav, close) IS NOT NULL
            """,
            (start, end),
        )
    conn.commit()


def load_index_map(conn, start: date, end: date) -> dict[date, dict[str, float]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date, ts_code, close
            FROM raw_ashare_index_daily
            WHERE ts_code = ANY(%s)
              AND trade_date BETWEEN %s AND %s
            """,
            (list(INDEX_CODES.keys()), start, end),
        )
        out: dict[date, dict[str, float]] = {}
        for d, code, close in cur.fetchall():
            if close is None:
                continue
            out.setdefault(d, {})[INDEX_CODES[code]] = float(close)
    return out


def rebuild_derived(conn, start: date, end: date) -> int:
    # include one prior session so the first day's flow is defined
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date, ts_code, shares, COALESCE(nav, close) AS px, scale
            FROM raw_national_team_etf_daily
            WHERE in_pool
              AND trade_date BETWEEN %s AND %s
            ORDER BY ts_code, trade_date
            """,
            (start - timedelta(days=20), end),
        )
        rows = cur.fetchall()

    by_code: dict[str, list] = {}
    for d, code, shares, px, scale in rows:
        by_code.setdefault(code, []).append((d, shares, px, scale))

    daily: dict[date, dict[str, float]] = {}
    for code, series in by_code.items():
        prev_shares = None
        prev_scale = None
        for d, shares, px, scale in series:
            rec = daily.setdefault(d, {"net_flow": 0.0, "scale": 0.0, "purchase": 0.0, "redeem": 0.0, "n": 0})
            if scale is not None:
                rec["scale"] += float(scale)
                rec["n"] += 1
            if prev_shares is not None and shares is not None and px is not None:
                flow = (float(shares) - float(prev_shares)) * float(px)
                rec["net_flow"] += flow
                if flow >= 0:
                    rec["purchase"] += flow
                else:
                    rec["redeem"] += -flow
            prev_shares = shares if shares is not None else prev_shares
            prev_scale = scale if scale is not None else prev_scale

    idx = load_index_map(conn, start - timedelta(days=20), end)
    dates = sorted(
        d for d in daily
        if start <= d <= end and daily[d]["n"] > 0 and daily[d]["scale"]
    )
    prev_scale = None
    # find last scale before start
    earlier = [d for d in sorted(daily) if d < start]
    if earlier:
        prev_scale = daily[earlier[-1]]["scale"]

    payload = []
    for d in dates:
        rec = daily[d]
        scale = rec["scale"]
        chg = None if prev_scale is None else scale - prev_scale
        ix = idx.get(d, {})
        payload.append((
            d,
            rec["net_flow"],
            scale,
            chg,
            rec["purchase"],
            rec["redeem"],
            ix.get("index_sh"),
            ix.get("index_csi300"),
            ix.get("index_csi1000"),
            int(rec["n"]),
        ))
        prev_scale = scale

    if not payload:
        return 0
    sql = """
    INSERT INTO derived_national_team_daily (
      trade_date, net_flow, scale, scale_chg, purchase, redeem,
      index_sh, index_csi300, index_csi1000, pool_count
    ) VALUES %s
    ON CONFLICT (trade_date) DO UPDATE SET
      net_flow = EXCLUDED.net_flow,
      scale = EXCLUDED.scale,
      scale_chg = EXCLUDED.scale_chg,
      purchase = EXCLUDED.purchase,
      redeem = EXCLUDED.redeem,
      index_sh = COALESCE(EXCLUDED.index_sh, derived_national_team_daily.index_sh),
      index_csi300 = COALESCE(EXCLUDED.index_csi300, derived_national_team_daily.index_csi300),
      index_csi1000 = COALESCE(EXCLUDED.index_csi1000, derived_national_team_daily.index_csi1000),
      pool_count = EXCLUDED.pool_count,
      updated_at = NOW()
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, payload, page_size=500)
    conn.commit()
    return len(payload)


def upsert_share_frame(conn, day: date, frame: pd.DataFrame, source: str) -> int:
    if frame is None or frame.empty:
        return 0
    rows = []
    for rec in frame.itertuples(index=False):
        code = to_ts_code(rec.code)
        name = getattr(rec, "name", "") or ""
        shares = float(rec.shares) if rec.shares is not None and pd.notna(rec.shares) else None
        in_pool = is_national_team_etf(name)
        rows.append((day, code, name or None, shares, None, None, None, in_pool, source, datetime.now()))
    return upsert_raw(conn, rows)


def backfill_shares(conn, dates: list[date]) -> int:
    if not dates:
        return 0
    cover = share_coverage(conn, dates)
    missing_sse = [d for d in dates if cover.get(d, (0, 0))[0] < 50]
    missing_szse = [d for d in dates if cover.get(d, (0, 0))[1] < 50]
    if not missing_sse and not missing_szse:
        log("Share dates already present for both exchanges.")
        return 0
    missing = sorted(set(missing_sse) | set(missing_szse))

    # SZSE in <= 6-month chunks
    total = 0
    chunks: list[tuple[date, date]] = []
    cur_s = missing[0]
    prev = missing[0]
    for d in missing[1:]:
        if (d - cur_s).days > 90:
            chunks.append((cur_s, prev))
            cur_s = d
        prev = d
    chunks.append((cur_s, prev))

    szse_by_date: dict[date, pd.DataFrame] = {}
    for s, e in chunks:
        log(f"Fetching SZSE shares {iso(s)} → {iso(e)}")
        try:
            z = fetch_szse_range(s, e)
            if not z.empty:
                for day, part in z.groupby("date"):
                    szse_by_date[day] = part
        except Exception as exc:
            log(f"  SZSE failed {iso(s)}-{iso(e)}: {exc}")
        time.sleep(0.4)

    for i, day in enumerate(missing_sse, 1):
        log(f"Fetching SSE shares {iso(day)} ({i}/{len(missing_sse)})")
        try:
            sse = fetch_sse(day)
            total += upsert_share_frame(conn, day, sse, "sse-scale")
        except Exception as exc:
            log(f"  SSE failed {iso(day)}: {exc}")
        time.sleep(0.25)
    for day, part in szse_by_date.items():
        if day in set(missing_szse) or cover.get(day, (0, 0))[1] < 50:
            total += upsert_share_frame(conn, day, part, "szse-scale")
    return total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=str, default=None)
    parser.add_argument("--end", type=str, default=None)
    parser.add_argument("--recent", type=int, default=0, help="Only the last N calendar days")
    args = parser.parse_args()

    load_env()
    end = parse_date(args.end) if args.end else date.today()
    if args.recent:
        start = end - timedelta(days=args.recent)
    elif args.start:
        start = parse_date(args.start)
    else:
        start = date(2023, 1, 1)

    conn = connect()
    try:
        ensure_tables(conn)
        dates = trading_dates_from_db(conn, start, end)
        if not dates:
            log("No index calendar in DB, falling back to akshare trade dates.")
            try:
                dates = trading_dates_akshare(start, end)
            except Exception as exc:
                log(f"Trade calendar failed: {exc}")
                dates = []
        if not dates:
            # weekday fallback
            d = start
            dates = []
            while d <= end:
                if d.weekday() < 5:
                    dates.append(d)
                d += timedelta(days=1)
        log(f"Calendar {iso(dates[0])} → {iso(dates[-1])} ({len(dates)} sessions)")
        backfill_shares(conn, dates)
        try:
            official = fetch_official_names()
            apply_official_names(conn, official)
        except Exception as exc:
            log(f"Official names failed (will classify from short names): {exc}")
        fill_prices(conn, start, end)
        attach_db_nav(conn, start, end)
        recompute_flags_and_scale(conn, start, end)
        n = rebuild_derived(conn, start, end)
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM derived_national_team_daily
                WHERE scale IS NULL OR scale = 0 OR pool_count IS NULL OR pool_count = 0
                """
            )
            removed = cur.rowcount
        conn.commit()
        if removed:
            log(f"Removed {removed} empty derived rows.")
        log(f"derived_national_team_daily upserted {n} days.")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT min(trade_date), max(trade_date), count(*),
                       (SELECT scale FROM derived_national_team_daily ORDER BY trade_date DESC LIMIT 1)
                FROM derived_national_team_daily
                """
            )
            mn, mx, cnt, scale = cur.fetchone()
            log(f"Derived range {mn} → {mx}, {cnt} rows, last scale={scale}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
