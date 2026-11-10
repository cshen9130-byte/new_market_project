# -*- coding: utf-8 -*-
"""Rewrite 结论 as main book, the other three blocks, and the shared short gamma."""
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep

PATH = Path(r"reports/RX383_交易策略.docx")


def texts(node) -> str:
    return "".join(t.text or "" for t in node.iter(qn("w:t")))


def main() -> None:
    doc = Document(str(PATH))
    body = doc.element.body
    concl = anchor = None
    for child in body:
        tx = texts(child).strip()
        if tx == "结论":
            concl = child
        elif tx.startswith("一、") and concl is not None and anchor is None:
            anchor = child
            break
    if concl is None or anchor is None:
        raise SystemExit("markers missing")
    node = concl.getnext()
    removed = 0
    while node is not None and node is not anchor:
        nxt = node.getnext()
        node.getparent().remove(node)
        removed += 1
        node = nxt
    sect = body[-1]
    tail = sect.getprevious()
    summary = {
        "sell_lots": 623,
        "end_date": "2026-11-03",
        "end_floating": -29096,
        "end_realized": 14518,
        "end_econ": -15826,
    }
    buckets = {
        "both_only": 358,
        "both_wing": 64,
        "one_wing": 69,
        "one_naked": 132,
        "one_call": 98,
        "one_put": 34,
    }
    rep.conclusion_body(
        doc,
        summary,
        buckets,
        {"p50": 0.13},
        {"p50": 0.12},
        {"p50": 0.023},
        {"lots": 641, "p50": 26, "min": 4, "max": 67},
        {"universe_med": 52, "k_med": 4.5, "logit": {"hits": 13, "k": 43}, "random": {"mean": 0.10}},
        "LC、LH",
        35,
        [None] * 17,
        {
            "expiry": {"dn15": -375762},
            "prem": 247764,
            "vol10": -172911,
            "fut_rows": [("LC", -17, 0), ("LH", -18, 0)],
        },
    )
    new = []
    node = tail.getnext()
    while node is not None and node is not sect:
        new.append(node)
        node = node.getnext()
    blob = "\n".join(texts(n) for n in new)
    if not blob.startswith("主力：短宽跨式，358 手，占 57%"):
        raise SystemExit("opening mismatch:\n" + blob[:200])
    for needle in ("其余：另外三块，265 手，占 43%", "死穴：四块都是负 gamma", "-37.6万", "看不出超额", "不是另押隐波回落"):
        if needle not in blob:
            raise SystemExit(f"missing {needle}")
    if texts(new[-1]).strip()[:2] != "账面":
        raise SystemExit("last line is not 账面")
    for node in new:
        anchor.addprevious(node)
    doc.save(str(PATH))
    print("removed", removed, "added", len(new))


if __name__ == "__main__":
    main()
