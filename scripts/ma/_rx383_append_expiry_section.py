# -*- coding: utf-8 -*-
"""Replace section 七 in the main strategy note, including the three charts."""
import re
import sys
from pathlib import Path

from docx.oxml.ns import qn

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof  # noqa: E402
import _rx383_combined_report as rep  # noqa: E402
from docx import Document  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.shared import Inches  # noqa: E402

path = rep.ROOT / "reports" / "RX383_交易策略.docx"
doc = Document(str(path))
body = doc.element.body
drop = False
for child in list(body):
    if child.tag == qn("w:sectPr"):
        continue
    if not drop:
        text = "".join(t.text or "" for t in child.xpath(".//w:t"))
        if text.startswith("七、持有到到期"):
            drop = True
    if drop:
        body.remove(child)

seq = {
    "fig": sum(1 for p in doc.paragraphs if re.match(r"图\d+", p.text.strip())),
    "tab": sum(1 for p in doc.paragraphs if re.match(r"表\d+", p.text.strip())),
}

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

rep.write_expiry_compare(doc, add_tab, add_fig)
try:
    doc.save(path)
    print("SAVED", path, "figs", seq["fig"], "tables", seq["tab"])
except PermissionError:
    alt = path.with_name(path.stem + "_含到期对照.docx")
    doc.save(alt)
    print("LOCKED", path)
    print("SAVED", alt, "figs", seq["fig"], "tables", seq["tab"])
