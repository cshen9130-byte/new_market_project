"""Export 博衍留芳1号A类 after switching 净值来源 from 团队净值 to 平台净值."""
from __future__ import annotations

import json
import re
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
            ctx, page = exp.launch(p, profile)
            try:
                page.goto(f"https://mp.fof99.com/fund/view/{fid}", wait_until="domcontentloaded", timeout=90000)
                page.wait_for_timeout(3000)
                matches = page.get_by_text("团队净值", exact=True)
                exp.emit(f"team-nav labels {matches.count()}")
                for i in range(min(matches.count(), 6)):
                    node = matches.nth(i)
                    info = node.evaluate(
                        """el => ({
                          tag: el.tagName,
                          cls: el.className,
                          parent: el.parentElement ? el.parentElement.className : '',
                          gp: el.parentElement && el.parentElement.parentElement
                            ? el.parentElement.parentElement.className : ''
                        })"""
                    )
                    exp.emit(f"label {i} {info}")
                source = matches.first
                source.click()
                page.wait_for_timeout(500)
                options = page.locator(".ant-select-item-option")
                exp.emit(f"options {options.count()}")
                for i in range(options.count()):
                    exp.emit(f"opt {i} {options.nth(i).inner_text()!r}")
                options.nth(0).evaluate(
                    """el => {
                      const fire = (name) => el.dispatchEvent(new MouseEvent(name, {bubbles:true, cancelable:true, view:window}));
                      fire('mousedown');
                      fire('mouseup');
                      el.click();
                    }"""
                )
                page.wait_for_timeout(1500)
                selected = source.inner_text().strip()
                exp.emit(f"selected {selected!r}")
                if selected != "平台净值":
                    raise RuntimeError(f"source stayed {selected}")
                page.wait_for_timeout(2500)
                column = page.get_by_text("单位净值", exact=True).first
                column.wait_for(timeout=20000)
                column.scroll_into_view_if_needed()
                box = column.bounding_box()
                if not box:
                    raise RuntimeError("nav column has no box")
                buttons = page.locator("button").filter(has_text=re.compile(r"导\s*出"))
                best = 0
                best_d = 10**9
                for i in range(buttons.count()):
                    bounds = buttons.nth(i).bounding_box() or {"y": 0}
                    dist = abs(bounds["y"] - box["y"])
                    if dist < best_d:
                        best_d = dist
                        best = i
                chosen = buttons.nth(best)
                download = None
                for _attempt in range(2):
                    try:
                        with page.expect_download(timeout=20000) as grabbed:
                            chosen.click()
                        download = grabbed.value
                        break
                    except Exception:
                        page.wait_for_timeout(1000)
                if download is None:
                    confirm = page.get_by_role("button", name=re.compile(r"确\s*定"))
                    confirm.wait_for(timeout=8000)
                    with page.expect_download(timeout=45000) as grabbed:
                        confirm.click()
                    download = grabbed.value
                suggested = download.suggested_filename
                if "净值" not in suggested:
                    raise RuntimeError(f"wrong file {suggested}")
                target = OUT / suggested
                if target.exists():
                    target = OUT / f"{CODE}_{suggested}"
                download.save_as(target)
                header = exp.xlsx_header(target)
                if header[:2] != ["日期", "单位净值"]:
                    target.unlink(missing_ok=True)
                    raise RuntimeError(f"bad header {header[:5]}")
                filename = target.name
                exp.emit(f"saved {filename}")
                rows = json.loads(MANIFEST.read_text(encoding="utf-8"))
                if not any(row.get("code") == CODE for row in rows):
                    rows.append({"code": CODE, "name": NAME, "file": filename})
                    MANIFEST.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
            finally:
                ctx.close()
    finally:
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
