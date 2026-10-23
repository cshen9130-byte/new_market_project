"""Retry the 博衍留芳1号A类 export and record why the NAV title was missing."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))
import _tmp_export_rest as exp  # noqa: E402

OUT = ROOT / "reports" / "fof99_web_export" / "chart_gaps"
MANIFEST = OUT / "manifest.json"
CODE = "ZG868A"
NAME = "博衍留芳1号A类"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    exp.OUT = OUT
    profile = exp.copy_profile()
    try:
        with exp.sync_playwright() as p:
            token, device = exp.read_session(p, profile)
            fid = exp.find_fid(token, device, CODE, NAME)
            exp.emit(f"fid {fid}")
            ctx, page = exp.launch(p, profile)
            try:
                page.goto(f"https://mp.fof99.com/fund/view/{fid}", wait_until="domcontentloaded", timeout=90000)
                page.wait_for_timeout(4000)
                body = page.locator("body").inner_text(timeout=15000)
                exp.emit(body[:1500].replace("\n", " | "))
                filename = exp.export_one(page, CODE, fid)
                exp.emit(f"saved {filename}")
                rows = json.loads(MANIFEST.read_text(encoding="utf-8"))
                rows.append({"code": CODE, "name": NAME, "file": filename})
                MANIFEST.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
            finally:
                ctx.close()
    finally:
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
