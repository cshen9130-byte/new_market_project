#!/usr/bin/env python3
"""
Incremental MOM trade-detail ETL
================================

Reads xlsx files from MOM data folders (03.投顾逐日), parses:
- 品种汇总: D6(account), I6(trade_date)
- 成交明细: header row 11, data rows start at 12, columns B..Q

Then upserts detail rows into PostgreSQL.

Behavior:
- First run: processes all files
- Later runs: only files that are new/changed (mtime/size delta)

Environment:
- DATABASE_URL (preferred) OR DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
- MOM_DATA_DIR (preferred)
  default: ../mom_data/03.投顾逐日 relative to project root
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Tuple
from xml.etree import ElementTree as ET


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"main": MAIN_NS, "rel": REL_NS, "pkg": PKG_REL_NS}

SUMMARY_SHEET_NAME = "品种汇总"
DETAIL_SHEET_NAME = "成交明细"
HEADER_ROW = 11
DATA_START_ROW = 12
FIRST_COLUMN = 2
LAST_COLUMN = 17

JOB_NAME = "mom_data_etl"

# Ordered list of (xlsx header text, SQL column name).
# Matches columns B-Q in 成交明细 sheet, same order as export_trade_details_by_account.py.
DETAIL_COLUMNS: List[Tuple[str, str]] = [
    ("合约",           "合约"),
    ("成交编号",        "成交编号"),
    ("成交时间",        "成交时间"),
    ("买/卖",          "买/卖"),
    ("投机/套保",       "投机/套保"),
    ("成交价",         "成交价"),
    ("手数",           "手数"),
    ("成交额",         "成交额"),
    ("开/平",          "开/平"),
    ("手续费",         "手续费"),
    ("平仓盈亏",        "平仓盈亏"),
    ("资金账户报单编号", "资金账户报单编号"),
    ("成交日期",        "成交日期"),
    ("权利金收支",      "权利金收支"),
    ("资金账户成交编号", "资金账户成交编号"),
    ("交易所",         "交易所"),
]
DETAIL_SQL_COLS = [f'"{sql}"' for _, sql in DETAIL_COLUMNS]
DETAIL_XLSX_HEADERS = [xlsx for xlsx, _ in DETAIL_COLUMNS]


def load_env_files() -> None:
    """Walk up and load .env/.env.local without overriding existing env vars."""
    candidates = [Path(__file__).resolve().parent, Path.cwd()]
    for base in candidates:
        cursor = base
        for _ in range(4):
            for fname in (".env.local", ".env"):
                env_file = cursor / fname
                if not env_file.is_file():
                    continue
                for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
            cursor = cursor.parent


def get_conn():
    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError as exc:
        raise RuntimeError("psycopg2 not installed. Run: pip install psycopg2-binary") from exc

    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)

    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


def resolve_base_dir(override: str | None) -> Path:
    if override:
        return Path(override)
    env_dir = os.environ.get("MOM_DATA_DIR")
    if env_dir:
        return Path(env_dir)

    # default: project sibling folder ../mom_data/03.投顾逐日
    project_root = Path(__file__).resolve().parents[2]
    return project_root.parent / "mom_data" / "03.投顾逐日"


def clean_cell(value):
    return "" if value is None else value


def collect_xlsx_files(base_dir: Path) -> List[Path]:
    files: List[Path] = []
    if not base_dir.exists():
        return files

    for folder in sorted(base_dir.iterdir()):
        if not folder.is_dir():
            continue
        for file_path in sorted(folder.iterdir()):
            if file_path.is_file() and file_path.suffix.lower() == ".xlsx" and not file_path.name.startswith("~$"):
                files.append(file_path)
    return files


def column_letter_to_index(column_letters: str) -> int:
    value = 0
    for char in column_letters:
        value = value * 26 + (ord(char.upper()) - ord("A") + 1)
    return value


def split_cell_reference(reference: str) -> Tuple[int | None, int | None]:
    match = re.match(r"([A-Z]+)(\d+)", reference)
    if not match:
        return None, None
    column_letters, row_number = match.groups()
    return column_letter_to_index(column_letters), int(row_number)


def normalize_sheet_target(target: str) -> str:
    normalized = target.replace("\\", "/")
    if normalized.startswith("/"):
        return normalized.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", normalized))


def load_shared_strings(workbook_zip: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in workbook_zip.namelist():
        return []

    root = ET.fromstring(workbook_zip.read("xl/sharedStrings.xml"))
    shared_strings: List[str] = []
    for string_item in root.findall("main:si", NS):
        text_parts: List[str] = []
        for text_node in string_item.iterfind(".//main:t", NS):
            text_parts.append(text_node.text or "")
        shared_strings.append("".join(text_parts))
    return shared_strings


def get_sheet_paths(workbook_zip: zipfile.ZipFile) -> Dict[str, str]:
    workbook_root = ET.fromstring(workbook_zip.read("xl/workbook.xml"))
    rel_root = ET.fromstring(workbook_zip.read("xl/_rels/workbook.xml.rels"))

    rel_map: Dict[str, str] = {}
    for relationship in rel_root.findall("pkg:Relationship", NS):
        rel_map[relationship.attrib["Id"]] = normalize_sheet_target(relationship.attrib["Target"])

    sheet_paths: Dict[str, str] = {}
    for sheet in workbook_root.findall("main:sheets/main:sheet", NS):
        rel_id = sheet.attrib.get(f"{{{REL_NS}}}id")
        if rel_id in rel_map:
            sheet_paths[sheet.attrib["name"]] = rel_map[rel_id]
    return sheet_paths


def extract_cell_value(cell_element, shared_strings: List[str]) -> str:
    cell_type = cell_element.attrib.get("t")

    if cell_type == "inlineStr":
        text_parts: List[str] = []
        for text_node in cell_element.iterfind(".//main:t", NS):
            text_parts.append(text_node.text or "")
        return "".join(text_parts)

    value_element = cell_element.find("main:v", NS)
    if value_element is None:
        return ""

    raw_value = value_element.text or ""

    if cell_type == "s":
        index = int(raw_value)
        return shared_strings[index] if 0 <= index < len(shared_strings) else ""
    if cell_type == "b":
        return "TRUE" if raw_value == "1" else "FALSE"
    return raw_value


def parse_summary_sheet(workbook_zip: zipfile.ZipFile, sheet_path: str, shared_strings: List[str]) -> Tuple[str, str]:
    account = ""
    trade_date = ""

    with workbook_zip.open(sheet_path) as sheet_file:
        for _, element in ET.iterparse(sheet_file, events=("end",)):
            if element.tag != f"{{{MAIN_NS}}}row":
                continue

            row_number = int(element.attrib.get("r", "0"))
            if row_number == 6:
                for cell in element.findall(f"{{{MAIN_NS}}}c"):
                    reference = cell.attrib.get("r", "")
                    if reference == "D6":
                        account = str(clean_cell(extract_cell_value(cell, shared_strings))).strip()
                    elif reference == "I6":
                        trade_date = str(clean_cell(extract_cell_value(cell, shared_strings))).strip()
                element.clear()
                break
            element.clear()

    return account, trade_date


def parse_detail_sheet(workbook_zip: zipfile.ZipFile, sheet_path: str, shared_strings: List[str]) -> Tuple[List[str], List[List[str]]]:
    headers: List[str] = []
    rows: List[List[str]] = []

    with workbook_zip.open(sheet_path) as sheet_file:
        for _, element in ET.iterparse(sheet_file, events=("end",)):
            if element.tag != f"{{{MAIN_NS}}}row":
                continue

            row_number = int(element.attrib.get("r", "0"))
            if row_number < HEADER_ROW:
                element.clear()
                continue

            row_values = [""] * (LAST_COLUMN - FIRST_COLUMN + 1)
            for cell in element.findall(f"{{{MAIN_NS}}}c"):
                ref = cell.attrib.get("r", "")
                col_idx, _ = split_cell_reference(ref)
                if col_idx is None or col_idx < FIRST_COLUMN or col_idx > LAST_COLUMN:
                    continue
                row_values[col_idx - FIRST_COLUMN] = str(clean_cell(extract_cell_value(cell, shared_strings)))

            if row_number == HEADER_ROW:
                headers = row_values
                element.clear()
                continue

            if row_number < DATA_START_ROW:
                element.clear()
                continue

            if not any(v != "" for v in row_values):
                element.clear()
                continue

            if str(row_values[0]).strip() == "合计":
                element.clear()
                break

            rows.append(row_values)
            element.clear()

    return headers, rows


def normalize_trade_date(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    s2 = s.replace("-", "").replace("/", "")
    if re.fullmatch(r"\d{8}", s2):
        return s2
    return s


def row_hash(file_rel: str, account: str, trade_date: str, values: Iterable[str]) -> str:
    payload = "|".join([file_rel, account, trade_date, *[str(v) for v in values]])
    return hashlib.sha1(payload.encode("utf-8", errors="ignore")).hexdigest()


def _old_schema_detected(conn) -> bool:
    """Return True if mom_trade_details still has the old JSONB 'detail_payload' column."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'mom_trade_details'
              AND column_name  = 'detail_payload'
            """
        )
        return cur.fetchone() is not None


def drop_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS mom_trade_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_trade_detail_file_state CASCADE")
    conn.commit()


def ensure_tables(conn) -> None:
    detail_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in DETAIL_COLUMNS)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_trade_details (
              id              BIGSERIAL PRIMARY KEY,
              account         TEXT NOT NULL,
              trade_date      DATE,
{detail_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS mom_trade_detail_file_state (
              source_file_rel TEXT PRIMARY KEY,
              source_mtime    TIMESTAMPTZ NOT NULL,
              source_size     BIGINT NOT NULL,
              account         TEXT,
              trade_date      TEXT,
              row_count       INTEGER NOT NULL DEFAULT 0,
              status          TEXT NOT NULL DEFAULT 'ok',
              error_message   TEXT,
              processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_trade_details_account_date
              ON mom_trade_details (account, trade_date)
            """
        )
    conn.commit()


def load_file_state(conn, files: List[Path], base_dir: Path) -> Dict[str, Tuple[datetime, int]]:
    rels = [str(p.relative_to(base_dir)).replace("\\", "/") for p in files]
    if not rels:
        return {}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_file_rel, source_mtime, source_size
            FROM mom_trade_detail_file_state
            WHERE source_file_rel = ANY(%s)
            """,
            (rels,),
        )
        rows = cur.fetchall()

    state: Dict[str, Tuple[datetime, int]] = {}
    for file_rel, mtime, size in rows:
        state[file_rel] = (mtime, int(size))
    return state


def upsert_file_state(conn, file_rel: str, mtime_dt: datetime, size: int, account: str, trade_date: str, row_count: int, status: str, error_message: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO mom_trade_detail_file_state
              (source_file_rel, source_mtime, source_size, account, trade_date, row_count, status, error_message, processed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (source_file_rel) DO UPDATE SET
              source_mtime = EXCLUDED.source_mtime,
              source_size = EXCLUDED.source_size,
              account = EXCLUDED.account,
              trade_date = EXCLUDED.trade_date,
              row_count = EXCLUDED.row_count,
              status = EXCLUDED.status,
              error_message = EXCLUDED.error_message,
              processed_at = NOW()
            """,
            (file_rel, mtime_dt, size, account, trade_date, row_count, status, error_message),
        )


def process_file(conn, base_dir: Path, file_path: Path) -> Tuple[bool, str]:
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    rel = str(file_path.relative_to(base_dir)).replace("\\", "/")
    stat = file_path.stat()
    mtime_dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    size = int(stat.st_size)

    try:
        with zipfile.ZipFile(file_path) as workbook_zip:
            sheet_paths = get_sheet_paths(workbook_zip)
            if SUMMARY_SHEET_NAME not in sheet_paths or DETAIL_SHEET_NAME not in sheet_paths:
                upsert_file_state(conn, rel, mtime_dt, size, "", "", 0, "error", "Missing required sheet")
                conn.commit()
                return False, f"missing sheet: {rel}"

            shared_strings = load_shared_strings(workbook_zip)
            account, trade_date_raw = parse_summary_sheet(workbook_zip, sheet_paths[SUMMARY_SHEET_NAME], shared_strings)
            headers, rows = parse_detail_sheet(workbook_zip, sheet_paths[DETAIL_SHEET_NAME], shared_strings)

        trade_date = normalize_trade_date(trade_date_raw)
        if not account or not trade_date:
            upsert_file_state(conn, rel, mtime_dt, size, account, trade_date, 0, "error", "Missing account/date in summary")
            conn.commit()
            return False, f"missing account/date: {rel}"

        # Build a mapping from xlsx header position → DETAIL_COLUMNS index.
        # Tolerates minor header variations (extra spaces, etc.).
        header_index_map: Dict[str, int] = {h.strip(): i for i, h in enumerate(headers)}
        col_positions: List[int | None] = [
            header_index_map.get(xlsx_hdr.strip())
            for xlsx_hdr in DETAIL_XLSX_HEADERS
        ]

        trade_date_iso = f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}" if re.fullmatch(r"\d{8}", trade_date) else None

        # Replace rows for this source file to avoid duplication on reprocess.
        with conn.cursor() as cur:
            cur.execute("DELETE FROM mom_trade_details WHERE source_file_rel = %s", (rel,))

            insert_cols = "account, trade_date, " + ", ".join(DETAIL_SQL_COLS) + ", source_file_rel, row_hash"
            values = []
            for rv in rows:
                detail_vals = [
                    rv[pos] if pos is not None and pos < len(rv) else ""
                    for pos in col_positions
                ]
                rh = row_hash(rel, account, trade_date, rv)
                values.append(tuple([account, trade_date_iso] + detail_vals + [rel, rh]))

            if values:
                execute_values(
                    cur,
                    f"INSERT INTO mom_trade_details ({insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    values,
                    page_size=1000,
                )

        upsert_file_state(conn, rel, mtime_dt, size, account, trade_date, len(rows), "ok", None)
        conn.commit()
        return True, f"ok: {rel} rows={len(rows)}"

    except Exception as exc:
        conn.rollback()
        try:
            upsert_file_state(conn, rel, mtime_dt, size, "", "", 0, "error", str(exc))
            conn.commit()
        except Exception:
            conn.rollback()
        return False, f"error: {rel} {exc}"


def run(base_dir: Path, reset: bool = False) -> int:
    files = collect_xlsx_files(base_dir)
    if not files:
        print(json.dumps({"job": JOB_NAME, "processed": 0, "changed": 0, "message": "No xlsx files found"}, ensure_ascii=False))
        return 0

    conn = get_conn()
    try:
        if reset:
            drop_tables(conn)
        elif _old_schema_detected(conn):
            # Auto-migrate: old JSONB schema detected, drop and recreate.
            drop_tables(conn)
        ensure_tables(conn)

        state = load_file_state(conn, files, base_dir)

        changed: List[Path] = []
        for p in files:
            rel = str(p.relative_to(base_dir)).replace("\\", "/")
            stat = p.stat()
            mtime_dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            size = int(stat.st_size)

            old = state.get(rel)
            if not old:
                changed.append(p)
                continue
            old_mtime, old_size = old
            if int(old_mtime.timestamp()) != int(mtime_dt.timestamp()) or int(old_size) != size:
                changed.append(p)

        ok_count = 0
        err_count = 0
        messages: List[str] = []

        for fp in changed:
            ok, msg = process_file(conn, base_dir, fp)
            messages.append(msg)
            if ok:
                ok_count += 1
            else:
                err_count += 1

        out = {
            "job": JOB_NAME,
            "total_files": len(files),
            "changed_files": len(changed),
            "processed_ok": ok_count,
            "processed_error": err_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # Include only first few messages for concise logs.
        if messages:
            out["sample"] = messages[:20]

        print(json.dumps(out, ensure_ascii=False))
        return 0 if err_count == 0 else 2

    finally:
        conn.close()


def main() -> None:
    load_env_files()

    parser = argparse.ArgumentParser(description="Incremental ETL for MOM 成交明细 to PostgreSQL")
    parser.add_argument("--base-dir", default=None, help="MOM data directory, defaults to MOM_DATA_DIR")
    parser.add_argument("--reset", action="store_true", help="Drop and recreate tables before processing (full reload)")
    args = parser.parse_args()

    base_dir = resolve_base_dir(args.base_dir)
    if not base_dir.exists():
        print(json.dumps({"job": JOB_NAME, "error": f"base dir not found: {base_dir}"}, ensure_ascii=False))
        sys.exit(1)

    code = run(base_dir, reset=args.reset)
    sys.exit(code)


if __name__ == "__main__":
    main()
