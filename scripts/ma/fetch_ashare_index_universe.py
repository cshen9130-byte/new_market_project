#!/usr/bin/env python3
"""
fetch_ashare_index_universe.py
==============================
Fetch daily closes for the JY 周度回顾 / 规模指数 universe.

Sources (tried in order per code):
  eastmoney kline, Tencent QQ, Sina, CSI index site, 申万官网 (AkShare).

Usage: python fetch_ashare_index_universe.py 2025-01-01 2026-09-16
Stdout: JSON { "data": [{date, ts_code, close, amount, source}], "errors": [...] }
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# ts_code stored in raw_ashare_index_daily → fetchers tried in order.
# kind: em | qq | qq_hk | sina | csindex | sw
INDEX_SPECS: list[tuple[str, list[tuple[str, str]]]] = [
    ("000016.SH", [("em", "1.000016"), ("qq", "sh000016"), ("sina", "sh000016"), ("csindex", "000016")]),
    ("000300.SH", [("em", "1.000300"), ("qq", "sh000300"), ("sina", "sh000300"), ("csindex", "000300")]),
    ("000905.SH", [("em", "1.000905"), ("qq", "sh000905"), ("sina", "sh000905"), ("csindex", "000905")]),
    ("000852.SH", [("em", "1.000852"), ("qq", "sh000852"), ("sina", "sh000852"), ("csindex", "000852")]),
    ("932000.CSI", [("em", "2.932000"), ("csindex", "932000")]),
    ("399006.SZ", [("em", "0.399006"), ("qq", "sz399006"), ("sina", "sz399006")]),
    ("000985.SH", [("em", "1.000985"), ("qq", "sh000985"), ("sina", "sh000985"), ("csindex", "000985")]),
    ("000001.SH", [("em", "1.000001"), ("qq", "sh000001"), ("sina", "sh000001"), ("csindex", "000001")]),
    ("000510.SH", [("em", "1.000510"), ("qq", "sh000510"), ("sina", "sh000510"), ("csindex", "000510")]),
    ("HSI.HI", [("em", "100.HSI"), ("qq", "hkHSI")]),
    ("HSTECH.HI", [("em", "124.HSTECH"), ("qq_hk", "hkHSTECH")]),
    ("000688.SH", [("em", "1.000688"), ("qq", "sh000688"), ("sina", "sh000688")]),
    ("899050.BJ", [("sina", "bj899050"), ("qq", "bj899050"), ("em", "0.899050")]),
    ("399372.SZ", [("em", "0.399372"), ("qq", "sz399372"), ("sina", "sz399372")]),
    ("399373.SZ", [("em", "0.399373"), ("qq", "sz399373"), ("sina", "sz399373")]),
    ("399374.SZ", [("em", "0.399374"), ("qq", "sz399374"), ("sina", "sz399374")]),
    ("399375.SZ", [("em", "0.399375"), ("qq", "sz399375"), ("sina", "sz399375")]),
    ("399376.SZ", [("em", "0.399376"), ("qq", "sz399376"), ("sina", "sz399376")]),
    ("399377.SZ", [("em", "0.399377"), ("qq", "sz399377"), ("sina", "sz399377")]),
    ("000015.SH", [("em", "1.000015"), ("qq", "sh000015"), ("sina", "sh000015")]),
    ("399997.SZ", [("em", "0.399997"), ("qq", "sz399997"), ("sina", "sz399997")]),
    ("399808.SZ", [("em", "0.399808"), ("qq", "sz399808"), ("sina", "sz399808")]),
    ("399303.SZ", [("em", "0.399303"), ("qq", "sz399303"), ("sina", "sz399303")]),
    ("BK0999.EM", [("em", "90.BK0999")]),
    ("BK1000.EM", [("em", "90.BK1000")]),
    ("BK1158.EM", [("em", "90.BK1158")]),
    ("BK1639.EM", [("em", "90.BK1639")]),
    ("BK1710.EM", [("em", "90.BK1710")]),
    ("BK1711.EM", [("em", "90.BK1711")]),
    ("BK1712.EM", [("em", "90.BK1712")]),
    ("BK1713.EM", [("em", "90.BK1713")]),
    ("BK1714.EM", [("em", "90.BK1714")]),
]

# Sample 大类指数 801271-801276 are Wind/中信 buckets; we store equal-weight 申万一级 composites.
SECTOR_COMPOSITES: dict[str, list[str]] = {
    "801271.SI": ["801950.SI", "801040.SI", "801050.SI", "801030.SI", "801960.SI", "801710.SI"],
    "801272.SI": ["801730.SI", "801890.SI", "801740.SI", "801880.SI"],
    "801273.SI": ["801120.SI", "801110.SI", "801200.SI", "801210.SI", "801130.SI", "801140.SI", "801010.SI"],
    "801275.SI": ["801080.SI", "801750.SI", "801770.SI", "801760.SI"],
    "801276.SI": ["801780.SI", "801790.SI", "801180.SI"],
    "801274.SI": ["801150.SI"],
}

SW_L1_CODES = sorted({
    code.split(".")[0]
    for members in SECTOR_COMPOSITES.values()
    for code in members
})


def _load_env() -> None:
    for base in (Path.cwd(), Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent.parent):
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _norm_date(s: str) -> str:
    return datetime.strptime(s.strip().replace("-", ""), "%Y%m%d").strftime("%Y-%m-%d")


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _http(url: str, *, referer: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Referer": referer, "Accept": "*/*"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _http_json(url: str, *, referer: str, retries: int = 2) -> object | None:
    last: Exception | None = None
    for i in range(retries):
        try:
            raw = _http(url, referer=referer)
            return json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as exc:
            last = exc
            time.sleep(0.6 * (i + 1))
    _log(f"http fail {url[:80]}: {last}")
    return None


def _num(v: object) -> float | None:
    try:
        n = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return n if n == n and n > 0 else None


def _in_range(d: str, start: str, end: str) -> bool:
    return bool(d) and start <= d <= end


def fetch_em(secid: str, start: str, end: str, lmt: int) -> list[dict]:
    url = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get"
        f"?secid={secid}&ut=fa5fd1943c7b386f172d6893dbfba10b"
        "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58"
        f"&klt=101&fqt=1&end=20500101&lmt={lmt}"
    )
    payload = _http_json(url, referer="https://quote.eastmoney.com/", retries=1)
    if not isinstance(payload, dict):
        return []
    klines = ((payload.get("data") or {}) or {}).get("klines") or []
    out: list[dict] = []
    for row in klines:
        parts = str(row).split(",")
        if len(parts) < 3:
            continue
        d = parts[0][:10]
        close = _num(parts[2])
        amount = _num(parts[6]) if len(parts) > 6 else None
        if close is None or not _in_range(d, start, end):
            continue
        out.append({"date": d, "close": close, "amount": amount, "source": "eastmoney"})
    return out


def fetch_qq(symbol: str, start: str, end: str, lmt: int, *, hk: bool = False) -> list[dict]:
    path = "hkfqkline" if hk else "fqkline"
    url = (
        f"https://web.ifzq.gtimg.cn/appstock/app/{path}/get"
        f"?param={symbol},day,,,{lmt},qfq"
    )
    payload = _http_json(url, referer="https://gu.qq.com/")
    if not isinstance(payload, dict):
        return []
    rows = (((payload.get("data") or {}) or {}).get(symbol) or {}).get("day") or []
    out: list[dict] = []
    for row in rows:
        if not row:
            continue
        d = str(row[0])[:10]
        close = _num(row[2] if len(row) > 2 else None)
        if close is None or not _in_range(d, start, end):
            continue
        out.append({"date": d, "close": close, "amount": None, "source": "qq"})
    return out


def fetch_sina(symbol: str, start: str, end: str, lmt: int) -> list[dict]:
    url = (
        "https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData"
        f"?symbol={symbol}&scale=240&ma=no&datalen={lmt}"
    )
    payload = _http_json(url, referer="https://finance.sina.com.cn/")
    if not isinstance(payload, list):
        text = ""
        try:
            raw = _http(url, referer="https://finance.sina.com.cn/")
            text = raw.decode("utf-8", errors="replace")
            open_i, close_i = text.find("["), text.rfind("]")
            if open_i >= 0 and close_i > open_i:
                payload = json.loads(text[open_i : close_i + 1])
        except Exception:
            payload = None
        if not isinstance(payload, list):
            return []
    out: list[dict] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        d = str(row.get("day") or "")[:10]
        close = _num(row.get("close"))
        if close is None or not _in_range(d, start, end):
            continue
        out.append({"date": d, "close": close, "amount": None, "source": "sina"})
    return out


def fetch_csindex(symbol: str, start: str, end: str) -> list[dict]:
    try:
        import akshare as ak
        df = ak.stock_zh_index_hist_csindex(
            symbol=symbol,
            start_date=start.replace("-", ""),
            end_date=end.replace("-", ""),
        )
    except Exception as exc:
        _log(f"csindex {symbol}: {exc}")
        return []
    if df is None or df.empty:
        return []
    close_col = next((c for c in df.columns if str(c) in ("收盘", "close", "Close")), None)
    date_col = next((c for c in df.columns if str(c) in ("日期", "date", "Date")), None)
    amt_col = next((c for c in df.columns if "成交金额" in str(c) or str(c) in ("amount",)), None)
    if not close_col or not date_col:
        return []
    out: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get(date_col, ""))[:10]
        close = _num(r.get(close_col))
        amt = _num(r.get(amt_col)) if amt_col else None
        if amt is not None and amt < 1e6:
            amt = amt * 1e8  # CSI hist 成交金额 is 亿元
        if close is None or not _in_range(d, start, end):
            continue
        out.append({"date": d, "close": close, "amount": amt, "source": "csindex"})
    return out


def fetch_sw(code: str, start: str, end: str) -> list[dict]:
    try:
        import akshare as ak
        df = ak.index_hist_sw(symbol=code, period="day")
    except Exception as exc:
        _log(f"sw {code}: {exc}")
        return []
    if df is None or df.empty:
        return []
    close_col = next((c for c in df.columns if str(c) in ("收盘", "close")), None)
    date_col = next((c for c in df.columns if str(c) in ("日期", "date")), None)
    amt_col = next((c for c in df.columns if "成交额" in str(c)), None)
    if not close_col or not date_col:
        return []
    out: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get(date_col, ""))[:10]
        close = _num(r.get(close_col))
        amt = _num(r.get(amt_col)) if amt_col else None
        if amt is not None and amt < 1e6:
            amt = amt * 1e8
        if close is None or not _in_range(d, start, end):
            continue
        out.append({"date": d, "close": close, "amount": amt, "source": "sw"})
    return out


def fetch_one(kind: str, symbol: str, start: str, end: str, lmt: int) -> list[dict]:
    if kind == "em":
        return fetch_em(symbol, start, end, lmt)
    if kind == "qq":
        return fetch_qq(symbol, start, end, lmt)
    if kind == "qq_hk":
        return fetch_qq(symbol, start, end, lmt, hk=True)
    if kind == "sina":
        return fetch_sina(symbol, start, end, lmt)
    if kind == "csindex":
        return fetch_csindex(symbol, start, end)
    if kind == "sw":
        return fetch_sw(symbol, start, end)
    return []


def first_source(spec: list[tuple[str, str]], start: str, end: str, lmt: int) -> list[dict]:
    ordered = [x for x in spec if x[0] != "em"] + [x for x in spec if x[0] == "em"]
    for kind, symbol in ordered:
        rows = fetch_one(kind, symbol, start, end, lmt)
        time.sleep(0.12)
        if len(rows) >= 2:
            return rows
    return []


def chain_equal_weight(member_series: list[list[dict]]) -> list[dict]:
    by_code: list[dict[str, float]] = []
    for rows in member_series:
        m = {str(r["date"])[:10]: float(r["close"]) for r in rows if _num(r.get("close"))}
        if m:
            by_code.append(m)
    if not by_code:
        return []
    dates = sorted({d for m in by_code for d in m})
    if len(dates) < 2:
        return []
    prev_close: list[float | None] = [None] * len(by_code)
    level = 1000.0
    started = False
    out: list[dict] = []
    for d in dates:
        rets: list[float] = []
        seen = False
        for i, series in enumerate(by_code):
            cur = series.get(d)
            old = prev_close[i]
            if cur is None:
                continue
            seen = True
            if old is not None and old > 0:
                rets.append(cur / old - 1.0)
            prev_close[i] = cur
        if not seen:
            continue
        if not started:
            started = True
            level = 1000.0
        elif rets:
            level *= 1.0 + (sum(rets) / len(rets))
        else:
            continue
        out.append({"date": d, "close": round(level, 4), "amount": None, "source": "sw_composite"})
    return out


def build_composites(sw_rows: dict[str, list[dict]], start: str, end: str) -> list[dict]:
    out: list[dict] = []
    for ts_code, members in SECTOR_COMPOSITES.items():
        series = chain_equal_weight([sw_rows.get(m, []) for m in members])
        for r in series:
            if _in_range(r["date"], start, end):
                out.append({**r, "ts_code": ts_code})
    return out


def main() -> None:
    _load_env()
    today = datetime.today().strftime("%Y-%m-%d")
    if len(sys.argv) >= 3:
        start_date = _norm_date(sys.argv[1])
        end_date = _norm_date(sys.argv[2])
    else:
        end_date = today
        start_date = (datetime.today() - timedelta(days=400)).strftime("%Y-%m-%d")

    span = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days
    lmt = 40 if span <= 45 else min(1200, max(80, span + 10))

    data: list[dict] = []
    errors: list[str] = []

    for ts_code, spec in INDEX_SPECS:
        rows = first_source(spec, start_date, end_date, lmt)
        if len(rows) < 2:
            errors.append(ts_code)
            _log(f"miss {ts_code}")
            continue
        _log(f"ok {ts_code} {len(rows)} {rows[0]['source']}")
        for r in rows:
            data.append({"date": r["date"], "ts_code": ts_code, "close": r["close"],
                         "amount": r.get("amount"), "source": r["source"]})

    sw_rows: dict[str, list[dict]] = {}
    for code in SW_L1_CODES:
        ts_code = f"{code}.SI"
        rows = fetch_sw(code, start_date, end_date)
        time.sleep(0.12)
        if len(rows) < 2:
            errors.append(ts_code)
            _log(f"miss {ts_code}")
            continue
        _log(f"ok {ts_code} {len(rows)} sw")
        sw_rows[ts_code] = rows
        for r in rows:
            data.append({"date": r["date"], "ts_code": ts_code, "close": r["close"],
                         "amount": r.get("amount"), "source": "sw"})

    data.extend(build_composites(sw_rows, start_date, end_date))

    print(json.dumps({
        "start_date": start_date,
        "end_date": end_date,
        "count": len(data),
        "errors": errors,
        "data": data,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
