#!/usr/bin/env python3
"""
fetch_ashare_daily_akshare.py
=============================
Fetch A-share daily OHLCV + amount + turnover via AkShare (free, no Choice quota).

Modes (ASHARE_AK_MODE env):
  spot  — latest session snapshot (East Money, falls back to Sina)
  hist  — per-stock history over a date range (East Money, falls back to Sina)

East Money (`stock_zh_a_spot_em` / `stock_zh_a_hist`) is frequently blocked;
Sina (`stock_zh_a_spot` / `stock_zh_a_daily`) is the reliable fallback and still
provides amount + turnover needed for crowding charts.

Usage
-----
  python fetch_ashare_daily_akshare.py 2026-07-10 2026-07-13
  ASHARE_AK_MODE=spot python fetch_ashare_daily_akshare.py 2026-07-13 2026-07-13

Output JSON: { start_date, end_date, mode, count, data: [{date, ts_code, open, ...}] }
"""

from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
from datetime import datetime, timedelta
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


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

    # Prevent AkShare/tqdm progress bars from filling subprocess stderr pipes
    # (capture_output deadlock → silent fetch failure in nightly_etl).
    os.environ.setdefault("TQDM_DISABLE", "1")


def _norm_date(s: str) -> str:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")


def _to_yyyymmdd(s: str) -> str:
    return s.replace("-", "")


def _to_ts_code(code: str) -> str:
    c = str(code).strip().lower()
    if c.startswith(("sh", "sz", "bj")) and len(c) >= 8:
        num = c[2:]
        ex = c[:2].upper()
        return f"{num}.{ex}"
    c = c.zfill(6)
    if c.startswith("92") or c.startswith(("83", "87", "43", "82", "88")):
        return f"{c}.BJ"
    if c.startswith("6"):
        return f"{c}.SH"
    return f"{c}.SZ"


def _to_sina_symbol(code: str) -> str:
    """600519 / 600519.SH → sh600519"""
    c = str(code).strip().lower()
    if c.startswith(("sh", "sz", "bj")) and len(c) >= 8:
        return c
    if "." in c:
        num, ex = c.split(".", 1)
        return f"{ex.lower()}{num.zfill(6)}"
    num = c.zfill(6)
    if num.startswith("92") or num.startswith(("83", "87", "43", "82", "88")):
        return f"bj{num}"
    if num.startswith("6"):
        return f"sh{num}"
    return f"sz{num}"


def _retry(fn, *, attempts: int = 4, base_sleep: float = 2.0):
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if i < attempts - 1:
                time.sleep(base_sleep * (i + 1))
    raise last_exc  # type: ignore[misc]


def _fval(row, *keys):
    for key in keys:
        try:
            v = row[key] if not isinstance(row, dict) else row.get(key)
        except Exception:
            continue
        if v is None or v == "" or v == "-":
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def _codes_from_spot_df(df) -> list[str]:
    code_col = df.columns[0]
    codes: list[str] = []
    for raw in df[code_col].tolist():
        s = str(raw).strip().lower()
        if s.startswith(("sh", "sz", "bj")) and len(s) >= 8:
            codes.append(s[2:].zfill(6))
        elif "." in s:
            codes.append(s.split(".", 1)[0].zfill(6))
        else:
            codes.append(s.zfill(6)[-6:])
    # Preserve order but drop empties/dupes
    seen: set[str] = set()
    out: list[str] = []
    for c in codes:
        if len(c) != 6 or c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out


def _fetch_universe() -> list[str]:
    """A-share code list for hist mode.

    East Money `stock_info_a_code_name` is frequently RemoteDisconnected on the
    production host; fall back to Sina spot codes (same universe, already proven
    reachable) so hist catch-up does not freeze stock-market charts for days.
    """
    import akshare as ak

    try:
        df = _retry(lambda: ak.stock_info_a_code_name(), attempts=2, base_sleep=1.5)
        codes = [str(c).zfill(6) for c in df["code"].tolist()]
        if len(codes) >= 3000:
            return codes
        sys.stderr.write(
            f"stock_info_a_code_name returned only {len(codes)} codes; falling back to sina spot\n"
        )
    except Exception as exc:
        sys.stderr.write(
            f"stock_info_a_code_name failed ({exc}); falling back to sina spot codes\n"
        )

    df = _retry(lambda: ak.stock_zh_a_spot(), attempts=3, base_sleep=2.0)
    codes = _codes_from_spot_df(df)
    if len(codes) < 3000:
        raise RuntimeError(f"sina spot universe too small: {len(codes)} codes")
    return codes


def _rows_from_spot_em(trade_date: str) -> list[dict]:
    import akshare as ak

    df = _retry(lambda: ak.stock_zh_a_spot_em(), attempts=2, base_sleep=1.5)
    code_col = "代码"
    for need in (code_col, "最新价", "今开", "最高", "最低", "成交量", "成交额", "换手率"):
        if need not in df.columns:
            raise ValueError(f"spot_em missing column {need}; got {list(df.columns)}")

    rows: list[dict] = []
    for _, r in df.iterrows():
        code = str(r[code_col]).strip().zfill(6)
        close_f = _fval(r, "最新价")
        if close_f is None or close_f <= 0:
            continue
        vol = _fval(r, "成交量")
        rows.append({
            "date": trade_date,
            "ts_code": _to_ts_code(code),
            "open": _fval(r, "今开"),
            "close": close_f,
            "high": _fval(r, "最高"),
            "low": _fval(r, "最低"),
            "volume": int(vol) if vol is not None else None,
            "amount": _fval(r, "成交额"),
            "turn": _fval(r, "换手率"),
            "source": "akshare_spot",
        })
    return rows


def _rows_from_spot_sina(trade_date: str) -> list[dict]:
    """Sina spot has amount but not turnover; turn left null (caller may use hist)."""
    import akshare as ak

    df = _retry(lambda: ak.stock_zh_a_spot(), attempts=3, base_sleep=2.0)
    # Columns: 代码, 名称, 最新价, ..., 今开, 最高, 最低, 成交量, 成交额, 时间戳
    code_col = df.columns[0]
    rows: list[dict] = []
    for _, r in df.iterrows():
        raw_code = str(r[code_col]).strip()
        close_f = _fval(r, "最新价")
        if close_f is None or close_f <= 0:
            continue
        vol = _fval(r, "成交量")
        rows.append({
            "date": trade_date,
            "ts_code": _to_ts_code(raw_code),
            "open": _fval(r, "今开", "开盘"),
            "close": close_f,
            "high": _fval(r, "最高"),
            "low": _fval(r, "最低"),
            "volume": int(vol) if vol is not None else None,
            "amount": _fval(r, "成交额"),
            "turn": _fval(r, "换手率"),  # usually absent on sina spot
            "source": "akshare_sina_spot",
        })
    return rows


def _rows_from_spot(trade_date: str) -> list[dict]:
    try:
        rows = _rows_from_spot_em(trade_date)
        if len(rows) >= 3000:
            return rows
        sys.stderr.write(
            f"akshare spot_em returned only {len(rows)} rows; trying sina daily hist\n"
        )
    except Exception as exc:
        sys.stderr.write(f"akshare spot_em failed ({exc}); trying sina daily hist\n")

    # Sina spot lacks turnover (needed for crowding %). Prefer single-day sina hist.
    try:
        return _fetch_hist_range(trade_date, trade_date, provider="sina")
    except Exception as exc:
        sys.stderr.write(
            f"sina daily hist failed ({exc}); using sina spot without turnover\n"
        )
        rows = _rows_from_spot_sina(trade_date)
        if len(rows) < 3000:
            raise RuntimeError(f"sina spot returned only {len(rows)} rows")
        return rows


def _rows_from_hist_em(code: str, start: str, end: str) -> list[dict]:
    import akshare as ak

    df = _retry(
        lambda: ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=_to_yyyymmdd(start),
            end_date=_to_yyyymmdd(end),
            adjust="",
        ),
        attempts=2,
        base_sleep=1.0,
    )
    if df is None or df.empty:
        return []

    rows: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get("日期", ""))[:10]
        if not d:
            continue
        close_f = _fval(r, "收盘")
        if close_f is None or close_f <= 0:
            continue
        vol = _fval(r, "成交量")
        rows.append({
            "date": d,
            "ts_code": _to_ts_code(code),
            "open": _fval(r, "开盘"),
            "close": close_f,
            "high": _fval(r, "最高"),
            "low": _fval(r, "最低"),
            "volume": int(vol) if vol is not None else None,
            "amount": _fval(r, "成交额"),
            "turn": _fval(r, "换手率"),
            "source": "akshare_hist",
        })
    return rows


def _rows_from_hist_sina(code: str, start: str, end: str) -> list[dict]:
    """Sina daily: turnover is a fraction (0.003); store as percent to match EM."""
    import akshare as ak

    symbol = _to_sina_symbol(code)
    df = _retry(
        lambda: ak.stock_zh_a_daily(
            symbol=symbol,
            start_date=_to_yyyymmdd(start),
            end_date=_to_yyyymmdd(end),
            adjust="",
        ),
        attempts=3,
        base_sleep=1.0,
    )
    if df is None or df.empty:
        return []

    rows: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get("date", ""))[:10]
        if not d:
            continue
        close_f = _fval(r, "close")
        if close_f is None or close_f <= 0:
            continue
        vol = _fval(r, "volume")
        turn_frac = _fval(r, "turnover")
        turn_pct = round(turn_frac * 100.0, 6) if turn_frac is not None else None
        rows.append({
            "date": d,
            "ts_code": _to_ts_code(code),
            "open": _fval(r, "open"),
            "close": close_f,
            "high": _fval(r, "high"),
            "low": _fval(r, "low"),
            "volume": int(vol) if vol is not None else None,
            "amount": _fval(r, "amount"),
            "turn": turn_pct,
            "source": "akshare_sina_daily",
        })
    return rows


def _rows_from_hist(code: str, start: str, end: str, *, provider: str) -> list[dict]:
    if provider == "sina":
        return _rows_from_hist_sina(code, start, end)
    try:
        rows = _rows_from_hist_em(code, start, end)
        if rows:
            return rows
    except Exception:
        pass
    return _rows_from_hist_sina(code, start, end)


def _fetch_hist_range(start: str, end: str, *, provider: str | None = None) -> list[dict]:
    codes = _fetch_universe()
    limit = int(os.environ.get("ASHARE_AK_CODE_LIMIT", "0"))
    if limit > 0:
        codes = codes[:limit]

    # Prefer Sina when East Money is known-blocked, or when explicitly requested.
    # Auto: try a probe on 000001; if EM fails, use sina for the whole run.
    if provider is None:
        provider = os.environ.get("ASHARE_AK_PROVIDER", "").strip().lower() or None
    if provider not in ("em", "sina"):
        try:
            probe = _rows_from_hist_em("000001", start, start)
            provider = "em" if probe else "sina"
        except Exception:
            provider = "sina"
            sys.stderr.write("akshare EM hist probe failed; using sina stock_zh_a_daily\n")

    # Sina/akshare pulls JS via mini_racer — concurrent workers segfault
    # (SIGSEGV in libmini_racer). Default to 1 for sina; EM can stay parallel.
    default_workers = "1" if provider == "sina" else "8"
    max_workers = int(os.environ.get("ASHARE_AK_MAX_WORKERS", default_workers))
    if provider == "sina" and max_workers > 1:
        sys.stderr.write(
            f"akshare hist(sina): clamping workers {max_workers} → 1 "
            f"(mini_racer is not thread-safe)\n"
        )
        max_workers = 1
    delay = float(os.environ.get("ASHARE_AK_DELAY", "0" if provider == "sina" else "0.05"))

    sys.stderr.write(
        f"akshare hist({provider}): {len(codes)} codes, {start} → {end}, workers={max_workers}\n"
    )
    all_rows: list[dict] = []
    done = 0
    errors = 0
    timed_out = 0
    task_timeout = float(os.environ.get("ASHARE_TASK_TIMEOUT", "25"))

    def task(code: str) -> list[dict]:
        if delay > 0:
            time.sleep(delay)
        return _rows_from_hist(code, start, end, provider=provider)

    def _note_progress() -> None:
        if done % 500 == 0 or done == len(codes):
            sys.stderr.write(
                f"  progress {done}/{len(codes)} codes, {len(all_rows)} rows, "
                f"errors={errors}, timeouts={timed_out}\n"
            )
            sys.stderr.flush()

    if max_workers <= 1:
        # Sequential path — required for sina/mini_racer stability.
        for code in codes:
            try:
                all_rows.extend(task(code))
            except Exception as exc:
                errors += 1
                if errors <= 5:
                    sys.stderr.write(f"  {code} failed: {exc}\n")
            done += 1
            _note_progress()
    else:
        # Submit in batches so we never hold thousands of pending futures.
        batch_size = max(max_workers * 8, 32)
        for batch_start in range(0, len(codes), batch_size):
            batch = codes[batch_start : batch_start + batch_size]
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = {pool.submit(task, code): code for code in batch}
                for fut in as_completed(futures):
                    code = futures[fut]
                    try:
                        all_rows.extend(fut.result(timeout=task_timeout))
                    except TimeoutError:
                        timed_out += 1
                        if timed_out <= 5:
                            sys.stderr.write(f"  {code} timed out after {task_timeout}s\n")
                    except Exception as exc:
                        errors += 1
                        if errors <= 5:
                            sys.stderr.write(f"  {code} failed: {exc}\n")
                    done += 1
                    _note_progress()

    sys.stderr.write(
        f"akshare hist({provider}) done: {len(all_rows)} rows, "
        f"{errors} errors, {timed_out} timeouts\n"
    )
    return all_rows


def main() -> None:
    _load_env()

    today = datetime.today().strftime("%Y-%m-%d")
    argv = sys.argv[1:]
    if len(argv) >= 2:
        start_date = _norm_date(argv[0])
        end_date = _norm_date(argv[1])
    else:
        end_date = today
        start_date = (datetime.today() - timedelta(days=7)).strftime("%Y-%m-%d")

    mode = os.environ.get("ASHARE_AK_MODE", "").strip().lower()
    if not mode:
        # Single-day incremental → spot; multi-day backfill → hist
        mode = "spot" if start_date == end_date else "hist"

    try:
        if mode == "spot":
            rows = _rows_from_spot(end_date)
        else:
            rows = _fetch_hist_range(start_date, end_date)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "mode": mode, "start_date": start_date, "end_date": end_date}))
        sys.exit(1)

    out = {
        "start_date": start_date,
        "end_date": end_date,
        "mode": mode,
        "count": len(rows),
        "data": rows,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
