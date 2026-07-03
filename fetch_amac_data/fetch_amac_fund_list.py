#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fetch all private fund names from AMAC (中国基金业协会) public disclosure API
and save to a CSV file.

Source: https://gs.amac.org.cn/amac-infodisc/res/pof/fund/index.html

Supports resume: progress is saved after each page; re-run to continue.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


AMAC_API = "https://gs.amac.org.cn/amac-infodisc/api/pof/fund"
FUND_DETAIL_BASE = "https://gs.amac.org.cn/amac-infodisc/res/pof/fund/"
HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://gs.amac.org.cn/amac-infodisc/res/pof/fund/index.html",
    "Origin": "https://gs.amac.org.cn",
}

CSV_COLUMNS = [
    "fund_name",
    "fund_no",
    "manager_name",
    "manager_type",
    "working_state",
    "mandator_name",
    "establish_date",
    "put_on_record_date",
    "detail_url",
]

DEFAULT_OUTPUT = Path(__file__).parent / "amac_private_funds.csv"
PROGRESS_SUFFIX = ".progress.json"

REQUEST_DELAY = 0.3
MAX_RETRIES = 5
RETRY_BACKOFF = 2.0
PAGE_SIZE = 100


class FetchProgress:
    """Terminal progress bar for page/fund fetch status."""

    def __init__(self, total_pages: int, total_elements: int, initial_fetched: int = 0) -> None:
        self.total_pages = total_pages
        self.total_elements = total_elements
        self.fetched = initial_fetched
        self.current_page = 0
        self.bar_width = 40

    def _bar(self, ratio: float) -> str:
        ratio = max(0.0, min(ratio, 1.0))
        filled = int(self.bar_width * ratio)
        return "#" * filled + "-" * (self.bar_width - filled)

    def update(self, page: int, fetched: int) -> None:
        self.current_page = page + 1
        self.fetched = fetched
        page_ratio = self.current_page / self.total_pages if self.total_pages else 0
        fund_ratio = self.fetched / self.total_elements if self.total_elements else 0
        line = (
            f"\r[{self._bar(page_ratio)}] "
            f"{page_ratio * 100:5.1f}% "
            f"page {self.current_page:,}/{self.total_pages:,} | "
            f"{self.fetched:,}/{self.total_elements:,} funds"
        )
        print(line, end="", flush=True)

    def message(self, text: str) -> None:
        print(f"\n{text}")

    def finish(self, text: str) -> None:
        print(f"\n{text}")


def ms_to_date(ms: int | None) -> str:
    if ms:
        return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d")
    return ""


def fetch_page(page: int, size: int) -> dict:
    url = f"{AMAC_API}?page={page}&size={size}"
    req = urllib.request.Request(url, data=b"{}", headers=HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_page_with_retry(page: int, size: int, progress: FetchProgress | None = None) -> dict:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fetch_page(page, size)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last_error = exc
            wait = RETRY_BACKOFF * attempt
            msg = f"  [RETRY {attempt}/{MAX_RETRIES}] page={page}: {exc}; wait {wait:.1f}s"
            if progress:
                progress.message(msg)
            else:
                print(msg)
            time.sleep(wait)
    raise RuntimeError(f"Failed to fetch page {page} after {MAX_RETRIES} attempts") from last_error


def fund_to_row(fund: dict) -> dict:
    detail_path = fund.get("url", "")
    detail_url = FUND_DETAIL_BASE + detail_path if detail_path else ""
    return {
        "fund_name": fund.get("fundName", ""),
        "fund_no": fund.get("fundNo", ""),
        "manager_name": fund.get("managerName", ""),
        "manager_type": fund.get("managerType", ""),
        "working_state": fund.get("workingState", ""),
        "mandator_name": fund.get("mandatorName", ""),
        "establish_date": ms_to_date(fund.get("establishDate")),
        "put_on_record_date": ms_to_date(fund.get("putOnRecordDate")),
        "detail_url": detail_url,
    }


def load_progress(progress_path: Path) -> dict | None:
    if not progress_path.exists():
        return None
    return json.loads(progress_path.read_text(encoding="utf-8"))


def save_progress(progress_path: Path, page: int, total_pages: int, total_elements: int, fetched: int) -> None:
    progress_path.write_text(
        json.dumps(
            {
                "next_page": page + 1,
                "total_pages": total_pages,
                "total_elements": total_elements,
                "fetched": fetched,
                "updated_at": datetime.now().isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch all private fund names from AMAC and save to CSV."
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output CSV path (default: {DEFAULT_OUTPUT.name})",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=PAGE_SIZE,
        help=f"Records per API page (default: {PAGE_SIZE})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=REQUEST_DELAY,
        help=f"Delay between requests in seconds (default: {REQUEST_DELAY})",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Stop after N pages (0 = fetch all; useful for testing)",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Ignore saved progress and overwrite the output CSV",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path: Path = args.output
    progress_path = output_path.with_suffix(output_path.suffix + PROGRESS_SUFFIX)

    start_page = 0
    append_mode = False
    fetched = 0

    if args.fresh:
        if output_path.exists():
            output_path.unlink()
        if progress_path.exists():
            progress_path.unlink()
    elif progress_path.exists() and output_path.exists():
        progress = load_progress(progress_path)
        if progress:
            start_page = progress.get("next_page", 0)
            fetched = progress.get("fetched", 0)
            append_mode = True
            print(f"Resuming from page {start_page} ({fetched} rows already saved)")

    print("Fetching page 0 to determine total count ...")
    first = fetch_page_with_retry(0, args.page_size)
    total_elements = first.get("totalElements", 0)
    total_pages = first.get("totalPages", 0)
    print(f"Total funds on AMAC: {total_elements:,} ({total_pages:,} pages)\n")

    progress = FetchProgress(total_pages, total_elements, fetched)
    write_header = not append_mode
    mode = "a" if append_mode else "w"
    end_page = total_pages
    if args.max_pages > 0:
        end_page = min(start_page + args.max_pages, total_pages)

    with output_path.open(mode, newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        if write_header:
            writer.writeheader()

        if start_page == 0:
            rows = [fund_to_row(f) for f in first.get("content", [])]
            writer.writerows(rows)
            fetched += len(rows)
            save_progress(progress_path, 0, total_pages, total_elements, fetched)
            progress.update(0, fetched)
            start_page = 1
            time.sleep(args.delay)

        for page in range(start_page, end_page):
            data = fetch_page_with_retry(page, args.page_size, progress)
            rows = [fund_to_row(f) for f in data.get("content", [])]
            if not rows:
                progress.message(f"Page {page + 1}/{total_pages}: empty response, stopping.")
                break
            writer.writerows(rows)
            fetched += len(rows)
            save_progress(progress_path, page, total_pages, total_elements, fetched)
            progress.update(page, fetched)
            time.sleep(args.delay)

    if fetched >= total_elements or end_page >= total_pages:
        if progress_path.exists():
            progress_path.unlink()
        progress.finish(f"Done. Saved {fetched:,} funds -> {output_path}")
    else:
        progress.finish(f"Stopped early. Saved {fetched:,} funds -> {output_path}")
        print("Progress saved; re-run to continue.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n\nInterrupted. Re-run to resume from saved progress.")
        raise SystemExit(130)
