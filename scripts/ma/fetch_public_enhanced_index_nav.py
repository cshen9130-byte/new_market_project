#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fetch Choice 公募增强指数型 NAV into Postgres.

Universe CSV is one row per share class (A/C/E and listed ETF), with Choice
tickers such as 159552.SZ and 027308.OF. NAV fields:

    UNITNAV, ACCUMULATEDNAV, ADJUSTEDNAV

ADJUSTEDNAV is Choice's 复权单位净值 and is stored in rehabilitation_nav.

Usage
-----
  python fetch_public_enhanced_index_nav.py --universe-only
  python fetch_public_enhanced_index_nav.py --codes 159552.SZ
  python fetch_public_enhanced_index_nav.py --end 2026-11-06

Reads EMQ_USERNAME, EMQ_PASSWORD, and DATABASE_URL from the environment or
.env / .env.local. Safe to re-run: each share is checkpointed at its latest
stored NAV date, so a later run only requests the gap through --end. The
checkpoint stays on that latest date when Choice has not published the
requested end yet, so an early run does not skip a NAV that appears later.

Nightly ETL calls this with --end today (step public_enhanced_index_nav).
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL_PATH = ROOT / "scripts" / "db" / "031_create_public_enhanced_index.sql"
DEFAULT_CSV = ROOT / "data" / "choice" / "public_enhanced_index_shares_20261109.csv"
LIST_AS_OF = date(2026, 11, 9)

# ADJUSTEDNAV is Choice's 复权单位净值. REHABILITATIONNAV is not populated
# on this terminal (service error 10000013, or null when batched).
CSD_FIELDS = "UNITNAV,ACCUMULATEDNAV,ADJUSTEDNAV"
CSD_OPTS = "period=1,adjustflag=1,curtype=1,order=1"
FIELD_NAMES = ("UNITNAV", "ACCUMULATEDNAV", "ADJUSTEDNAV")
FIELD_COLUMNS = {
    "UNITNAV": "unit_nav",
    "ACCUMULATEDNAV": "accumulated_nav",
    "ADJUSTEDNAV": "rehabilitation_nav",
}
GRID_START = date(2002, 1, 1)
GRID_YEARS = 4
BATCH_SIZE = int(os.environ.get("PUBLIC_ENHANCED_BATCH", "20"))
QUOTA_CODES = ("10001012",)


def _load_env() -> None:
    candidates = [Path.cwd(), Path(__file__).resolve().parent, ROOT]
    for base in candidates:
        for name in (".env.local", ".env"):
            path = base / name
            if not path.is_file():
                continue
            try:
                for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
            except OSError:
                pass


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def _parse_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text or text in {"-", "—", "--"}:
        return None
    text = text[:10].replace("/", "-")
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "—", "--"}:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if number != number:  # NaN
        return None
    return number


def _parse_bool(value: object) -> bool:
    return str(value or "").strip() in {"1", "是", "Y", "y", "true", "True"}


def _add_years(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        return day.replace(year=day.year + years, day=28)


def _norm_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value)[:10].replace("/", "-")
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def _flatten(series) -> list:
    if series is None:
        return []
    if isinstance(series, (list, tuple)):
        if len(series) == 1 and isinstance(series[0], (list, tuple)):
            return list(series[0])
        return list(series)
    return [series]


def _nav_value(raw: object) -> float | None:
    number = _parse_float(raw)
    if number is None or number <= 0 or number > 1_000_000:
        return None
    return number


def _is_quota(message: str) -> bool:
    lowered = message.lower()
    return any(code in message for code in QUOTA_CODES) or "insufficient user access" in lowered


class Share:
    def __init__(self, row: dict[str, str]):
        self.choice_code = (row.get("choice_code") or "").strip()
        self.fund_code = (row.get("fund_code") or "").strip()
        self.short_name = row.get("short_name") or None
        self.full_name = row.get("full_name") or None
        self.share_class = row.get("share_class") or None
        self.product_form = row.get("product_form") or None
        self.market_type = row.get("market_type") or None
        self.is_etf = _parse_bool(row.get("is_etf"))
        self.is_feeder = _parse_bool(row.get("is_feeder"))
        self.type_l1 = row.get("type_l1") or None
        self.type_l2 = row.get("type_l2") or None
        self.track_method = row.get("track_method") or None
        self.benchmark_index = row.get("benchmark_index") or None
        self.inception_date = _parse_date(row.get("inception_date")) or date(2002, 1, 1)
        self.manager_company = row.get("manager_company") or None
        self.fund_manager = row.get("fund_manager") or None
        self.benchmark_desc = row.get("benchmark_desc") or None
        self.snapshot_unit_nav = _parse_float(row.get("snapshot_unit_nav"))
        self.snapshot_nav_date = _parse_date(row.get("snapshot_nav_date"))
        self.snapshot_return_pct = _parse_float(row.get("snapshot_return_pct"))
        self.aum_yi = _parse_float(row.get("aum_yi"))
        self.share_scale_text = row.get("share_scale_text") or None
        self.top_industry = row.get("top_industry") or None
        self.fetched_through: date | None = None

    def as_tuple(self) -> tuple:
        return (
            self.choice_code,
            self.fund_code,
            self.short_name,
            self.full_name,
            self.share_class,
            self.product_form,
            self.market_type,
            self.is_etf,
            self.is_feeder,
            self.type_l1,
            self.type_l2,
            self.track_method,
            self.benchmark_index,
            self.inception_date,
            self.manager_company,
            self.fund_manager,
            self.benchmark_desc,
            self.snapshot_unit_nav,
            self.snapshot_nav_date,
            self.snapshot_return_pct,
            self.aum_yi,
            self.share_scale_text,
            self.top_industry,
            LIST_AS_OF,
        )


def load_shares(csv_path: Path) -> list[Share]:
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        shares = [Share(row) for row in csv.DictReader(handle)]
    shares = [row for row in shares if row.choice_code and row.fund_code]
    if not shares:
        raise SystemExit(f"no share rows in {csv_path}")
    return shares


def connect():
    try:
        import psycopg2
    except ImportError as exc:
        raise SystemExit(f"psycopg2 not installed: {exc}") from exc
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required")
    return psycopg2.connect(url)


def ensure_schema(conn) -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def upsert_shares(conn, shares: list[Share]) -> None:
    from psycopg2.extras import execute_values

    sql = """
        INSERT INTO public_enhanced_index_share (
            choice_code, fund_code, short_name, full_name, share_class, product_form,
            market_type, is_etf, is_feeder, type_l1, type_l2, track_method,
            benchmark_index, inception_date, manager_company, fund_manager, benchmark_desc,
            snapshot_unit_nav, snapshot_nav_date, snapshot_return_pct, aum_yi,
            share_scale_text, top_industry, list_as_of
        ) VALUES %s
        ON CONFLICT (choice_code) DO UPDATE SET
            fund_code = EXCLUDED.fund_code,
            short_name = EXCLUDED.short_name,
            full_name = EXCLUDED.full_name,
            share_class = EXCLUDED.share_class,
            product_form = EXCLUDED.product_form,
            market_type = EXCLUDED.market_type,
            is_etf = EXCLUDED.is_etf,
            is_feeder = EXCLUDED.is_feeder,
            type_l1 = EXCLUDED.type_l1,
            type_l2 = EXCLUDED.type_l2,
            track_method = EXCLUDED.track_method,
            benchmark_index = EXCLUDED.benchmark_index,
            inception_date = EXCLUDED.inception_date,
            manager_company = EXCLUDED.manager_company,
            fund_manager = EXCLUDED.fund_manager,
            benchmark_desc = EXCLUDED.benchmark_desc,
            snapshot_unit_nav = EXCLUDED.snapshot_unit_nav,
            snapshot_nav_date = EXCLUDED.snapshot_nav_date,
            snapshot_return_pct = EXCLUDED.snapshot_return_pct,
            aum_yi = EXCLUDED.aum_yi,
            share_scale_text = EXCLUDED.share_scale_text,
            top_industry = EXCLUDED.top_industry,
            list_as_of = EXCLUDED.list_as_of,
            updated_at = NOW()
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, [row.as_tuple() for row in shares], page_size=500)
    conn.commit()


def load_checkpoints(conn, shares: list[Share]) -> None:
    codes = [row.choice_code for row in shares]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT choice_code, nav_fetched_through
            FROM public_enhanced_index_share
            WHERE choice_code = ANY(%s)
            """,
            (codes,),
        )
        found = {code: through for code, through in cur.fetchall()}
    for row in shares:
        row.fetched_through = found.get(row.choice_code)


def next_window(share: Share, end: date) -> tuple[date, date, date] | None:
    """Return (request_start, window_end, grid_start) still needed for this share."""
    resume = share.inception_date
    if share.fetched_through and share.fetched_through >= resume:
        resume = share.fetched_through + timedelta(days=1)
    if resume > end:
        return None
    grid = GRID_START
    while grid <= end:
        grid_end = min(_add_years(grid, GRID_YEARS) - timedelta(days=1), end)
        if resume <= grid_end:
            request_start = max(resume, share.inception_date)
            if request_start <= grid_end:
                return request_start, grid_end, grid
        grid = _add_years(grid, GRID_YEARS)
    return None


def _field_map(data, codes: list[str]) -> dict[str, dict[str, list]]:
    dates = list(getattr(data, "Dates", None) or getattr(data, "dates", None) or [])
    payload = getattr(data, "Data", None)
    if payload is None:
        payload = getattr(data, "data", None)
    indicators = [
        str(item).upper()
        for item in (
            getattr(data, "Indicators", None)
            or getattr(data, "Fields", None)
            or FIELD_NAMES
        )
    ]
    out: dict[str, dict[str, list]] = {}

    def take(code: str, raw) -> None:
        series: dict[str, list] = {}
        if isinstance(raw, dict):
            for name in indicators:
                value = raw.get(name)
                if value is None:
                    value = raw.get(name.lower())
                if value is not None:
                    series[name] = _flatten(value)
        elif isinstance(raw, (list, tuple)):
            for index, name in enumerate(indicators):
                if index < len(raw):
                    series[name] = _flatten(raw[index])
        if series:
            out[code] = series

    if isinstance(payload, dict):
        sample = next(iter(payload), "")
        sample_name = str(sample).upper()
        if sample_name in FIELD_NAMES or sample_name in set(indicators):
            if len(codes) == 1:
                take(codes[0], payload)
        else:
            for code in codes:
                raw = payload.get(code)
                if raw is None:
                    continue
                take(code, raw)
    elif isinstance(payload, (list, tuple)) and len(codes) == 1:
        take(codes[0], payload)

    out["_dates"] = {"_": dates}  # type: ignore[assignment]
    return out


_LOGGED_SHAPE = False


def parse_nav(data, codes: list[str]) -> list[tuple]:
    global _LOGGED_SHAPE
    error_code = getattr(data, "ErrorCode", 0)
    if error_code not in (0, None):
        message = f"({error_code}): {getattr(data, 'ErrorMsg', 'csd error')}"
        raise RuntimeError(message)
    if not _LOGGED_SHAPE:
        _LOGGED_SHAPE = True
        payload = getattr(data, "Data", None)
        indicators = getattr(data, "Indicators", None) or getattr(data, "Fields", None)
        key_sample = list(payload)[:3] if isinstance(payload, dict) else type(payload).__name__
        sys.stderr.write(f"  csd shape indicators={indicators} keys={key_sample} dates={len(getattr(data, 'Dates', []) or [])}\n")
    mapped = _field_map(data, codes)
    dates = mapped.pop("_dates", {}).get("_", [])
    rows: list[tuple] = []
    for code in codes:
        series = mapped.get(code)
        if not series:
            continue
        for index, raw_day in enumerate(dates):
            nav_day = _norm_date(raw_day)
            if nav_day is None:
                continue
            values = {}
            for field, column in FIELD_COLUMNS.items():
                points = series.get(field) or series.get(field.upper()) or []
                values[column] = _nav_value(points[index] if index < len(points) else None)
            if all(values[column] is None for column in FIELD_COLUMNS.values()):
                continue
            rows.append((
                code,
                nav_day,
                values["unit_nav"],
                values["accumulated_nav"],
                values["rehabilitation_nav"],
            ))
    return rows


def upsert_nav(conn, rows: list[tuple]) -> int:
    if not rows:
        return 0
    from psycopg2.extras import execute_values

    sql = """
        INSERT INTO public_enhanced_index_nav (
            choice_code, nav_date, unit_nav, accumulated_nav, rehabilitation_nav, source
        ) VALUES %s
        ON CONFLICT (choice_code, nav_date) DO UPDATE SET
            unit_nav = EXCLUDED.unit_nav,
            accumulated_nav = EXCLUDED.accumulated_nav,
            rehabilitation_nav = EXCLUDED.rehabilitation_nav,
            source = EXCLUDED.source,
            fetched_at = NOW()
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows, template="(%s,%s,%s,%s,%s,'emquant')", page_size=2000)
    conn.commit()
    return len(rows)


def mark_progress(conn, codes: list[str], through: date, error: str | None = None) -> None:
    """Checkpoint shares after a window.

    Rows that landed are checkpointed at MAX(nav_date). That stays behind the
    requested end when Choice has not published it yet, so the next run retries
    the gap. The in-memory cursor still advances to `through` so this process
    does not immediately ask for the same unpublished day again.
    """
    with conn.cursor() as cur:
        if error:
            cur.execute(
                """
                UPDATE public_enhanced_index_share
                SET nav_error = %s, nav_fetched_at = NOW(), updated_at = NOW()
                WHERE choice_code = ANY(%s)
                """,
                (error[:500], codes),
            )
        else:
            cur.execute(
                """
                UPDATE public_enhanced_index_share AS s
                SET nav_fetched_through = n.mx,
                    nav_error = NULL,
                    nav_fetched_at = NOW(),
                    nav_start_date = n.mn,
                    nav_end_date = n.mx,
                    nav_row_count = n.n,
                    updated_at = NOW()
                FROM (
                    SELECT choice_code,
                           MIN(nav_date) AS mn,
                           MAX(nav_date) AS mx,
                           COUNT(*)::int AS n
                    FROM public_enhanced_index_nav
                    WHERE choice_code = ANY(%s)
                    GROUP BY choice_code
                ) AS n
                WHERE s.choice_code = n.choice_code
                  AND s.choice_code = ANY(%s)
                """,
                (codes, codes),
            )
            cur.execute(
                """
                UPDATE public_enhanced_index_share
                SET nav_fetched_through = %s,
                    nav_error = COALESCE(nav_error, 'no_nav'),
                    nav_fetched_at = NOW(),
                    updated_at = NOW()
                WHERE choice_code = ANY(%s)
                  AND nav_row_count IS NULL
                """,
                (through, codes),
            )
    conn.commit()


def login_choice():
    username = os.environ.get("EMQ_USERNAME", "")
    password = os.environ.get("EMQ_PASSWORD", "")
    if not username or not password:
        raise SystemExit("Missing EMQ_USERNAME/EMQ_PASSWORD")
    try:
        from EmQuantAPI import c  # type: ignore
    except ImportError as exc:
        raise SystemExit(f"EmQuantAPI import failed: {exc}") from exc
    last = None
    for force in (0, 1):
        options = f"UserName={username},PassWord={password},TestLatency=0,ForceLogin={force}"
        result = c.start(options)
        if getattr(result, "ErrorCode", 1) == 0:
            return c
        last = getattr(result, "ErrorMsg", "login failed")
        sys.stderr.write(f"Choice login ForceLogin={force} failed: {last}\n")
    raise SystemExit(f"Choice login failed: {last}")


def _retag(rows: list[tuple], code: str) -> list[tuple]:
    return [(code, row[1], row[2], row[3], row[4]) for row in rows]


def fetch_one(c_api, code: str, start: date, end: date) -> list[tuple]:
    """Fetch one share. Choice rejects some 场内 LOF suffixes; NAV for those is on .OF."""
    try:
        return fetch_batch(c_api, [code], start, end)
    except Exception as exc:
        if "10003008" not in str(exc):
            raise
        if not (code.endswith(".SH") or code.endswith(".SZ")):
            raise
        alt = code[:-3] + ".OF"
        sys.stderr.write(f"  {code} is not a Choice NAV ticker, using {alt}\n")
        return _retag(fetch_batch(c_api, [alt], start, end), code)


def fetch_batch(c_api, codes: list[str], start: date, end: date) -> list[tuple]:
    last_error: Exception | None = None
    for attempt in (1, 2):
        try:
            data = c_api.csd(
                ",".join(codes),
                CSD_FIELDS,
                start.isoformat(),
                end.isoformat(),
                CSD_OPTS,
            )
            return parse_nav(data, codes)
        except Exception as exc:
            last_error = exc
            if "10000013" in str(exc) and attempt == 1:
                time.sleep(2)
                continue
            raise
    if last_error:
        raise last_error
    return []


def run_fetch(conn, c_api, shares: list[Share], end: date) -> dict:
    failed: set[str] = set()
    inserted = 0
    calls = 0
    while True:
        groups: dict[tuple[date, date], list[Share]] = defaultdict(list)
        for share in shares:
            if share.choice_code in failed:
                continue
            window = next_window(share, end)
            if window is None:
                continue
            request_start, window_end, _grid = window
            groups[(request_start, window_end)].append(share)
        if not groups:
            break
        # Wider windows first so a code's checkpoint moves forward in order.
        # request_start differs inside a grid year, so regroup by window_end
        # and pull from the earliest start in that chunk.
        by_end: dict[date, list[tuple[date, Share]]] = defaultdict(list)
        for (request_start, window_end), members in groups.items():
            for share in members:
                by_end[window_end].append((request_start, share))

        for window_end in sorted(by_end):
            members = by_end[window_end]
            members.sort(key=lambda item: (item[0], item[1].choice_code))
            index = 0
            while index < len(members):
                chunk = members[index:index + BATCH_SIZE]
                index += BATCH_SIZE
                start = min(item[0] for item in chunk)
                codes = [item[1].choice_code for item in chunk]
                calls += 1
                sys.stderr.write(
                    f"[{calls}] {start} → {window_end}  {len(codes)} codes  {codes[0]}…\n"
                )
                sys.stderr.flush()
                try:
                    rows = fetch_batch(c_api, codes, start, window_end)
                    if not rows and (window_end - start).days > 14:
                        raise RuntimeError("empty nav batch")
                except Exception as exc:
                    message = str(exc)
                    if _is_quota(message):
                        sys.stderr.write(f"Choice quota hit: {message}\n")
                        return {"calls": calls, "rows": inserted, "failed": len(failed), "quota": True}
                    sys.stderr.write(f"  batch failed ({message}); retrying one by one\n")
                    ok_codes: list[str] = []
                    for code in codes:
                        calls += 1
                        try:
                            one_rows = fetch_one(c_api, code, start, window_end)
                            inserted += upsert_nav(conn, one_rows)
                            ok_codes.append(code)
                            share = next(item[1] for item in chunk if item[1].choice_code == code)
                            share.fetched_through = window_end
                        except Exception as single_exc:
                            single_message = str(single_exc)
                            if _is_quota(single_message):
                                sys.stderr.write(f"Choice quota hit: {single_message}\n")
                                if ok_codes:
                                    mark_progress(conn, ok_codes, window_end)
                                return {"calls": calls, "rows": inserted, "failed": len(failed), "quota": True}
                            failed.add(code)
                            mark_progress(conn, [code], window_end, error=single_message)
                            sys.stderr.write(f"  {code} failed: {single_message}\n")
                    if ok_codes:
                        mark_progress(conn, ok_codes, window_end)
                    continue
                inserted += upsert_nav(conn, rows)
                for _start, share in chunk:
                    share.fetched_through = window_end
                mark_progress(conn, codes, window_end)
                sys.stderr.write(f"  upserted {len(rows)} nav rows\n")
                time.sleep(0.2)
    return {"calls": calls, "rows": inserted, "failed": len(failed), "quota": False}


def parse_args(argv: list[str]) -> dict:
    out = {
        "csv": DEFAULT_CSV,
        "end": date.today(),
        "codes": None,
        "universe_only": False,
        "force": False,
    }
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--universe-only":
            out["universe_only"] = True
        elif arg == "--force":
            out["force"] = True
        elif arg == "--csv" and index + 1 < len(argv):
            index += 1
            out["csv"] = Path(argv[index])
        elif arg == "--end" and index + 1 < len(argv):
            index += 1
            parsed = _parse_date(argv[index])
            if parsed is None:
                raise SystemExit(f"bad --end {argv[index]}")
            out["end"] = parsed
        elif arg == "--codes" and index + 1 < len(argv):
            index += 1
            out["codes"] = {part.strip() for part in argv[index].split(",") if part.strip()}
        else:
            raise SystemExit(f"unknown argument: {arg}")
        index += 1
    return out


def main() -> None:
    _configure_stdio()
    _load_env()
    args = parse_args(sys.argv[1:])
    csv_path: Path = args["csv"]
    if not csv_path.is_file():
        raise SystemExit(f"universe csv not found: {csv_path}")
    shares = load_shares(csv_path)
    if args["codes"]:
        shares = [row for row in shares if row.choice_code in args["codes"]]
        missing = args["codes"] - {row.choice_code for row in shares}
        if missing:
            raise SystemExit(f"codes not in universe csv: {', '.join(sorted(missing))}")
    conn = connect()
    try:
        ensure_schema(conn)
        upsert_shares(conn, shares)
        sys.stderr.write(f"universe upserted: {len(shares)} share classes\n")
        if args["universe_only"]:
            print(json.dumps({"shares": len(shares), "universe_only": True}))
            return
        load_checkpoints(conn, shares)
        if args["force"]:
            for row in shares:
                row.fetched_through = None
        pending = [
            row for row in shares
            if row.fetched_through is None or row.fetched_through < args["end"]
        ]
        sys.stderr.write(f"nav pending: {len(pending)} / {len(shares)} through {args['end']}\n")
        summary = {
            "end": args["end"].isoformat(),
            "shares": len(shares),
            "pending": len(pending),
            "calls": 0,
            "rows": 0,
            "failed": 0,
            "quota": False,
        }
        if pending:
            c_api = login_choice()
            try:
                summary.update(run_fetch(conn, c_api, shares, args["end"]))
            finally:
                try:
                    c_api.stop()
                except Exception:
                    pass
        summary["end"] = args["end"].isoformat()
        summary["shares"] = len(shares)
        summary["pending"] = len(pending)
        sys.stderr.write(
            f"done calls={summary['calls']} rows={summary['rows']} "
            f"failed={summary['failed']} quota={summary['quota']}\n"
        )
        print(json.dumps(summary))
        if summary["quota"]:
            sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
