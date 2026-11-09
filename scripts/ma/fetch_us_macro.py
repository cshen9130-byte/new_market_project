#!/usr/bin/env python3
"""Refresh /ma/dashboard/macro-market US charts (FOMC, CPI, jobs, FedWatch).

The page used to ship a static JSON snapshot. This job rewrites
``data/us-macro/fomc-cpi.json`` every day. The API reads that file at
request time, so a later run does not need a Next.js rebuild.

Sources that answer from this network (Eastmoney + Wallstreetcn):
  - CPI YoY / MoM, core CPI YoY / MoM, unemployment, nonfarm, fed funds target
  - Consensus forecasts, core PCE YoY, labor-force participation

CME FedWatch quotes are tried with a short timeout. When that host is
unreachable, reported probabilities are kept and later sessions are extended
from the US 1-year Treasury yield (Wallstreetcn), which this network can read.

Prints one JSON object on stdout. Logs go to stderr.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[2]
BUNDLED = ROOT / "lib" / "ma" / "fomc-cpi-data.json"
OUT_PATH = ROOT / "data" / "us-macro" / "fomc-cpi.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")

# Curated history before the September 2026 meeting stays as shipped.
LOCK_BEFORE = "2026-09-01"
# First run walks Wallstreetcn back through the stale gap. Later runs
# only need a recent window; older months are already in the output file.
BACKFILL_START = date(2026, 8, 1)

EASTMONEY = "https://datacenter-web.eastmoney.com/api/data/v1/get"
WSCN = "https://api-one-wscn.awtmt.com/apiv1/finance/macrodatas"
CME_QUOTES = "https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/305/G"
WSCN_KLINE = "https://api-ddc-wscn.awtmt.com/market/kline"
YIELD_NOTE = "收益率折算"
# Quoted next-meeting hike probabilities from Wallstreetcn, used to bridge the
# CME gap. Later sessions are scaled off the 2026-10-30 quote with the US 1-year yield.
WIRE_ODDS = [
    {"date": "2026-09-15", "label": "Sep 15", "hike": 92.0, "note": "华尔街见闻：9月会议加息概率超过 92%"},
    {"date": "2026-09-25", "label": "Sep 25", "hike": 69.0, "note": "华尔街见闻：10月加息概率升至 69%"},
    {"date": "2026-10-16", "label": "Oct 16", "hike": 15.0, "note": "华尔街见闻：10月加息概率跌破 15%"},
    {"date": "2026-10-30", "label": "Oct 30", "hike": 70.0, "note": "华尔街见闻：12月加息概率约为 70%"},
]
YIELD_ANCHOR_DATE = "2026-10-30"

INDICATORS = {
    "cpi_yoy": "EMG00000733",
    "core_cpi_yoy": "EMG00000746",
    "cpi_mom": "EMG00000770",
    "core_cpi_mom": "EMG00000771",
    "unrate": "EMG00001039",
    "nfp": "EMG00152118",
    "funds_hi": "EMG00342250",
    "funds_lo": "EMG00358536",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

log = logging.getLogger("fetch_us_macro")


def shanghai_today() -> date:
    return datetime.now(SHANGHAI).date()


def parse_day(value: str | None) -> date | None:
    if not value:
        return None
    text = str(value).strip().replace(".", "-").replace("/", "-")
    head = text[:10]
    try:
        return date.fromisoformat(head)
    except ValueError:
        return None


def ym_of(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def add_months(ym: str, delta: int) -> str:
    year, month = (int(part) for part in ym.split("-"))
    month += delta
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return f"{year:04d}-{month:02d}"


def month_label(day: date) -> str:
    return f"{MONTHS[day.month - 1]} {day.day}"


def cpi_month_label(ym: str) -> str:
    year, month = (int(part) for part in ym.split("-"))
    return f"{MONTHS[month - 1]} {year}"


def as_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def round_num(value: float | None, digits: int = 1) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def load_base() -> dict:
    path = OUT_PATH if OUT_PATH.is_file() else BUNDLED
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_indicator(indicator_id: str) -> list[dict]:
    rows: list[dict] = []
    page = 1
    pages = 1
    while page <= pages and page <= 20:
        response = requests.get(
            EASTMONEY,
            params={
                "reportName": "RPT_ECONOMICVALUE_USA",
                "columns": "ALL",
                "filter": f'(INDICATOR_ID="{indicator_id}")',
                "pageNumber": str(page),
                "pageSize": "500",
                "sortColumns": "REPORT_DATE",
                "sortTypes": "1",
                "source": "WEB",
                "client": "WEB",
            },
            headers=HEADERS,
            timeout=30,
        )
        response.raise_for_status()
        result = (response.json() or {}).get("result") or {}
        chunk = result.get("data") or []
        pages = int(result.get("pages") or 1)
        rows.extend(chunk)
        if not chunk:
            break
        page += 1
    parsed: list[dict] = []
    for row in rows:
        report = parse_day(row.get("REPORT_DATE"))
        published = parse_day(row.get("PUBLISH_DATE"))
        if report is None:
            continue
        parsed.append(
            {
                "ym": ym_of(report),
                "publish": published,
                "value": as_float(row.get("VALUE")),
                "pre": as_float(row.get("PRE_VALUE")),
            }
        )
    parsed.sort(key=lambda item: item["ym"])
    return parsed


def fetch_wallstreet(start: date, end: date) -> list[dict]:
    rows: list[dict] = []
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=7), end)
        start_sec = int(datetime(cursor.year, cursor.month, cursor.day, tzinfo=SHANGHAI).timestamp())
        end_sec = int(datetime(chunk_end.year, chunk_end.month, chunk_end.day, tzinfo=SHANGHAI).timestamp())
        try:
            response = requests.get(
                WSCN,
                params={"start": start_sec, "end": end_sec},
                headers={**HEADERS, "Referer": "https://wallstreetcn.com/calendar"},
                timeout=25,
            )
            response.raise_for_status()
            items = ((response.json() or {}).get("data") or {}).get("items") or []
        except Exception as exc:
            log.warning("wallstreetcn %s..%s failed: %s", cursor, chunk_end, exc)
            items = []
        for item in items:
            country = str(item.get("country_id") or item.get("country") or "")
            title = f"{item.get('title') or ''} {item.get('event') or ''}".strip()
            if country not in ("US", "美国") and "美国" not in title and "美联储" not in title:
                continue
            published_raw = item.get("public_date")
            try:
                published = datetime.fromtimestamp(int(published_raw), SHANGHAI).date()
            except (TypeError, ValueError, OSError):
                continue
            rows.append(
                {
                    "title": title,
                    "published": published,
                    "actual": as_float(item.get("actual")),
                    "forecast": as_float(item.get("forecast")),
                }
            )
        cursor = chunk_end
    return rows


def classify_event(title: str) -> str | None:
    text = title.replace(" ", "")
    if "申请" in text or "救济" in text:
        return None
    if "核心PCE物价指数同比" in text:
        return "core_pce_yoy"
    if "核心CPI同比" in text:
        return "core_cpi_yoy"
    if "核心CPI环比" in text:
        return "core_cpi_mom"
    if "CPI环比" in text and "核心" not in text:
        return "cpi_mom"
    if "CPI同比" in text and "核心" not in text:
        return "cpi_yoy"
    if "劳动力参与率" in text:
        return "participation"
    if "失业率" in text:
        return "unrate"
    if "非农就业人口变动" in text:
        return "nfp"
    if "U-6" in text or "U6" in text or "广义失业" in text:
        return "u6"
    return None


def event_ym(title: str, published: date) -> str | None:
    match = re.search(r"(\d{1,2})月", title)
    if not match:
        return None
    month = int(match.group(1))
    if month < 1 or month > 12:
        return None
    year = published.year - 1 if month > published.month else published.year
    return f"{year:04d}-{month:02d}"


def index_events(events: list[dict]) -> dict[str, dict[str, dict]]:
    """series -> ym -> {actual, forecast, published}. Later prints win."""
    out: dict[str, dict[str, dict]] = {}
    for event in events:
        kind = classify_event(event["title"])
        if not kind:
            continue
        ym = event_ym(event["title"], event["published"])
        if not ym:
            continue
        slot = out.setdefault(kind, {})
        current = slot.get(ym)
        if current and current["published"] > event["published"]:
            continue
        actual = event["actual"]
        if kind == "nfp" and actual is not None:
            actual = round(actual * 10, 1)
        forecast = event["forecast"]
        if kind == "nfp" and forecast is not None:
            forecast = round(forecast * 10, 1)
        slot[ym] = {
            "actual": actual,
            "forecast": forecast,
            "published": event["published"],
        }
    return out


def released_day(row: dict) -> date | None:
    return parse_day(row.get("released") or row.get("label"))


def upsert_month(monthly: list[dict], by_ym: dict[str, dict], ym: str, publish: date | None) -> dict:
    slot = by_ym.get(ym)
    if slot is None:
        released = publish.isoformat() if publish else ym + "-01"
        slot = {
            "ym": ym,
            "label": released,
            "released": released,
            "actual": None,
            "forecast": None,
            "mom": None,
            "core": None,
        }
        monthly.append(slot)
        by_ym[ym] = slot
    elif publish and not slot.get("released"):
        slot["released"] = publish.isoformat()
        slot["label"] = publish.isoformat()
    return slot


def apply_series(rows: list[dict], cutoff: str, assign) -> None:
    for row in rows:
        if row["value"] is None or row["ym"] < cutoff:
            continue
        assign(row)


def cpi_known_on(monthly: list[dict], day: date) -> dict | None:
    known = []
    for row in monthly:
        released = released_day(row)
        if released is None or released > day or row.get("actual") is None:
            continue
        known.append((released, row))
    if not known:
        return None
    known.sort(key=lambda item: (item[0], item[1]["ym"]))
    return known[-1][1]


def nearest_meeting(meetings: list[dict], day: date, window: int = 3) -> dict | None:
    best = None
    best_gap = window + 1
    for meeting in meetings:
        decision = parse_day(meeting.get("decision"))
        if decision is None:
            continue
        gap = abs((decision - day).days)
        if gap <= window and gap < best_gap:
            best = meeting
            best_gap = gap
    return best


def fill_meeting_cpi(meeting: dict, monthly: list[dict], day: date) -> None:
    cpi = cpi_known_on(monthly, day)
    if not cpi:
        return
    meeting["cpiMonth"] = cpi_month_label(cpi["ym"])
    meeting["cpiRelease"] = str(cpi.get("released") or "")
    meeting["actual"] = cpi.get("actual")
    forecast = cpi.get("forecast")
    meeting["forecast"] = cpi.get("actual") if forecast is None else forecast


def sync_meetings(data: dict, funds_rows: list[dict], today: date) -> None:
    meetings: list[dict] = data.setdefault("MEETINGS", [])
    monthly: list[dict] = data.get("MONTHLY") or []
    decided = [row for row in funds_rows if row["value"] is not None and row["publish"] is not None]
    decided.sort(key=lambda row: row["publish"])
    future = [row for row in funds_rows if row["value"] is None and row["publish"] and row["publish"] > today]
    future.sort(key=lambda row: row["publish"])

    prev_upper = None
    for row in decided:
        upper = float(row["value"])
        if prev_upper is None:
            prev_upper = float(row["pre"]) if row["pre"] is not None else upper
        bps = int(round((upper - prev_upper) * 100))
        if bps > 0:
            action = "Hike"
        elif bps < 0:
            action = "Cut"
        else:
            action = "Hold"
        match = nearest_meeting(meetings, row["publish"])
        if match and match["decision"] < LOCK_BEFORE and match.get("action") != "Pending":
            prev_upper = upper
            continue
        if match is None and row["publish"].isoformat() < LOCK_BEFORE:
            prev_upper = upper
            continue
        if match:
            match["action"] = action
            match["bps"] = bps
            match["fundsHi"] = upper
            if match.get("actual") is None:
                fill_meeting_cpi(match, monthly, row["publish"])
        else:
            meeting = {
                "decision": row["publish"].isoformat(),
                "label": month_label(row["publish"]),
                "era": "now" if row["publish"].isoformat() >= "2026-01-01" else "ease",
                "action": action,
                "bps": bps,
                "fundsHi": upper,
                "cpiMonth": "",
                "cpiRelease": "",
                "actual": None,
                "forecast": None,
            }
            fill_meeting_cpi(meeting, monthly, row["publish"])
            meetings.append(meeting)
        prev_upper = upper

    if not future:
        meetings.sort(key=lambda item: item["decision"])
        return
    upcoming = future[0]
    pending = [item for item in meetings if item.get("action") == "Pending"]
    match = nearest_meeting(pending, upcoming["publish"], window=5)
    if match is None and len(pending) == 1 and pending[0]["decision"] < LOCK_BEFORE:
        match = None
    if match is None:
        match = {
            "decision": upcoming["publish"].isoformat(),
            "label": month_label(upcoming["publish"]),
            "era": "now",
            "action": "Pending",
            "bps": None,
            "fundsHi": None,
            "cpiMonth": "",
            "cpiRelease": "",
            "actual": None,
            "forecast": None,
        }
        meetings.append(match)
    match["decision"] = upcoming["publish"].isoformat()
    match["label"] = month_label(upcoming["publish"])
    match["action"] = "Pending"
    match["bps"] = None
    match["fundsHi"] = None
    match["era"] = "now"
    fill_meeting_cpi(match, monthly, min(upcoming["publish"], today))
    meetings.sort(key=lambda item: item["decision"])


def sahm_values(unrate: dict[str, float]) -> dict[str, float]:
    months = sorted(ym for ym, value in unrate.items() if value is not None)
    out: dict[str, float] = {}
    for index, ym in enumerate(months):
        if index < 15:
            continue
        window = [unrate[months[pos]] for pos in range(index - 2, index + 1)]
        current = sum(window) / 3
        previous = []
        for pos in range(index - 12, index):
            sample = [unrate[months[point]] for point in range(pos - 2, pos + 1)]
            previous.append(sum(sample) / 3)
        if len(previous) < 12:
            continue
        out[ym] = round(current - min(previous), 2)
    return out


def hike_probability(futures_price: float, meeting: date, midpoint: float) -> float | None:
    """Probability of at least a +25bp hike, from the 30-day fed-funds future.

    CME prices the contract as 100 minus the expected average effective rate
    over the delivery month. Days up to and including the announcement stay
    at the current midpoint; the new rate applies afterward. A meeting in the
    last few days of the month barely moves that average, so callers should
    pass the following month's price in that case.
    """
    if futures_price <= 50 or futures_price >= 100:
        return None
    days = monthrange(meeting.year, meeting.month)[1]
    before = meeting.day
    after = days - before
    implied = 100.0 - futures_price
    if after < 3:
        expected = implied
    else:
        expected = (implied * days - midpoint * before) / after
    probability = (expected - midpoint) / 0.25 * 100
    return max(0.0, min(100.0, round(probability, 1)))


def contract_month(quote: dict) -> date | None:
    for key in ("expirationDate", "expirationMonth", "lastTradeDate", "updateTime"):
        raw = quote.get(key)
        if not raw:
            continue
        text = str(raw)
        iso = parse_day(text)
        if iso:
            return date(iso.year, iso.month, 1)
        named = re.search(r"([A-Za-z]{3})\s+(\d{4})", text)
        if named and named.group(1).title() in MONTHS:
            return date(int(named.group(2)), MONTHS.index(named.group(1).title()) + 1, 1)
    return None


def quote_price(quote: dict) -> float | None:
    for key in ("last", "priorSettle", "settle", "close"):
        price = as_float(str(quote.get(key)).replace(",", "")) if quote.get(key) not in (None, "", "-") else None
        if price and 50 < price < 100:
            return price
    return None


def fetch_us1y_closes() -> list[tuple[str, float]]:
    try:
        response = requests.get(
            WSCN_KLINE,
            params={
                "prod_code": "US1YR.OTC",
                "tick_count": 90,
                "period_type": 86400,
                "fields": "tick_at,close_px",
            },
            headers={**HEADERS, "Referer": "https://wallstreetcn.com/"},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        log.info("US 1-year yield unavailable: %s", exc)
        return []
    candle = ((payload.get("data") or {}).get("candle") or {}).get("US1YR.OTC") or {}
    fields = (payload.get("data") or {}).get("fields") or ["close_px", "tick_at"]
    try:
        close_at = fields.index("close_px")
        time_at = fields.index("tick_at")
    except ValueError:
        return []
    rows = []
    for line in candle.get("lines") or []:
        if not isinstance(line, list) or len(line) <= max(close_at, time_at):
            continue
        close = as_float(line[close_at])
        try:
            day = datetime.fromtimestamp(int(line[time_at]), timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            continue
        if close is None:
            continue
        rows.append((day, close))
    rows.sort()
    return rows


def ensure_wire_odds(odds: list[dict]) -> None:
    """Insert reported probabilities without disturbing same-day pre/post points."""
    odds[:] = [row for row in odds if not str(row.get("note") or "").startswith(YIELD_NOTE)]
    have = {(row.get("date"), row.get("label")) for row in odds}
    for point in WIRE_ODDS:
        key = (point["date"], point["label"])
        if key not in have:
            odds.append(dict(point))
    odds.sort(key=lambda row: (str(row.get("date") or ""), 0 if "pre" in str(row.get("label")) else 1, str(row.get("label") or "")))


def extend_odds_from_yield(odds: list[dict], closes: list[tuple[str, float]], today: date) -> int:
    """Carry the latest quoted hike probability forward with the 1-year yield.

    One basis point of a 25bp fed-funds contract is about 4 percentage points
    of hike probability. The 1-year yield is the stand-in because the December
    fed-funds future is not quoted on a host this network can reach.
    """
    anchor = next((row for row in odds if row.get("date") == YIELD_ANCHOR_DATE), None)
    if anchor is None or anchor.get("hike") is None:
        return 0
    anchor_close = next((close for day, close in closes if day == YIELD_ANCHOR_DATE), None)
    if anchor_close is None:
        prior = [close for day, close in closes if day <= YIELD_ANCHOR_DATE]
        anchor_close = prior[-1] if prior else None
    if anchor_close is None:
        return 0
    taken = {row.get("date") for row in odds if row.get("date") and not str(row.get("note") or "").startswith(YIELD_NOTE)}
    written = 0
    for day, close in closes:
        if day <= YIELD_ANCHOR_DATE or day > today.isoformat() or day in taken:
            continue
        basis_points = (close - anchor_close) * 100
        hike = max(0.0, min(100.0, round(float(anchor["hike"]) + basis_points / 0.25, 1)))
        odds.append(
            {
                "date": day,
                "label": month_label(date.fromisoformat(day)),
                "hike": hike,
                "note": (
                    f"{YIELD_NOTE}：美国1年期国债 {close:.3f}%，相对 {YIELD_ANCHOR_DATE} 的 {anchor_close:.3f}%。"
                    "CME 未连通，不是官方 FedWatch。"
                ),
            }
        )
        written += 1
    odds.sort(key=lambda row: (str(row.get("date") or ""), 0 if "pre" in str(row.get("label")) else 1, str(row.get("label") or "")))
    return written


def try_fedwatch(next_meeting: date, upper: float, lower: float) -> dict | None:
    try:
        response = requests.get(CME_QUOTES, headers=HEADERS, timeout=8)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        log.info("FedWatch quotes unavailable: %s", exc)
        return None
    quotes = payload.get("quotes") if isinstance(payload, dict) else None
    if not isinstance(quotes, list):
        log.info("FedWatch payload has no quotes array")
        return None
    priced = []
    for quote in quotes:
        if not isinstance(quote, dict):
            continue
        month = contract_month(quote)
        price = quote_price(quote)
        if month and price:
            priced.append((month, price))
    if not priced:
        log.info("FedWatch quotes had no usable prices")
        return None
    days_after = monthrange(next_meeting.year, next_meeting.month)[1] - next_meeting.day
    target = date(next_meeting.year, next_meeting.month, 1)
    if days_after < 3:
        year = target.year + (1 if target.month == 12 else 0)
        month = 1 if target.month == 12 else target.month + 1
        target = date(year, month, 1)
    chosen = min(priced, key=lambda item: (abs((item[0] - target).days), item[0]))
    midpoint = (upper + lower) / 2
    probability = hike_probability(chosen[1], next_meeting if days_after >= 3 else target.replace(day=15), midpoint)
    if probability is None:
        return None
    today = shanghai_today()
    return {
        "date": today.isoformat(),
        "label": month_label(today),
        "hike": probability,
        "note": f"30天联邦基金期货 {chosen[1]:.4f} 隐含加息，目标中值 {midpoint:.3f}",
    }


def append_fedwatch(data: dict, point: dict | None) -> str:
    if point is None:
        return "unavailable"
    odds = data.setdefault("SEP_HIKE_ODDS", [])
    if odds and odds[-1].get("date") == point["date"] and odds[-1].get("label") == point["label"]:
        odds[-1] = point
    else:
        odds.append(point)
    return "cme"


def rebuild_year_arrays(data: dict, nfp_rows: list[dict], nfp_forecast: dict[str, dict]) -> float | None:
    nfp_known = [row for row in nfp_rows if row["value"] is not None]
    if not nfp_known:
        return None
    year = nfp_known[-1]["ym"][:4]
    points = []
    for row in nfp_known:
        if not row["ym"].startswith(year):
            continue
        month = int(row["ym"][5:7])
        forecast = (nfp_forecast.get(row["ym"]) or {}).get("forecast")
        k_value = float(row["value"])
        point = {
            "ym": row["ym"],
            "m": MONTHS[month - 1],
            "k": int(k_value) if k_value.is_integer() else round(k_value, 1),
        }
        if forecast is not None:
            point["forecast"] = forecast
        points.append(point)
    data["NFP_2026"] = points
    trail = [row["value"] for row in nfp_known[-12:]]
    average = round(sum(trail) / len(trail), 1) if trail else None

    monthly = [row for row in data.get("MONTHLY") or [] if row.get("core") is not None]
    if monthly:
        cpi_year = monthly[-1]["ym"][:4]
        data["CORE_MOM_2026"] = [
            {"ym": row["ym"], "m": MONTHS[int(row["ym"][5:7]) - 1], "actual": row["core"]}
            for row in monthly
            if row["ym"].startswith(cpi_year)
        ]
    return average


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)
    today = shanghai_today()
    cutoff = add_months(ym_of(today), -8)
    try:
        series = {name: fetch_indicator(indicator_id) for name, indicator_id in INDICATORS.items()}
    except Exception as exc:
        print(json.dumps({"error": f"eastmoney: {exc}"}, ensure_ascii=False))
        return 1
    if not any(row["value"] is not None for row in series["cpi_yoy"]):
        print(json.dumps({"error": "eastmoney returned no CPI"}, ensure_ascii=False))
        return 1

    data = load_base()
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    backfilled = bool(meta.get("backfillThrough"))
    wscn_start = today - timedelta(days=50) if backfilled else BACKFILL_START
    events = index_events(fetch_wallstreet(wscn_start, today + timedelta(days=2)))

    monthly: list[dict] = data.setdefault("MONTHLY", [])
    by_ym = {row["ym"]: row for row in monthly if row.get("ym")}

    def publish_of(rows: list[dict], ym: str) -> date | None:
        for row in rows:
            if row["ym"] == ym:
                return row["publish"]
        return None

    apply_series(
        series["cpi_yoy"],
        cutoff,
        lambda row: upsert_month(monthly, by_ym, row["ym"], row["publish"]).update(actual=round_num(row["value"])),
    )
    apply_series(
        series["cpi_mom"],
        cutoff,
        lambda row: upsert_month(monthly, by_ym, row["ym"], row["publish"] or publish_of(series["cpi_yoy"], row["ym"])).update(
            mom=round_num(row["value"])
        ),
    )
    apply_series(
        series["core_cpi_mom"],
        cutoff,
        lambda row: upsert_month(monthly, by_ym, row["ym"], row["publish"] or publish_of(series["cpi_yoy"], row["ym"])).update(
            core=round_num(row["value"])
        ),
    )

    for ym, event in (events.get("cpi_yoy") or {}).items():
        slot = by_ym.get(ym)
        if ym < cutoff or event["forecast"] is None or slot is None or slot.get("actual") is None:
            continue
        slot["forecast"] = round_num(event["forecast"])
    for ym, event in (events.get("core_cpi_mom") or {}).items():
        slot = by_ym.get(ym)
        if ym < cutoff or event["forecast"] is None or slot is None or slot.get("actual") is None:
            continue
        slot["coreForecast"] = round_num(event["forecast"])
    data["MONTHLY"] = [row for row in monthly if row.get("actual") is not None]
    data["MONTHLY"].sort(key=lambda row: row["ym"])

    def merge_map(key: str, rows: list[dict], digits: int = 1) -> None:
        target = data.setdefault(key, {})
        for row in rows:
            if row["value"] is None or row["ym"] < cutoff:
                continue
            target[row["ym"]] = round_num(row["value"], digits)

    merge_map("CORE_YOY", series["core_cpi_yoy"])
    merge_map("UNRATE", series["unrate"])
    for ym, event in (events.get("core_pce_yoy") or {}).items():
        if event["actual"] is None or ym < cutoff:
            continue
        data.setdefault("CORE_PCE_YOY", {})[ym] = round_num(event["actual"], 2)
    for ym, event in (events.get("participation") or {}).items():
        if event["actual"] is None or ym < cutoff:
            continue
        data.setdefault("CIVPART", {})[ym] = round_num(event["actual"])
    for ym, event in (events.get("u6") or {}).items():
        if event["actual"] is None or ym < cutoff:
            continue
        data.setdefault("U6RATE", {})[ym] = round_num(event["actual"])

    computed_sahm = sahm_values({key: float(value) for key, value in (data.get("UNRATE") or {}).items()})
    stored_sahm = data.get("SAHM") or {}
    anchor = stored_sahm.get("2026-08")
    computed_anchor = computed_sahm.get("2026-08")
    sahm_ok = anchor is not None and computed_anchor is not None and abs(float(anchor) - computed_anchor) <= 0.08
    if sahm_ok:
        for ym, value in computed_sahm.items():
            if ym >= cutoff:
                data.setdefault("SAHM", {})[ym] = value
    else:
        log.info("Sahm anchor mismatch stored=%s computed=%s; left the history in place", anchor, computed_anchor)

    sync_meetings(data, series["funds_hi"], today)
    trail = rebuild_year_arrays(data, series["nfp"], events.get("nfp") or {})

    latest_funds = [row for row in series["funds_hi"] if row["value"] is not None and row["publish"]]
    latest_lower = [row for row in series["funds_lo"] if row["value"] is not None and row["publish"]]
    pending = next((item for item in reversed(data["MEETINGS"]) if item.get("action") == "Pending"), None)
    odds = data.setdefault("SEP_HIKE_ODDS", [])
    ensure_wire_odds(odds)
    fedwatch_status = "unavailable"
    if pending and latest_funds and latest_lower:
        point = try_fedwatch(
            parse_day(pending["decision"]) or today,
            float(latest_funds[-1]["value"]),
            float(latest_lower[-1]["value"]),
        )
        fedwatch_status = append_fedwatch(data, point)
    if extend_odds_from_yield(odds, fetch_us1y_closes(), today) and fedwatch_status != "cme":
        fedwatch_status = "yield"

    latest_cpi = next((row["ym"] for row in reversed(monthly) if row.get("actual") is not None), None)
    latest_nfp = next((row["ym"] for row in reversed(series["nfp"]) if row["value"] is not None), None)
    latest_pce = max((data.get("CORE_PCE_YOY") or {}), default=None)
    data["meta"] = {
        "updatedAt": today.isoformat(),
        "backfillThrough": today.isoformat(),
        "sources": ["eastmoney RPT_ECONOMICVALUE_USA", "wallstreetcn macrodatas"],
        "fedwatch": fedwatch_status,
        "nfpTrailAvg": trail,
        "latest": {"cpi": latest_cpi, "nfp": latest_nfp, "pce": latest_pce, "pending": (pending or {}).get("decision")},
        "sahmAnchor": {"stored": anchor, "computed": computed_anchor, "applied": sahm_ok},
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(OUT_PATH)

    summary = {
        "updated": 1,
        "asOf": today.isoformat(),
        "cpi": latest_cpi,
        "nfp": latest_nfp,
        "pce": latest_pce,
        "pending": (pending or {}).get("decision"),
        "meetings": len(data["MEETINGS"]),
        "fedwatch": fedwatch_status,
        "sahmApplied": sahm_ok,
        "path": str(OUT_PATH),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
