"""Count two leftovers of the 火富牛 weekly design. Read-only.

1. Product chart stops before 火富牛 points already stored (manual tip blocks them).
2. 火富牛 series itself has an interior week that was never requested, while a
   later date is already stored. The weekly job only asks after have_through.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import resolve_week_target  # noqa: E402
from fof99_weekly_nav_fetch import connect, load_env  # noqa: E402

TODAY = date(2026, 10, 21)
# A later tip means the fund was updated past the hole, not merely abandoned.
TIP_FLOOR = date(2026, 9, 1)


def fridays_between(start: date, end: date) -> list[date]:
    d = start + timedelta(days=(4 - start.weekday()) % 7)
    out = []
    while d <= end:
        out.append(d)
        d += timedelta(days=7)
    return out


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    conn = connect()
    cur = conn.cursor()

    cur.execute(
        """
        WITH manual AS (
          SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(nav_date) AS tip, COUNT(*) AS n
          FROM ops_team_nav_manual
          WHERE nav_type = 'pre_fee'
          GROUP BY 1
        ),
        email AS (
          SELECT UPPER(BTRIM(product_code)) AS code, MAX(nav_date) AS tip
          FROM ops_email_nav_records
          WHERE nav IS NOT NULL AND nav > 0 AND product_code IS NOT NULL
          GROUP BY 1
        ),
        shown AS (
          SELECT m.code, m.tip AS manual_tip, m.n AS manual_n, e.tip AS email_tip,
                 CASE
                   WHEN e.tip IS NOT NULL AND e.tip > m.tip THEN e.tip
                   ELSE m.tip
                 END AS shown_tip
          FROM manual m
          LEFT JOIN email e ON e.code = m.code
        )
        SELECT s.code,
               COALESCE(i.product_name, s.code),
               s.manual_tip, s.email_tip, s.shown_tip,
               MIN(f.price_date) FILTER (WHERE f.price_date > s.shown_tip),
               MAX(f.price_date),
               COUNT(*) FILTER (WHERE f.price_date > s.shown_tip)
        FROM shown s
        JOIN private_fund_nav f ON UPPER(BTRIM(f.beian_hao)) = s.code
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = s.code
        GROUP BY s.code, i.product_name, s.manual_tip, s.email_tip, s.shown_tip
        HAVING COUNT(*) FILTER (WHERE f.price_date > s.shown_tip) > 0
        ORDER BY COUNT(*) FILTER (WHERE f.price_date > s.shown_tip) DESC, s.code
        """
    )
    blocked = cur.fetchall()
    blocked_multi = [r for r in blocked if r[7] >= 2 and (r[6] - r[5]).days >= 7]
    print(f"A chart ignores later 火富牛: funds={len(blocked)} with_span={len(blocked_multi)}")
    email_extended = sum(1 for r in blocked_multi if r[3] is not None and r[3] > r[2])
    manual_is_tip = sum(1 for r in blocked_multi if r[3] is None or r[3] <= r[2])
    print(f"  span and email did not pass manual tip: {manual_is_tip}")
    print(f"  span but email tip is later than manual (chart uses email): {email_extended}")
    print("  top spans (code, name, manual_tip, email_tip, shown_tip, first_fof_after, fof_tip, n)")
    for row in blocked_multi[:15]:
        print("   ", row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7])

    cur.execute(
        """
        SELECT policy, COUNT(*) FROM fof99_nav_universe GROUP BY 1 ORDER BY 1
        """
    )
    print("universe", cur.fetchall())

    cur.execute(
        """
        SELECT UPPER(BTRIM(u.reg_code)), COALESCE(i.product_name, u.product_name, u.reg_code), u.policy
        FROM fof99_nav_universe u
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = UPPER(BTRIM(u.reg_code))
        WHERE u.policy IN ('weekly', 'weekly_plus')
        """
    )
    universe = cur.fetchall()
    codes = [r[0] for r in universe]
    names = {r[0]: r[1] for r in universe}
    policies = {r[0]: r[2] for r in universe}

    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), price_date
        FROM private_fund_nav
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
        """,
        (codes,),
    )
    have: dict[str, set[date]] = defaultdict(set)
    for code, d in cur.fetchall():
        have[code].add(d)

    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), price_date, status
        FROM fof99_nav_fetch_log
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
          AND price_date >= DATE '2025-01-01'
          AND status IN ('ok', 'no_data')
        """,
        (codes,),
    )
    logged: dict[str, dict[date, str]] = defaultdict(dict)
    for code, d, status in cur.fetchall():
        logged[code][d] = status

    cur.execute(
        """
        SELECT batch_id LIKE 'hole%' OR batch_id LIKE 'holefill%', COUNT(DISTINCT reg_code), COUNT(*)
        FROM fof99_nav_fetch_log
        WHERE batch_id LIKE 'hole%'
        GROUP BY 1
        """
    )
    print("prior hole batches", cur.fetchall())

    def lower_median(vals: list[int]) -> int:
        if not vals:
            return 7
        ordered = sorted(vals)
        return ordered[(len(ordered) - 1) // 2]

    def open_fridays(start: date, end: date) -> list[date]:
        d = start + timedelta(days=(4 - start.weekday()) % 7)
        if d < start:
            d += timedelta(days=7)
        out = []
        while d <= end:
            fetch, _cover = resolve_week_target(d)
            if fetch == d:
                out.append(d)
            d += timedelta(days=7)
        return out

    never = []
    asked_empty = []
    for code in codes:
        held_set = have.get(code)
        if not held_set or len(held_set) < 2:
            continue
        held = sorted(held_set)
        tip = held[-1]
        if tip < TIP_FLOOR:
            continue
        gaps = [(b - a).days for a, b in zip(held, held[1:]) if (b - a).days > 0]
        hole_floor = max(lower_median(gaps) * 2, 7)
        miss_never: list[date] = []
        miss_empty: list[date] = []
        for a, b in zip(held, held[1:]):
            if a.year != 2026 or b.year != 2026:
                continue
            if (b - a).days <= hole_floor:
                continue
            for friday in open_fridays(a + timedelta(days=1), b - timedelta(days=1)):
                if friday in held_set or friday > tip:
                    continue
                status = logged[code].get(friday)
                if status == "ok":
                    continue
                if status == "no_data":
                    miss_empty.append(friday)
                elif status is None:
                    miss_never.append(friday)
        if miss_never:
            never.append((code, names[code], policies[code], held[0], tip, miss_never))
        if miss_empty:
            asked_empty.append((code, len(miss_empty)))

    print(
        f"B 2026 interior open Fridays never requested, tip>={TIP_FLOOR}: "
        f"funds={len(never)} fridays={sum(len(r[5]) for r in never)}"
    )
    print(
        f"  2026 interior Fridays already asked, API empty: "
        f"funds={len(asked_empty)} fridays={sum(n for _c, n in asked_empty)}"
    )
    by_pol = defaultdict(int)
    for row in never:
        by_pol[row[2]] += 1
    print("  by policy", dict(by_pol))
    buckets: dict[tuple[str, str], int] = defaultdict(int)
    era: dict[tuple[str, str], int] = defaultdict(int)
    for _code, _name, policy, _first, _tip, days in never:
        n = len(days)
        bucket = "1" if n == 1 else "2-4" if n <= 4 else "5+"
        buckets[(policy, bucket)] += 1
        for day in days:
            key = "before_sep" if day < date(2026, 9, 1) else "sep_or_later"
            era[(policy, key)] += 1
    print("  funds by missing-friday count", dict(buckets))
    print("  friday dates", dict(era))

    weekly_never = [row for row in never if row[2] in ("weekly", "weekly_plus")]
    weekly_codes = [row[0] for row in weekly_never]
    cur.execute(
        """
        SELECT UPPER(BTRIM(product_code)), nav_date
        FROM ops_email_nav_records
        WHERE UPPER(BTRIM(product_code)) = ANY(%s)
          AND nav_date >= DATE '2026-01-01'
          AND nav IS NOT NULL AND nav > 0
        """,
        (weekly_codes,),
    )
    email_days: dict[str, set[date]] = defaultdict(set)
    for code, d in cur.fetchall():
        email_days[code].add(d)
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), nav_date
        FROM ops_team_nav_manual
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
          AND nav_date >= DATE '2026-01-01'
        """,
        (weekly_codes,),
    )
    manual_days: dict[str, set[date]] = defaultdict(set)
    for code, d in cur.fetchall():
        manual_days[code].add(d)
    bare_by_policy: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for code, _name, policy, _first, _tip, days in weekly_never:
        bare = [
            d for d in days
            if d not in email_days[code] and d not in manual_days[code]
        ]
        if not bare:
            continue
        slot = bare_by_policy[policy]
        slot[0] += 1
        slot[1] += len(bare)
        slot[2] += sum(1 for d in bare if d < date(2026, 9, 1))
        slot[3] += sum(1 for d in bare if d >= date(2026, 9, 1))
    for policy, (funds_n, fridays_n, before_n, after_n) in sorted(bare_by_policy.items()):
        print(
            f"  {policy} holes also absent from email and manual: "
            f"funds={funds_n} fridays={fridays_n} "
            f"before_sep={before_n} sep_or_later={after_n}"
        )

    never.sort(key=lambda r: (-len(r[5]), r[0]))
    print("  largest never-asked holes")
    for code, name, policy, first, tip, days in never[:20]:
        show = ",".join(d.isoformat() for d in days[:8])
        more = "" if len(days) <= 8 else f" +{len(days) - 8}"
        print(f"   {code} {name} {policy} {first}..{tip} n={len(days)} {show}{more}")

    # SZX461 check
    sx = [r for r in never if r[0] == "SZX461"]
    print("SZX461 never-asked", sx)
    print("SZX461 in blocked", [r for r in blocked if r[0] == "SZX461"])
    conn.close()


if __name__ == "__main__":
    main()
