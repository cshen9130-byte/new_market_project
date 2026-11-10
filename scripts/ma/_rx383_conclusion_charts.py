# -*- coding: utf-8 -*-
"""Put the four payoff shapes and the pie at the top of 结论."""
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep

PATH = Path(r"reports/RX383_交易策略.docx")
CAP = re.compile(r"^图(\d+)(\s+)")


def texts(node) -> str:
    return "".join(t.text or "" for t in node.iter(qn("w:t")))


def bump(paragraph) -> None:
    m = CAP.match(paragraph.text)
    if not m:
        return
    n = int(m.group(1))
    if n < 6:
        return
    new = f"图{n + 2}{m.group(2)}" + paragraph.text[m.end():]
    paragraph.runs[0].text = new
    for run in paragraph.runs[1:]:
        run.text = ""


def main() -> None:
    paths = rep.four_shape_charts()
    pie = rep.four_type_pie({
        "both_only": 358,
        "both_wing": 64,
        "one_wing": 69,
        "one_naked": 132,
    })
    doc = Document(str(PATH))
    body = doc.element.body
    caps = []
    for p in doc.paragraphs:
        m = CAP.match(p.text)
        if m:
            caps.append(int(m.group(1)))
    if caps != list(range(1, 47)):
        raise SystemExit(f"figure numbers are {caps[:8]}...{caps[-3:]}")
    concl = None
    for child in body:
        if texts(child).strip() == "结论":
            concl = child
            break
    if concl is None:
        raise SystemExit("结论 missing")
    anchor = concl.getnext()
    if anchor is None or not texts(anchor).startswith("主力"):
        raise SystemExit("主力 is not directly under 结论")
    before = True
    for p in doc.paragraphs:
        if p.text.strip() == "结论":
            before = False
            continue
        m = CAP.match(p.text)
        if m and before and int(m.group(1)) >= 6:
            raise SystemExit("a figure at or after 图6 sits above 结论")
    for p in doc.paragraphs:
        bump(p)
    sect = body[-1]
    tail = sect.getprevious()
    rep._picture_grid(doc, paths)
    rep.prof.caption(
        doc,
        "图6  四块的形状。期货价记成 100。海军蓝是到期，金色是还剩 30 天。虚线是行权价。"
        "加近买再买更近的认购，15 手卖对 2 手买。比率只卖认购，20 手卖对 2 手买。单边只卖认购。",
    )
    doc.add_picture(str(pie), width=Inches(6.3))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    rep.prof.caption(doc, "图7  四块卖开手数占全部卖开的比例。四块相加等于全部卖开。")
    new = []
    node = tail.getnext()
    while node is not None and node is not sect:
        new.append(node)
        node = node.getnext()
    if len(new) != 4:
        raise SystemExit(f"expected 4 new blocks, got {len(new)}")
    for node in new:
        anchor.addprevious(node)
    doc.save(str(PATH))
    print("inserted", len(new))


if __name__ == "__main__":
    main()
