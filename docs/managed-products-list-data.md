# 在管产品 (Managed Products) — Data Flow Reference

This document describes how the **在管产品** table on the investment dashboard loads its data: which PostgreSQL tables are involved, how metrics are computed, and which code files to change.

---

## UI entry points

| Tab | Sidebar item | React component | File |
|-----|--------------|-----------------|------|
| 投资 (Investment) | 在管产品 | `InvestmentManagedProductsView` | `app/ma/dashboard/private-funds/page.tsx` |
| 运维 (Operations) | 在管产品 | `OperationsManagedProductsView` | same file |

Both views call the same API helper:

```ts
fetch(`/ma/api/ops/managed-products/list?${params}`)
```

Defined in `page.tsx` as `fetchManagedProductsList()` / `buildManagedProductsListParams()`.

---

## API route

**Path:** `GET /ma/api/ops/managed-products/list`

**File:** `app/ma/api/ops/managed-products/list/route.ts`

### Query parameters

| Param | Default | Purpose |
|-------|---------|---------|
| `page` | 1 | Pagination |
| `pageSize` | 50 | Rows per page (max 200) |
| `strategy_source` | `company` | `company` or `platform` — which strategy column to filter/sort on |
| `strategy_l1` | — | Primary strategy filter; `__unconfigured__` = no strategy set |
| `run_status` | `running` | `running` (NAV > 0) or `liquidated` (NAV ≤ 0) |
| `team_tag_mode` | `and` | `and` or `or` for team tag filter |
| `team_tag` | — | Repeatable; team labels from `type6_ops_team_full.tag` |
| `keyword` | — | ILIKE match on product name or beian_hao |
| `sort` / `dir` | sequence_no / asc | Column sort |
| `cutoff` | today (from UI) | Metrics as-of date (`YYYY-MM-DD`) |

### Response shape (per row)

| JSON field | Source | Notes |
|------------|--------|-------|
| `id` | `managed_products.id` | Row key for selection / menus |
| `product_name` | `managed_products.product_name` | |
| `beian_hao` | Resolved (see below) or `cache.beian_hao` | Fund registration / product code |
| `short_name` | Resolved or `cache.short_name` | |
| `strategy_l1` | `type6_ops_team_full` or `private_fund_info_bfl` | Computed at query time, **not** cached |
| `latest_nav` | Cache or live NAV lookup | Unit NAV |
| `latest_nav_date` | Cache or live | |
| `latest_price_change` | Cache `return_pct` or live | **Decimal** (0.0408 = 4.08%); UI multiplies ×100 |
| `custody_balance` | `managed_products.custody_account_balance` | Live from base table |
| `net_asset_value` | `managed_products.net_asset_value` | Live from base table |
| `ret_1w` … `ret_1y` | Cache or live | **Decimal** returns |
| `sharpe_1y`, `calmar_1y` | Cache or `private_fund_info` (slow path) | Unitless ratios |

Also returns: `total`, `page`, `pageSize`, `totalPages`, `totalNetAssetValue`.

---

## Read path: fast vs slow

```
Request with cutoff date
        │
        ▼
 cutoff == today (UTC) OR no cutoff?
        │
   yes ─┴─ no
    │       │
    ▼       ▼
 FAST      SLOW
 cache     per-row LATERAL joins
 join      across 9+ NAV tables
```

**Fast path** (`useManagedProductsListCache()` in `lib/server/managed-products-list-cache-pg.ts`):

- Used when `cutoff` is absent or equals today's UTC date (`YYYY-MM-DD`).
- Joins `managed_products` → `ops_managed_products_list_cache`.
- Still joins `type6_ops_team_full`, `private_fund_info_bfl`, etc. for **filters** (strategy, team tags, beian resolution).
- If cache is empty, `ensureManagedProductsListCachePopulated()` runs a full refresh once (first deploy / before nightly ETL).

**Slow path** (historical cutoff):

- Recomputes NAV + returns on the fly using the same multi-table fallback logic as before.
- Sharpe / Calmar come from `private_fund_info` join (not recomputed).

---

## PostgreSQL tables

### 1. `managed_products` — base row data (source of truth for listing)

Primary table for which products appear in the list.

| Column (used by list) | UI column |
|-----------------------|-----------|
| `id` | Internal row id |
| `sequence_no` | Default sort order |
| `product_name` | 产品名称 |
| `latest_unit_nav` | Fallback latest NAV |
| `latest_nav_date` | Fallback NAV date |
| `latest_return_pct` | Fallback weekly return (stored as **percent**, e.g. 4.08) |
| `custody_account_balance` | 托管账户余额 |
| `net_asset_value` | 资产净值; also used for 运行中 / 已清盘 filter |

Rows with `product_name = '合计'` are excluded everywhere.

> Schema is managed outside this repo (no CREATE TABLE in codebase). Table is assumed to exist in production.

---

### 2. `ops_managed_products_list_cache` — precomputed metrics (fast path)

**Created by:** `lib/server/managed-products-list-cache-pg.ts` (`CREATE TABLE IF NOT EXISTS`)

**Refreshed by:** `refreshManagedProductsListCache()` — nightly + on-demand.

| Column | Meaning |
|--------|---------|
| `managed_product_id` | PK, FK to `managed_products.id` |
| `product_name` | Denormalized copy |
| `beian_hao` | Resolved registration code |
| `short_name` | Resolved short name |
| `unit_nav` | Latest unit NAV |
| `nav_date` | Latest NAV date |
| `return_pct` | Latest period return, **decimal** (e.g. 0.0408) |
| `ret_1w`, `ret_1m`, `ret_3m`, `ret_6m`, `ret_1y` | Total returns, **decimal** |
| `sharpe_1y`, `calmar_1y` | 1-year risk ratios (unitless) |
| `as_of_date` | Date metrics were computed for (usually today) |
| `refreshed_at` | Last ETL timestamp |

**Refresh strategy:** `DELETE` all rows, then `INSERT` full snapshot (not incremental upsert).

---

### 3. `ops_email_nav_fund_latest` — latest NAV only (legacy helper)

**File:** `lib/server/email-nav-latest-pg.ts`

Still populated during ETL (`scope_type = 'managed_product'`) but the list API **no longer reads this table** after the cache was introduced. Kept for potential other consumers / backward compatibility.

---

### 4. `ops_email_nav_records` — email-parsed NAV time series

**File:** `lib/server/email-nav-pg.ts`

Populated by email crawl ETL. Highest-priority NAV source when resolving latest NAV and historical points.

---

### 5. Legacy NAV tables (fallback chain)

When email NAV is missing, the system falls back through these tables (in order), matching by `beian_hao`, then `product_name`, then `short_name`:

1. `private_fund_nav_group`
2. `private_fund_nav_group_hy`
3. `private_fund_nav`

Historical lookup for returns uses the same chain at offsets **7 / 30 / 90 / 180 / 365** calendar days before the cutoff date.

SQL helpers: `lib/server/managed-products-nav-query.ts` (`managedNavScalarExpr`, `managedNavAtOffsetJoin`).

Email NAV joins: `lib/server/email-nav-query.ts` (`buildEmailNavLatestJoins`, `buildEmailNavLatestExprs`).

---

### 6. Identity / metadata joins (not cached)

Used at query time for filters and display:

| Table | Purpose |
|-------|---------|
| `private_fund_info_bfl` | Beian, short name, `strategy_company` |
| `private_fund_info` | Beian fallback; sharpe/calmar on **slow path** only |
| `type6_ops_team_full` | Beian (`register_number`), strategies, team tags |
| `fof_underlying_detail` | Beian fallback |
| `investment_tracking_fof_underlying` | Beian fallback |

**Beian resolution expression** (`FOF_UNDERLYING_BEIAN_EXPR`):

```
COALESCE(b.beian_hao, pi.beian_hao, o.register_number, fd.beian_hao, t.beian_hao, en_code.product_code)
```

**Join builder:** `buildManagedProductsFrom()` in `lib/server/fof-underlying-query.ts`.

---

## Metric computation (ETL)

### When it runs

| Trigger | Function |
|---------|----------|
| Nightly ETL (parse) | `scripts/ma/nightly_etl.py` → `step_email_nav_parse()` → `email_nav_etl.ts --parse-only` (incremental from per-mailbox checkpoint; no `--days` by default) |
| Nightly ETL (cache) | `scripts/ma/nightly_etl.py` → `step_investment_pool_metrics()` → `email_nav_etl.ts --refresh-only --cache-only` |
| After manual email parse | `lib/server/email-parse-fetch.ts` |
| Background email job | `lib/server/email-parse-fetch-job.ts` |
| Manual refresh (fast, 在管产品) | `npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --managed-only` |
| Manual refresh (fast, FOF底层) | `npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --fof-only` (~15 min) |
| Manual refresh (fast, both list caches) | `npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only` |
| Manual refresh (full) | `npx tsx scripts/ma/email_nav_etl.ts --refresh-only` (includes valuation JSONB backfills; can exceed 60 min) |

All of the above call:

```ts
refreshManagedProductsNavAndListCache()  // lib/server/email-nav-latest-pg.ts
  ├── refreshManagedProductsEmailNavLatest()   → ops_email_nav_fund_latest
  └── refreshManagedProductsListCache()        → ops_managed_products_list_cache
```

### Return columns (`ret_1w` … `ret_1y`)

Computed in SQL during refresh:

```
ret = (current_nav / nav_at_offset) - 1
```

- `current_nav`: email NAV → fallback `managed_products.latest_unit_nav`
- `nav_at_offset`: same multi-table COALESCE at 7/30/90/180/365 days before `CURRENT_DATE`

### Sharpe / Calmar (`sharpe_1y`, `calmar_1y`)

Computed in TypeScript during refresh (`managed-products-list-cache-pg.ts`):

1. Load legacy NAV history (`private_fund_nav_group`, `_hy`, `private_fund_nav`).
2. Load email NAV series via `loadEmailNavSeries()`.
3. Merge with `mergeNavSeriesWithEmail()` (email wins on duplicate dates).
4. Take last 365 days up to `nav_date`.
5. Require ≥ 20 NAV points.
6. Compute via `computeFundNavMetrics()` in `lib/fund-nav-metrics.ts`.

---

## Code file map

| Concern | File |
|---------|------|
| API route (fast + slow paths) | `app/ma/api/ops/managed-products/list/route.ts` |
| Cache table + ETL refresh | `lib/server/managed-products-list-cache-pg.ts` |
| Shared NAV fallback SQL | `lib/server/managed-products-nav-query.ts` |
| Beian / FROM joins | `lib/server/fof-underlying-query.ts` |
| Email NAV query helpers | `lib/server/email-nav-query.ts` |
| Email NAV latest table | `lib/server/email-nav-latest-pg.ts` |
| Sharpe/Calmar math | `lib/fund-nav-metrics.ts` |
| Frontend table | `app/ma/dashboard/private-funds/page.tsx` |
| Nightly email ETL script | `scripts/ma/email_nav_etl.ts` |
| Nightly orchestrator | `scripts/ma/nightly_etl.py` (`step_email_nav_parse` + `step_investment_pool_metrics`) |
| Incremental parse cursors | `lib/server/email-parse-cursor.ts` → `data/ops_email_parse_cursors.json` |
| Custody 估值表 date repair | `scripts/ma/repair_valuation_nav_shift.mjs` (`--db-fix-dates` or re-fetch) |
| FOF底层 list cache | `lib/server/fof-overview-list-cache-pg.ts` |
| FOF holding NAV history | `lib/server/managed-fof-underlying-pg.ts` |
| FOF list API | `app/ma/api/ops/fof-underlying/list/route.ts` |
| FOF cache refresh helper | `scripts/ma/_refresh_fof_cache.ts` (optional; can be slow) |

---

## Value formats (important for UI changes)

| Field | Storage | UI display |
|-------|---------|------------|
| `latest_price_change`, `ret_*` | Decimal (0.0408) | `TrackPctCell` → `(n * 100).toFixed(2)%` |
| `sharpe_1y`, `calmar_1y` | Ratio (1.25) | `TrackRatioCell` → `n.toFixed(2)` |
| `managed_products.latest_return_pct` | **Percent** (4.08) | Divided by 100 before use as fallback |

---

## Common modification scenarios

### Add a new column to the table

1. If it needs heavy NAV computation → add column to `ops_managed_products_list_cache`, compute in `refreshManagedProductsListCache()`, read in fast path of `list/route.ts`.
2. If it comes from `managed_products` or ops metadata → join at query time in `list/route.ts` only.
3. Update `ManagedProductRow` interface and table headers in `page.tsx`.

### Change NAV source priority

Edit `managedNavScalarExpr()` and/or `buildEmailNavLatestJoins()` — used by both ETL refresh and slow path.

### Change when cache is used

Edit `useManagedProductsListCache()` in `managed-products-list-cache-pg.ts`.

### Force refresh after deploy

**Fast (recommended for nightly / stale list dates):** rebuild list caches only, skip valuation backfills (~2 min):

```bash
cd ~/new_market_project
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only
```

**Full refresh** (valuation sync + cache; may take >60 min):

```bash
npx tsx scripts/ma/email_nav_etl.ts --refresh-only
```

The script loads `.env.local` / `.env` from the project root automatically. If you still see a DB auth error, verify credentials first:

```bash
grep -E '^DATABASE_URL=|^DB_PASSWORD=' .env.local
# or run with explicit env:
set -a && source .env.local && set +a && npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only
```

### Fix stale custody 估值表 dates (2026-07-08)

If emails were parsed but NAV dates lag the mailbox (Guohai/GTJA `4级科目估值表_YYYYMMDD` shifted back one trading day), see **What Was Fixed (2026-07-08)** in `docs/nav-calculation-rules.md`. Quick recovery:

```bash
npx tsx scripts/ma/repair_valuation_nav_shift.mjs --db-fix-dates --since=2026-06-01
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --managed-only
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --fof-only
```

### Historical date picker (cutoff ≠ today)

Uses **slow path** only. To support historical dates from cache, you would need either:

- A separate cache keyed by `(managed_product_id, as_of_date)`, or
- On-demand refresh for that cutoff (expensive).

---

## Architecture diagram

```
                    ┌─────────────────────────────────────┐
                    │  Nightly email parse                │
                    │  email_nav_etl.ts --parse-only      │
                    └─────────────────┬───────────────────┘
                                      │
                                      ▼
                         ops_email_nav_records (+ 估值表 tables)
                                      │
                    ┌─────────────────┴───────────────────┐
                    │  Nightly cache refresh              │
                    │  email_nav_etl.ts --refresh-only    │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
 ops_email_nav_fund_latest    ops_managed_products_list_cache   ops_fof_overview_list_cache
 (time series)              (latest NAV only)             (all list metrics)
          │                           │                           │
          └──────── NAV fallback ─────┴───────────────────────────┘
                                      │
                                      ▼
                         GET /ma/api/ops/managed-products/list
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
             cutoff = today                      cutoff = past date
             JOIN cache (fast)                   LATERAL joins (slow)
                    │                                   │
                    └─────────────┬─────────────────────┘
                                  ▼
                    JOIN managed_products + ops metadata
                                  ▼
                    InvestmentManagedProductsView / OperationsManagedProductsView
```

---

## Related but separate

- **FOF底层 list** (`/ma/api/ops/fof-underlying/list`) uses `ops_fof_overview_list_cache`, refreshed by the same nightly `step_investment_pool_metrics()` → `--refresh-only --cache-only` (or `--fof-only` for FOF only). See **What Was Fixed (2026-07-08 — §4 FOF底层)** in `docs/nav-calculation-rules.md` for stale-date recovery and NAV source priority (email vs parent 估值表 holdings).
- **私募基金 list** (`/ma/api/private-funds/list`) uses `private_fund_info` with precomputed columns from `scripts/ma/private_fund_indicators_etl.py` — different page, different cache strategy.
- **跟踪产品 list** (`/ma/api/tracking-funds/list`) has its own similar NAV fallback logic in `app/ma/api/tracking-funds/list/route.ts`.
