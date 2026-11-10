# -*- coding: utf-8 -*-
"""Insert the sector-margin chart under the conclusion pie."""
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


def main() -> None:
    facts = rep.sector_exposure()
    doc = Document(str(PATH))
    caps = [int(m.group(1)) for p in doc.paragraphs if (m := CAP.match(p.text))]
    if caps != list(range(1, 49)):
        raise SystemExit(f"figure numbers {caps[:10]} ... {caps[-3:]}")
    for p in doc.paragraphs:
        m = CAP.match(p.text)
        if not m or int(m.group(1)) < 8:
            continue
        new = f"图{int(m.group(1)) + 1}{m.group(2)}" + p.text[m.end():]
        p.runs[0].text = new
        for run in p.runs[1:]:
            run.text = ""
    body = doc.element.body
    anchor = None
    for child in body:
        if texts(child).startswith("主力"):
            anchor = child
            break
    if anchor is None:
        raise SystemExit("主力 missing")
    sect = body[-1]
    tail = sect.getprevious()
    doc.add_picture(str(facts["path"]), width=Inches(6.3))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    rep.prof.caption(doc, f"图8  {rep.SECTOR_CAP}")
    rep._sector_gloss(doc, facts)
    new = []
    node = tail.getnext()
    while node is not None and node is not sect:
        new.append(node)
        node = node.getnext()
    if len(new) != 6:
        raise SystemExit(f"expected 6 new blocks, got {len(new)}")
    for node in new:
        anchor.addprevious(node)
    doc.save(str(PATH))
    print("inserted", len(new))


if __name__ == "__main__":
    main()
