# -*- coding: utf-8 -*-
"""Insert structure×sector and risk×sector charts before 主力."""
import re
import sys
from pathlib import Path

import pandas as pd
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
    end = pd.Timestamp("2026-11-03")
    conn = rep.get_conn()
    try:
        trades = rep.base.load_account(conn)["opt_trades"]
    finally:
        conn.close()
    structure = rep.structure_by_sector(trades[pd.to_datetime(trades["dt"]) <= end])
    greeks = rep.exposure_facts()["by_sector"]
    totals = structure.groupby("kind")["sell"].sum().round(0).to_dict()
    if totals != {"短宽跨式": 358.0, "短宽跨式加近买": 64.0, "比率价差": 69.0, "单边卖权": 132.0}:
        raise SystemExit(f"structure totals changed: {totals}")
    paths = rep._sector_link_charts(structure, greeks)
    doc = Document(str(PATH))
    caps = [int(m.group(1)) for p in doc.paragraphs if (m := CAP.match(p.text))]
    if caps != list(range(1, 50)):
        raise SystemExit(f"figure numbers {caps[:8]} ... {caps[-3:]}")
    for p in doc.paragraphs:
        m = CAP.match(p.text)
        if not m or int(m.group(1)) < 9:
            continue
        new = f"图{int(m.group(1)) + 2}{m.group(2)}" + p.text[m.end():]
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
    for path, cap in (
        (paths["structure"], "图9  四块卖开的手数，按板块叠起来。同一天、同一品种才分进一块。样本到 11 月 3 日。"),
        (paths["risk"], "图10  11 月 3 日的期权。四张图横轴各自缩放。Delta 是涨 1%。Theta 是过 1 天。Vega 是隐波升 10 点。Gamma 是持有到到期、价格跌 15%。不含期货。"),
    ):
        doc.add_picture(str(path), width=Inches(6.3))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        rep.prof.caption(doc, cap)
    rep._link_gloss(doc, structure, greeks)
    new = []
    node = tail.getnext()
    while node is not None and node is not sect:
        new.append(node)
        node = node.getnext()
    if len(new) != 12:
        raise SystemExit(f"expected 12 new blocks, got {len(new)}: " + " | ".join(texts(n)[:24] for n in new))
    for node in new:
        anchor.addprevious(node)
    doc.save(str(PATH))
    print("inserted", len(new))


if __name__ == "__main__":
    main()
