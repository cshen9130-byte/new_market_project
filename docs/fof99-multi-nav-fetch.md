# 火富牛 私募基金多基金净值 — 抓取目标与规则

Use [`FundMultiPrice`](../fof99_api/mall_sdk/fof99/requests/fundrequest.py) (`GET /fund/price`) only. One call = up to **40 备案号** for **one calendar date** = **1 credit**. Credits are expensive. Never use `FundPrice` (single-fund history) for this job.

Credentials live in `FOF99_APP_ID` / `FOF99_APP_KEY` (or `fof99_api/api_key.txt` locally). Do not copy keys into docs, logs, or git.

DB is `market_data` on the server, reached from local via:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_server" -L 5433:127.0.0.1:5432 -N root@8.154.33.143
```

`DATABASE_URL` must point at `127.0.0.1:5433`.

## Target (`public.fof99_nav_universe`)

Policies live in Postgres and in the job CSVs (`fof99_policy`). **Do not re-derive weekly from the AMAC 1–3 month list filter.**

The 2026-09-04 净值日期 **1–3个月** job froze **927** products (`scripts/ma/fof99_1_3m_927_latest_nav.csv`). The **3–6个月** funds that 火富牛 already has (**10,228**, `scripts/ma/fof99_3_6m_have_data.csv`) were labeled from stored `fof99_latest_date` only (no extra credits):

| 火富牛 latest (`fof99_latest_date`) | Policy |
|---|---|
| before 2026-08-01 | `update_slow` |
| 2026-08-01 and later (August onward) | `weekly` |

`skip` is never overwritten. Re-apply with `python scripts/ma/fof99_label_3_6m_have_data.py`.

| Policy | Meaning | 火富牛 weekly ETL |
|---|---|---|
| `weekly` | 火富牛 still publishing a current (Aug 2026+) NAV, plus the original 1–3m funds already within 1 month. | **Yes** — Friday `FundMultiPrice` only |
| `skip` | Empty-date probe `no_data` (1–3m job, plus 3–6m list-blank **287** and missing-from-list **10**). 火富牛 has no series. | **Never** |
| `update_slow` | 火富牛 latest is old (before Aug 2026, or older than the AMAC list tip on the 1–3m job). | **No**, unless we change the row’s policy later |

Flip a fund later with:

```sql
UPDATE fof99_nav_universe
SET policy = 'weekly', reason = 'operator override', updated_at = NOW()
WHERE reg_code = 'XXXXXX';
```

Credit budget is **weekly only**. After the 3–6m August-onward labels, weekly is **9,717** products ≈ **243 credits per Friday** if every fund is one Friday behind. Default script budget stays **40** so a full run cannot start by accident; pass `--budget 243` (or the printed batch count) to fetch all. Stop if planned batches would exceed the budget.

Goal: each Friday after the last stored NAV, so the list and product page stay on the current week.

## API contract

- Endpoint: `https://mallapi.huofuniu.com/fund/price`
- Params: `reg_code` = comma-separated 备案号 (max 40), `date` = `YYYY-MM-DD` (the Friday)
- Response row: `reg_code`, `price_date`, `nav`, `cumulative_nav`, `cumulative_nav_withdrawal`, `price_change`
- Write NAV into `public.private_fund_nav` (`UNIQUE (beian_hao, price_date)`). Advance `private_fund_info.latest_nav` / `latest_nav_date` only when the new date is newer.
- After a successful NAV write, delete `ops_private_fund_detail_nav_cache` for those codes so the product page rebuilds.
- Log every finished attempt in `public.fof99_nav_fetch_log`.
- Empty-date latest probe uses sentinel `1970-01-01` in the log. Do not re-run `--latest` on `skip` / `update_slow`.

## Rules (must follow)

1. **Plan before any paid call.** Only `policy = 'weekly'`. Compute missing `(beian_hao, friday)` from existing `private_fund_nav` + `private_fund_info` + fetch log. Print universe size, Friday list, batch count, and credit estimate. Do not fetch dates we already have.

2. **One credit = one (Friday, ≤40 codes) call.** Group by Friday, chunk 40. Prefer **latest trading Friday first** so the table updates even if the job stops early; then walk backward. **Never request a Friday that is a PRC public holiday / 调休 rest day** (shared list `lib/cn-statutory-holiday-dates.json`, e.g. 2026-06-19 端午). Those dates have no platform NAV and would be all `no_data`.

3. **Never duplicate a paid call.** Skip `(reg_code, date)` when:
   - `private_fund_nav` already has that day, or
   - `fof99_nav_fetch_log.status` is `ok` or `no_data`.

4. **Do not retry logged empties.** Friday `no_data` and empty-date `no_data` are permanent for that pair / product. `skip` funds are never requested again.

5. **Stop immediately on real failure.** HTTP ≠ 200, `error_code != 0`, timeout, quota, or unexpected exception → print the batch, date, and debug info, then **exit**. Do not continue through the remaining products.

6. **Commit after every successful batch.** NAV rows + fetch log + list tip update + detail-cache delete land in Postgres before the next credit is spent. Kill / Ctrl+C / resume must not refetch saved pairs.

7. **Local fetch must be visible.** Print flush each batch: Friday, chunk i/n, credit used / budget, codes, ok / no_data counts. If something looks wrong, the operator can stop; already-saved rows stay.

8. **Products have different start/end dates.** Each fund’s first needed Friday is the first Friday **strictly after** `GREATEST(latest_nav_date, max(private_fund_nav.price_date))`. Do not request Fridays on or before data we already hold.

9. **Do not write vendor history we already have.** `ON CONFLICT (beian_hao, price_date) DO NOTHING` (or skip before the call). Do not touch `mom_*` or 单账户 tables.

## Resume

Re-run the same script. It rebuilds the missing set from the database and fetch log and continues from the first unpaid batch.

## Script

```text
python scripts/ma/fof99_label_3_6m_have_data.py --dry-run
python scripts/ma/fof99_label_3_6m_have_data.py
python scripts/ma/fof99_weekly_nav_fetch.py --dry-run
python scripts/ma/fof99_weekly_nav_fetch.py --budget 250

# September-first fill (火富牛 latest in Sep, ~1280 funds). Known dates then Friday gap.
# 火富牛 latest for these is Tue/Wed/Thu, so skip this week's Friday.
python scripts/ma/fof99_weekly_nav_fetch.py --dry-run --only-fof99-since 2026-09-01 --known-latest-first --skip-latest-friday --max-fridays 13 --skip-empty-after 0 --budget 480
python scripts/ma/fof99_weekly_nav_fetch.py --only-fof99-since 2026-09-01 --known-latest-first --skip-latest-friday --max-fridays 13 --skip-empty-after 0 --budget 480
```
