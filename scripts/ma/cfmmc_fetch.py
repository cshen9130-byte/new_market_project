"""
Log in to CFMMC investor query (https://investorservice.cfmmc.com/) and download
the daily 客户交易结算日报 xls.

Login uses Playwright + OCR. History download is sequential HTTP, same as
C:/coding/auto_login/login.py: POST setParameter.do (switch date) then GET
the Excel URL. A file is kept only when its inner 交易日期 matches the
requested day — CFMMC otherwise returns the latest report for empty dates.

Credentials come from env CFMMC_USER / CFMMC_PASSWORD (never argv).
Prints a single JSON object to stdout; logs go to stderr.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import unquote

def _missing_dep_error(package: str) -> None:
    exe = sys.executable
    hint = (
        f"{exe} -m pip install -r scripts/ma/requirements-cfmmc.txt"
        f" && {exe} -m playwright install chromium"
    )
    if sys.platform.startswith("linux"):
        hint += f" && {exe} -m playwright install-deps chromium"
    sys.stdout.write(
        json.dumps(
            {
                "ok": False,
                "error": f"未安装 {package}（当前 Python: {exe}）。请在服务器项目目录执行：{hint}",
            },
            ensure_ascii=False,
        )
        + "\n"
    )
    sys.stdout.flush()
    raise SystemExit(1)


try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError:
    _missing_dep_error("Playwright")

try:
    import requests as req_lib
except ModuleNotFoundError:
    _missing_dep_error("requests")

LOGIN_URL = "https://investorservice.cfmmc.com/"
BASE_URL = "https://investorservice.cfmmc.com"
SET_PARAM_URL = BASE_URL + "/customer/setParameter.do"
EXCEL_DAILY_URL = BASE_URL + "/customer/setupViewCustomerDetailFromCompanyWithExcel.do"
TRADE_DATE_LIST_URL = BASE_URL + "/script/tradeDateList.js"
MAX_CAPTCHA_TRIES = 8
# Used only when --history is not set. Full history walks back to the first
# settlement day CFMMC actually returns for that login.
AVAILABLE_DAYS_BACK = 65
# Daily auto-fetch: catch up a short gap (weekend / missed run), never the full archive.
INCREMENTAL_DAYS_BACK = 10
# Stop the history walk after this many trading days in a row have no settlement.
# That boundary is the account begin date (first day a matching 交易日期 exists).
INCEPTION_MISS_LIMIT = 12
HISTORY_FLOOR = dt.date(2010, 1, 1)
_SHANGHAI = dt.timezone(dt.timedelta(hours=8))

_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": BASE_URL + "/",
}


def emit(payload: dict, exit_code: int) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return exit_code


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def make_ocr():
    import ddddocr

    return ddddocr.DdddOcr(show_ad=False)


def recognize_captcha(ocr, image_bytes: bytes) -> str:
    text = ocr.classification(image_bytes)
    return re.sub(r"[^A-Za-z0-9]", "", str(text)).upper()


def page_error_text(page) -> str:
    loc = page.locator(".error-msg")
    if loc.count() == 0:
        return ""
    return (loc.first.inner_text() or "").strip()


def still_on_login(page) -> bool:
    return page.locator("form[name=loginForm] input[name=userID]").count() > 0


def safe_user_id(user_id: str) -> str:
    return re.sub(r"[^\w.-]+", "_", user_id).strip("_") or "account"


def fetch_disabled_dates() -> set[str]:
    """Non-trading dates (YYYY-MM-DD) published by CFMMC."""
    try:
        req = urllib.request.Request(TRADE_DATE_LIST_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            js_text = resp.read().decode("utf-8", errors="replace")
        dates = re.findall(r"'(\d{4}-\d{2}-\d{2})'", js_text)
        log(f"Fetched {len(dates)} non-trading dates from CFMMC.")
        return set(dates)
    except Exception as exc:  # noqa: BLE001
        log(f"Could not fetch tradeDateList.js ({exc}). Using weekends only.")
        return set()


def trading_days_in_range(start: dt.date, end: dt.date, disabled: set[str]) -> list[dt.date]:
    days: list[dt.date] = []
    cur = start
    while cur <= end:
        if cur.weekday() < 5 and cur.strftime("%Y-%m-%d") not in disabled:
            days.append(cur)
        cur += dt.timedelta(days=1)
    return days


def iter_account_dirs(dest_dir: Path) -> list[Path]:
    """Import root plus one book-id level (files may live in either)."""
    if not dest_dir.exists():
        return []
    out = [dest_dir]
    try:
        out.extend(p for p in dest_dir.iterdir() if p.is_dir())
    except OSError:
        pass
    return out


def official_fetch_path(dest_dir: Path, user_id: str, day: dt.date) -> Path | None:
    """Return this 资金账号's official fetch file for `day` if it exists."""
    uid = safe_user_id(user_id)
    date = day.strftime("%Y-%m-%d")
    names = (
        f"{uid}_{date}.xls",
        f"{uid}_{date}.xlsx",
        f"{uid}_{uid}_{date}.xls",
        f"{uid}_{uid}_{date}.xlsx",
    )
    for folder in iter_account_dirs(dest_dir):
        for name in names:
            p = folder / name
            if p.is_file() and p.stat().st_size > 0:
                return p
    return None


def downloaded_dates(dest_dir: Path, user_id: str) -> list[dt.date]:
    dates: list[dt.date] = []
    uid = safe_user_id(user_id)
    for folder in iter_account_dirs(dest_dir):
        try:
            files = folder.glob(f"{uid}_*.xls*")
        except OSError:
            continue
        for p in files:
            if p.name.startswith("~$") or not p.is_file():
                continue
            raw = official_name_date(user_id, p.name)
            if not raw:
                continue
            try:
                dates.append(dt.date.fromisoformat(raw))
            except ValueError:
                pass
    return dates


def last_downloaded_date(dest_dir: Path, user_id: str) -> dt.date | None:
    dates = downloaded_dates(dest_dir, user_id)
    return max(dates) if dates else None


def first_downloaded_date(dest_dir: Path, user_id: str) -> dt.date | None:
    dates = downloaded_dates(dest_dir, user_id)
    return min(dates) if dates else None


def previous_trading_day(day: dt.date, disabled: set[str]) -> dt.date:
    cur = day - dt.timedelta(days=1)
    for _ in range(40):
        if cur.weekday() < 5 and cur.isoformat() not in disabled:
            return cur
        cur -= dt.timedelta(days=1)
    return cur


def on_or_before_trading_day(day: dt.date, disabled: set[str]) -> dt.date:
    if day.weekday() < 5 and day.isoformat() not in disabled:
        return day
    return previous_trading_day(day, disabled)


def shanghai_today() -> dt.date:
    return dt.datetime.now(_SHANGHAI).date()


def parse_iso_date(raw: str | None) -> dt.date | None:
    if not raw:
        return None
    try:
        return dt.date.fromisoformat(raw.strip()[:10])
    except ValueError:
        return None


def normalize_trade_date(value: object, datemode: int = 0) -> str | None:
    if isinstance(value, float):
        try:
            import xlrd

            y, m, d = xlrd.xldate_as_tuple(value, datemode)[:3]
            return f"{y:04d}-{m:02d}-{d:02d}"
        except Exception:
            return None
    text = str(value or "").strip().replace("/", "-").split(" ")[0]
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if not m:
        return None
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def extract_xls_trade_date(path: Path) -> str | None:
    """Read 交易日期 from the first sheet of a 客户交易结算日报 xls."""
    try:
        import xlrd
    except ModuleNotFoundError:
        return None
    try:
        wb = xlrd.open_workbook(str(path), formatting_info=False)
        sh = wb.sheet_by_index(0)
    except Exception:
        return None
    for r in range(min(sh.nrows, 25)):
        for c in range(min(sh.ncols, 12)):
            label = str(sh.cell_value(r, c) or "").strip()
            if "交易日期" not in label:
                continue
            for dc in range(c + 1, min(sh.ncols, c + 4)):
                got = normalize_trade_date(sh.cell_value(r, dc), wb.datemode)
                if got:
                    return got
    return None


def official_name_date(user_id: str, name: str) -> str | None:
    uid = safe_user_id(user_id)
    m = re.match(
        rf"^{re.escape(uid)}(?:_{re.escape(uid)})?_(\d{{4}}-\d{{2}}-\d{{2}})\.(xls|xlsx|xlsm)$",
        name,
        re.IGNORECASE,
    )
    return m.group(1) if m else None


def purge_mismatched_official_files(dest_dir: Path, user_id: str) -> int:
    """Delete official-named files whose inner 交易日期 does not match the filename."""
    uid = safe_user_id(user_id)
    removed = 0
    for folder in iter_account_dirs(dest_dir):
        try:
            files = folder.glob(f"{uid}_*.xls*")
        except OSError:
            continue
        for p in files:
            if p.name.startswith("~$"):
                continue
            want = official_name_date(user_id, p.name)
            if not want:
                continue
            got = extract_xls_trade_date(p)
            if got and got != want:
                log(f"  remove mismatch {p.name} (inside {got}, name {want})")
                p.unlink(missing_ok=True)
                removed += 1
    return removed


def already_downloaded(dest_dir: Path, user_id: str, day: dt.date) -> bool:
    """Skip only when this 资金账号 already has a file whose inner date matches."""
    p = official_fetch_path(dest_dir, user_id, day)
    if p is None:
        return False
    want = day.strftime("%Y-%m-%d")
    got = extract_xls_trade_date(p)
    if got is None:
        return True
    if got == want:
        return True
    log(f"  replace mismatch {p.name} (inside {got})")
    p.unlink(missing_ok=True)
    return False


def extract_struts_token(html: str) -> str | None:
    m = re.search(
        r'<input[^>]+name="org\.apache\.struts\.taglib\.html\.TOKEN"[^>]+value="([^"]+)"',
        html,
        re.IGNORECASE,
    )
    return m.group(1) if m else None


def build_http_session(playwright_page) -> req_lib.Session:
    ss = req_lib.Session()
    ss.headers.update(_HTTP_HEADERS)
    for ck in playwright_page.context.cookies():
        ss.cookies.set(
            ck["name"],
            ck["value"],
            domain=ck.get("domain") or "investorservice.cfmmc.com",
            path=ck.get("path") or "/",
        )
    return ss


def is_xls_bytes(content: bytes, content_type: str) -> bool:
    if not content or len(content) < 8:
        return False
    lowered = content_type.lower()
    if "text/html" in lowered or "text/plain" in lowered:
        return False
    head = content[:16]
    if head.startswith(b"<!DOCTYPE") or head.startswith(b"<html") or head.startswith(b"<HTML"):
        return False
    # OLE Compound File (.xls) or ZIP (.xlsx)
    return head.startswith(b"\xd0\xcf\x11\xe0") or head.startswith(b"PK")


def save_excel_response(dest_dir: Path, user_id: str, date_str: str, excel_resp: req_lib.Response) -> Path | None:
    content_type = excel_resp.headers.get("Content-Type", "")
    content = excel_resp.content
    if not is_xls_bytes(content, content_type):
        return None
    cd = excel_resp.headers.get("Content-Disposition", "")
    fname_m = re.search(r"filename\*?=['\"]?(?:UTF-8'')?([^'\";\r\n]+)", cd, re.IGNORECASE)
    suffix = ".xls"
    if fname_m:
        fname = unquote(fname_m.group(1).strip().strip("\"'"))
        suffix = Path(fname).suffix or ".xls"
    target = dest_dir / f"{safe_user_id(user_id)}_{date_str}{suffix}"
    dest_dir.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


def session_from_cookies(cookies: list[dict]) -> req_lib.Session:
    ss = req_lib.Session()
    ss.headers.update(_HTTP_HEADERS)
    for ck in cookies:
        ss.cookies.set(
            ck["name"],
            ck["value"],
            domain=ck.get("domain") or "investorservice.cfmmc.com",
            path=ck.get("path") or "/",
        )
    return ss


def switch_trade_date(ss: req_lib.Session, date_str: str, token: str | None) -> str | None:
    """POST setParameter.do so the session's active settlement date changes."""
    post_data: dict[str, str] = {"tradeDate": date_str, "byType": "trade"}
    if token:
        post_data["org.apache.struts.taglib.html.TOKEN"] = token
    resp = ss.post(SET_PARAM_URL, data=post_data, timeout=20)
    return extract_struts_token(resp.text) or token


class DayFetch:
    """One settlement-day attempt. mismatch means CFMMC returned another day's report."""

    def __init__(self, status: str, path: Path | None = None, detail: str = "") -> None:
        self.status = status
        self.path = path
        self.detail = detail


def download_settlement_day(
    ss: req_lib.Session,
    token: str | None,
    dest_dir: Path,
    user_id: str,
    day: dt.date,
) -> tuple[DayFetch, str | None]:
    date_str = day.strftime("%Y-%m-%d")
    if already_downloaded(dest_dir, user_id, day):
        return DayFetch("skipped"), token
    try:
        token = switch_trade_date(ss, date_str, token)
        resp = ss.get(EXCEL_DAILY_URL, timeout=30)
    except Exception as exc:  # noqa: BLE001
        return DayFetch("error", detail=str(exc)), token
    path = save_excel_response(dest_dir, user_id, date_str, resp)
    if path is None:
        return DayFetch("empty"), token
    got = extract_xls_trade_date(path)
    if got and got != date_str:
        path.unlink(missing_ok=True)
        return DayFetch("mismatch", detail=got), token
    return DayFetch("saved", path), token


def download_settlement_day_retry(
    ss: req_lib.Session,
    token: str | None,
    dest_dir: Path,
    user_id: str,
    day: dt.date,
) -> tuple[DayFetch, str | None]:
    """Retry transport/HTML failures. A date mismatch is a real empty day, not a retry."""
    last = DayFetch("error", detail="no attempt")
    for attempt in range(1, 4):
        last, token = download_settlement_day(ss, token, dest_dir, user_id, day)
        if last.status in ("saved", "skipped", "mismatch"):
            return last, token
        log(f"  {day.isoformat()} {last.status} ({last.detail or 'no xls'}), retry {attempt}/3")
        time.sleep(1.5)
    return last, token


def plan_fetch_days(
    dest_dir: Path,
    user_id: str,
    days_back: int,
    latest_only: bool,
    incremental: bool,
    since: str | None,
) -> tuple[dt.date, dt.date, list[dt.date], list[dt.date]]:
    today = shanghai_today()
    # Include today: 监控中心 often publishes 当日结算 shortly after close
    # (the 17:00 job). If it is not ready yet, inner 交易日期 will not match
    # and the file is discarded.
    end_date = today
    if incremental:
        last = last_downloaded_date(dest_dir, user_id)
        parsed = parse_iso_date(since)
        if last and parsed:
            last = max(last, parsed)
        elif parsed:
            last = parsed
        if last:
            start_date = last + dt.timedelta(days=1)
            log(f"Incremental after last local file {last.isoformat()}")
        else:
            start_date = today - dt.timedelta(days=max(1, min(days_back, INCREMENTAL_DAYS_BACK)))
            log(f"Incremental with no local files; look back to {start_date.isoformat()}")
    else:
        start_date = today - dt.timedelta(days=max(1, days_back))
    if start_date > end_date:
        start_date = end_date
    disabled = fetch_disabled_dates()
    days = trading_days_in_range(start_date, end_date, disabled)
    if latest_only and not incremental:
        days = days[-1:] if days else []
    pending = [d for d in days if not already_downloaded(dest_dir, user_id, d)]
    return start_date, end_date, days, pending


def download_all_dates(
    cookies: list[dict],
    user_id: str,
    dest_dir: Path,
    days_back: int,
    latest_only: bool,
    token: str | None = None,
    home_url: str | None = None,
    incremental: bool = False,
    since: str | None = None,
) -> tuple[list[Path], int, int]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    purged = purge_mismatched_official_files(dest_dir, user_id)
    if purged:
        log(f"Removed {purged} official files whose inner 交易日期 did not match the filename.")

    start_date, end_date, days, pending = plan_fetch_days(
        dest_dir, user_id, days_back, latest_only, incremental, since,
    )
    skipped = len(days) - len(pending)
    log(f"Trading days: {len(days)}  pending={len(pending)}  skipped={skipped}  ({start_date} → {end_date})")
    if not pending:
        return [], skipped, purged

    ss = session_from_cookies(cookies)
    if not token and home_url:
        try:
            token = extract_struts_token(ss.get(home_url, timeout=15).text)
        except Exception as exc:  # noqa: BLE001
            log(f"Could not refresh Struts token ({exc}).")
    log(f"Excel mode=setParameter  sequential  token={'yes' if token else 'no'}")

    saved: list[Path] = []
    discarded = 0
    for i, day in enumerate(pending, 1):
        date_str = day.strftime("%Y-%m-%d")
        fetched, token = download_settlement_day(ss, token, dest_dir, user_id, day)
        if fetched.status == "saved" and fetched.path is not None:
            log(f"  [{i:>2}/{len(pending)}] {date_str}  saved {fetched.path.name} ({fetched.path.stat().st_size:,} B)")
            saved.append(fetched.path)
            continue
        if fetched.status == "mismatch":
            log(f"  [{i:>2}/{len(pending)}] {date_str}  discarded (inside {fetched.detail})")
        elif fetched.status == "error":
            log(f"  [{i:>2}/{len(pending)}] {date_str}  error: {fetched.detail}")
        elif fetched.status != "skipped":
            log(f"  [{i:>2}/{len(pending)}] {date_str}  no xls")
        discarded += 1
    return saved, skipped, discarded + purged


def excel_session_alive(ss: req_lib.Session, token: str | None, day: dt.date) -> tuple[bool, str | None]:
    """Hit the excel URL for a day we expect to exist. HTML means the login died."""
    date_str = day.strftime("%Y-%m-%d")
    try:
        token = switch_trade_date(ss, date_str, token)
        resp = ss.get(EXCEL_DAILY_URL, timeout=30)
    except Exception as exc:  # noqa: BLE001
        log(f"  session probe {date_str} error: {exc}")
        return False, token
    return is_xls_bytes(resp.content, resp.headers.get("Content-Type", "")), token


def download_from_account_begin(
    cookies: list[dict],
    user_id: str,
    password: str,
    dest_dir: Path,
    token: str | None,
    home_url: str | None,
    headless: bool,
) -> tuple[list[Path], int, int]:
    """Download from the first day this login has a settlement report through today.

    Walks backward from the earliest local file (or today). A run of days with
    no matching 交易日期 is the account begin boundary. An empty HTTP body is
    either that same gap or a dead session; a known later day is probed so a
    dropped login is renewed instead of cutting history short.
    """
    disabled = fetch_disabled_dates()
    today = shanghai_today()
    first = first_downloaded_date(dest_dir, user_id)
    if first:
        cursor = previous_trading_day(first, disabled)
        log(f"History: walk back from the day before earliest local file {first.isoformat()}")
    else:
        cursor = on_or_before_trading_day(today, disabled)
        log(f"History: no local files; walk back from {cursor.isoformat()}")

    ss = session_from_cookies(cookies)
    if not token and home_url:
        try:
            token = extract_struts_token(ss.get(home_url, timeout=15).text)
        except Exception as exc:  # noqa: BLE001
            log(f"Could not refresh Struts token ({exc}).")
    log(f"Excel mode=setParameter  from account begin  token={'yes' if token else 'no'}")

    saved: list[Path] = []
    discarded = 0
    misses = 0
    relogins = 0

    def renew_if_session_dead(when: dt.date) -> bool:
        """Return True when the session was dead and has been replaced. Caller retries `when`."""
        nonlocal ss, token, cookies, relogins
        known = last_downloaded_date(dest_dir, user_id) or on_or_before_trading_day(today, disabled)
        alive, token = excel_session_alive(ss, token, known)
        if alive:
            return False
        relogins += 1
        if relogins > 4:
            raise RuntimeError(f"{when.isoformat()} 登录已失效，重新登录多次仍无法下载")
        log(f"  {when.isoformat()} session expired; logging in again ({relogins}/4)")
        cookies, token, _home = capture_login(user_id, password, headless)
        ss = session_from_cookies(cookies)
        return True

    while cursor >= HISTORY_FLOOR and misses < INCEPTION_MISS_LIMIT:
        fetched, token = download_settlement_day_retry(ss, token, dest_dir, user_id, cursor)
        date_str = cursor.isoformat()
        if fetched.status == "saved" and fetched.path is not None:
            misses = 0
            saved.append(fetched.path)
            log(f"  {date_str}  saved {fetched.path.name} ({fetched.path.stat().st_size:,} B)")
        elif fetched.status == "skipped":
            misses = 0
        elif fetched.status == "mismatch":
            misses += 1
            discarded += 1
            log(
                f"  {date_str}  no settlement ({misses}/{INCEPTION_MISS_LIMIT}, inside {fetched.detail})"
            )
        elif renew_if_session_dead(cursor):
            continue
        else:
            misses += 1
            discarded += 1
            log(f"  {date_str}  no xls ({misses}/{INCEPTION_MISS_LIMIT})")
        cursor = previous_trading_day(cursor, disabled)
        time.sleep(0.2)

    begin = first_downloaded_date(dest_dir, user_id)
    if misses >= INCEPTION_MISS_LIMIT:
        log(f"Account begin date {begin.isoformat() if begin else 'unknown'} (no earlier settlement).")
    elif cursor < HISTORY_FLOOR:
        log(f"Reached history floor {HISTORY_FLOOR.isoformat()}; earliest file {begin}.")

    if begin:
        pending = [
            d for d in trading_days_in_range(begin, today, disabled)
            if not already_downloaded(dest_dir, user_id, d)
        ]
        log(f"Fill {begin.isoformat()} → {today.isoformat()}: pending={len(pending)}")
        idx = 0
        while idx < len(pending):
            day = pending[idx]
            fetched, token = download_settlement_day_retry(ss, token, dest_dir, user_id, day)
            date_str = day.isoformat()
            label = f"[{idx + 1}/{len(pending)}]"
            if fetched.status == "saved" and fetched.path is not None:
                saved.append(fetched.path)
                log(f"  {label} {date_str}  saved {fetched.path.name}")
            elif fetched.status == "mismatch":
                discarded += 1
                log(f"  {label} {date_str}  discarded (inside {fetched.detail})")
            elif fetched.status != "skipped":
                if renew_if_session_dead(day):
                    continue
                discarded += 1
                log(f"  {label} {date_str}  no xls")
            idx += 1
            time.sleep(0.2)

    begin = first_downloaded_date(dest_dir, user_id)
    span = trading_days_in_range(begin, today, disabled) if begin else []
    already = sum(1 for d in span if already_downloaded(dest_dir, user_id, d))
    skipped = max(0, already - len(saved))
    log(f"History done. begin={begin.isoformat() if begin else 'none'}  new={len(saved)}  already={skipped}")
    return saved, skipped, discarded


def launch_browser(playwright, headless: bool):
    channel = os.environ.get("CFMMC_BROWSER_CHANNEL", "").strip()
    attempts: list[dict] = []
    if channel:
        attempts.append({"headless": headless, "channel": channel})
    elif sys.platform == "win32":
        attempts.append({"headless": headless, "channel": "msedge"})
    attempts.append({"headless": headless})
    last_err: Exception | None = None
    for kwargs in attempts:
        try:
            log(f"Launching chromium {kwargs}")
            return playwright.chromium.launch(**kwargs)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            log(f"Launch failed: {exc}")
    raise last_err or RuntimeError("Could not launch browser")


def login(page, user_id: str, password: str) -> None:
    ocr = make_ocr()
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("input[name=userID]", timeout=30000)

    for attempt in range(1, MAX_CAPTCHA_TRIES + 1):
        page.fill("input[name=userID]", user_id)
        page.fill("input[name=password]", password)

        captcha_img = page.locator("#imgVeriCode")
        captcha_img.wait_for(state="visible", timeout=15000)
        time.sleep(0.2)
        image_bytes = captcha_img.screenshot()
        code = recognize_captcha(ocr, image_bytes)
        log(f"[try {attempt}/{MAX_CAPTCHA_TRIES}] captcha OCR: {code!r}")

        if len(code) != 6:
            log("OCR not 6 chars, refreshing captcha")
            page.locator(".login-form-refresh-captcha-btn").click()
            time.sleep(0.4)
            continue

        page.fill("input[name=vericode]", code)
        page.click("input[type=submit]")
        page.wait_for_load_state("domcontentloaded", timeout=30000)
        time.sleep(0.4)

        if not still_on_login(page):
            log("Login succeeded.")
            return

        err = page_error_text(page)
        log(f"Still on login page. {err or 'No error text.'}")
        lowered = err.lower()
        if "超过" in err or "3 times" in lowered or "分钟后再试" in err or "try again after" in lowered:
            raise RuntimeError(err)
        # A wrong captcha is sometimes reported as a bad password. Stop before the
        # site's third strike, which locks the account for about an hour.
        if "验证码" in err or "verif" in lowered or not err or "password" in lowered or "密码" in err:
            if "password" in lowered or "密码" in err:
                if attempt >= 2:
                    raise RuntimeError(err)
            page.locator(".login-form-refresh-captcha-btn").click()
            time.sleep(0.4)
            continue
        raise RuntimeError(err or "登录被拒绝（非验证码原因）")

    raise RuntimeError("验证码识别失败，已重试多次")


def capture_login(user_id: str, password: str, headless: bool) -> tuple[list[dict], str | None, str]:
    cookies: list[dict] = []
    token: str | None = None
    home_url = LOGIN_URL
    with sync_playwright() as p:
        browser = launch_browser(p, headless)
        try:
            context = browser.new_context(locale="zh-CN", accept_downloads=True)
            page = context.new_page()
            login(page, user_id, password)
            cookies = page.context.cookies()
            home_url = page.url or LOGIN_URL
            token = extract_struts_token(page.content())
            log("Login cookies captured; closing browser before HTTP download.")
        finally:
            try:
                browser.close()
            except PlaywrightError:
                pass
    return cookies, token, home_url


def fetch_reports(
    user_id: str,
    password: str,
    dest_dir: Path,
    headless: bool,
    history: bool,
    days_back: int,
    incremental: bool = False,
    since: str | None = None,
) -> tuple[list[Path], int, int]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    purged = purge_mismatched_official_files(dest_dir, user_id)
    if purged:
        log(f"Removed {purged} official files whose inner 交易日期 did not match the filename.")

    if history:
        cookies, token, home_url = capture_login(user_id, password, headless)
        saved, skipped, discarded = download_from_account_begin(
            cookies, user_id, password, dest_dir, token, home_url, headless,
        )
        return saved, skipped, discarded + purged

    latest_only = not incremental
    start_date, end_date, days, pending = plan_fetch_days(
        dest_dir, user_id, days_back, latest_only, incremental, since,
    )
    skipped = len(days) - len(pending)
    log(f"Trading days: {len(days)}  pending={len(pending)}  skipped={skipped}  ({start_date} → {end_date})")
    if not pending:
        log("Nothing new to download; skipping login.")
        return [], skipped, purged

    cookies, token, home_url = capture_login(user_id, password, headless)
    return download_all_dates(
        cookies,
        user_id,
        dest_dir,
        days_back=days_back,
        latest_only=latest_only,
        incremental=incremental,
        since=since,
        token=token,
        home_url=home_url,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch CFMMC daily settlement xls")
    parser.add_argument("--out-dir", required=True, help="Directory to save the xls")
    parser.add_argument("--headed", action="store_true", help="Show the browser window")
    parser.add_argument(
        "--history",
        action="store_true",
        help="Download from this account's first settlement day through today",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Download only days after the latest local file (daily auto-fetch)",
    )
    parser.add_argument("--since", metavar="YYYY-MM-DD", help="Inclusive start date for incremental fetch")
    parser.add_argument("--days", type=int, default=AVAILABLE_DAYS_BACK, help="Calendar days to walk back")
    args = parser.parse_args()

    user_id = (os.environ.get("CFMMC_USER") or "").strip()
    password = (os.environ.get("CFMMC_PASSWORD") or "").strip()
    if not user_id or not password:
        return emit({"ok": False, "error": "缺少 CFMMC_USER / CFMMC_PASSWORD"}, 1)

    dest_dir = Path(args.out_dir)
    incremental = bool(args.incremental or args.since) and not args.history
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        paths, skipped, discarded = fetch_reports(
            user_id,
            password,
            dest_dir,
            headless=not args.headed,
            history=args.history,
            days_back=max(1, args.days),
            incremental=incremental,
            since=args.since,
        )
        if not paths and skipped == 0 and discarded == 0 and not incremental:
            return emit({"ok": False, "error": "未下载到结算日报（可能该区间没有数据）"}, 1)
        last = paths[-1] if paths else None
        today = shanghai_today()
        begin = first_downloaded_date(dest_dir, user_id)
        have_today = already_downloaded(dest_dir, user_id, today)
        if not have_today and today.weekday() < 5:
            log(f"Today {today.isoformat()} is not on disk yet (settlement may still be unpublished, or download was discarded).")
        return emit(
            {
                "ok": True,
                "file": str(last) if last else "",
                "filename": last.name if last else "",
                "files": [p.name for p in paths],
                "downloaded": len(paths),
                "skipped": skipped,
                "discarded": discarded,
                "beginDate": begin.isoformat() if begin else None,
                "haveToday": have_today,
                "today": today.isoformat(),
            },
            0,
        )
    except Exception as exc:  # noqa: BLE001
        return emit({"ok": False, "error": str(exc)}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
