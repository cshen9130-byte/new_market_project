#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared AMAC private fund list API client."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Callable, Iterator

AMAC_API = "https://gs.amac.org.cn/amac-infodisc/api/pof/fund"
FUND_DETAIL_BASE = "https://gs.amac.org.cn/amac-infodisc/res/pof/fund/"
AMAC_FUTURES_API = "https://gs.amac.org.cn/amac-infodisc/api/pof/futures"
FUTURES_DETAIL_BASE = "https://gs.amac.org.cn/amac-infodisc/res/pof/futures/"
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
FUTURES_HEADERS = {
    **HEADERS,
    "Referer": "https://gs.amac.org.cn/amac-infodisc/res/pof/futures/index.html",
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

DEFAULT_PAGE_SIZE = 100
# AMAC /api/pof/futures rejects size > 20 with HTTP 400.
FUTURES_PAGE_SIZE = 20
DEFAULT_REQUEST_DELAY = 0.3
DEFAULT_MAX_RETRIES = 5
DEFAULT_RETRY_BACKOFF = 2.0


def ms_to_date(ms: int | None) -> str:
    if ms:
        return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d")
    return ""


def _amac_date(value) -> str:
    if value is None or value == "" or value == "-":
        return ""
    if isinstance(value, (int, float)):
        return ms_to_date(int(value))
    s = str(value).strip()
    if s.isdigit():
        return ms_to_date(int(s))
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return ""


def fund_to_row(fund: dict) -> dict[str, str]:
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


def futures_to_row(item: dict) -> dict[str, str]:
    item_id = str(item.get("id") or "").strip()
    detail_url = f"{FUTURES_DETAIL_BASE}detail.html?id={item_id}" if item_id else ""
    return {
        "fund_name": str(item.get("mpiName") or item.get("fundName") or "").strip(),
        "fund_no": str(item.get("mpiProductCode") or item.get("fundNo") or "").strip(),
        "manager_name": str(item.get("aoiName") or item.get("managerName") or "").strip(),
        "manager_type": "期货公司",
        "working_state": str(item.get("fundStatus") or item.get("workingState") or "").strip(),
        "mandator_name": str(item.get("mpiTrustee") or item.get("mandatorName") or "").strip(),
        "establish_date": _amac_date(item.get("mpiCreateDate") or item.get("establishDate")),
        "put_on_record_date": _amac_date(item.get("registeredDate") or item.get("putOnRecordDate")),
        "detail_url": detail_url,
        "fund_type": "期货公司集合资管产品",
        "investment_type": str(item.get("tzlx") or "").strip(),
        "is_tiered": str(item.get("sfjgh") or "").strip(),
        "due_date": _amac_date(item.get("dueDate")),
    }


def fetch_page(page: int, size: int) -> dict:
    return fetch_api_page(AMAC_API, HEADERS, page, size)


def fetch_futures_page(page: int, size: int) -> dict:
    return fetch_api_page(AMAC_FUTURES_API, FUTURES_HEADERS, page, min(size, FUTURES_PAGE_SIZE))


def fetch_api_page(api: str, headers: dict[str, str], page: int, size: int) -> dict:
    url = f"{api}?page={page}&size={size}&rand=0.7"
    req = urllib.request.Request(url, data=b"{}", headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_page_with_retry(
    page: int,
    size: int,
    *,
    max_retries: int = DEFAULT_MAX_RETRIES,
    retry_backoff: float = DEFAULT_RETRY_BACKOFF,
    on_retry: Callable[[str], None] | None = None,
    fetch_fn: Callable[[int, int], dict] | None = None,
) -> dict:
    loader = fetch_fn or fetch_page
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            return loader(page, size)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last_error = exc
            wait = retry_backoff * attempt
            msg = f"[RETRY {attempt}/{max_retries}] page={page}: {exc}; wait {wait:.1f}s"
            if on_retry:
                on_retry(msg)
            time.sleep(wait)
    raise RuntimeError(f"Failed to fetch page {page} after {max_retries} attempts") from last_error


def fetch_first_page(page_size: int) -> dict:
    return fetch_page_with_retry(0, page_size)


def _iter_amac_pages(
    *,
    fetch_fn: Callable[[int, int], dict],
    row_fn: Callable[[dict], dict[str, str]],
    page_size: int,
    start_page: int,
    end_page: int | None,
    request_delay: float,
    on_page: Callable[[int, int, int], None] | None,
) -> Iterator[tuple[int, list[dict[str, str]], dict]]:
    first = fetch_page_with_retry(start_page, page_size, fetch_fn=fetch_fn) if start_page == 0 else None
    if first is None:
        first = fetch_page_with_retry(0, page_size, fetch_fn=fetch_fn)

    total_elements = int(first.get("totalElements", 0) or 0)
    total_pages = int(first.get("totalPages", 0) or 0)
    meta = {
        "total_elements": total_elements,
        "total_pages": total_pages,
        "page_size": page_size,
    }

    if end_page is None:
        end_page = total_pages
    else:
        end_page = min(end_page, total_pages)

    if start_page == 0:
        rows = [row_fn(f) for f in first.get("content", [])]
        if on_page:
            on_page(0, len(rows), total_elements)
        yield 0, rows, meta
        start_page = 1

    for page in range(start_page, end_page):
        data = fetch_page_with_retry(page, page_size, fetch_fn=fetch_fn)
        rows = [row_fn(f) for f in data.get("content", [])]
        if not rows:
            break
        if on_page:
            on_page(page, len(rows), total_elements)
        yield page, rows, meta
        if request_delay > 0:
            time.sleep(request_delay)


def iter_fund_pages(
    *,
    page_size: int = DEFAULT_PAGE_SIZE,
    start_page: int = 0,
    end_page: int | None = None,
    request_delay: float = DEFAULT_REQUEST_DELAY,
    on_page: Callable[[int, int, int], None] | None = None,
) -> Iterator[tuple[int, list[dict[str, str]], dict]]:
    """Yield (page_index, rows, meta) for each AMAC private-fund list page."""
    yield from _iter_amac_pages(
        fetch_fn=fetch_page,
        row_fn=fund_to_row,
        page_size=page_size,
        start_page=start_page,
        end_page=end_page,
        request_delay=request_delay,
        on_page=on_page,
    )


def iter_futures_pages(
    *,
    page_size: int = FUTURES_PAGE_SIZE,
    start_page: int = 0,
    end_page: int | None = None,
    request_delay: float = DEFAULT_REQUEST_DELAY,
    on_page: Callable[[int, int, int], None] | None = None,
) -> Iterator[tuple[int, list[dict[str, str]], dict]]:
    """Yield (page_index, rows, meta) for each AMAC 期货公司集合资管 list page."""
    page_size = min(page_size, FUTURES_PAGE_SIZE)
    yield from _iter_amac_pages(
        fetch_fn=fetch_futures_page,
        row_fn=futures_to_row,
        page_size=page_size,
        start_page=start_page,
        end_page=end_page,
        request_delay=request_delay,
        on_page=on_page,
    )
