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
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

LOGIN_URL = "https://investorservice.cfmmc.com/"
MAX_CAPTCHA_TRIES = 8


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


def click_xls_download(page, dest_dir: Path, user_id: str) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    page.wait_for_selector("text=客户交易结算日报", timeout=30000)
    time.sleep(0.5)
    button = xls_download_locator(page)
    button.wait_for(state="visible", timeout=15000)
    log("Clicking xls download...")
    with page.expect_download(timeout=60000) as download_info:
        button.click()
    download = download_info.value
    suggested = download.suggested_filename or "cfmmc.xls"
    safe_user = re.sub(r"[^\w.-]+", "_", user_id).strip("_") or "account"
    stem = Path(suggested).stem
    suffix = Path(suggested).suffix or ".xls"
    target = dest_dir / f"{safe_user}_{stem}{suffix}"
    if target.exists():
        stamp = time.strftime("%Y%m%d%H%M%S")
        target = dest_dir / f"{safe_user}_{stem}_{stamp}{suffix}"
    download.save_as(str(target))
    log(f"Saved download to {target}")
    return target


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


def fetch_one(user_id: str, password: str, dest_dir: Path, headless: bool) -> Path:
    ocr = make_ocr()
    with sync_playwright() as p:
        browser = launch_browser(p, headless)
        try:
            context = browser.new_context(locale="zh-CN", accept_downloads=True)
            page = context.new_page()
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
                    return click_xls_download(page, dest_dir, user_id)

                err = page_error_text(page)
                log(f"Still on login page. {err or 'No error text.'}")
                if "验证码" in err or "verif" in err.lower() or not err:
                    page.locator(".login-form-refresh-captcha-btn").click()
                    time.sleep(0.6)
                    continue
                raise RuntimeError(err or "登录被拒绝（非验证码原因）")

            raise RuntimeError("验证码识别失败，已重试多次")
        finally:
            try:
                browser.close()
            except PlaywrightError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch CFMMC daily settlement xls")
    parser.add_argument("--out-dir", required=True, help="Directory to save the xls")
    parser.add_argument("--headed", action="store_true", help="Show the browser window")
    args = parser.parse_args()

    user_id = (os.environ.get("CFMMC_USER") or "").strip()
    password = (os.environ.get("CFMMC_PASSWORD") or "").strip()
    if not user_id or not password:
        return emit({"ok": False, "error": "缺少 CFMMC_USER / CFMMC_PASSWORD"}, 1)

    dest_dir = Path(args.out_dir)
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        path = fetch_one(user_id, password, dest_dir, headless=not args.headed)
        return emit({"ok": True, "file": str(path), "filename": path.name}, 0)
    except Exception as exc:  # noqa: BLE001
        return emit({"ok": False, "error": str(exc)}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
