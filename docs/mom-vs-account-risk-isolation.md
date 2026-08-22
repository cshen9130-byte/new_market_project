# MOM 每日风控 vs 单账户每日风控 — isolation rules

MOM 每日风控 is **stable production**. 单账户每日风控 is **still in development**. They look similar in the UI but they **must not share PostgreSQL tables, ETL, file directories, caches, or parsers**. Work on 单账户 must never change MOM data or MOM behaviour.

Read this file before touching either module.

---

## Two products

| | MOM 每日风控 | 单账户每日风控 |
|---|---|---|
| UI | `/ma/dashboard/mom-analysis/risk-report` | `/ma/dashboard/mom-analysis/account-risk-report` |
| Status | Stable — do not “improve” it while building 单账户 | In development |
| Data | Broker **客户交易核算日报** (MOM settlement pack) | 中国期货市场监控中心 / 国投期货 **客户交易结算日报（逐笔对冲）** `.xls` |
| Sample files | Existing MOM import under `data/` (do not reuse for 单账户) | `data/account-risk/imports/` e.g. `02188010101763_2026-08-20.xls` |
| ETL | `scripts/ma/mom_data_etl.py` and `/ma/api/mom-analysis/data-import/*` | `lib/server/cfmmc-etl.ts` and `/ma/api/account-risk/*` + `/ma/api/mom-analysis/account-risk-import/*` |

Same chart **components** may be reused. Same **database rows** must not.

---

## Hard rules

1. **Never write, UPDATE, DELETE, TRUNCATE, or migrate `public.mom_*` when doing 单账户 work.**
2. **Never edit `scripts/ma/mom_data_etl.py`** (or MOM data-import API routes) to “also support” CFMMC / 国投 files.
3. **Never point 单账户 queries at `public.mom_*`.** Missing 单账户 tables must return empty, not fall through to MOM.
4. **Never share cache files.** MOM cache keys and 单账户 cache keys must be disjoint. Clearing 单账户 cache must not delete MOM cache.
5. **Never change a MOM `/ma/api/mom-analysis/*` handler’s default behaviour** so that it “works for both”. If 单账户 needs an API, add `/ma/api/account-risk/*` (or a dedicated 单账户 route) and keep MOM as-is.
6. **Never run 单账户 ETL against MOM directories**, and never save 单账户 `.xls` into the MOM import folder.

If a change needs to touch both trees, split it into two PRs: MOM-only (avoid) and 单账户-only.

---

## PostgreSQL

### MOM (stable)

- Schema: **`public`**
- Tables: `mom_daily_reports`, `mom_futures_trade_details`, `mom_position_details`, `mom_futures_position_details`, `mom_close_details`, `mom_summary_details`, `mom_trade_details`, `mom_fund_transactions`, … — all created/filled by `mom_data_etl.py`
- `search_path` default: `public`

### 单账户 (developing)

- Own tables only. Current dedicated tables:
  - `public.cfmmc_daily_summary`
  - `public.cfmmc_product_pnl`
  - `public.cfmmc_positions`
  - `public.cfmmc_trades`
  - `public.cfmmc_closes`
- Staging / chart-facing copies, if used, live in schema **`account_risk`** (`account_risk.mom_*` clones). These exist so the shared UI can query a MOM-like layout **without reading `public.mom_*`**.
- `account_risk.*` is 单账户-only. Do not copy 单账户 rows into `public.mom_*`.
- **Do not rely on `SET search_path TO account_risk, public`.** That falls through to MOM when a clone table is missing. 单账户 queries must use **schema-qualified** names (`account_risk.mom_daily_reports`, `public.cfmmc_daily_summary`) or a search_path that **does not include `public` for `mom_*`**.

Target direction: 单账户 APIs read `public.cfmmc_*` (and/or `account_risk.*`) directly. Stop adding `?source=account` patches on MOM routes.

---

## ETL and files

| | MOM | 单账户 |
|---|---|---|
| Code | `scripts/ma/mom_data_etl.py` | `lib/server/cfmmc-etl.ts` (`runCfmmcETL`) |
| Trigger | `/ma/api/mom-analysis/data-import/run` | `POST /ma/api/account-risk/run-etl` |
| Files | MOM data-import folders | `data/account-risk/imports/` (`ACCOUNT_RISK_DATA_DIR` if set) |
| Cache | `data/mom-cache/<date>_<route>.json` | Must use a different prefix (e.g. `account__…`). `clearAccountSourceCache()` must not delete MOM files |

单账户 extract is **not** a fork of `mom_data_etl.py`. Redesign the parser from the sample 国投 / 监控中心 workbook (below). Column cell-refs from MOM (`D13` = 当日盈亏, etc.) **do not apply**.

---

## 单账户 source format (sample file)

Workbook title: **客户交易结算日报(逐笔对冲)**  
Broker example: 国投期货. Filename pattern: `{资金账号}_{YYYY-MM-DD}.xls`

Sheets (do not assume MOM sheet names):

- `客户交易结算日报`
- `品种汇总`
- `成交明细`
- `平仓明细`
- `持仓明细`
- `期权成交明细` / `期权品种汇总` / `期权类型汇总`
- `证券成交明细` / `证券买卖汇总`

### 资金状况 (first sheet) — label-based, not cell-ref-based

Account row: `客户期货期权内部资金账户` (value ~ col 2), `交易日期` (value ~ col 7).

| Statement label | Meaning | MOM equivalent (do not search this name in 单账户 files) |
|---|---|---|
| 上日结存 | previous balance | 期初结存 / D11 |
| 当日存取合计 | cash flow | 期初存取合计 / D12 |
| 客户权益 | equity (right column) | I11 |
| 平仓盈亏 | realized | D23 |
| 浮动盈亏 | open MTM **level**, not daily delta | 持仓盈亏 / I23 |
| 当日手续费 | commission | 交易手续费 / D15 |
| 当日结存 | ending balance | 期末结存 / D16 |
| 保证金占用 | margin | I16 |
| 可用资金 | available | D17 |
| 风险度 | often a **string** `"0.90%"` | I17 |
| *(none)* | **no `当日盈亏` field** | D13 当日盈亏 |

**NAV / daily PnL for 单账户** must use the equity path, not 平仓盈亏+浮动盈亏:

```
daily_pnl_net = 客户权益_t − 客户权益_{t−1} − 当日存取合计_t
daily_return  = daily_pnl_net / 客户权益_{t−1}   (when previous equity > 0)
```

`浮动盈亏` is remaining open-position MTM. Summing 平仓+浮动−手续费 double-counts prior-day MTM and will **not** match NAV.

### 品种汇总

Header row is exactly `品种` (not the section title `品种汇总`). Columns: 品种, 手数, 成交额, 手续费, 平仓盈亏.

### 成交明细

`合约, 成交序号, 成交时间, 买/卖, 投机…, 成交价, 手数, 成交额, 开/平, 手续费, 平仓盈亏, 实际成交日期`  
Open trades may have 平仓盈亏 = `"--"`.

### 持仓明细

`合约, 成交序号, 买持仓, 买入价, 卖持仓, 卖出价, 昨结算价, 今结算价, 浮动盈亏, 投机…, 交易编码, 实际成交日期`  
Long rows fill 买持仓/买入价; short rows fill 卖持仓/卖出价. This is **not** the MOM 期货持仓明细 B11:S11 layout.

---

## MOM source format (do not use for 单账户)

- Sheet `客户交易核算日报`
- Fixed cells: D6 账户, I6 日期, D13 **当日盈亏**, D15 当日手续费, D20/I20 权利金, D23 平仓盈亏, I23 持仓盈亏
- MOM product NAV: `当日盈亏 − 当日手续费 + 权利金收入 − 权利金支出` over `mom_daily_reports` + capital flows from `mom_fund_transactions`

Leave this pipeline unchanged.

---

## API / UI

- MOM UI: `RiskReportApp` with `variant="mom"` → `/ma/api/mom-analysis/*` → `public.mom_*`
- 单账户 UI: `RiskReportApp` with `variant="account"` → `/ma/api/account-risk/*` and/or 单账户-only tables
- Prefer **dedicated 单账户 routes** (`app/ma/api/account-risk/`) over patching `window.fetch` to reuse MOM routes
- Shared React charts are OK; they must call different URLs and must not share an in-memory cache of MOM JSON

---

## Checklist before merging 单账户 work

- [ ] `git diff` does not include `scripts/ma/mom_data_etl.py` or MOM data-import routes unless the user explicitly asked to change MOM
- [ ] No SQL against unqualified `mom_*` in 单账户 ETL (that hits `public` under default search_path)
- [ ] No `INSERT`/`UPDATE` into `public.mom_*`
- [ ] Parser matches the sample 国投/监控中心 workbook, not MOM cell refs
- [ ] After ETL, `public.mom_daily_reports` row count / checksum is unchanged
- [ ] MOM risk-report page still loads production series (spot-check 净值曲线)
