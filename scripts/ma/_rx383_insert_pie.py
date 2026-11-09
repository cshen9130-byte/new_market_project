# -*- coding: utf-8 -*-
"""Insert the four-structure pie into the existing strategy report."""
import re
import sys
from pathlib import Path

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.shared import Inches, Pt
from docx.text.paragraph import Paragraph

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof  # noqa: E402
import _rx383_combined_report as rep  # noqa: E402
from docx import Document  # noqa: E402

ANCHOR = "四块相加就是全部"
CAPTION = "四块卖开手数占全部卖开的比例。四块相加等于全部卖开。"


def insert_after(paragraph):
    new_p = OxmlElement("w:p")
    paragraph._p.addnext(new_p)
    return Paragraph(new_p, paragraph._parent)


path = rep.ROOT / "reports" / "RX383_交易策略.docx"
doc = Document(str(path))
if any(CAPTION in p.text for p in doc.paragraphs):
    print("ALREADY", path)
    raise SystemExit(0)

anchor = next((p for p in doc.paragraphs if ANCHOR in p.text), None)
if anchor is None:
    raise SystemExit("anchor paragraph not found")
named = re.findall(
    r"(短宽跨式\(两边一起卖，不再买\)|短宽跨式加近买\(两边一起卖，再买一翼\)|比率价差\(只卖一边，再买同向\)|单边卖权\(只卖一边，不再买\))\s*(\d+)\s*手",
    anchor.text,
)
both, wing, ratio, naked = (int(n) for _name, n in named)
total = both + wing + ratio + naked
print("lots", both, wing, ratio, naked, "total", total)
pic = rep.four_type_pie({
    "both_only": both,
    "both_wing": wing,
    "one_wing": ratio,
    "one_naked": naked,
})

before = 0
seen_anchor = False
for p in doc.paragraphs:
    if p._p is anchor._p:
        seen_anchor = True
    if not seen_anchor and re.match(r"图\d+", p.text.strip()):
        before += 1
new_num = before + 1

for p in doc.paragraphs:
    if p._p is anchor._p:
        seen_anchor = True
        continue
    # second pass uses a flag set below
seen = False
for p in doc.paragraphs:
    if p._p is anchor._p:
        seen = True
        continue
    if not seen:
        continue
    m = re.match(r"图(\d+)", p.text.strip())
    if not m or int(m.group(1)) < new_num:
        continue
    rest = p.text[m.end():]
    p.text = f"图{int(m.group(1)) + 1}{rest}"
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in p.runs:
        prof.set_run_font(run, size=9, color=prof.MUTED)

img = insert_after(anchor)
img.alignment = WD_ALIGN_PARAGRAPH.CENTER
img.paragraph_format.space_before = Pt(6)
img.paragraph_format.space_after = Pt(2)
img.add_run().add_picture(str(pic), width=Inches(6.3))

cap = insert_after(img)
cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
cap.paragraph_format.space_before = Pt(2)
cap.paragraph_format.space_after = Pt(12)
run = cap.add_run(f"图{new_num}  {CAPTION}")
prof.set_run_font(run, size=9, color=prof.MUTED)

try:
    doc.save(path)
    print("SAVED", path, "fig", new_num)
except PermissionError:
    alt = path.with_name(path.stem + "_含四块饼图.docx")
    doc.save(alt)
    print("LOCKED", path)
    print("SAVED", alt, "fig", new_num)
