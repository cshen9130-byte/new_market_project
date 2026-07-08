#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fetch additional AMAC (中国基金业协会) data and save to CSV files.

Outputs (default folder: amac_extra/):
  managers.csv           - private fund manager list (~19k)
  person_org_stats.csv   - per-org personnel counts (基金经理/投资经理 counts)
  manager_details.csv    - manager detail page fields (管理规模区间, staff, etc.)
  manager_executives.csv - 高管信息 (one row per executive)
  manager_executive_resume.csv - 高管工作履历 (one row per resume entry)
  personnel.csv          - individual personnel records (if API available)

Each stage supports resume via .progress_<stage>.json in the output folder.
Re-run the same command to continue after interruption.

Examples:
  python fetch_amac_extra.py
  python fetch_amac_extra.py --stage managers --max-pages 5
  python fetch_amac_extra.py --stage manager_details
  python fetch_amac_extra.py --fresh --stage all
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
import time
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import requests

warnings.filterwarnings("ignore", message="Unverified HTTPS request")

BASE = "https://gs.amac.org.cn/amac-infodisc"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
}

DEFAULT_OUTPUT_DIR = Path(__file__).parent / "amac_extra"
REQUEST_DELAY = 0.3
MAX_RETRIES = 5
RETRY_BACKOFF = 2.0
PAGE_SIZE = 100

STAGES = ("managers", "person_org", "manager_details", "personnel")

MANAGER_COLUMNS = [
    "私募基金管理人名称",
    "法定代表人/执行事务合伙人(委派代表)姓名",
    "机构类型",
    "登记编号",
    "注册地省份",
    "注册地城市",
    "注册地",
    "办公地",
    "成立时间",
    "登记时间",
    "在管基金数量",
    "会员类型",
    "是否有提示信息",
    "是否有诚信信息",
    "详情链接",
    "管理人ID",
]

PERSON_ORG_COLUMNS = [
    "机构名称",
    "机构类型",
    "员工人数",
    "基金从业资格",
    "基金销售业务资格",
    "投资经理",
    "基金经理",
    "外部员工人数",
    "外部基金从业资格",
    "外部基金销售业务资格",
    "外部投资经理",
    "外部基金经理",
]

MANAGER_DETAIL_COLUMNS = [
    "登记编号",
    "基金管理人全称(中文)",
    "基金管理人全称(英文)",
    "组织机构代码",
    "登记时间",
    "成立时间",
    "注册地址",
    "办公地址",
    "注册资本(万元)(人民币)",
    "实缴资本(万元)(人民币)",
    "注册资本实缴比例",
    "企业性质",
    "机构类型",
    "业务类型",
    "全职员工人数",
    "取得基金从业人数",
    "管理规模区间",
    "是否为符合提供投资建议条件的第三方机构",
    "实际控制人姓名 / 名称",
    "是否为会员",
    "律师事务所名称",
    "律师姓名",
    "私募基金信息披露备份系统投资者查询账号开立率",
    "详情链接",
]

EXECUTIVE_COLUMNS = [
    "登记编号",
    "管理人名称",
    "姓名",
    "职务",
    "是否有基金从业资格",
    "资格取得方式",
]

EXECUTIVE_RESUME_COLUMNS = [
    "登记编号",
    "管理人名称",
    "姓名",
    "高管职务",
    "时间",
    "任职单位",
    "任职部门",
    "职务",
]

PERSONNEL_COLUMNS = [
    "姓名",
    "性别",
    "证书编号",
    "机构名称",
    "从业资格类别",
    "证书取得日期",
    "证书状态变更记录",
    "诚信记录",
]

# AMAC 详情页字段标签 -> CSV 列名（与 MANAGER_DETAIL_COLUMNS 一致）
DETAIL_LABEL_MAP = {
    "登记编号": "登记编号",
    "基金管理人全称(中文)": "基金管理人全称(中文)",
    "基金管理人全称(英文)": "基金管理人全称(英文)",
    "组织机构代码": "组织机构代码",
    "登记时间": "登记时间",
    "成立时间": "成立时间",
    "注册地址": "注册地址",
    "办公地址": "办公地址",
    "注册资本(万元)(人民币)": "注册资本(万元)(人民币)",
    "实缴资本(万元)(人民币)": "实缴资本(万元)(人民币)",
    "注册资本实缴比例": "注册资本实缴比例",
    "企业性质": "企业性质",
    "机构类型": "机构类型",
    "业务类型": "业务类型",
    "全职员工人数": "全职员工人数",
    "取得基金从业人数": "取得基金从业人数",
    "管理规模区间": "管理规模区间",
    "是否为符合提供投资建议条件的第三方机构": "是否为符合提供投资建议条件的第三方机构",
    "实际控制人姓名 / 名称": "实际控制人姓名 / 名称",
    "是否为会员": "是否为会员",
    "律师事务所名称": "律师事务所名称",
    "律师姓名": "律师姓名",
    "私募基金信息披露备份系统投资者查询账号开立率": "私募基金信息披露备份系统投资者查询账号开立率",
}


class FetchProgress:
    """Terminal progress bar."""

    def __init__(self, label: str, total: int, initial: int = 0) -> None:
        self.label = label
        self.total = max(total, 1)
        self.current = initial
        self.bar_width = 40

    def _bar(self, ratio: float) -> str:
        ratio = max(0.0, min(ratio, 1.0))
        filled = int(self.bar_width * ratio)
        return "#" * filled + "-" * (self.bar_width - filled)

    def update(self, current: int) -> None:
        self.current = current
        ratio = self.current / self.total
        line = (
            f"\r[{self._bar(ratio)}] {ratio * 100:5.1f}% "
            f"{self.label}: {self.current:,}/{self.total:,}"
        )
        print(line, end="", flush=True)

    def message(self, text: str) -> None:
        print(f"\n{text}")

    def finish(self, text: str) -> None:
        print(f"\n{text}")


def ms_to_date(ms: Any) -> str:
    if ms in (None, "", 0):
        return ""
    try:
        return datetime.fromtimestamp(int(ms) / 1000).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return str(ms)


def clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def progress_path(output_dir: Path, stage: str) -> Path:
    return output_dir / f".progress_{stage}.json"


def load_progress(path: Path) -> dict | None:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def save_progress(path: Path, data: dict) -> None:
    data["updated_at"] = datetime.now().isoformat(timespec="seconds")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def post_json(
    session: requests.Session,
    api_path: str,
    page: int,
    size: int,
    body: dict | None = None,
    progress: FetchProgress | None = None,
) -> dict:
    url = f"{BASE}{api_path}"
    params = {"rand": str(random.random()), "page": str(page), "size": str(size)}
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.post(
                url,
                params=params,
                json=body if body is not None else {},
                headers=HEADERS,
                verify=False,
                timeout=90,
            )
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            wait = RETRY_BACKOFF * attempt
            msg = f"  [RETRY {attempt}/{MAX_RETRIES}] {api_path} page={page}: {exc}; wait {wait:.1f}s"
            if progress:
                progress.message(msg)
            else:
                print(msg)
            time.sleep(wait)
    raise RuntimeError(f"Failed {api_path} page {page}") from last_error


def get_html(session: requests.Session, url: str, progress: FetchProgress | None = None) -> str:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(
                url,
                headers={"User-Agent": HEADERS["User-Agent"]},
                verify=False,
                timeout=90,
            )
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or "utf-8"
            return resp.text
        except requests.RequestException as exc:
            last_error = exc
            wait = RETRY_BACKOFF * attempt
            msg = f"  [RETRY {attempt}/{MAX_RETRIES}] GET {url}: {exc}; wait {wait:.1f}s"
            if progress:
                progress.message(msg)
            else:
                print(msg)
            time.sleep(wait)
    raise RuntimeError(f"Failed GET {url}") from last_error


def paginated_fetch(
    session: requests.Session,
    stage: str,
    output_dir: Path,
    csv_name: str,
    columns: list[str],
    api_path: str,
    row_fn: Callable[[dict], dict],
    json_body: dict | None = None,
    page_size: int = PAGE_SIZE,
    max_pages: int = 0,
    fresh: bool = False,
    delay: float = REQUEST_DELAY,
) -> None:
    csv_path = output_dir / csv_name
    prog_path = progress_path(output_dir, stage)

    start_page = 0
    fetched = 0
    append_mode = False

    if fresh:
        csv_path.unlink(missing_ok=True)
        prog_path.unlink(missing_ok=True)
    elif prog_path.exists() and csv_path.exists():
        prog = load_progress(prog_path)
        if prog:
            start_page = prog.get("next_page", 0)
            fetched = prog.get("fetched", 0)
            append_mode = True
            print(f"[{stage}] Resuming from page {start_page} ({fetched:,} rows saved)")

    print(f"[{stage}] Probing total count ...")
    first = post_json(session, api_path, 0, page_size, json_body)
    total_elements = int(first.get("totalElements", 0))
    total_pages = int(first.get("totalPages", 0))
    print(f"[{stage}] Total: {total_elements:,} records, {total_pages:,} pages\n")

    end_page = total_pages
    if max_pages > 0:
        end_page = min(start_page + max_pages, total_pages)

    bar = FetchProgress(stage, total_elements, fetched)
    mode = "a" if append_mode else "w"

    with csv_path.open(mode, newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        if not append_mode:
            writer.writeheader()

        if start_page == 0:
            rows = [row_fn(item) for item in first.get("content", [])]
            writer.writerows(rows)
            fetched += len(rows)
            save_progress(
                prog_path,
                {
                    "next_page": 1,
                    "total_pages": total_pages,
                    "total_elements": total_elements,
                    "fetched": fetched,
                },
            )
            bar.update(fetched)
            start_page = 1
            time.sleep(delay)

        for page in range(start_page, end_page):
            data = post_json(session, api_path, page, page_size, json_body, bar)
            items = data.get("content", [])
            if not items:
                bar.message(f"[{stage}] Empty page {page + 1}, stopping.")
                break
            rows = [row_fn(item) for item in items]
            writer.writerows(rows)
            fetched += len(rows)
            save_progress(
                prog_path,
                {
                    "next_page": page + 1,
                    "total_pages": total_pages,
                    "total_elements": total_elements,
                    "fetched": fetched,
                },
            )
            bar.update(fetched)
            time.sleep(delay)

    if fetched >= total_elements or end_page >= total_pages:
        prog_path.unlink(missing_ok=True)
        bar.finish(f"[{stage}] Done. Saved {fetched:,} rows -> {csv_path}")
    else:
        bar.finish(f"[{stage}] Stopped early. Saved {fetched:,} rows -> {csv_path}")
        print(f"[{stage}] Progress saved; re-run to continue.")


def yes_no(value: Any) -> str:
    if value is True:
        return "是"
    if value is False:
        return "否"
    return "" if value is None else str(value)


def manager_row(item: dict) -> dict:
    url_part = item.get("url", "") or ""
    detail_url = f"{BASE}/res/pof/manager/{url_part}" if url_part else ""
    manager_id = url_part.replace(".html", "") if url_part else ""
    return {
        "私募基金管理人名称": item.get("managerName", ""),
        "法定代表人/执行事务合伙人(委派代表)姓名": item.get("artificialPersonName", ""),
        "机构类型": item.get("primaryInvestType", ""),
        "登记编号": item.get("registerNo", ""),
        "注册地省份": item.get("registerProvince", ""),
        "注册地城市": item.get("registerCity", ""),
        "注册地": item.get("regAdrAgg", ""),
        "办公地": item.get("officeAdrAgg", ""),
        "成立时间": ms_to_date(item.get("establishDate")),
        "登记时间": ms_to_date(item.get("registerDate")),
        "在管基金数量": item.get("fundCount", ""),
        "会员类型": item.get("memberType", ""),
        "是否有提示信息": yes_no(item.get("hasSpecialTips")),
        "是否有诚信信息": yes_no(item.get("hasCreditTips")),
        "详情链接": detail_url,
        "管理人ID": manager_id,
    }


def person_org_row(item: dict) -> dict:
    return {
        "机构名称": item.get("orgName", ""),
        "机构类型": item.get("orgType", ""),
        "员工人数": item.get("workerTotalNum", ""),
        "基金从业资格": item.get("operNum", ""),
        "基金销售业务资格": item.get("salesmanNum", ""),
        "投资经理": item.get("investmentManagerNum", ""),
        "基金经理": item.get("fundManagerNum", ""),
        "外部员工人数": item.get("extWorkerTotalNum", ""),
        "外部基金从业资格": item.get("extOperNum", ""),
        "外部基金销售业务资格": item.get("extSalesmanNum", ""),
        "外部投资经理": item.get("extInvestmentManagerNum", ""),
        "外部基金经理": item.get("extFundManagerNum", ""),
    }


def personnel_row(item: dict) -> dict:
    return {
        "姓名": item.get("userName", item.get("name", "")),
        "性别": item.get("sex", item.get("gender", "")),
        "证书编号": item.get("certCode", ""),
        "机构名称": item.get("orgName", ""),
        "从业资格类别": item.get("certName", item.get("certType", "")),
        "证书取得日期": ms_to_date(item.get("certDate")),
        "证书状态变更记录": item.get("certState", ""),
        "诚信记录": item.get("creditRecord", ""),
    }


def extract_section_html(html: str, section_title: str) -> str:
    pattern = (
        rf'<div class="common-tit">\s*<span>{re.escape(section_title)}</span>\s*</div>'
        rf"(.*?)(?=<div class=\"section\">|<div class=\"common-tit\">|$)"
    )
    match = re.search(pattern, html, re.S)
    return match.group(1) if match else ""


def parse_executives(
    html: str, register_no: str, manager_name: str
) -> tuple[list[dict], list[dict]]:
    """Parse 高管信息 section only — one executive row + optional resume rows per person."""
    section = extract_section_html(html, "高管信息")
    if not section:
        return [], []

    executives: list[dict] = []
    resumes: list[dict] = []

    blocks = re.split(
        r'<tr>\s*<td[^>]*class="title"[^>]*>\s*职务\s*</td>',
        section,
        flags=re.S,
    )

    for block in blocks[1:]:
        header = re.search(
            r"<td[^>]*>\s*(.*?)\s*</td>\s*"
            r'<td[^>]*class="title"[^>]*>\s*姓名\s*</td>\s*'
            r"<td[^>]*>\s*(.*?)\s*</td>",
            block,
            re.S,
        )
        if not header:
            continue

        role = clean_html(header.group(1))
        person_name = clean_html(header.group(2))
        if not person_name:
            continue

        qual = re.search(
            r"是否有基金从业资格\s*</td>\s*<td[^>]*>\s*(.*?)\s*</td>\s*"
            r'<td[^>]*class="title"[^>]*>\s*资格获取方式\s*</td>\s*'
            r"<td[^>]*>\s*(.*?)\s*</td>",
            block,
            re.S,
        )
        executives.append(
            {
                "登记编号": register_no,
                "管理人名称": manager_name,
                "姓名": person_name,
                "职务": role,
                "是否有基金从业资格": clean_html(qual.group(1)) if qual else "",
                "资格取得方式": clean_html(qual.group(2)) if qual else "",
            }
        )

        for table in re.finditer(
            r'<table class="list-table">.*?<tbody>(.*?)</tbody>',
            block,
            re.S,
        ):
            for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", table.group(1), re.S):
                cells = re.findall(r"<td[^>]*>(.*?)</td>", tr.group(1), re.S)
                if len(cells) < 4:
                    continue
                time_val = clean_html(cells[0])
                employer = clean_html(cells[1])
                if not time_val and not employer:
                    continue
                resumes.append(
                    {
                        "登记编号": register_no,
                        "管理人名称": manager_name,
                        "姓名": person_name,
                        "高管职务": role,
                        "时间": time_val,
                        "任职单位": employer,
                        "任职部门": clean_html(cells[2]),
                        "职务": clean_html(cells[3]),
                    }
                )

    return executives, resumes


def parse_manager_detail(html: str, detail_url: str) -> tuple[dict, list[dict], list[dict]]:
    row = {col: "" for col in MANAGER_DETAIL_COLUMNS}
    row["详情链接"] = detail_url

    name_match = re.search(r'id="complaint2"[^>]*>([^<]+)<', html)
    if name_match:
        row["基金管理人全称(中文)"] = name_match.group(1).strip()

    for label, col in DETAIL_LABEL_MAP.items():
        if col == "基金管理人全称(中文)" and row["基金管理人全称(中文)"]:
            continue
        pattern = (
            rf"<td[^>]*class=\"title\"[^>]*>\s*{re.escape(label)}\s*</td>\s*"
            rf"<td[^>]*(?:colspan=\"\d+\")?[^>]*>(.*?)</td>"
        )
        match = re.search(pattern, html, re.S | re.I)
        if match:
            row[col] = clean_html(match.group(1))

    register_no = row.get("登记编号", "")
    manager_name = row.get("基金管理人全称(中文)", "")
    executives, resumes = parse_executives(html, register_no, manager_name)
    return row, executives, resumes


def fetch_managers(session: requests.Session, output_dir: Path, args: argparse.Namespace) -> None:
    try:
        session.get(
            f"{BASE}/res/pof/manager/managerList.html",
            headers={"User-Agent": HEADERS["User-Agent"]},
            verify=False,
            timeout=60,
        )
    except requests.RequestException:
        pass
    paginated_fetch(
        session,
        "managers",
        output_dir,
        "managers.csv",
        MANAGER_COLUMNS,
        "/api/pof/manager",
        manager_row,
        json_body={},
        page_size=args.page_size,
        max_pages=args.max_pages,
        fresh=args.fresh,
        delay=args.delay,
    )


def fetch_person_org(session: requests.Session, output_dir: Path, args: argparse.Namespace) -> None:
    try:
        session.get(
            f"{BASE}/res/pof/person/personOrgList.html",
            headers={"User-Agent": HEADERS["User-Agent"]},
            verify=False,
            timeout=60,
        )
    except requests.RequestException:
        pass
    page_size = min(args.page_size, 20)
    paginated_fetch(
        session,
        "person_org",
        output_dir,
        "person_org_stats.csv",
        PERSON_ORG_COLUMNS,
        "/api/pof/personOrg",
        person_org_row,
        json_body={"orgType": "smjjglr", "page": "1"},
        page_size=page_size,
        max_pages=args.max_pages,
        fresh=args.fresh,
        delay=args.delay,
    )


def fetch_personnel(session: requests.Session, output_dir: Path, args: argparse.Namespace) -> None:
    try:
        session.get(
            f"{BASE}/res/pof/person/personList.html",
            headers={"User-Agent": HEADERS["User-Agent"]},
            verify=False,
            timeout=60,
        )
    except requests.RequestException:
        pass
    page_size = min(args.page_size, 40)
    bodies = [
        {"userName": None, "certCode": None, "certName": None, "userId": None, "page": 1},
        {"userId": None, "page": 1},
    ]
    for body in bodies:
        try:
            post_json(session, "/api/pof/person", 0, min(page_size, 3), body)
            paginated_fetch(
                session,
                "personnel",
                output_dir,
                "personnel.csv",
                PERSONNEL_COLUMNS,
                "/api/pof/person",
                personnel_row,
                json_body=body,
                page_size=page_size,
                max_pages=args.max_pages,
                fresh=args.fresh,
                delay=args.delay,
            )
            return
        except RuntimeError:
            continue
    print(
        "[personnel] Skipped: AMAC personnel API unavailable (400). "
        "Use person_org_stats.csv for org-level 基金经理/投资经理 counts."
    )


def fetch_manager_details(session: requests.Session, output_dir: Path, args: argparse.Namespace) -> None:
    managers_csv = output_dir / "managers.csv"
    if not managers_csv.exists():
        raise SystemExit(
            f"{managers_csv} not found. Run --stage managers first (or place managers.csv in output dir)."
        )

    detail_csv = output_dir / "manager_details.csv"
    exec_csv = output_dir / "manager_executives.csv"
    resume_csv = output_dir / "manager_executive_resume.csv"
    prog_path = progress_path(output_dir, "manager_details")

    managers: list[dict] = []
    with managers_csv.open(encoding="utf-8-sig", newline="") as fh:
        managers = list(csv.DictReader(fh))

    start_idx = 0
    detail_append = False
    exec_append = False
    resume_append = False
    if args.fresh:
        detail_csv.unlink(missing_ok=True)
        exec_csv.unlink(missing_ok=True)
        resume_csv.unlink(missing_ok=True)
        prog_path.unlink(missing_ok=True)
    elif prog_path.exists() and detail_csv.exists():
        prog = load_progress(prog_path)
        if prog:
            start_idx = prog.get("next_index", 0)
            detail_append = True
            exec_append = exec_csv.exists()
            resume_append = resume_csv.exists()
            print(f"[manager_details] Resuming from index {start_idx:,}/{len(managers):,}")

    end_idx = len(managers)
    if args.max_pages > 0:
        end_idx = min(start_idx + args.max_pages * args.page_size, len(managers))

    bar = FetchProgress("manager_details", len(managers), start_idx)
    detail_mode = "a" if detail_append else "w"
    exec_mode = "a" if exec_append else "w"
    resume_mode = "a" if resume_append else "w"

    with detail_csv.open(detail_mode, newline="", encoding="utf-8-sig") as dfh, exec_csv.open(
        exec_mode, newline="", encoding="utf-8-sig"
    ) as efh, resume_csv.open(resume_mode, newline="", encoding="utf-8-sig") as rfh:
        dw = csv.DictWriter(dfh, fieldnames=MANAGER_DETAIL_COLUMNS)
        ew = csv.DictWriter(efh, fieldnames=EXECUTIVE_COLUMNS)
        rw = csv.DictWriter(rfh, fieldnames=EXECUTIVE_RESUME_COLUMNS)
        if not detail_append:
            dw.writeheader()
        if not exec_append:
            ew.writeheader()
        if not resume_append:
            rw.writeheader()

        for idx in range(start_idx, end_idx):
            mgr = managers[idx]
            url = mgr.get("详情链接", "")
            if not url:
                bar.update(idx + 1)
                continue
            html = get_html(session, url, bar)
            detail_row, exec_rows, resume_rows = parse_manager_detail(html, url)
            if not detail_row.get("登记编号"):
                detail_row["登记编号"] = mgr.get("登记编号", "")
            if not detail_row.get("基金管理人全称(中文)"):
                detail_row["基金管理人全称(中文)"] = mgr.get("私募基金管理人名称", "")
            reg = detail_row.get("登记编号", "")
            mgr_name = detail_row.get("基金管理人全称(中文)", "")
            for er in exec_rows:
                er.setdefault("登记编号", reg)
                er.setdefault("管理人名称", mgr_name)
            for rr in resume_rows:
                rr.setdefault("登记编号", reg)
                rr.setdefault("管理人名称", mgr_name)
            dw.writerow(detail_row)
            ew.writerows(exec_rows)
            rw.writerows(resume_rows)
            save_progress(
                prog_path,
                {"next_index": idx + 1, "total": len(managers), "fetched": idx + 1},
            )
            bar.update(idx + 1)
            time.sleep(args.delay)

    if end_idx >= len(managers):
        prog_path.unlink(missing_ok=True)
        bar.finish(
            f"[manager_details] Done. {detail_csv.name}, {exec_csv.name}, {resume_csv.name}"
        )
    else:
        bar.finish(f"[manager_details] Stopped early at {end_idx:,}/{len(managers):,}")
        print("[manager_details] Progress saved; re-run to continue.")


STAGE_FUNCS = {
    "managers": fetch_managers,
    "person_org": fetch_person_org,
    "manager_details": fetch_manager_details,
    "personnel": fetch_personnel,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch extra AMAC data to CSV files.")
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR.name}/)",
    )
    parser.add_argument(
        "--stage",
        choices=[*STAGES, "all"],
        default="all",
        help="Which dataset to fetch (default: all)",
    )
    parser.add_argument("--page-size", type=int, default=PAGE_SIZE, help=f"API page size (default: {PAGE_SIZE})")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY, help=f"Delay between requests (default: {REQUEST_DELAY})")
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Stop after N API pages (0 = all). manager_details: N * page-size managers.",
    )
    parser.add_argument("--fresh", action="store_true", help="Ignore progress and overwrite CSVs for selected stage(s)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    stages = list(STAGES) if args.stage == "all" else [args.stage]
    print(f"Output directory: {output_dir.resolve()}\n")

    for stage in stages:
        print("=" * 60)
        fn = STAGE_FUNCS[stage]
        fn(session, output_dir, args)
        print()

    print("All requested stages finished.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n\nInterrupted. Re-run the same command to resume from saved progress.")
        raise SystemExit(130)
