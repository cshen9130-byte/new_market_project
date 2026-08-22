"""
Log in to CFMMC investor query (https://investorservice.cfmmc.com/) and download
the daily 客户交易结算日报 xls.

Credentials come from env CFMMC_USER / CFMMC_PASSWORD (never argv).
Prints a single JSON object to stdout; logs go to stderr.

Adapted from D:/coding/auto_login/login.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError:
    sys.stdout.write(
        json.dumps(
            {
                "ok": False,
                "error": "未安装 Playwright。请在项目目录执行：.venv\\Scripts\\python.exe -m pip install -r scripts/ma/requirements-cfmmc.txt && .venv\\Scripts\\python.exe -m playwright install chromium",
            },
            ensure_ascii=False,
        )
        + "\n"
    )
    sys.stdout.flush()
    raise SystemExit(1)

LOGIN_URL = "https://investorservice.cfmmc.com/"
SET_PARAM_URL = "https://investorservice.cfmmc.com/customer/setParameter.do"
MAX_CAPTCHA_TRIES = 8
# 监控中心日报通常只开放近两个月；多走几天以覆盖节假日。
DEFAULT_HISTORY_DAYS = 90


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


def xls_download_locator(page):
    for loc in (
        page.get_by_role("link", name=re.compile(r"xls\s*下载")),
        page.get_by_text(re.compile(r"xls\s*下载")),
        page.locator("a[href*='Excel'], a[href*='excel']"),
    ):
        if loc.count() > 0:
            return loc.first
    return page.locator("a", has_text=re.compile(r"下载")).last


def safe_user_id(user_id: str) -> str:
    return re.sub(r"[^\w.-]+", "_", user_id).strip("_") or "account"


def existing_dates(dest_dir: Path, user_id: str) -> set[str]:
    """Dates already saved for this 资金账号 (import root + one book subfolder)."""
    found: set[str] = set()
    if not dest_dir.exists():
        return found
    needle = user_id
    for p in dest_dir.iterdir():
        if p.is_file() and needle in p.name:
            m = re.search(r"(20\d{2}-\d{2}-\d{2})", p.name)
            if m:
                found.add(m.group(1))
        elif p.is_dir():
            for f in p.iterdir():
                if f.is_file() and needle in f.name:
                    m = re.search(r"(20\d{2}-\d{2}-\d{2})", f.name)
                    if m:
                        found.add(m.group(1))
    return found


def weekday_dates(days_back: int) -> list[str]:
    today = date.today()
    out: list[str] = []
    for i in range(days_back + 1):
        d = today - timedelta(days=i)
        if d.weekday() >= 5:
            continue
        out.append(d.isoformat())
    return out


def page_has_settlement(page) -> bool:
    body = ""
    try:
        body = page.locator("body").inner_text(timeout=5000) or ""
    except Exception:
        return False
    if any(s in body for s in ("没有结算", "无结算单", "查无此", "不存在结算", "无符合条件")):
        return False
    return "客户交易结算日报" in body or page.locator("text=xls").count() > 0


def query_trade_date(page, ymd: str) -> None:
    loc = page.locator("input[name='tradeDate'], input#tradeDate, input[id*='tradeDate' i]")
    if loc.count() > 0:
        box = loc.first
        box.click()
        box.fill("")
        box.fill(ymd)
        btn = page.locator(
            "input[type=submit][value*='查询'], button:has-text('查询'), a:has-text('查询'), input[value='查询']"
        )
        if btn.count() > 0:
            btn.first.click()
        else:
            box.press("Enter")
        page.wait_for_load_state("domcontentloaded", timeout=30000)
        time.sleep(0.5)
        return
    try:
        page.request.post(SET_PARAM_URL, form={"tradeDate": ymd, "byType": "trade"}, timeout=30000)
        page.goto(SET_PARAM_URL, wait_until="domcontentloaded", timeout=30000)
        time.sleep(0.4)
    except Exception as exc:  # noqa: BLE001
        log(f"setParameter fallback failed for {ymd}: {exc}")


def click_xls_download(page, dest_dir: Path, user_id: str, ymd: str | None = None) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    page.wait_for_selector("text=客户交易结算日报", timeout=30000)
    time.sleep(0.4)
    button = xls_download_locator(page)
    button.wait_for(state="visible", timeout=15000)
    log(f"Clicking xls download{f' for {ymd}' if ymd else ''}...")
    with page.expect_download(timeout=60000) as download_info:
        button.click()
    download = download_info.value
    suggested = download.suggested_filename or "cfmmc.xls"
    suffix = Path(suggested).suffix or ".xls"
    match = re.search(r"(20\d{2}-\d{2}-\d{2})", suggested)
    date_part = ymd or (match.group(1) if match else Path(suggested).stem)
    target = dest_dir / f"{safe_user_id(user_id)}_{date_part}{suffix}"
    download.save_as(str(target))
    log(f"Saved download to {target}")
    return target


def download_history(page, dest_dir: Path, user_id: str, days_back: int) -> tuple[list[Path], int]:
    already = existing_dates(dest_dir, user_id)
    saved: list[Path] = []
    skipped = 0
    for ymd in weekday_dates(days_back):
        if ymd in already:
            skipped += 1
            log(f"Skip {ymd}: already on disk")
            continue
        log(f"Query settlement {ymd}...")
        try:
            query_trade_date(page, ymd)
            if not page_has_settlement(page):
                log(f"No settlement for {ymd}")
                continue
            path = click_xls_download(page, dest_dir, user_id, ymd)
            saved.append(path)
            already.add(ymd)
        except Exception as exc:  # noqa: BLE001
            log(f"Failed {ymd}: {exc}")
            continue
    return saved, skipped


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
        time.sleep(0.4)
        image_bytes = captcha_img.screenshot()
        code = recognize_captcha(ocr, image_bytes)
        log(f"[try {attempt}/{MAX_CAPTCHA_TRIES}] captcha OCR: {code!r}")

        if len(code) != 6:
            log("OCR not 6 chars, refreshing captcha")
            page.locator(".login-form-refresh-captcha-btn").click()
            time.sleep(0.6)
            continue

        page.fill("input[name=vericode]", code)
        page.click("input[type=submit]")
        page.wait_for_load_state("domcontentloaded", timeout=30000)
        time.sleep(1.0)

        if not still_on_login(page):
            log("Login succeeded.")
            return

        err = page_error_text(page)
        log(f"Still on login page. {err or 'No error text.'}")
        if "验证码" in err or "verif" in err.lower() or not err:
            page.locator(".login-form-refresh-captcha-btn").click()
            time.sleep(0.6)
            continue
        raise RuntimeError(err or "登录被拒绝（非验证码原因）")

    raise RuntimeError("验证码识别失败，已重试多次")


def fetch_reports(
    user_id: str,
    password: str,
    dest_dir: Path,
    headless: bool,
    history: bool,
    days_back: int,
) -> tuple[list[Path], int]:
    with sync_playwright() as p:
        browser = launch_browser(p, headless)
        try:
            context = browser.new_context(locale="zh-CN", accept_downloads=True)
            page = context.new_page()
            login(page, user_id, password)
            if history:
                return download_history(page, dest_dir, user_id, days_back)
            path = click_xls_download(page, dest_dir, user_id)
            return [path], 0
        finally:
            try:
                browser.close()
            except PlaywrightError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch CFMMC daily settlement xls")
    parser.add_argument("--out-dir", required=True, help="Directory to save the xls")
    parser.add_argument("--headed", action="store_true", help="Show the browser window")
    parser.add_argument("--history", action="store_true", help="Download all available history dates")
    parser.add_argument("--days", type=int, default=DEFAULT_HISTORY_DAYS, help="Calendar days to walk back")
    args = parser.parse_args()

    user_id = (os.environ.get("CFMMC_USER") or "").strip()
    password = (os.environ.get("CFMMC_PASSWORD") or "").strip()
    if not user_id or not password:
        return emit({"ok": False, "error": "缺少 CFMMC_USER / CFMMC_PASSWORD"}, 1)

    dest_dir = Path(args.out_dir)
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        paths, skipped = fetch_reports(
            user_id,
            password,
            dest_dir,
            headless=not args.headed,
            history=args.history,
            days_back=max(1, args.days),
        )
        if not paths and skipped == 0:
            return emit({"ok": False, "error": "未下载到结算日报（可能该区间没有数据）"}, 1)
        last = paths[-1] if paths else None
        return emit(
            {
                "ok": True,
                "file": str(last) if last else "",
                "filename": last.name if last else "",
                "files": [p.name for p in paths],
                "downloaded": len(paths),
                "skipped": skipped,
            },
            0,
        )
    except Exception as exc:  # noqa: BLE001
        return emit({"ok": False, "error": str(exc)}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
