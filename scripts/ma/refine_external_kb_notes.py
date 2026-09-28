"""
Repair 外部笔记 imported from the three external due-diligence folders.

- Sidebar date becomes the roadshow / file date, with a channel label (点睛 / beny / 喵财君).
- Original files are copied into the note's attachments.
- Files about the same manager within a few days (or the same month, when the
  filename only has a month) become one note and share those attachments.
- Written reports and meeting notes are placed in the body. Pitch decks are
  rewritten into a more detailed note.

  python3 scripts/ma/refine_external_kb_notes.py --dry-run
  python3 scripts/ma/refine_external_kb_notes.py --apply
  python3 scripts/ma/refine_external_kb_notes.py --apply --skip-llm

Designed to run on the production server, where the knowledge-base files and
investment-notes JSON live under /root/market_dashboard_storage.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date as Date

STORAGE = os.environ.get("MARKET_DASHBOARD_STORAGE_DIR", "/root/market_dashboard_storage")
NOTES_PATH = os.path.join(STORAGE, "investment-notes", "notes.json")
MATERIALS_PATH = os.path.join(STORAGE, "investment-notes", "materials.json")
MATERIALS_DIR = os.path.join(STORAGE, "investment-notes", "materials")
PROGRESS_PATH = os.path.join(STORAGE, "investment-notes", "external-kb-note-progress.json")
KB_ROOT = os.path.join(STORAGE, "ai-knowledge-base")
ENV_FILES = ("/root/new_market_project/.env.local", "/root/new_market_project/.env")

AUTHOR = "外部笔记"
REFINED_MARK = "<!-- external-kb-refined -->"
CHANNELS = (
    ("点睛", ("外部尽调资料/点睛炎究所/", "外部尽调资料/点睛研究所/")),
    ("beny", ("外部尽调资料/Beny的尽调笔记本/",)),
    ("喵财君", ("外部尽调资料/喵财君带你一起去探店/", "外部尽调资料/喵才君带你一起去探店/")),
)
PRICE_IN = 0.8 / 1_000_000
PRICE_OUT = 2 / 1_000_000
MAX_TEXT = 18_000
HAND_EDIT_DATES = {"2026/09/24", "2026/09/25"}

DAY_RES = (
    re.compile(r"(20\d{2})[.\-_/年](\d{1,2})[.\-_/月](\d{1,2})"),
    re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)"),
)
MONTH_RES = (
    re.compile(r"(20\d{2})[.\-_/年](\d{1,2})(?:月)?(?!\d)"),
    re.compile(r"(?<!\d)(20\d{2})(\d{2})(?!\d)"),
)
TEXT_DAY_RE = re.compile(
    r"(?:会议时间|会议日期|路演时间|路演日期|交流时间|访谈时间|调研时间|日期)\s*[：:]\s*"
    r"(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})"
)
PATH_RE = re.compile(r"知识库路径：([^<]+)")
ORG_RE = re.compile(r"([\u4e00-\u9fff]{2,8}(?:投资|资产|基金|资本|量化|资管))")
HEADING_RE = re.compile(
    r"^(?:[一二三四五六七八九十]+、|\d+(?:\.\d+){0,2}[\s、.]|（[一二三四五六七八九十\d]+）|\([一二三四五六七八九十\d]+\))"
)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for path in ENV_FILES:
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return env


def channel_of(source: str) -> str:
    for label, prefixes in CHANNELS:
        if any(source.startswith(prefix) for prefix in prefixes):
            return label
    return ""


def valid_ymd(year: int, month: int, day: int) -> bool:
    if not (2000 <= year <= 2035 and 1 <= month <= 12 and 1 <= day <= 31):
        return False
    try:
        Date(year, month, day)
    except ValueError:
        return False
    return True


def parse_filename_date(name: str) -> tuple[str, str] | None:
    for rx in DAY_RES:
        match = rx.search(name)
        if not match:
            continue
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if valid_ymd(year, month, day):
            return f"{year:04d}/{month:02d}/{day:02d}", "day"
    for rx in MONTH_RES:
        match = rx.search(name)
        if not match:
            continue
        year, month = int(match.group(1)), int(match.group(2))
        if valid_ymd(year, month, 1):
            return f"{year:04d}/{month:02d}", "month"
    return None


def date_from_text(text: str) -> str | None:
    match = TEXT_DAY_RE.search(text[:2500])
    if not match:
        return None
    year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
    if not valid_ymd(year, month, day):
        return None
    return f"{year:04d}/{month:02d}/{day:02d}"


def ordinal(stamp: str) -> int:
    parts = stamp.split("/")
    year, month = int(parts[0]), int(parts[1])
    day = int(parts[2]) if len(parts) > 2 else 1
    return year * 372 + month * 31 + day


def same_month(a: str, b: str) -> bool:
    return a[:7] == b[:7]


def org_key(filename: str) -> str:
    base = os.path.splitext(os.path.basename(filename))[0]
    base = re.sub(r"\(\d+\)", "", base)
    base = re.sub(r"_\d{10,}", "", base)
    branded = re.search(r"点睛智库[_\s\-]*([\u4e00-\u9fff]{2,8})", base)
    if branded:
        return branded.group(1)
    stripped = DAY_RES[0].sub(" ", base)
    stripped = DAY_RES[1].sub(" ", stripped)
    stripped = MONTH_RES[0].sub(" ", stripped)
    match = ORG_RE.search(stripped)
    if not match:
        return ""
    name = match.group(1)
    name = re.sub(r"^(上海|北京|深圳|广东|杭州|南京)", "", name)
    return name


def duplicate_key(filename: str) -> str:
    base = os.path.splitext(os.path.basename(filename))[0].lower()
    base = re.sub(r"\(\d+\)", "", base)
    base = re.sub(r"[_\-\s]*\d{12,}", "", base)
    base = re.sub(r"(定稿|外发版|机构版|详细版|新版)$", "", base)
    return re.sub(r"\s+", "", base)


def is_designed(source: str) -> bool:
    name = os.path.basename(source)
    if "/尽调报告/" in source:
        return True
    if any(token in name for token in ("尽调报告", "会议纪要", "调研纪要", "交流纪要", "访谈纪要")):
        return True
    if "纪要" in name and "介绍" not in name and "推介" not in name:
        return True
    return False


def prefer_attachment(path: str) -> tuple[int, int, str]:
    name = os.path.basename(path)
    penalty = 0
    if re.search(r"\(\d+\)", name):
        penalty += 2
    if re.search(r"_\d{12,}", name):
        penalty += 2
    return (penalty, len(name), name)


def stitch(parts: list[str]) -> str:
    if not parts:
        return ""
    out = parts[0] or ""
    for part in parts[1:]:
        cur = part or ""
        if not cur:
            continue
        window = out[-900:]
        best = 0
        limit = min(len(window), len(cur), 700)
        for size in range(limit, 50, -1):
            if cur.startswith(window[-size:]):
                best = size
                break
        if best:
            out += cur[best:]
            continue
        tail = window[-80:]
        idx = cur.find(tail) if len(tail) >= 40 else -1
        if idx >= 0:
            out += cur[idx + len(tail):]
        else:
            out += "\n" + cur
    return out.strip()


def prepare_text(text: str) -> str:
    text = re.sub(r"--\s*\d+\s*of\s*\d+\s*--", "\n", text)
    text = text.replace("内部文件严禁转发", "")
    text = re.sub(r"[\u4e00-\u9fffA-Za-z0-9·]{2,24}会议纪要\s*\d+", "\n", text)
    cut = re.split(r"风险提示及免责声明|重要声明\s*$", text)
    text = cut[0]
    markers = ("会议时间", "会议日期", "(一)", "（一）", "一、")
    positions = [text.find(mark) for mark in markers if text.find(mark) > 120]
    if positions:
        start = min(positions)
        head = text[:start]
        if any(token in head for token in ("风险提示", "重要声明", "不得转载", "合格投资者")):
            text = text[start:]
    text = re.sub(r"\s*(➢|⚫|◆|•)", r"\n\1", text)
    text = re.sub(
        r"\s*((?:[一二三四五六七八九十]+、)|[（(][一二三四五六七八九十\d]+[）)])",
        r"\n\1",
        text,
    )
    return text


def clean_lines(text: str) -> list[str]:
    text = prepare_text(text)
    raw_lines = []
    for line in text.splitlines():
        line = re.sub(r"[ \t]{2,}", " ", line).strip()
        if not line or re.fullmatch(r"\d{1,3}", line):
            continue
        raw_lines.append(line)
    counts: dict[str, int] = defaultdict(int)
    for line in raw_lines:
        if len(line) <= 24:
            counts[line] += 1
    lines = [line for line in raw_lines if counts[line] < 3]
    body_at = 0
    for index, line in enumerate(lines[:40]):
        if re.match(r"^[一二三四五六七八九十]+、", line) or line.startswith(("会议时间", "会议日期", "公司概况")):
            body_at = index
            break
    if body_at > 2:
        lines = lines[body_at:]
    blocks: list[str] = []
    buf = ""
    for line in lines:
        heading = bool(HEADING_RE.match(line)) and len(line) <= 40
        bullet = line.startswith(("➢", "⚫", "•", "·", "-", "—"))
        if heading:
            if buf:
                blocks.append(buf)
                buf = ""
            blocks.append(line)
            continue
        if not buf:
            buf = line
            continue
        if bullet or buf.endswith(("。", "！", "？", "；", "：")):
            blocks.append(buf)
            buf = line
            continue
        buf += line
    if buf:
        blocks.append(buf)
    cleaned = [block.strip() for block in blocks if block.strip()]
    deduped: list[str] = []
    for block in cleaned:
        if deduped and (block in deduped[-1] or deduped[-1] in block):
            if len(block) > len(deduped[-1]):
                deduped[-1] = block
            continue
        deduped.append(block)
    return deduped


def blocks_to_html(blocks: list[str]) -> str:
    parts = []
    for block in blocks:
        safe = html.escape(block)
        if HEADING_RE.match(block) and len(block) <= 40:
            parts.append(f"<div><b>{safe}</b></div>")
        elif block.startswith(("➢", "⚫", "•", "·")):
            parts.append(f"<div>{safe}</div>")
        else:
            parts.append(f"<div>{safe}</div>")
    return "".join(parts)


def source_header(files: list[dict]) -> str:
    names = "、".join(html.escape(os.path.basename(item["source"])) for item in files)
    paths = "".join(f"<div>知识库路径：{html.escape(item['source'])}</div>" for item in files)
    channel = files[0]["channel"]
    return (
        f"{REFINED_MARK}"
        f"<div><b>资料来源</b></div>"
        f"<div>{html.escape(channel)} · {names}</div>"
        f"{paths}"
        f"<div><br></div>"
    )


def preview_from(html_body: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html_body)
    text = text.replace(REFINED_MARK, "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^资料来源\s*", "", text)
    text = re.sub(r"^(点睛|beny|喵财君)\s*·\s*", "", text)
    return (text[:80] + "...") if len(text) > 80 else text


def display_date(stamp: str, channel: str) -> str:
    if stamp and channel:
        return f"{stamp} · {channel}"
    if channel:
        return f"日期不详 · {channel}"
    return stamp


def load_chunks(env: dict[str, str]) -> dict[str, str]:
    import psycopg2

    conn = psycopg2.connect(env["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        """
        SELECT source, content
        FROM kb_chunks
        WHERE source LIKE '外部尽调资料/点睛%%'
           OR source LIKE '外部尽调资料/Beny%%'
           OR source LIKE '外部尽调资料/喵财君%%'
           OR source LIKE '外部尽调资料/喵才君%%'
        ORDER BY source, id
        """
    )
    grouped: dict[str, list[str]] = defaultdict(list)
    for source, content in cur.fetchall():
        if channel_of(source):
            grouped[source].append(content or "")
    conn.close()
    return {source: stitch(parts) for source, parts in grouped.items()}


def build_files(texts: dict[str, str]) -> list[dict]:
    files = []
    for source, text in texts.items():
        channel = channel_of(source)
        if not channel:
            continue
        name = os.path.basename(source)
        parsed = parse_filename_date(name)
        text_day = date_from_text(text)
        if parsed and parsed[1] == "day":
            stamp, precision = parsed
        elif text_day:
            stamp, precision = text_day, "day"
        elif parsed:
            stamp, precision = parsed
        else:
            loose = re.search(
                r"(20\d{2})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?",
                text[:900],
            )
            if loose and valid_ymd(int(loose.group(1)), int(loose.group(2)), int(loose.group(3) or 1)):
                year, month = int(loose.group(1)), int(loose.group(2))
                if loose.group(3):
                    stamp, precision = f"{year:04d}/{month:02d}/{int(loose.group(3)):02d}", "day"
                else:
                    stamp, precision = f"{year:04d}/{month:02d}", "month"
            else:
                stamp, precision = "", ""
        files.append(
            {
                "source": source,
                "name": name,
                "channel": channel,
                "text": text,
                "stamp": stamp,
                "precision": precision,
                "org": org_key(name),
                "dup": duplicate_key(name),
                "designed": is_designed(source),
                "abs": os.path.join(KB_ROOT, *source.split("/")),
            }
        )
    return files


def cluster_files(files: list[dict]) -> list[list[dict]]:
    by_channel_dup: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for item in files:
        by_channel_dup[(item["channel"], item["dup"])].append(item)
    groups = list(by_channel_dup.values())

    def group_stamp(group: list[dict]) -> str:
        stamps = [item["stamp"] for item in group if item["stamp"]]
        return min(stamps) if stamps else ""

    def group_org(group: list[dict]) -> str:
        for item in group:
            if item["org"]:
                return item["org"]
        return ""

    merged: list[list[dict]] = []
    used = [False] * len(groups)
    order = sorted(range(len(groups)), key=lambda i: (groups[i][0]["channel"], group_org(groups[i]), group_stamp(groups[i])))
    for index in order:
        if used[index]:
            continue
        used[index] = True
        current = list(groups[index])
        org = group_org(current)
        channel = current[0]["channel"]
        if org:
            for other in order:
                if used[other] or groups[other][0]["channel"] != channel or group_org(groups[other]) != org:
                    continue
                if close_enough(current, groups[other]):
                    used[other] = True
                    current.extend(groups[other])
        merged.append(current)
    return merged


def close_enough(left: list[dict], right: list[dict]) -> bool:
    combined = left + right
    if any(not item["stamp"] for item in combined):
        return False
    if all(item["precision"] == "day" for item in combined):
        ords = [ordinal(item["stamp"]) for item in combined]
        return max(ords) - min(ords) <= 10
    months = {item["stamp"][:7] for item in combined}
    return len(months) == 1


def choose_kept_files(group: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for item in group:
        buckets[item["dup"]].append(item)
    kept = []
    for bucket in buckets.values():
        sizes = []
        for item in bucket:
            try:
                sizes.append(os.path.getsize(item["abs"]))
            except OSError:
                sizes.append(0)
        if len(bucket) == 1 or max(sizes) == 0:
            kept.append(sorted(bucket, key=lambda item: prefer_attachment(item["source"]))[0])
            continue
        best = sorted(bucket, key=lambda item: prefer_attachment(item["source"]))[0]
        best_size = os.path.getsize(best["abs"]) if os.path.exists(best["abs"]) else 0
        kept.append(best)
        for item, size in zip(bucket, sizes):
            if item is best or best_size == 0:
                continue
            if abs(size - best_size) / best_size > 0.02:
                kept.append(item)
    return kept


def note_sources(note: dict) -> list[str]:
    found = []
    for item in PATH_RE.findall(note.get("content") or ""):
        found.append(html.unescape(item).replace("\u00a0", " ").strip())
    return found


def norm_source(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def index_notes_by_source(notes: list[dict]) -> dict[str, dict]:
    by_source: dict[str, dict] = {}
    for note in notes:
        if note.get("creator") != AUTHOR:
            continue
        for source in note_sources(note):
            by_source.setdefault(norm_source(source), note)
    return by_source


def relink_materials(materials: list[dict], old_id: str, keep: dict) -> None:
    for row in materials:
        if row.get("noteId") == old_id:
            row["noteId"] = keep["id"]
            row["noteTitle"] = keep.get("title") or row.get("noteTitle") or ""


def dedupe_external_notes(notes: list[dict], materials: list[dict], files: list[dict]) -> tuple[list[dict], int]:
    """Collapse a real note and a filename shell that point at the same file."""
    by_source = index_notes_by_source(notes)
    drop: set[str] = set()
    for note in notes:
        if note.get("creator") != AUTHOR or note.get("id") in drop or note_sources(note):
            continue
        title = (note.get("title") or "").strip()
        for item in files:
            stem = os.path.splitext(item["name"])[0].strip()
            key = norm_source(item["source"])
            other = by_source.get(key)
            if title == stem and other and other["id"] != note["id"]:
                drop.add(note["id"])
                relink_materials(materials, note["id"], other)
                break
    grouped: dict[str, list[dict]] = defaultdict(list)
    for note in notes:
        if note.get("id") in drop or note.get("creator") != AUTHOR:
            continue
        for source in note_sources(note):
            grouped[norm_source(source)].append(note)
    for group in grouped.values():
        unique = []
        seen = set()
        for note in group:
            if note["id"] in seen:
                continue
            seen.add(note["id"])
            unique.append(note)
        if len(unique) < 2:
            continue
        keep = max(
            unique,
            key=lambda note: (
                1 if REFINED_MARK in (note.get("content") or "") else 0,
                len(note.get("content") or ""),
            ),
        )
        for note in unique:
            if note["id"] == keep["id"]:
                continue
            drop.add(note["id"])
            relink_materials(materials, note["id"], keep)
    if not drop:
        return notes, 0
    return [note for note in notes if note.get("id") not in drop], len(drop)


def capture_manual_ids(notes: list[dict], progress: dict) -> set[str]:
    """Ids edited by a person after the import. Captured once so later runs can resume."""
    if progress.get("manualIdsCaptured"):
        return set(progress.get("manualIds") or [])
    found = [
        note["id"]
        for note in notes
        if note.get("creator") == AUTHOR
        and (note.get("modifiedDate") or "") not in HAND_EDIT_DATES
        and REFINED_MARK not in (note.get("content") or "")
    ]
    progress["manualIds"] = found
    progress["manualIdsCaptured"] = True
    return set(found)


def cluster_stamp(files: list[dict]) -> str:
    day = [item["stamp"] for item in files if item["precision"] == "day" and item["stamp"]]
    if day:
        return min(day)
    month = [item["stamp"] for item in files if item["stamp"]]
    return min(month) if month else ""


def designed_html(files: list[dict]) -> str:
    sections = []
    for item in files:
        if not item["designed"]:
            continue
        blocks = clean_lines(item["text"])
        body = blocks_to_html(blocks)
        plain = re.sub(r"<[^>]+>", "", body)
        if len(plain) < 400:
            continue
        if len(files) > 1:
            sections.append(f"<div><b>{html.escape(item['name'])}</b></div>{body}<div><br></div>")
        else:
            sections.append(body)
    return "".join(sections)


def mime_for(name: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    return {
        ".pdf": "application/pdf",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".ppt": "application/vnd.ms-powerpoint",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
    }.get(ext, "application/octet-stream")


def attach_files(note: dict, files: list[dict], materials: list[dict]) -> int:
    existing = {
        (row.get("noteId"), row.get("name"))
        for row in materials
    }
    added = 0
    for item in files:
        if not os.path.isfile(item["abs"]):
            continue
        if (note["id"], item["name"]) in existing:
            continue
        data = open(item["abs"], "rb").read()
        digest = hashlib.sha256(data).hexdigest()[:16]
        ext = os.path.splitext(item["name"])[1].lower()
        material_id = f"mat_{int(time.time() * 1000):x}_{digest[:8]}"
        storage_name = f"{material_id}_{digest}{ext}"
        os.makedirs(MATERIALS_DIR, exist_ok=True)
        dest = os.path.join(MATERIALS_DIR, storage_name)
        if not os.path.exists(dest):
            try:
                os.link(item["abs"], dest)
            except OSError:
                with open(dest, "wb") as handle:
                    handle.write(data)
        materials.insert(
            0,
            {
                "id": material_id,
                "name": item["name"],
                "size": len(data),
                "mimeType": mime_for(item["name"]),
                "storageFilename": storage_name,
                "noteId": note["id"],
                "noteTitle": note.get("title") or "",
                "uploadedBy": AUTHOR,
                "uploadedByName": AUTHOR,
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                "nameResolved": True,
                "extractJobId": None,
            },
        )
        existing.add((note["id"], item["name"]))
        added += 1
        time.sleep(0.002)
    return added


def shell_note(files: list[dict]) -> dict:
    title = os.path.splitext(files[0]["name"])[0].strip()[:80] or "外部资料笔记"
    channel = files[0]["channel"]
    return {
        "id": f"{int(time.time() * 1000)}-{os.urandom(3).hex()}",
        "title": title,
        "content": "",
        "preview": "",
        "contentVariant": "plain",
        "teamShared": True,
        "kbRelativePath": None,
        "tags": [],
        "associations": [],
        "extractedProducts": [],
        "roadshowAssociations": [],
        "attachments": [],
        "creator": AUTHOR,
        "creatorId": AUTHOR,
        "lastModifiedBy": AUTHOR,
        "modifiedDate": time.strftime("%Y/%m/%d"),
        "createdDate": display_date(cluster_stamp(files), channel),
        "sourceLabel": channel,
    }


def apply_meta(note: dict, files: list[dict], content: str | None) -> None:
    channel = files[0]["channel"]
    stamp = cluster_stamp(files)
    note["createdDate"] = display_date(stamp, channel)
    note["sourceLabel"] = channel
    note["modifiedDate"] = time.strftime("%Y/%m/%d")
    note["lastModifiedBy"] = AUTHOR
    if content is not None:
        note["content"] = content
        note["preview"] = preview_from(content)


def llm_summary(env: dict[str, str], files: list[dict]) -> tuple[str, str, float]:
    api_key = env.get("DASHSCOPE_API_KEY") or ""
    base = env.get("DASHSCOPE_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model = env.get("DASHSCOPE_ANALYSIS_MODEL") or env.get("DASHSCOPE_CHAT_MODEL") or "qwen-plus"
    if not api_key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY")
    chunks = []
    budget = 28_000
    for item in files:
        piece = item["text"][:MAX_TEXT]
        if len(piece) > budget:
            piece = piece[:budget]
        budget -= len(piece)
        chunks.append(f"【文件：{item['name']}】\n{piece}")
        if budget <= 0:
            break
    system = "\n".join(
        [
            "你是私募投资研究助手。把路演材料、公司介绍或策略推介整理成一篇详细的投资笔记。",
            "要求：",
            "1. 只依据提供的原文，不要编造事实、业绩、人名或结论。原文没有的信息就省略。",
            "2. 写详细，不要写成几句摘要。尽量保留管理人、团队履历、规模、策略做法、交易品种、持有周期、容量、风控、业绩数字和近期观点。",
            "3. 有业绩或产品要素时用 HTML table 列出，表头用 th。",
            "4. 结构使用这些小节（没有内容的小节省略）：管理人与团队、策略与交易、产品与业绩、风控、近期观点、需要注意的点。",
            "5. 严格输出 JSON：{\"title\":\"不超过40字的标题\",\"content\":\"HTML正文\"}",
            "6. content 只用 div、b、p、ul、li、table、tr、th、td。不要 markdown，不要代码块。",
        ]
    )
    body = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 4096,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"渠道：{files[0]['channel']}\n共 {len(files)} 份资料。\n\n" + "\n\n".join(chunks)},
        ],
    }
    last = "AI 请求失败"
    for attempt in range(4):
        request = urllib.request.Request(
            base.rstrip("/") + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            last = f"HTTP {err.code}"
            if err.code == 429 or err.code >= 500:
                time.sleep(8 * (attempt + 1))
                continue
            detail = err.read().decode("utf-8", "replace")[:200]
            raise RuntimeError(f"HTTP {err.code} {detail}") from err
        raw = (((payload.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
        parsed = extract_json(raw)
        title = str(parsed.get("title") or "").strip()[:80]
        content = str(parsed.get("content") or "").strip()
        if not re.sub(r"<[^>]+>", "", content).strip():
            raise RuntimeError("AI 未返回可用正文")
        usage = payload.get("usage") or {}
        cost = int(usage.get("prompt_tokens") or 0) * PRICE_IN + int(usage.get("completion_tokens") or 0) * PRICE_OUT
        return title, content, cost
    raise RuntimeError(last)


def extract_json(text: str) -> dict:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    candidate = (fenced.group(1) if fenced else text).strip()
    start = candidate.find("{")
    if start >= 0:
        candidate = candidate[start:]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        repaired = re.sub(r"(?<!\\)\r?\n", r"\\n", candidate)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            title_match = re.search(r'"title"\s*:\s*"((?:\\.|[^"\\])*)"', candidate)
            content_match = re.search(r'"content"\s*:\s*"', candidate)
            if not content_match:
                raise
            body = candidate[content_match.end():]
            body = re.sub(r'"\s*,?\s*}\s*$', "", body)
            body = body.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
            if len(re.sub(r"<[^>]+>", "", body).strip()) < 200:
                raise
            title = title_match.group(1) if title_match else ""
            return {"title": title, "content": body}


def patch_note(note_id: str, title: str, content: str, files: list[dict]) -> None:
    """Reload before writing so a concurrent edit of another note is kept."""
    fresh = json.load(open(NOTES_PATH, encoding="utf-8"))
    for note in fresh:
        if note.get("id") != note_id:
            continue
        if title:
            note["title"] = title
        apply_meta(note, files, content)
        break
    save_json(NOTES_PATH, fresh)


def run_llm_only(env: dict[str, str], files: list[dict], clusters: list[list[dict]], notes: list[dict], manual_ids: set[str]) -> None:
    materials = json.load(open(MATERIALS_PATH, encoding="utf-8"))
    notes, dropped = dedupe_external_notes(notes, materials, files)
    if dropped:
        save_json(NOTES_PATH, notes)
        save_json(MATERIALS_PATH, materials)
        print(f"deduped {dropped}", flush=True)
    by_source = index_notes_by_source(notes)
    empty_by_title = {
        (note.get("title") or "").strip(): note
        for note in notes
        if note.get("creator") == AUTHOR and not (note.get("content") or "").strip()
    }
    queue: list[tuple[dict, list[dict]]] = []
    created = 0
    for cluster in clusters:
        group = choose_kept_files(cluster)
        if designed_html(group):
            continue
        linked = []
        seen = set()
        for item in cluster:
            note = by_source.get(norm_source(item["source"]))
            if note and note["id"] not in seen:
                seen.add(note["id"])
                linked.append(note)
        survivor = next((note for note in linked if note["id"] in manual_ids), None)
        if survivor is None and linked:
            survivor = linked[0]
        if survivor is None:
            survivor = empty_by_title.get(os.path.splitext(group[0]["name"])[0].strip())
        if survivor is None:
            survivor = shell_note(group)
            notes.append(survivor)
            created += 1
        if survivor["id"] in manual_ids or REFINED_MARK in (survivor.get("content") or ""):
            continue
        queue.append((survivor, group))
    if created:
        save_json(NOTES_PATH, notes)
    print(f"llm-only queue={len(queue)} new_shells={created}", flush=True)
    lock = threading.Lock()
    spent = 0.0
    done = 0

    def work(item: tuple[dict, list[dict]]):
        note, group = item
        title, content, cost = llm_summary(env, group)
        return note["id"], title, source_header(group) + content, cost, group

    workers = 4
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, item) for item in queue]
        for future in as_completed(futures):
            try:
                note_id, title, content, cost, group = future.result()
            except Exception as err:
                print(f"LLM FAIL {err}", flush=True)
                continue
            with lock:
                patch_note(note_id, title, content, group)
                spent += cost
                done += 1
                print(f"llm {done}/{len(queue)} ¥{spent:.2f} {title}", flush=True)
    print(f"llm_done={done} spent=¥{spent:.2f}", flush=True)


def save_json(path: str, data) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--skip-llm", action="store_true")
    parser.add_argument("--llm-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    if not args.llm_only and args.dry_run == args.apply:
        raise SystemExit("请指定 --dry-run 或 --apply")

    env = load_env()
    texts = load_chunks(env)
    files = build_files(texts)
    clusters = cluster_files(files)
    notes = json.load(open(NOTES_PATH, encoding="utf-8"))
    external = [note for note in notes if note.get("creator") == AUTHOR]
    by_source = index_notes_by_source(notes)

    multi = [c for c in clusters if len({item["dup"] for item in c}) > 1]
    designed = sum(1 for c in clusters if any(item["designed"] for item in c))
    dated = sum(1 for c in clusters if cluster_stamp(c))
    missing_notes = sum(1 for c in clusters if not any(norm_source(item["source"]) in by_source for item in c))
    print(
        f"files={len(files)} clusters={len(clusters)} multi={len(multi)} "
        f"designed_clusters={designed} dated={dated} external_notes={len(external)} "
        f"clusters_without_note={missing_notes}"
    )
    print("--- grouped ---")
    for cluster in sorted(multi, key=len, reverse=True):
        print(f"[{cluster[0]['channel']}] {cluster[0]['org']} n={len(cluster)} date={cluster_stamp(cluster)}")
        for item in cluster:
            flag = "NOTE" if item["designed"] else "deck"
            print(f"   {item['stamp'] or '????':10} {flag:4} {item['name']}")

    if args.llm_only:
        progress = {}
        if os.path.exists(PROGRESS_PATH):
            try:
                progress = json.load(open(PROGRESS_PATH, encoding="utf-8"))
            except json.JSONDecodeError:
                progress = {}
        manual_ids = capture_manual_ids(notes, progress)
        save_json(PROGRESS_PATH, progress)
        run_llm_only(env, files, clusters, notes, manual_ids)
        return

    if args.dry_run:
        undated = [item for item in files if not item["stamp"]]
        print(f"undated_files={len(undated)}")
        for item in undated[:12]:
            print("  undated", item["channel"], item["name"])
        print("--- no existing note ---")
        for cluster in clusters:
            if any(norm_source(item["source"]) in by_source for item in cluster):
                continue
            for item in cluster:
                print(" ", item["name"])
        sample = next((c for c in clusters if any(item["designed"] for item in c) and "会议纪要" in "".join(i["source"] for i in c)), None)
        report = next((c for c in clusters if any("/尽调报告/" in item["source"] for item in c)), None)
        for label, cluster in (("MINUTES", sample), ("REPORT", report)):
            if not cluster:
                continue
            item = next(entry for entry in cluster if entry["designed"])
            print(f"--- cleaned {label}: {item['name']} ---")
            print("\n".join(clean_lines(item["text"])[:18]))
        return

    materials = json.load(open(MATERIALS_PATH, encoding="utf-8"))
    notes, dropped = dedupe_external_notes(notes, materials, files)
    if dropped:
        print(f"deduped {dropped}")
    by_source = index_notes_by_source(notes)
    progress = {}
    if os.path.exists(PROGRESS_PATH):
        try:
            progress = json.load(open(PROGRESS_PATH, encoding="utf-8"))
        except json.JSONDecodeError:
            progress = {}
    manual_ids = capture_manual_ids(notes, progress)
    save_json(PROGRESS_PATH, progress)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(NOTES_PATH, NOTES_PATH + f".bak-external-refine-{stamp}")
    shutil.copy2(MATERIALS_PATH, MATERIALS_PATH + f".bak-external-refine-{stamp}")

    remove_ids: set[str] = set()
    llm_queue: list[tuple[dict, list[dict]]] = []
    attached = 0
    direct = 0
    kept = 0
    for cluster in clusters:
        linked = [by_source[norm_source(item["source"])] for item in cluster if norm_source(item["source"]) in by_source]
        unique_notes = []
        seen = set()
        for note in linked:
            if note["id"] in seen:
                continue
            seen.add(note["id"])
            unique_notes.append(note)
        files_to_keep = choose_kept_files(cluster)
        if not unique_notes:
            body = designed_html(files_to_keep)
            if body:
                note = shell_note(files_to_keep)
                apply_meta(note, files_to_keep, source_header(files_to_keep) + body)
                notes.append(note)
                attached += attach_files(note, files_to_keep, materials)
                direct += 1
            elif not args.skip_llm:
                note = shell_note(files_to_keep)
                notes.append(note)
                attached += attach_files(note, files_to_keep, materials)
                llm_queue.append((note, files_to_keep))
            continue
        survivor = next((note for note in unique_notes if note["id"] in manual_ids), None)
        if survivor is None:
            survivor = max(unique_notes, key=lambda note: len(note.get("content") or ""))
        for note in unique_notes:
            if note["id"] != survivor["id"] and note["id"] not in manual_ids:
                remove_ids.add(note["id"])
        attached += attach_files(survivor, files_to_keep, materials)
        if survivor["id"] in manual_ids:
            apply_meta(survivor, files_to_keep, None)
            kept += 1
            continue
        if REFINED_MARK in (survivor.get("content") or ""):
            apply_meta(survivor, files_to_keep, None)
            continue
        body = designed_html(files_to_keep)
        if body:
            apply_meta(survivor, files_to_keep, source_header(files_to_keep) + body)
            direct += 1
        else:
            apply_meta(survivor, files_to_keep, None)
            llm_queue.append((survivor, files_to_keep))

    if remove_ids:
        notes = [note for note in notes if note.get("id") not in remove_ids]
    save_json(NOTES_PATH, notes)
    save_json(MATERIALS_PATH, materials)
    done = set(progress.get("done") or [])
    done.update(item["source"] for item in files)
    progress["done"] = sorted(done)
    save_json(PROGRESS_PATH, progress)
    print(f"saved direct={direct} llm_pending={len(llm_queue)} removed={len(remove_ids)} attached={attached} hand_kept={kept}")

    if args.skip_llm:
        return
    spent = 0.0
    done_llm = 0
    limit = args.limit or len(llm_queue)
    for note, group in llm_queue:
        if done_llm >= limit:
            break
        try:
            title, content, cost = llm_summary(env, group)
            spent += cost
            if title:
                note["title"] = title
            apply_meta(note, group, source_header(group) + content)
            done_llm += 1
            if done_llm % 5 == 0:
                save_json(NOTES_PATH, notes)
            print(f"llm {done_llm} ¥{spent:.3f} {note['title']}")
        except Exception as err:
            print(f"LLM FAIL {note.get('title')}: {err}")
            save_json(NOTES_PATH, notes)
    save_json(NOTES_PATH, notes)
    print(f"llm_done={done_llm} spent=¥{spent:.2f}")


if __name__ == "__main__":
    main()
