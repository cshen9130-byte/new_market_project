# -*- coding: utf-8 -*-
"""Replace figure 1 with the option-only greek chart and refresh its four lines."""
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep

PATH = Path(r"reports/RX383_交易策略.docx")


def texts(node) -> str:
    return "".join(t.text or "" for t in node.iter(qn("w:t")))


def main() -> None:
    doc = Document(str(PATH))
    body = doc.element.body
    cap = None
    for child in body:
        if texts(child).startswith("图1  "):
            cap = child
            break
    if cap is None:
        raise SystemExit("no 图1")
    prev = cap.getprevious()
    if len(list(prev.iter(qn("w:drawing")))) != 1:
        raise SystemExit("picture before 图1 not found")
    prev.getparent().remove(prev)
    doc.add_picture(str(rep.OUT / "charts" / "exposure_rank.png"), width=Inches(6.3))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    new = doc.paragraphs[-1]._p
    cap.addprevious(new)
    for p in doc.paragraphs:
        if p.text.startswith("图1  ") and p.runs:
            p.runs[0].text = (
                "图1  四根柱只算期权，不含期货。Delta 是涨 1%。Theta 是过 1 天。"
                "Vega 是隐波升 10 点。Gamma 是持有到到期、价格跌 15%。金色虚线是账上权利金。"
            )
            break
    new_lines = {
        "最大": ("Gamma", "    最大。到期跌 15% -37.6万，是权利金 +24.8万的 1.5 倍。"),
        "其次": ("Vega", "    隐波升 10 点 -17.3万。一天的费要攒 20 天，才抵这一下。"),
        "进账": ("Theta", "    一天 +0.9万。权利金从 10 月 15 日 +0.8万加到 +24.8万，还在建。"),
        "类型": ("Delta", "    两翼对掉了。涨 1% 只有 +1.1万。期货不在这张图里。"),
    }
    for p in doc.paragraphs:
        if not p.runs:
            continue
        key = p.runs[0].text.strip()
        if key in new_lines and len(p.runs) > 1:
            name, rest = new_lines[key]
            p.runs[0].text = name
            p.runs[1].text = rest
    doc.save(str(PATH))
    print("saved")


if __name__ == "__main__":
    main()
