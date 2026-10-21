"""Extract fund valuation or performance PDF tables into an Excel workbook.

Valuation PDFs use the text table layer (科目代码 / 科目名称).
Performance PDFs use that text layer when it exists, and OCR for long-screenshot pages.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    _reconfigure = getattr(_stream, "reconfigure", None)
    if _reconfigure is not None:
        try:
            _reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass

import fitz
import pandas as pd

try:
    import numpy as np
    from PIL import Image
except ImportError:  # valuation-only installs can still run
    np = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]

HEADER_COLUMNS = [
    "科目代码",
    "科目名称",
    "数量",
    "单位成本",
    "成本",
    "成本占净值%",
    "市价",
    "市值",
    "市值占净值%",
    "估值增值",
    "停牌信息",
]

TEXT_MAX_PAGES = 80
OCR_MAX_PAGES = 10
MAX_IMAGE_WIDTH = 1400
MAX_IMAGE_HEIGHT = 16000
PREVIEW_ROWS = 12

STRIP_H = 1100
OVERLAP = 100
ROW_GAP = 24

WATERMARK_RE = re.compile(r"小何|笔记|公众号|无码|进群|微信|码版")
JUNK_RE = re.compile(r"^[《》「」\W_记]+$")
PERCENT_RE = re.compile(r"-?\d+(?:\.\d+)?%")
SCALE_STRAT_RE = re.compile(
    r"^(?P<scale>\d+\s*[~～~\-]\s*\d+\s*亿(?:以上)?|\d+\s*亿以上)(?P<strat>\S.+)$"
)
STRATEGY_LABEL_RE = re.compile(r"^(?:(?:[A-Za-z]{1,4}\d{2,4}|\d{2,4}|[一-鿿]{2,8})指增)$|^(?:量化选股|量化择时|量化对冲|量化多头|市场中性)$")
STRATEGY_PERCENT_RE = re.compile(
    r"^(?P<strat>(?:(?:[A-Za-z]{1,4}\d{2,4}|\d{2,4}|[一-鿿]{2,8})指增|量化选股|量化择时|量化对冲|量化多头|市场中性))\d?(?P<pct>-?\d+(?:\.\d+)?%)$"
)
HEADER_LABEL_RE = re.compile(
    r"基金简称|产品名称|管理人|管理规模|规模|策略|近1周|今年|周超额|\d{4}年|\d{4}超额"
)


HEADER_LABEL_EXACT_RE = re.compile(
    r"^(?:基金简称|产品名称|管理人|管理规模|规模|策略|近1周|近1月|今年|周超额|\d{4}年|\d{4}超额)$"
)


def is_header_label(text: str) -> bool:
    return bool(HEADER_LABEL_EXACT_RE.fullmatch(text.replace(" ", "")))




def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def report(percent: float, message: str) -> None:
    bounded = max(0, min(99, int(percent)))
    print(f"PROGRESS\t{bounded}\t{message}", file=sys.stderr, flush=True)




def normalize_cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").strip()
    return re.sub(r"\s+", " ", text)


def extract_rows(doc: fitz.Document, max_pages: int) -> tuple[list[list[str]], bool]:
    truncated = doc.page_count > max_pages
    all_rows: list[list[str]] = []
    for index, page in enumerate(doc):
        if index >= max_pages:
            break
        try:
            tables = page.find_tables()
        except Exception:
            continue
        found = getattr(tables, "tables", None) or []
        for table in found:
            try:
                extracted = table.extract()
            except Exception:
                continue
            for row in extracted:
                cells = [normalize_cell(cell) for cell in row]
                if any(cells):
                    all_rows.append(cells)
    return all_rows, truncated


def is_valuation_header(row: list[str]) -> bool:
    joined = "".join(row)
    return "科目代码" in joined and "科目名称" in joined


def is_performance_header(row: list[str]) -> bool:
    joined = "".join(row).replace(" ", "")
    return "管理人" in joined and any(key in joined for key in ("基金简称", "产品名称", "策略"))


def parse_cover_lines(page: fitz.Page) -> dict[str, str]:
    lines = [line.strip() for line in page.get_text().splitlines() if line.strip()]
    meta: dict[str, str] = {}
    for line in lines[:20]:
        if line.startswith("估值日期"):
            meta["估值日期"] = line.split("：", 1)[-1].split(":", 1)[-1].strip()
        elif line.startswith("单位净值"):
            meta["单位净值"] = line.split("：", 1)[-1].split(":", 1)[-1].strip()
        elif "估值表" in line and "标题" not in meta:
            meta["标题"] = line
        elif "___" in line or "专用表" in line:
            meta["产品"] = line
    return meta


def pad_row(row: list[str], width: int) -> list[str]:
    if len(row) < width:
        return row + [""] * (width - len(row))
    return row[:width]


def dedupe_columns(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    columns: list[str] = []
    for index, name in enumerate(names):
        base = name.strip() or f"列{index + 1}"
        count = seen.get(base, 0) + 1
        seen[base] = count
        columns.append(base if count == 1 else f"{base}_{count}")
    return columns


def looks_like_header(row: list[str]) -> bool:
    text_cells = [cell for cell in row if cell]
    if len(text_cells) < 2:
        return False
    alpha = sum(1 for cell in text_cells if re.search(r"[A-Za-z\u4e00-\u9fff]", cell))
    return alpha >= max(1, len(text_cells) // 2)


def frame_payload(name: str, frame: pd.DataFrame) -> dict[str, object]:
    columns = [str(column) for column in frame.columns]
    preview: list[list[str]] = []
    for record in frame.head(PREVIEW_ROWS).itertuples(index=False, name=None):
        cells: list[str] = []
        for value in record:
            text = "" if value is None else str(value)
            cells.append(text if len(text) <= 200 else f"{text[:200]}…")
        preview.append(cells)
    return {
        "name": name,
        "columns": columns,
        "rowCount": int(len(frame)),
        "preview": preview,
    }


def unique_sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[\\/*?:\[\]]", "", name).strip() or "表格"
    cleaned = cleaned[:31]
    if cleaned not in used:
        used.add(cleaned)
        return cleaned
    number = 2
    while True:
        suffix = f"_{number}"
        candidate = f"{cleaned[: 31 - len(suffix)]}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        number += 1


def write_workbook(
    xlsx_path: Path,
    meta_rows: list[tuple[str, str]],
    frames: list[tuple[str, pd.DataFrame]],
) -> list[dict[str, object]]:
    sheets: list[dict[str, object]] = []
    used = {"概要"}
    with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
        pd.DataFrame(meta_rows, columns=["字段", "值"]).to_excel(writer, sheet_name="概要", index=False)
        for name, frame in frames:
            sheet_name = unique_sheet_name(name, used)
            frame.to_excel(writer, sheet_name=sheet_name, index=False)
            sheets.append(frame_payload(sheet_name, frame))
    return sheets


def valuation_frame(rows: list[list[str]]) -> tuple[pd.DataFrame, str, list[str]]:
    header_idx = next((index for index, row in enumerate(rows) if is_valuation_header(row)), None)
    warnings: list[str] = []
    if header_idx is None:
        width = max(len(row) for row in rows)
        normalized = [pad_row(row, width) for row in rows]
        if looks_like_header(normalized[0]):
            columns = dedupe_columns(normalized[0])
            data_rows = normalized[1:]
        else:
            columns = [f"列{index + 1}" for index in range(width)]
            data_rows = normalized
        warnings.append("未识别到标准估值表表头，已按原始表格导出。")
        return pd.DataFrame(data_rows, columns=columns), "提取表格", warnings

    header = rows[header_idx]
    width = len(header)
    columns = HEADER_COLUMNS if width == len(HEADER_COLUMNS) else dedupe_columns(header)
    data_rows = [
        pad_row(row, width)
        for row in rows[header_idx + 1 :]
        if not is_valuation_header(row)
    ]
    return pd.DataFrame(data_rows, columns=columns), "估值明细", warnings


def convert_text_tables(
    doc: fitz.Document,
    xlsx_path: Path,
    rows: list[list[str]],
    truncated: bool,
    kind: str,
) -> dict[str, object]:
    warnings: list[str] = []
    if truncated:
        warnings.append(f"仅处理前 {TEXT_MAX_PAGES} 页。")
    if not rows:
        raise RuntimeError("未从 PDF 中识别到文字表格。扫描件或业绩截图请改用「业绩表」。")

    meta = [("页数", str(doc.page_count))]
    if kind == "valuation":
        cover = parse_cover_lines(doc[0])
        frame, sheet_name, frame_warnings = valuation_frame(rows)
        detected = "valuation" if sheet_name == "估值明细" else "tables"
        meta.insert(0, ("类型", "估值表" if detected == "valuation" else "通用表格"))
        for key in ("标题", "产品", "估值日期", "单位净值"):
            if cover.get(key):
                meta.append((key, cover[key]))
        warnings.extend(frame_warnings)
        frames = [(sheet_name, frame)]
    else:
        detected = "performance"
        meta.insert(0, ("类型", "业绩表"))
        meta.append(("识别方式", "文字表格"))
        frames = performance_frames(rows)
        if not frames:
            raise RuntimeError("未识别到业绩表。表头需要包含管理人，以及基金简称、产品名称或策略。")
    if not any(len(frame.index) or len(frame.columns) for _, frame in frames):
        raise RuntimeError("表格为空，没有可导出的数据。")

    report(96, "正在写入 Excel")
    sheets = write_workbook(xlsx_path, meta, frames)
    return {
        "detectedMode": detected,
        "method": "text",
        "pageCount": doc.page_count,
        "meta": [{"field": field, "value": value} for field, value in meta],
        "sheets": sheets,
        "warnings": warnings,
    }


def performance_frames(rows: list[list[str]]) -> list[tuple[str, pd.DataFrame]]:
    header_indexes = [index for index, row in enumerate(rows) if is_performance_header(row)]
    frames: list[tuple[str, pd.DataFrame]] = []
    for position, header_index in enumerate(header_indexes):
        end = header_indexes[position + 1] if position + 1 < len(header_indexes) else len(rows)
        header = rows[header_index]
        width = len(header)
        columns = dedupe_columns(header)
        data_rows = [
            pad_row(row, width)
            for row in rows[header_index + 1 : end]
            if any(row) and not is_performance_header(row)
        ]
        name = "业绩明细" if position == 0 else f"业绩明细_{position + 1}"
        frames.append((name, pd.DataFrame(data_rows, columns=columns)))
    return frames


def page_has_images(page: fitz.Page) -> bool:
    try:
        return bool(page.get_images())
    except Exception:
        return False


def looks_like_screenshot(doc: fitz.Document) -> bool:
    text_chars = 0
    image_pages = 0
    sample = min(doc.page_count, 3)
    for index, page in enumerate(doc):
        if index < sample:
            text_chars += len(page.get_text().strip())
        if page_has_images(page):
            image_pages += 1
    if image_pages == 0:
        return False
    return text_chars < 80 * sample


@dataclass
class Box:
    text: str
    x0: float
    x1: float
    y0: float
    y1: float
    score: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


def require_ocr():
    if np is None or Image is None:
        raise RuntimeError("业绩表 OCR 依赖未安装，请执行: py -3 -m pip install rapidocr pillow numpy")
    try:
        from rapidocr import RapidOCR
    except ImportError as exc:
        raise RuntimeError("业绩表 OCR 依赖未安装，请执行: py -3 -m pip install rapidocr pillow numpy") from exc
    return RapidOCR


def cell_is_green(img: np.ndarray, box: Box) -> bool:
    patch = img[max(0, int(box.y0)) : int(box.y1), max(0, int(box.x0)) : int(box.x1)]
    if patch.size == 0 or patch.ndim != 3 or patch.shape[2] < 3:
        return False
    red = patch[:, :, 0].astype(np.int16)
    green = patch[:, :, 1].astype(np.int16)
    blue = patch[:, :, 2].astype(np.int16)
    dark = (red + green + blue) < 450
    green_px = int((dark & (green > red + 20) & (green > blue + 10)).sum())
    red_px = int((dark & (red > green + 20)).sum())
    return green_px > 30 and green_px > red_px * 2


def clean_cell(text: str) -> str:
    text = text.strip().replace("％", "%").replace("～", "~").replace("〜", "~")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"亿.上", "亿以上", text)
    percent = re.fullmatch(r"(-?\d+(?:\.\d+)?%)(.*)", text)
    if percent and percent.group(2) and len(percent.group(2)) <= 6 and not PERCENT_RE.search(percent.group(2)):
        text = percent.group(1)
    return text


def restore_sign(img: np.ndarray, box: Box) -> Box:
    text = clean_cell(box.text).replace("|", "")
    text = re.sub(r"\.{2,}", ".", text)
    leading = re.fullmatch(r"[^\d\-]*(-?\d+(?:\.\d+)?%)", text)
    if leading and not STRATEGY_LABEL_RE.fullmatch(text[: leading.start(1)]):
        text = leading.group(1)
    if re.fullmatch(r"\d+(?:\.\d+)?%", text) and cell_is_green(img, box):
        text = f"-{text}"
    if text == box.text:
        return box
    return Box(text, box.x0, box.x1, box.y0, box.y1, box.score)


def ocr_image(engine, img: np.ndarray, on_strip=None, gap: float = ROW_GAP) -> list[Box]:
    height = img.shape[0]
    boxes: list[Box] = []
    y = 0
    strip_index = 0
    strips = max(1, int(np.ceil((height - OVERLAP) / (STRIP_H - OVERLAP))))
    while y < height:
        y1 = min(height, y + STRIP_H)
        strip = Image.fromarray(img[y:y1])
        strip_index += 1
        if on_strip:
            on_strip(strip_index, strips)
        log(f"  strip {strip_index}/{strips} y={y}")
        result = engine(strip)
        txts = getattr(result, "txts", None) or [] if result is not None else []
        boxes_attr = getattr(result, "boxes", None) if result is not None else None
        scores = getattr(result, "scores", None) if result is not None else None
        if boxes_attr is not None and scores is not None:
          for text, quad, score in zip(txts, boxes_attr, scores):
            text = str(text).strip()
            if not text or WATERMARK_RE.search(text) or JUNK_RE.fullmatch(text):
                continue
            xs = [float(point[0]) for point in quad]
            ys = [float(point[1]) for point in quad]
            top, bot = min(ys), max(ys)
            touches_edge = (y > 0 and top < 8) or (y1 < height and bot > (y1 - y) - 8)
            if touches_edge:
                continue
            boxes.append(Box(text, min(xs), max(xs), y + top, y + bot, float(score)))
        if y1 >= height:
            break
        y += STRIP_H - OVERLAP
    return dedup_boxes(boxes, gap)


def dedup_boxes(boxes: list[Box], gap: float = ROW_GAP) -> list[Box]:
    boxes.sort(key=lambda box: (box.cy, box.cx))
    kept: list[Box] = []
    x_tol = max(8.0, 25.0 * gap / ROW_GAP)
    for box in boxes:
        duplicate = False
        for prev in reversed(kept[-40:]):
            if box.cy - prev.cy > gap:
                break
            if abs(box.cx - prev.cx) < x_tol and box.text == prev.text:
                duplicate = True
                if box.score > prev.score:
                    prev.score = box.score
                break
        if not duplicate:
            kept.append(box)
    return kept


def split_glued(boxes: list[Box]) -> list[Box]:
    output: list[Box] = []
    for box in boxes:
        compact = box.text.replace(" ", "").replace("％", "%")
        parts = PERCENT_RE.findall(compact)
        residue = PERCENT_RE.sub("", compact)
        if len(parts) >= 2 and len(residue) <= 4:
            width = (box.x1 - box.x0) / len(parts)
            for index, part in enumerate(parts):
                output.append(
                    Box(
                        part,
                        box.x0 + index * width,
                        box.x0 + (index + 1) * width,
                        box.y0,
                        box.y1,
                        box.score,
                    )
                )
            continue
        output.append(box)
    return output


def cluster_rows(boxes: list[Box], gap: float = ROW_GAP) -> list[list[Box]]:
    rows: list[list[Box]] = []
    centers: list[float] = []
    for box in sorted(boxes, key=lambda item: item.cy):
        if not rows or box.cy - centers[-1] > gap:
            rows.append([box])
            centers.append(box.cy)
        else:
            rows[-1].append(box)
            count = len(rows[-1])
            centers[-1] = (centers[-1] * (count - 1) + box.cy) / count
    for row in rows:
        row.sort(key=lambda item: item.cx)
    return rows


def is_ocr_header_row(row: list[Box]) -> bool:
    joined = "".join(box.text for box in row)
    return "管理人" in joined and any(key in joined for key in ("基金简称", "产品名称", "策略"))


def explode_header(row: list[Box]) -> list[Box]:
    cells: list[Box] = []
    for box in row:
        labels = HEADER_LABEL_RE.findall(box.text.replace(" ", ""))
        if len(labels) < 2:
            cells.append(box)
            continue
        width = (box.x1 - box.x0) / len(labels)
        for index, label in enumerate(labels):
            cells.append(
                Box(
                    label,
                    box.x0 + index * width,
                    box.x0 + (index + 1) * width,
                    box.y0,
                    box.y1,
                    box.score,
                )
            )
    return cells



def split_header_boxes(row: list[Box]) -> tuple[list[Box], list[Box]]:
    labels: list[Box] = []
    spilled: list[Box] = []
    for box in explode_header(row):
        compact = box.text.replace(" ", "")
        if is_header_label(compact):
            labels.append(Box(compact, box.x0, box.x1, box.y0, box.y1, box.score))
        elif compact:
            spilled.append(box)
    return labels, spilled


def bounds_from_boxes(labels: list[Box], width: int) -> tuple[list[str], list[float]]:
    cells = sorted(labels, key=lambda box: box.cx)
    names = dedupe_columns([box.text for box in cells])
    centers = [box.cx for box in cells]
    bounds = [0.0]
    for left, right in zip(centers, centers[1:]):
        bounds.append((left + right) / 2)
    bounds.append(float(width))
    return names, bounds


def header_columns(row: list[Box], width: int) -> tuple[list[str], list[float]]:
    cells = sorted(explode_header(row), key=lambda box: box.cx)
    names = [box.text.replace(" ", "") for box in cells]
    centers = [box.cx for box in cells]
    bounds = [0.0]
    for left, right in zip(centers, centers[1:]):
        bounds.append((left + right) / 2)
    bounds.append(float(width))
    return names, bounds


def column_index(bounds: list[float], x: float) -> int:
    for index in range(len(bounds) - 1):
        if bounds[index] <= x < bounds[index + 1]:
            return index
    return len(bounds) - 2


def put_cell(values: list[str], index: int, text: str) -> None:
    text = clean_cell(text)
    if not text:
        return
    if not values[index]:
        values[index] = text
        return
    if text in values[index] or values[index] in text:
        if len(text) > len(values[index]):
            values[index] = text
        return
    values[index] = f"{values[index]}{text}"


def strategy_column(names: list[str]) -> int | None:
    for index, name in enumerate(names):
        if "策略" in str(name):
            return index
    return None


def assign_row(row: list[Box], names: list[str], bounds: list[float]) -> list[str]:
    values = [""] * len(names)
    strat_idx = strategy_column(names)
    for box in row:
        text = box.text.replace(" ", "").replace("−", "-").replace("–", "-")
        center = column_index(bounds, box.cx)
        glued = STRATEGY_PERCENT_RE.fullmatch(text)
        if glued and strat_idx is not None:
            put_cell(values, strat_idx, glued.group("strat"))
            pct_idx = center if center > strat_idx else min(strat_idx + 1, len(names) - 1)
            put_cell(values, pct_idx, glued.group("pct"))
            continue
        if strat_idx is not None and center >= strat_idx and STRATEGY_LABEL_RE.fullmatch(text):
            put_cell(values, strat_idx, text)
            continue
        left = column_index(bounds, box.x0 + 4)
        right = column_index(bounds, box.x1 - 4)
        match = SCALE_STRAT_RE.match(text)
        if match and right > left:
            put_cell(values, left, match.group("scale"))
            strat_text = match.group("strat")
            if strat_idx is not None and STRATEGY_LABEL_RE.fullmatch(strat_text):
                put_cell(values, strat_idx, strat_text)
            else:
                glued_tail = STRATEGY_PERCENT_RE.fullmatch(strat_text)
                if glued_tail and strat_idx is not None:
                    put_cell(values, strat_idx, glued_tail.group("strat"))
                    pct_idx = right if right > strat_idx else min(strat_idx + 1, len(names) - 1)
                    put_cell(values, pct_idx, glued_tail.group("pct"))
                else:
                    put_cell(values, right, strat_text)
            continue
        put_cell(values, center, text)
    strat_idx = strategy_column(names)
    if strat_idx is not None:
        for index, value in enumerate(list(values)):
            if not value or index == strat_idx:
                continue
            glued = STRATEGY_PERCENT_RE.fullmatch(value.replace(" ", ""))
            if not glued:
                continue
            strat = glued.group("strat")
            current = values[strat_idx]
            if not current or len(strat) > len(current):
                values[strat_idx] = strat
            values[index] = glued.group("pct")
    return values



def fix_percent(text: str, aggressive: bool) -> str:
    match = re.fullmatch(r"(-?)(\d{3,4})%", text)
    if not match:
        return text
    sign, digits = match.group(1), match.group(2)
    if aggressive and len(digits) == 3:
        return f"{sign}{digits[0]}.{digits[1:]}%"
    if int(digits) >= 300:
        return f"{sign}{digits[:-2]}.{digits[-2:]}%"
    return text


def clean_strategy(text: str) -> str:
    match = re.search(r"(\d+指增|量化选股|量化择时|量化对冲|量化多头|套利|债券|中性)$", text)
    if match and match.start() > 0 and match.start() <= 4:
        return match.group(1)
    return text


def page_to_frame(img: np.ndarray, boxes: list[Box], gap: float = ROW_GAP) -> tuple[pd.DataFrame, list[str]]:
    boxes = [
        Box(clean_cell(box.text).replace("|", ""), box.x0, box.x1, box.y0, box.y1, box.score)
        for box in boxes
    ]
    boxes = split_glued(boxes)
    boxes = [restore_sign(img, box) for box in boxes]
    rows = cluster_rows(boxes, gap)
    header_index = next((index for index, row in enumerate(rows) if is_ocr_header_row(row)), None)
    if header_index is None:
        raise RuntimeError("未找到业绩表表头（需包含管理人，以及基金简称、产品名称或策略）。")

    labels, spilled = split_header_boxes(rows[header_index])
    if len(labels) >= 6:
        names, bounds = bounds_from_boxes(labels, img.shape[1])
    else:
        names, bounds = header_columns(rows[header_index], img.shape[1])
        names = dedupe_columns(names)
        spilled = []
    notes = ["".join(box.text for box in row) for row in rows[:header_index]]
    records: list[list[str]] = []
    if spilled and names:
        spilled_values = assign_row(spilled, names, bounds)
        if any(spilled_values):
            records.append(spilled_values)
    damaged: set[int] = set()
    for row in rows[header_index + 1 :]:
        if is_ocr_header_row(row):
            continue
        values = assign_row(row, names, bounds)
        for index, value in enumerate(values):
            if "策略" in names[index]:
                value = clean_strategy(value)
            if "%" in value:
                value = fix_percent(value, index in damaged)
            values[index] = value
        if any(values):
            records.append(values)
    return pd.DataFrame(records, columns=names), notes


def columns_ok(frame: pd.DataFrame) -> bool:
    if not 10 <= len(frame.columns) <= 16:
        return False
    for name in frame.columns:
        label = str(name)
        if len(label) > 10 or re.search(r"(\d{4}).*\1", label):
            return False
    return True


def sheet_name_from_notes(notes: list[str], page_index: int) -> str:
    blob = " ".join(notes)
    match = re.search(r"按(.{2,16}?降序)", blob)
    if match:
        name = match.group(1).strip("-— ")
    else:
        name = f"第{page_index + 1}页"
    name = re.sub(r"[\\/*?:\[\]]", "", name)[:31]
    return name or f"第{page_index + 1}页"


def limit_image(image: np.ndarray) -> tuple[np.ndarray, bool]:
    height, width = image.shape[:2]
    scale = min(1.0, MAX_IMAGE_WIDTH / max(width, 1), MAX_IMAGE_HEIGHT / max(height, 1))
    if scale >= 0.999:
        return image, False
    resized = Image.fromarray(image).resize(
        (max(1, int(width * scale)), max(1, int(height * scale))),
        Image.Resampling.BILINEAR,
    )
    return np.array(resized), True


def header_quality(frame: pd.DataFrame) -> int:
    labels = sum(1 for name in frame.columns if is_header_label(str(name)))
    junk = len(frame.columns) - labels
    return labels * 10 - junk * 8 + min(len(frame.index), 40)


def needs_ocr_retry(frame: pd.DataFrame) -> bool:
    labels = sum(1 for name in frame.columns if is_header_label(str(name)))
    # Extra columns such as 夏普 or 回撤 are normal on a performance sheet.
    # A second full-page OCR only pays for itself when the header or the
    # body failed. Retrying every extra column freezes the progress bar
    # near the end of a long screenshot for several minutes.
    return len(frame.index) < 3 or labels < 6


def largest_embedded_image(doc: fitz.Document, page: fitz.Page) -> np.ndarray | None:
    best_bytes = None
    best_area = 0
    try:
        images = page.get_images(full=True) or []
    except Exception:
        return None
    for info in images:
        xref = info[0]
        try:
            extracted = doc.extract_image(xref)
        except Exception:
            continue
        area = int(extracted.get("width") or 0) * int(extracted.get("height") or 0)
        blob = extracted.get("image")
        if blob and area >= best_area:
            best_bytes = blob
            best_area = area
    if not best_bytes:
        return None
    with Image.open(io.BytesIO(best_bytes)) as picture:
        return np.array(picture.convert("RGB"))


def render_page(page: fitz.Page) -> np.ndarray:
    zoom = 1.0 if page.rect.height > 4000 else 2.0
    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    channels = pixmap.n
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, channels).copy()
    if channels == 4:
        image = image[:, :, :3]
    elif channels == 1:
        image = np.repeat(image, 3, axis=2)
    return image


def page_to_rgb(doc: fitz.Document, page: fitz.Page) -> np.ndarray:
    image = largest_embedded_image(doc, page)
    if image is None:
        image = render_page(page)
    if image.ndim == 2:
        image = np.repeat(image[:, :, None], 3, axis=2)
    if image.shape[2] == 4:
        image = image[:, :, :3]
    return image


def convert_performance_ocr(doc: fitz.Document, xlsx_path: Path) -> dict[str, object]:
    rapid_ocr = require_ocr()
    report(8, "正在加载识别模型")
    engine = rapid_ocr(params={"Global.log_level": "error", "Det.unclip_ratio": 1.15})
    fallback = None
    warnings = ["业绩表由截图 OCR 识别，百分比正负号请核对。"]
    page_total = doc.page_count
    page_limit = min(page_total, OCR_MAX_PAGES)
    if page_total > OCR_MAX_PAGES:
        warnings.append(f"业绩截图仅处理前 {OCR_MAX_PAGES} 页。")

    frames: list[tuple[str, pd.DataFrame]] = []
    meta: list[tuple[str, str]] = [
        ("类型", "业绩表"),
        ("识别方式", "截图 OCR"),
        ("页数", str(page_total)),
    ]
    for page_index in range(page_limit):
        log(f"page {page_index + 1}/{page_limit}")
        image = page_to_rgb(doc, doc[page_index])
        full_width = image.shape[1]
        image, shrunk = limit_image(image)
        scale = image.shape[1] / max(full_width, 1)
        gap = max(6.0, ROW_GAP * scale)
        if shrunk:
            warnings.append(f"第 {page_index + 1} 页图片过高，已缩小后再识别。")
        log(f"  size={image.shape[1]}x{image.shape[0]}")

        def on_strip(
            index: int,
            total: int,
            *,
            phase: str = "first",
            page_index: int = page_index,
            page_limit: int = page_limit,
        ) -> None:
            span = 80 / max(page_limit, 1)
            # First pass uses the first 70% of this page. A retry continues
            # upward from there, so the bar does not sit still and then jump backward.
            if phase == "retry":
                base = 12 + span * page_index + span * 0.7
                width = span * 0.3
                verb = "再识别"
            else:
                base = 12 + span * page_index
                width = span * 0.7
                verb = "识别"
            percent = base + width * (index / max(total, 1))
            report(percent, f"第 {page_index + 1}/{page_limit} 页，{verb} {index}/{total} 段")

        frame = None
        notes: list[str] = []
        try:
            boxes = ocr_image(engine, image, on_strip, gap)
            report(12 + (80 / max(page_limit, 1)) * (page_index + 0.7), f"第 {page_index + 1}/{page_limit} 页，正在整理表格")
            frame, notes = page_to_frame(image, boxes, gap)
        except RuntimeError:
            frame = None
        if frame is None or needs_ocr_retry(frame):
            report(12 + (80 / max(page_limit, 1)) * (page_index + 0.7), "表头不完整，正在再识别一次")
            if fallback is None:
                fallback = rapid_ocr(params={"Global.log_level": "error", "Det.unclip_ratio": 1.05})
            try:
                boxes = ocr_image(fallback, image, lambda index, total: on_strip(index, total, phase="retry"), gap)
                second, second_notes = page_to_frame(image, boxes, gap)
                if frame is None or header_quality(second) > header_quality(frame):
                    frame, notes = second, second_notes
            except RuntimeError as exc:
                if frame is None:
                    warnings.append(f"第 {page_index + 1} 页：{exc}")
                    continue
        name = sheet_name_from_notes(notes, page_index)
        frames.append((name, frame))
        meta.append((f"第{page_index + 1}页", " / ".join(notes)[:500]))
        meta.append((f"{name}行数", str(len(frame))))
        log(f"  rows={len(frame)} sheet={name}")

    if not frames:
        raise RuntimeError("未从业绩 PDF 中识别到表格。请确认页面包含基金简称、管理人和策略等表头。")
    sheets = write_workbook(xlsx_path, meta, frames)
    return {
        "detectedMode": "performance",
        "method": "ocr",
        "pageCount": page_total,
        "meta": [{"field": field, "value": value} for field, value in meta],
        "sheets": sheets,
        "warnings": warnings,
    }


def convert_performance(doc: fitz.Document, xlsx_path: Path) -> dict[str, object]:
    if looks_like_screenshot(doc):
        return convert_performance_ocr(doc, xlsx_path)
    report(12, "正在读取文字表格")
    rows, truncated = extract_rows(doc, TEXT_MAX_PAGES)
    if any(is_performance_header(row) for row in rows):
        return convert_text_tables(doc, xlsx_path, rows, truncated, "performance")
    if any(page_has_images(page) for page in doc):
        return convert_performance_ocr(doc, xlsx_path)
    raise RuntimeError("未识别到业绩表。文字表需要管理人与基金简称/策略表头；截图 PDF 需要包含页面图片。")


def convert_auto(doc: fitz.Document, xlsx_path: Path) -> dict[str, object]:
    report(5, "正在判断 PDF 类型")
    if looks_like_screenshot(doc):
        return convert_performance_ocr(doc, xlsx_path)
    report(12, "正在读取文字表格")
    rows, truncated = extract_rows(doc, TEXT_MAX_PAGES)
    if any(is_valuation_header(row) for row in rows):
        return convert_text_tables(doc, xlsx_path, rows, truncated, "valuation")
    if any(is_performance_header(row) for row in rows):
        return convert_text_tables(doc, xlsx_path, rows, truncated, "performance")
    if rows and not looks_like_screenshot(doc):
        return convert_text_tables(doc, xlsx_path, rows, truncated, "valuation")
    if any(page_has_images(page) for page in doc):
        return convert_performance_ocr(doc, xlsx_path)
    raise RuntimeError("未识别到可提取的表格。若这是业绩长图截图，请选择「业绩表」后重试。")


def convert(pdf_path: Path, xlsx_path: Path, mode: str) -> dict[str, object]:
    doc = fitz.open(pdf_path)
    try:
        if doc.needs_pass:
            raise RuntimeError("PDF 已加密，无法提取。")
        if doc.page_count == 0:
            raise RuntimeError("PDF 没有页面。")
        if mode == "valuation":
            rows, truncated = extract_rows(doc, TEXT_MAX_PAGES)
            return convert_text_tables(doc, xlsx_path, rows, truncated, "valuation")
        if mode == "performance":
            return convert_performance(doc, xlsx_path)
        if mode != "auto":
            raise RuntimeError("不支持的提取类型。")
        return convert_auto(doc, xlsx_path)
    finally:
        doc.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("xlsx")
    parser.add_argument("summary")
    parser.add_argument("--mode", choices=["auto", "valuation", "performance"], default="auto")
    args = parser.parse_args()
    try:
        summary = convert(Path(args.pdf), Path(args.xlsx), args.mode)
    except Exception as exc:
        message = str(exc).strip() or "PDF 提取失败。"
        print(message, file=sys.stderr)
        return 1
    Path(args.summary).write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
