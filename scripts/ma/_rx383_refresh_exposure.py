# -*- coding: utf-8 -*-
"""Replace the opening exposure section and renumber later figures once."""
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof
import _rx383_combined_report as rep

PATH = Path(r"reports/RX383_交易策略.docx")


def bump(doc, prefix: str, step: int) -> int:
    pat = re.compile(rf"^{prefix}(\d+)")
    n = 0
    for p in doc.paragraphs:
        m = pat.match(p.text.strip())
        if not m:
            continue
        newer = f"{prefix}{int(m.group(1)) + step}"
        done = False
        for run in p.runs:
            if run.text.startswith(prefix):
                run.text = pat.sub(newer, run.text, count=1)
                done = True
                break
        if not done and p.runs:
            p.runs[0].text = pat.sub(newer, p.text, count=1)
        n += 1
    return n


def main() -> None:
    doc = Document(str(PATH))
    if any("海军蓝是期权" in p.text for p in doc.paragraphs):
        print("ALREADY")
        return
    body = doc.element.body
    start = next(p._p for p in doc.paragraphs if p.text.strip() == "他在赚哪一种钱")
    end = next(p._p for p in doc.paragraphs if p.text.strip() == "结论")
    node = start
    while node is not None and node is not end:
        nxt = node.getnext()
        body.remove(node)
        node = nxt
    figs = bump(doc, "图", 4)
    tabs = bump(doc, "表", 1)
    print("bumped figs", figs, "tabs", tabs)
    seq = {"fig": 0, "tab": 0}

    def add_fig(pic, cap: str) -> None:
        p = Path(pic) if pic else None
        if p is None or not p.exists():
            return
        seq["fig"] += 1
        doc.add_picture(str(p), width=Inches(6.3))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        prof.caption(doc, f"图{seq['fig']}  {cap}")

    def add_tab(headers, body_rows, cap: str) -> None:
        prof.add_table(doc, headers, body_rows)
        seq["tab"] += 1
        prof.caption(doc, f"表{seq['tab']}  {cap}")

    prof.heading.offset = 0
    old_ids = {id(c) for c in list(body)}
    rep.write_exposure(doc, add_fig, add_tab)
    anchor = next(p._p for p in doc.paragraphs if p.text.strip() == "结论")
    for node in [c for c in list(body) if id(c) not in old_ids]:
        anchor.addprevious(node)
    doc.save(str(PATH))
    print("SAVED", seq)


if __name__ == "__main__":
    main()
