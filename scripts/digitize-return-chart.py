"""Digitize a blue return-line chart. stdout: JSON [[date, pct], ...]"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

from PIL import Image


def is_line(px, x: int, y: int) -> bool:
    r, g, b = px[x, y]
    return b > 170 and r < 130 and g < 170 and b > r + 60 and b > g + 20


def parse_iso(s: str) -> date:
    return date.fromisoformat(s[:10])


def main() -> None:
    path = Path(sys.argv[1])
    start = parse_iso(sys.argv[2]) if len(sys.argv) > 2 else date(2025, 12, 1)
    end = parse_iso(sys.argv[3]) if len(sys.argv) > 3 else date(2026, 9, 19)
    y_max = float(sys.argv[4]) if len(sys.argv) > 4 else 12.0
    if not (2.0 <= y_max <= 80.0):
        y_max = 12.0
    if end <= start:
        end = start + timedelta(days=120)

    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for x in range(w):
        for y in range(h):
            if is_line(px, x, y):
                xs.append(x)
                ys.append(y)
    if len(xs) < 20:
        print("[]")
        return
    x_left, x_right = min(xs), max(xs)
    y0 = max(ys)
    plot_top = max(4, int(h * 0.04))
    scale = max(1, y0 - plot_top)

    def pct_at(y: int) -> float:
        return (y0 - y) / scale * y_max

    span = max(1, (end - start).days)
    by: dict[str, list[float]] = {}
    for x in range(x_left, x_right + 1):
        col = [y for y in range(h) if is_line(px, x, y)]
        if not col:
            continue
        t = (x - x_left) / max(1, x_right - x_left)
        d = start + timedelta(days=round(t * span))
        by.setdefault(d.isoformat(), []).append(pct_at(min(col)))
    out = [[d, round(sum(v) / len(v), 3)] for d, v in sorted(by.items())]
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
