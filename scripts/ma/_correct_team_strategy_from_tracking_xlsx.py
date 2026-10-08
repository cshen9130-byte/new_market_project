#!/usr/bin/env python3
"""Correct type6 团队策略标签 from a 团队跟踪（私募） workbook.

  py -3 scripts/ma/_correct_team_strategy_from_tracking_xlsx.py <xlsx>
  py -3 scripts/ma/_correct_team_strategy_from_tracking_xlsx.py <xlsx> --apply
"""
from __future__ import annotations

import importlib.util
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(r"C:\coding\market_dashboard_website")
HELPER = ROOT / "scripts" / "ma" / "_export_find_data_nav.py"

spec = importlib.util.spec_from_file_location("findnav", HELPER)
nav = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(nav)


def log(msg: str) -> None:
    print(msg, flush=True)


def l3_parts(value: str) -> list[str]:
    if not value:
        return []
    out: list[str] = []
    for part in re.split(r"[，,、/]", value):
        p = part.strip()
        if p and p not in nav.EMPTY:
            out.append(p)
    return out


def l3_store(value: str) -> str | None:
    parts = l3_parts(value)
    return ",".join(parts) if parts else None


def l3_key(value: str | None) -> tuple[str, ...]:
    return tuple(sorted(l3_parts(value or "")))


def level(value: str) -> str | None:
    s = nav.trim(value)
    return s or None


def same_strategy(cur: tuple[str | None, str | None, str | None], nxt: tuple[str | None, str | None, str | None]) -> bool:
    return (cur[0] or None) == (nxt[0] or None) and (cur[1] or None) == (nxt[1] or None) and l3_key(cur[2]) == l3_key(nxt[2])


def core_key(raw: str) -> str:
    c = nav.core_name(raw)
    if c.endswith("基金") and len(c) > 4:
        c = c[:-2]
    c = re.sub(r"([abc])类份额$", r"\1类", c)
    return c


def name_keys(raw: str) -> set[str]:
    keys: set[str] = set()
    n = nav.norm_name(raw)
    c = core_key(raw)
    if n:
        keys.add(n)
    if c:
        keys.add(c)
    return {k for k in keys if k}


def names_compatible(left: str, right: str) -> bool:
    a, b = core_key(left), core_key(right)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True

    def bare(value: str) -> str:
        return re.sub(r"[abc]类?$", "", value)

    ba, bb = bare(a), bare(b)
    return bool(ba and bb and (ba == bb or ba == b or bb == a))


def canonical_code(code: str) -> str:
    return re.sub(r"\([ABC]级\)$", "", (code or "").strip().upper())


def read_sheet(path: Path) -> list[dict]:
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    header = [str(x or "").strip() for x in next(ws.iter_rows(max_row=1, values_only=True))]
    idx = {h: i for i, h in enumerate(header)}
    for col in ("产品名称", "团队一级策略", "团队二级策略", "团队三级策略"):
        if col not in idx:
            raise SystemExit(f"missing column {col}; got {header}")
    rows: list[dict] = []
    for raw in ws.iter_rows(min_row=2, values_only=True):
        name = nav.trim(raw[idx["产品名称"]])
        if not name or name in {"合计", "总计", "汇总"}:
            continue
        rows.append(
            {
                "product_name": name,
                "manager": nav.trim(raw[idx["基金管理人"]]) if "基金管理人" in idx else "",
                "l1": level(raw[idx["团队一级策略"]]),
                "l2": level(raw[idx["团队二级策略"]]),
                "l3": l3_store(nav.trim(raw[idx["团队三级策略"]])),
            }
        )
    wb.close()
    return rows


def pick(cands: list, manager: str):
    if not cands:
        return None, "unmatched"
    uniq: dict[str, object] = {}
    for fund in cands:
        uniq.setdefault(fund.code, fund)
    collapsed: dict[str, object] = {}
    for fund in uniq.values():
        base = canonical_code(fund.code)
        current = collapsed.get(base)
        if current is None or (fund.code == base and current.code != base):
            collapsed[base] = fund
    items = list(collapsed.values())
    if len(items) == 1:
        return items[0], "unique_name"
    mgr_hits = [f for f in items if nav.managers_overlap(manager, f.manager)]
    mgr_codes = {f.code for f in mgr_hits}
    if len(mgr_codes) == 1:
        return mgr_hits[0], "manager"
    return None, "ambiguous"


def load_names_and_strategies(cur):
    """Index 团队策略 rows by their own names.

    A longer title on the same 备案号 in another table is not treated as an alias
    unless it is the same product name (share-class / 基金 suffix included).
    """
    funds: list = []
    by_code: dict[str, object] = {}
    aliases: dict[str, set[str]] = defaultdict(set)

    def ensure(code: str):
        code = canonical_code(code)
        if not code:
            return None
        fund = by_code.get(code)
        if fund is None:
            fund = nav.DbFund(code, "", src="team")
            by_code[code] = fund
            funds.append(fund)
        return fund

    def add_alias(code: str, *names: str, manager: str = "", force: bool = False) -> None:
        fund = ensure(code)
        if fund is None:
            return
        if manager and not fund.manager:
            fund.manager = manager
        existing = [n for n in aliases[fund.code] if n]
        for name in names:
            cleaned = (name or "").strip()
            if not cleaned:
                continue
            if existing and not force and not any(names_compatible(cleaned, prev) for prev in existing):
                continue
            aliases[fund.code].add(cleaned)
            existing.append(cleaned)
            if not fund.name:
                fund.name = cleaned
            elif not fund.short and cleaned != fund.name:
                fund.short = cleaned

    cur.execute(
        """
        SELECT UPPER(BTRIM(register_number)),
               COALESCE(fund_name, ''),
               COALESCE(fund_short_name, ''),
               NULLIF(BTRIM(company_strategy_one), ''),
               NULLIF(BTRIM(company_strategy_two), ''),
               NULLIF(BTRIM(company_strategy_three), ''),
               updated_at
        FROM type6_ops_team_full
        WHERE register_number IS NOT NULL AND BTRIM(register_number) <> ''
        ORDER BY updated_at DESC NULLS LAST
        """
    )
    strategies: dict[str, tuple[str | None, str | None, str | None]] = {}
    for code, name, short, l1, l2, l3, _updated in cur.fetchall():
        base = canonical_code(code)
        add_alias(base, name, short, force=True)
        strategies.setdefault(base, (l1, l2, l3_store(l3 or "")))

    if nav.table_exists(cur, "private_fund_info_bfl"):
        cur.execute(
            """
            SELECT UPPER(BTRIM(beian_hao)), COALESCE(product_name,''), COALESCE(short_name,'')
            FROM private_fund_info_bfl
            WHERE beian_hao IS NOT NULL AND BTRIM(beian_hao) <> ''
            """
        )
        for code, name, short in cur.fetchall():
            add_alias(code, name, short, force=canonical_code(code) not in strategies)

    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), COALESCE(product_name,''), COALESCE(manager,'')
        FROM private_fund_info
        WHERE beian_hao IS NOT NULL AND BTRIM(beian_hao) <> ''
        """
    )
    for code, name, manager in cur.fetchall():
        add_alias(code, name, manager=manager, force=canonical_code(code) not in strategies)

    for fund in funds:
        names = [n for n in aliases.get(fund.code, set()) if n]
        if names and not fund.name:
            fund.name = names[0]
        if len(names) > 1 and not fund.short:
            fund.short = names[1]
    return funds, strategies, aliases


def index_funds(funds: list, aliases: dict[str, set[str]]) -> dict[str, list]:
    exact: dict[str, list] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for fund in funds:
        raw_names = aliases.get(fund.code) or {fund.name, fund.short}
        for raw in raw_names:
            for key in name_keys(raw or ""):
                token = (key, fund.code)
                if token in seen:
                    continue
                seen.add(token)
                exact[key].append(fund)
    return exact


def apply_updates(cur, changes: list[dict]) -> None:
    cur.execute(
        """
        CREATE TEMP TABLE strategy_fix (
          beian text PRIMARY KEY,
          l1 text,
          l2 text,
          l3 text,
          product_name text
        ) ON COMMIT DROP
        """
    )
    cur.executemany(
        "INSERT INTO strategy_fix (beian, l1, l2, l3, product_name) VALUES (%s,%s,%s,%s,%s)",
        [(c["code"], c["l1"], c["l2"], c["l3"], c["product_name"]) for c in changes],
    )
    cur.execute(
        """
        UPDATE type6_ops_team_full t
        SET company_strategy_one = s.l1,
            company_strategy_two = s.l2,
            company_strategy_three = s.l3,
            updated_at = NOW()
        FROM strategy_fix s
        WHERE UPPER(BTRIM(t.register_number)) = s.beian
        """
    )
    log(f"type6 rows updated: {cur.rowcount}")
    cur.execute(
        """
        INSERT INTO type6_ops_team_full (
          source_row_number, fund_name, fund_short_name, register_number,
          company_strategy_one, company_strategy_two, company_strategy_three,
          row_hash, source_file, imported_at, updated_at
        )
        SELECT
          (SELECT COALESCE(MAX(source_row_number), 0) FROM type6_ops_team_full)
            + ROW_NUMBER() OVER (ORDER BY s.beian),
          s.product_name,
          s.product_name,
          s.beian,
          s.l1,
          s.l2,
          s.l3,
          md5('team_tracking_xlsx_20261008::' || s.beian),
          'team_tracking_xlsx_20261008',
          NOW(),
          NOW()
        FROM strategy_fix s
        WHERE NOT EXISTS (
          SELECT 1 FROM type6_ops_team_full t
          WHERE UPPER(BTRIM(t.register_number)) = s.beian
        )
        """
    )
    log(f"type6 rows inserted: {cur.rowcount}")

    cache_tables = [
        "ops_tracking_funds_list_cache",
        "ops_managed_products_list_cache",
        "ops_fof_overview_list_cache",
        "ops_investment_overview_product_cache",
        "ops_investment_overview_underlying_cache",
    ]
    for table in cache_tables:
        if not nav.table_exists(cur, table):
            continue
        cols = nav.table_cols(cur, table)
        if not {"beian_hao", "company_strategy_l1", "company_strategy_l2", "company_strategy_l3"} <= cols:
            continue
        extra = ""
        if table == "ops_tracking_funds_list_cache" and "raw_strategy_json" in cols:
            extra = """,
              raw_strategy_json = CASE
                WHEN raw_strategy_json IS NULL THEN jsonb_build_object(
                  'company', jsonb_build_object('strategy_one', s.l1, 'strategy_two', s.l2, 'strategy_three', s.l3)
                )
                ELSE jsonb_set(
                  raw_strategy_json,
                  '{company}',
                  jsonb_build_object('strategy_one', s.l1, 'strategy_two', s.l2, 'strategy_three', s.l3),
                  true
                )
              END"""
        refreshed = ", refreshed_at = NOW()" if "refreshed_at" in cols else ""
        cur.execute(
            f"""
            UPDATE {table} c
            SET company_strategy_l1 = s.l1,
                company_strategy_l2 = s.l2,
                company_strategy_l3 = s.l3
                {extra}
                {refreshed}
            FROM strategy_fix s
            WHERE UPPER(BTRIM(c.beian_hao)) = s.beian
            """
        )
        log(f"{table} rows updated: {cur.rowcount}")


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--apply"]
    apply = "--apply" in sys.argv
    if not args:
        raise SystemExit("usage: _correct_team_strategy_from_tracking_xlsx.py <xlsx> [--apply]")
    path = Path(args[0])
    sheet_rows = read_sheet(path)
    log(f"sheet rows: {len(sheet_rows)}")

    tunnel = nav.start_tunnel()
    try:
        conn = nav.connect()
        conn.autocommit = False
        cur = conn.cursor()
        log("Loading fund names ...")
        funds, strategies, aliases = load_names_and_strategies(cur)
        log(f"catalog codes: {len(funds)}; type6 strategies: {len(strategies)}")
        index = index_funds(funds, aliases)

        def lookup(row, keys):
            cands = []
            for key in keys:
                cands.extend(index.get(key, []))
            return pick(cands, row["manager"])

        matched = []
        unmatched = []
        ambiguous = []
        no_type6 = []
        methods = Counter()
        for row in sheet_rows:
            fund, how = lookup(row, name_keys(row["product_name"]))
            if fund is None and how != "ambiguous":
                loose = core_key(row["product_name"])
                loose = re.sub(r"[abc]类$", "", loose)
                loose = re.sub(r"[abc]$", "", loose)
                extra = {loose} if loose else set()
                if re.search(r"[abc]$", core_key(row["product_name"])):
                    extra.add(core_key(row["product_name"]) + "类")
                fund, how = lookup(row, extra)
                if fund is not None:
                    how = "share_class"
                    current = strategies.get(fund.code)
                    if current and (current[0] or None) != (row["l1"] or None):
                        fund, how = None, "unmatched"
            methods[how if fund or how == "ambiguous" else "unmatched"] += 1
            if how == "ambiguous":
                ambiguous.append((row, [], 0))
                continue
            if fund is None:
                unmatched.append(row)
                continue
            if fund.code not in strategies:
                if row["l1"] or row["l2"] or row["l3"]:
                    no_type6.append((row, fund))
                continue
            matched.append((row, fund, how))

        by_code: dict[str, list] = defaultdict(list)
        for row, fund, how in matched:
            by_code[fund.code].append((row, fund, how))

        changes = []
        same = 0
        conflicts = []
        for code, group in by_code.items():
            triples = {(r["l1"], r["l2"], r["l3"]) for r, _f, _h in group}
            if len(triples) > 1:
                conflicts.append((code, group))
                continue
            row, fund, how = group[0]
            current = strategies[code]
            target = (row["l1"], row["l2"], row["l3"])
            if same_strategy(current, target):
                same += 1
                continue
            changes.append(
                {
                    "code": code,
                    "product_name": row["product_name"],
                    "db_name": fund.name,
                    "how": how,
                    "l1": target[0],
                    "l2": target[1],
                    "l3": target[2],
                    "from": current,
                    "insert": False,
                }
            )

        for row, fund in no_type6:
            changes.append(
                {
                    "code": fund.code,
                    "product_name": fund.name or row["product_name"],
                    "db_name": fund.name,
                    "how": "insert",
                    "l1": row["l1"],
                    "l2": row["l2"],
                    "l3": row["l3"],
                    "from": (None, None, None),
                    "insert": True,
                }
            )

        log(f"matched unique codes: {len(by_code)}")
        log(f"already correct: {same}")
        log(f"to write: {len(changes)} (update {sum(1 for c in changes if not c['insert'])}, insert {sum(1 for c in changes if c['insert'])})")
        log(f"unmatched: {len(unmatched)}")
        log(f"ambiguous: {len(ambiguous)}")
        log(f"matched but no type6 row: {len(no_type6)}")
        log(f"conflicting sheet rows for one code: {len(conflicts)}")
        log(f"match methods: {dict(methods)}")

        clears = sum(1 for c in changes if not c["l1"] and not c["l2"] and not c["l3"])
        log(f"of which clear-to-empty: {clears}")
        log("--- sample changes ---")
        for c in changes[:40]:
            log(
                f"{c['code']} {c['product_name']} | "
                f"{c['from'][0] or '-'} / {c['from'][1] or '-'} / {c['from'][2] or '-'}  =>  "
                f"{c['l1'] or '-'} / {c['l2'] or '-'} / {c['l3'] or '-'}"
            )
        if unmatched[:15]:
            log("--- sample unmatched ---")
            for row in unmatched[:15]:
                log(f"{row['product_name']} | {row['manager']} | {row['l1']}/{row['l2']}/{row['l3']}")
        if ambiguous[:10]:
            log("--- sample ambiguous ---")
            for row, codes, n in ambiguous[:10]:
                log(f"{row['product_name']} | {row['manager']} | {n} codes {codes}")

        report = ROOT / "data" / "runtime" / "team-strategy-correction-preview.txt"
        report.parent.mkdir(parents=True, exist_ok=True)
        lines = [
            f"sheet={path}",
            f"to_update={len(changes)} already={same} unmatched={len(unmatched)} ambiguous={len(ambiguous)} no_type6={len(no_type6)} conflicts={len(conflicts)}",
            "",
            "CHANGES",
        ]
        for c in changes:
            lines.append(
                f"{c['code']}\t{c['product_name']}\t{c['from'][0] or ''}/{c['from'][1] or ''}/{c['from'][2] or ''}\t=>\t{c['l1'] or ''}/{c['l2'] or ''}/{c['l3'] or ''}"
            )
        lines.append("")
        lines.append("UNMATCHED")
        for row in unmatched:
            lines.append(f"{row['product_name']}\t{row['manager']}\t{row['l1'] or ''}/{row['l2'] or ''}/{row['l3'] or ''}")
        lines.append("")
        lines.append("AMBIGUOUS")
        for row, codes, n in ambiguous:
            lines.append(f"{row['product_name']}\t{row['manager']}\t{n}\t{','.join(codes)}")
        lines.append("")
        lines.append("NO_TYPE6")
        for row, fund in no_type6:
            lines.append(f"{fund.code}\t{row['product_name']}\t{fund.name}")
        report.write_text("\n".join(lines) + "\n", encoding="utf-8")
        log(f"preview: {report}")

        if not apply:
            conn.rollback()
            log("dry-run only (pass --apply to write)")
            return 0
        if not changes:
            conn.rollback()
            log("nothing to write")
            return 0
        apply_updates(cur, changes)
        conn.commit()
        log(f"committed {len(changes)} product strategy corrections")
        return 0
    finally:
        if tunnel is not None:
            tunnel.kill()


if __name__ == "__main__":
    raise SystemExit(main())
