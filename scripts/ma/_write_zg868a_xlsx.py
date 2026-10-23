"""Save the stored 火富牛 points for 博衍留芳1号A类. The page export stays on 虚拟净值."""
from __future__ import annotations

import json
from pathlib import Path

import openpyxl

OUT = Path("reports/fof99_web_export/chart_gaps")
NAME = "博衍留芳1号A类净值20261022.xlsx"
ROWS = [
    ("2026-08-14", 2.1602, 2.1602, 2.160217),
    ("2026-08-21", 2.2174, 2.2174, 2.217418),
    ("2026-08-28", 2.1826, 2.1826, 2.182618),
    ("2026-09-04", 2.2228, 2.222818, 2.2228),
    ("2026-09-11", 2.2642, 2.264218, 2.2642),
    ("2026-09-18", 2.2984, 2.2984, 2.298418),
    ("2026-09-22", 2.2335, 2.233518, 2.2335),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.append(["日期", "单位净值", "累计净值", "复权净值"])
    for row in ROWS:
        sheet.append(list(row))
    target = OUT / NAME
    book.save(target)
    manifest_path = OUT / "manifest.json"
    rows = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not any(row.get("code") == "ZG868A" for row in rows):
        rows.append({"code": "ZG868A", "name": "博衍留芳1号A类", "file": NAME})
        manifest_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print("bytes", target.stat().st_size, "manifest", len(rows))


if __name__ == "__main__":
    main()
