"""Export platform NAV workbooks for funds whose chart stops before 火富牛.

Same login and 导出 button path as scripts/ma/_tmp_export_rest.py.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

import _tmp_export_rest as exp  # noqa: E402

OUT = ROOT / "reports" / "fof99_web_export" / "chart_gaps"
LOG = ROOT / "reports" / "fof99_export_chart_gaps.jsonl"
MANIFEST = OUT / "manifest.json"

PRODUCTS = [
    ("SGU760", "天鹭量化一号"),
    ("SB933C", "九鞅禾瑞十号C类"),
    ("SATL22", "木莲安澜1号"),
    ("L1596C", "九鞅禾禧五号C类"),
    ("SXF368", "博孚利锡泰稳强FOF1号"),
    ("SCR903", "华澄二号"),
    ("SLL138", "魔寓雁塔2号"),
    ("ABG50B", "金麦穗金秋稳健一号B类"),
    ("SXN204", "兰盈量化CTA1号私募证券投资基金"),
    ("ZG868A", "博衍留芳1号A类"),
    ("SADG72", "凯瑞稳健二号私募证券投资基金"),
    ("SAYP39", "量智数益CTA一号"),
    ("AUG23A", "钇远永意1号A类"),
    ("SAKD71", "宽价种子1号"),
]


def log(event: dict) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    exp.OUT = OUT
    OUT.mkdir(parents=True, exist_ok=True)
    profile = exp.copy_profile()
    saved: list[dict] = []
    failed: list[str] = []
    reason = "complete"
    try:
        with exp.sync_playwright() as p:
            token, device = exp.read_session(p, profile)
            ctx, page = exp.launch(p, profile)
            try:
                for index, (code, name) in enumerate(PRODUCTS, start=1):
                    exp.show_bar(index - 1, len(PRODUCTS), code, name, "fetch")
                    fid = None
                    missed = None
                    for attempt, wait in enumerate((0, 15, 45)):
                        if wait:
                            exp.emit(f"search empty {code} wait {wait}s")
                            time.sleep(wait)
                        try:
                            fid = exp.find_fid(token, device, code, name)
                            break
                        except exp.Miss as exc:
                            missed = exc
                            break
                        except (exp.EmptySearch, exp.RateLimit) as exc:
                            detail = str(exc)[:180]
                            log({"event": "retry", "code": code, "attempt": attempt + 1, "detail": detail})
                            exp.emit(f"retry {code} {detail}")
                            if isinstance(exc, exp.RateLimit) and attempt == 2:
                                reason = f"rate limit at {code}"
                                log({"event": "stop", "code": code, "reason": reason})
                                raise
                    if missed is not None:
                        failed.append(code)
                        log({"event": "fail", "code": code, "error": str(missed)[:220]})
                        exp.show_bar(index, len(PRODUCTS), code, name, "skip")
                        time.sleep(2)
                        continue
                    if fid is None:
                        reason = f"search stayed empty at {code}"
                        log({"event": "stop", "code": code, "reason": reason})
                        break
                    filename = None
                    try:
                        filename = exp.export_one(page, code, fid)
                    except Exception as exc:
                        failed.append(code)
                        message = f"{type(exc).__name__}: {exc}"[:220]
                        log({"event": "fail", "code": code, "error": message})
                        exp.show_bar(index, len(PRODUCTS), code, name, "fail")
                        exp.emit(message)
                        if isinstance(exc, exp.RateLimit):
                            reason = f"rate limit at {code}"
                            break
                        try:
                            page.close()
                        except Exception:
                            pass
                        page = ctx.new_page()
                        time.sleep(2)
                        continue
                    saved.append({"code": code, "name": name, "file": filename})
                    log({"event": "saved", "n": index, "code": code, "file": filename})
                    exp.show_bar(index, len(PRODUCTS), code, name, "saved")
                    time.sleep(2)
            finally:
                ctx.close()
    except (exp.RateLimit, exp.AuthError) as exc:
        reason = f"{type(exc).__name__}: {exc}"
        log({"event": "stop", "reason": reason[:300]})
        exp.emit(f"stop {reason[:300]}")
    except Exception:
        reason = traceback.format_exc()[-500:]
        log({"event": "crash", "reason": reason})
        exp.emit(reason)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    MANIFEST.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    log({"event": "finished", "saved": len(saved), "failed": failed, "reason": reason})
    exp.emit(f"finished saved={len(saved)} failed={len(failed)} {reason}")


if __name__ == "__main__":
    main()
