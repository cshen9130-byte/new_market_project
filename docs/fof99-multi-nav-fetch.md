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
| `weekly` | 火富牛 still publishing a current (Aug 2026+) NAV, plus the original 1–3m funds already within 1 month. New products (inception ≤ 2 months, 火富牛 list NAV, not previously in the universe) are added here by weekly maintain. | **Yes** — Friday `FundMultiPrice` only |
| `weekly_plus` | Current-1m funds that 火富牛 has (Aug 2026+ on advancedlist) but email usually already wrote `private_fund_info.latest_nav_date`. | **Yes, only if list tip is behind that Friday.** Example: updating 2026-08-28, only funds with `list_nav_date` **before** 2026-08-28 are paid (~20 of 150). |
| `skip` | Empty-date probe `no_data` (1–3m job, 3–6m list-blank **287** + missing-from-list **10**, plus current-1m missing-from-list **171**). 火富牛 has no series. | **Never** |
| `update_slow` | 火富牛 latest is old (before Aug 2026, or older than the AMAC list tip on the 1–3m job). Includes current-1m blank-policy funds whose 火富牛 latest is before 2026-08 (**36**). Weekly maintain also moves `weekly` here after **3 consecutive empty trading Fridays**. | **No**, unless we change the row’s policy later |

Flip a fund later with:

```sql
UPDATE fof99_nav_universe
SET policy = 'weekly', reason = 'operator override', updated_at = NOW()
WHERE reg_code = 'XXXXXX';
```

Credit budget is **weekly + weekly_plus**. Default and hard cap are **300 FundMultiPrice credits per run and per Shanghai day** (12,000 funds × 1 Friday). `--budget` cannot exceed 300. If more Fridays are missing, the job keeps the newest 300 batches and a later run continues. After the 3–6m labels, weekly is **9,717** ≈ **243 credits** for one Friday. `weekly_plus` adds only the funds whose list tip is still behind that Friday (often ~1 extra credit).

Consumed credits (must match the 火富牛 mall 总调用):

```text
SELECT total_credits FROM fof99_credit_usage;
-- or: python scripts/ma/fof99_mall_credits.py
```

That is `FundMultiPrice` batches in `fof99_nav_fetch_log` plus non-price mall calls in `fof99_mall_other_credit`. Baseline **2026-09-07: 3061 + 122 = 3183**. Future `/fund/advancedlist` (and other non-price mall APIs) insert into `fof99_mall_other_credit`.

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

1. **Plan before any paid call.** `policy = 'weekly'` and `weekly_plus` only. Compute missing `(beian_hao, friday)` from existing `private_fund_nav` + `private_fund_info` + fetch log. For `weekly_plus`, use **list tip only** (`private_fund_info.latest_nav_date`): if that date is already on or after the Friday, do not pay. Print universe size, Friday list, batch count, and credit estimate. Do not fetch dates we already have.

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

## Friday afternoon (previous Friday, cheaper)

On Friday afternoon 火富牛 usually still shows **last** Friday, not today. Do **not** FundMultiPrice this Friday then.

The PM2 background worker runs this **every Friday 16:00 Asia/Shanghai**. It still runs if **this** Friday is a CN holiday (so last week’s Friday can be fetched). It **skips only when last week’s Friday is a holiday** (no NAV that week). Example: 2026-09-25 中秋 Friday runs and fills 2026-09-18; 2026-10-02 skips because 2026-09-25 was a holiday. Set `FOF99_FRIDAY_ETL_DISABLED=1` to pause. Manual:

```text
python scripts/ma/fof99_friday_afternoon_fetch.py --dry-run
python scripts/ma/fof99_friday_afternoon_fetch.py
```

1. `/fund/advancedlist` newest-first (`order=0`), 1,000/page, **stop when a page has no `price_date` ≥ previous trading Friday** (~11 credits). Persist `weekly` / `weekly_plus` rows whose date **equals** that Friday. Mid-week dates on those pages are stored as extra points only — they do not replace the Friday. The same pages also stamp NAV for products **established within 2 months** that are not yet in the universe (no extra list credits).
2. `FundMultiPrice` **that Friday** for every `weekly` fund still missing it, and `weekly_plus` only if the list tip is still behind. Expected leftover after list stamps is the mid-week + older set (~3,923 → ~99 credits on the 2026-09-04 mix), not the full 9,733.
3. This week’s Friday is left to a later `fof99_weekly_nav_fetch.py` run (weekend / Monday).
4. **Universe maintain** (same process, after the fetch). `--skip-maintain` to skip.

Previous Friday = last completed trading Friday **strictly before today** (Friday afternoon → last week). Override with `--friday YYYY-MM-DD`. `--skip-list` is FundMultiPrice only.

## Weekly universe maintain (after Friday afternoon)

Runs at the end of `fof99_friday_afternoon_fetch.py` (and standalone). No extra `/fund/advancedlist` crawl.

```text
python scripts/ma/fof99_weekly_universe_maintain.py --dry-run
python scripts/ma/fof99_weekly_universe_maintain.py
```

1. **Downgrade.** A `weekly` fund whose last **3 trading Fridays** (holiday weeks skipped) all have fetch-log `no_data` and no `private_fund_nav` row → `update_slow`. Dates we never requested do **not** count as empty, so a fund added last week is not dropped. Does not touch `skip` or `weekly_plus`.
2. **Admit.** Product is **not** in `fof99_nav_universe`, lives in `private_fund_info`, **inception within 2 months**, and 火富牛 already returned NAV (list stamp / fetch-log `ok`) → insert `weekly`. Then FundMultiPrice **only** the new names still missing that Friday, capped at **3 credits**.

`skip` / `update_slow` / `weekly_plus` rows are never auto-promoted. Extra spend is only the new names (usually 0–1 credit).

## Resume

Re-run the same script. It rebuilds the missing set from the database and fetch log and continues from the first unpaid batch.

## Script

```text
python scripts/ma/fof99_label_3_6m_have_data.py --dry-run
python scripts/ma/fof99_label_3_6m_have_data.py
python scripts/ma/fof99_label_1m_blank_weekly_plus.py --dry-run
python scripts/ma/fof99_label_1m_blank_weekly_plus.py
python scripts/ma/fof99_friday_afternoon_fetch.py --dry-run
python scripts/ma/fof99_friday_afternoon_fetch.py
python scripts/ma/fof99_weekly_universe_maintain.py --dry-run
python scripts/ma/fof99_weekly_universe_maintain.py
python scripts/ma/fof99_weekly_nav_fetch.py --dry-run
python scripts/ma/fof99_weekly_nav_fetch.py
python scripts/ma/fof99_mall_credits.py
```
