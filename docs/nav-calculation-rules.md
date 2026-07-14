# NAV Calculation Rules & Dividend Handling

## The Invariant That Must Always Hold

```
复权净值 (adj) >= 累计净值 (cum) >= 单位净值 (unit)
```

This must be satisfied for **every single row** in the NAV series, including and especially on ex-dividend dates and all dates after.

---

## Field Mapping

| DB / Code Field | Chinese Name | Meaning |
|---|---|---|
| `nav` / `unit_nav` | 单位净值 | Current unit NAV — drops on ex-dividend dates |
| `cum_nav_withdrawal` | 累计净值 | Cumulative NAV = unit + all historical dividends paid (stays flat or rises on ex-div) |
| `cumulative_nav` | 复权净值 | Reinvestment-adjusted NAV — always ≥ 累计净值 |

In `ops_team_nav_manual` the column `cumulative_nav` stores **累计净值** (not 复权净值). The 复权净值 is always **computed** by the pipeline — never stored from manual uploads.

---

## What Was Fixed (荣熙恒盈2号 — SBAH99)

### The 4.30 Dividend Issue

The fund paid a large dividend (~0.21/unit, ex-date ~2026-05-06 after Labour Day holiday). This caused two failures that recur if the calculation logic is changed carelessly:

**Failure 1 — adj was below cum after the ex-div date**

Root cause: `syncExDivAdjustedNav` was using `prevAdj × cum / prevCum`, which sets `adj = cum` on the ex-dividend date. Subsequent rechaining used `prevAdj × (unit / prevUnit)` (unit ratio), but `cum = unit + constant_offset` — so as unit falls below its ex-div level, adj drops below cum.

**Failure 2 — adj exploded to ~2.11 (my bad "fix")**

Root cause: A previous "fix" used `prevAdj × (prevUnit / unit)` — this multiplied adj by ~1.11× on the ex-div date, then a rebase loop multiplied ALL subsequent adj values by another ~1.09×, snowballing adj to ~2.11.

### The Correct Fixes Applied

See `lib/server/email-nav-query.ts`, functions:
- `syncExDivAdjustedNav`
- `rechainDerivedFromPrev`
- `propagateMissingAdjRows`

---

## What Was Fixed (钜融添宝20号 — SNF018)

### The Problem

After we invested in this fund, two email streams arrived for the same underlying:

| Source | Example date | Stored `nav` | Actual meaning |
|---|---|---|---|
| **TA虚拟净值** (post-investment) | 2026-06-23 | **1.3358** | Correct 单位净值 |
| **资产净值公告** attachment | 2026-06-25 | **1.7600** | 累计净值 stored as unit NAV (`nav == cumulative_nav`) |

The system previously **excluded** all `虚拟净值` emails from primary selection and preferred `attachment_nav_table`. That caused:

1. **FOF底层 list** — 最新单位净值 showed **1.7600** instead of ~**1.35**
2. **Fund detail page** (`/ma/dashboard/private-funds/SNF018`) — header and 团队净值 table showed unit = cum = **1.7600**, with stale legacy 复权 **1.3496** below 累计 **1.7600**, violating `adj >= cum >= unit`

Correct values from TA email on 2026-06-23: unit **1.3358**, cum **1.7462**, adj **~1.82**.

### Root Causes

1. **Wrong source priority** — Pre-investment 资产净值公告 beat post-investment TA虚拟净值.
2. **Cumulative stored as unit** — Attachment rows often set `nav == cumulative_nav` at the cumulative scale (~1.76); unit should be ~1.34 (ratio ≈ unit/cum ≈ 0.765 from virtual history).
3. **Stale legacy 复权** — When email refreshed unit + cum, old `cumulative_nav` from legacy DB was kept, leaving adj below cum on newer dates.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Post-investment email priority | `isPostInvestmentVirtualNavEmail`, `emailNavSourceTier`, `selectEmailNavSeriesRows` | TA virtual emails rank above attachments; per-date best row, not attachment-only stream |
| Unit inference | `inferEmailUnitNav`, `applyEmailUnitNavCorrection` | When attachment has `nav == cum` but virtual history shows a unit/cum gap, infer unit as `nav × (last_virtual_unit / last_virtual_cumulative)` |
| FOF list (instant load) | `buildEmailNavLatestJoins`, `BatchNavResolver`, `fof-overview/list` fast path | Virtual-first selection + cache read; no per-request lateral scans |
| Detail page merge | `loadEmailNavSeries`, `mergeNavSeriesWithEmail` | Virtual-first email series; clear stale 复权 when email supplies new unit + cum |
| Invariant repair | `repairAdjBelowCumRows` | Rechain 复权 from prior row (or trailing adj/cum ratio) when legacy left `adj < cum` |

### Verified Correct Values (after fix)

| Date | 单位净值 | 累计净值 | 复权净值 |
|---|---|---|---|
| 2026-06-23 | 1.3358 | 1.7462 | ~1.816 |
| 2026-06-24 | 1.3408 | 1.7512 | ~1.821 |
| 2026-06-25 (latest) | **1.3475** | 1.7600 | ~1.830 |

### Regression Checks

All **44 FOF底层** funds must satisfy `adj >= cum >= unit`:

```bash
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

This fix does **not** change SBAH99 dividend formulas — only source priority and stale-adj repair. Still re-run SBAH99 checks after NAV pipeline edits:

```bash
npx tsx scripts/test-nav-rechain.mjs
```

---

## What Was Fixed (抱朴聚融祥和一号 — SSG947)

### The Problem

The verified xlsx seed (`data/managed-product-nav/SSG947.json`, through **2026-06-22**) was correct, but the fund detail chart and 团队净值 table showed corrupt rows after that date:

| Date | Shown (wrong) | Expected |
|---|---|---|
| 2026-06-22 | unit 1.9983, cum **2.5612**, adj **2.5833** | unit 1.9983, cum **2.5632**, adj **~2.5893** |
| 2026-06-23 | unit 1.9983, cum **1.9983**, adj **1.9983** | unit 1.9983, cum **2.5632**, adj **~2.5893** (rechained from seed) |
| 2026-06-24 | unit 1.9764, cum **1.9764** | unit 1.9764, cum **~2.54**, adj **~2.57** (rechained from prior) |

Symptoms: **-59.89% daily return** on 2026-06-23 despite flat unit NAV, and the 复权净值 chart line plunged toward zero at the end.

The email data itself was fine — the **managed-product fetch/merge path** was wrong.

### Root Causes

1. **Split email selection logic** — The detail API used `selectEmailNavSeriesRows` (per-date best row + unit correction), but the 在管产品 team stream used `selectEmailSourceStream` via `filterEmailNavManageStream`. That locked onto a single `fund_name` stream and skipped `applyEmailUnitNavCorrection`.

2. **Post-seed email finalized in isolation** — `mergeManagedProductDetailNav` took pre-finalized team rows (`mergeNavSeriesWithEmail([], emailPoints)`) and pasted them after the seed. Email rows finalized without the seed tail lost the unit/cum gap (~0.56). When 资产净值公告 stored **累计净值 in the unit column** (`nav == cumulative_nav`), cum and adj collapsed to unit level.

3. **Unit/cum ratio only learned from TA virtual emails** — `applyEmailUnitNavCorrection` only established `unit/cum` ratio from post-investment virtual NAV subjects. SSG947 (and similar custody-only funds) establish the ratio from custody **估值表** rows where unit and cum are already separated — that path was missing.

FOF multi-level 估值表 rejection (`isFofUnderlyingValuationEmailRow`) was already correct and unchanged.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Unified email selection for 在管产品 | `filterEmailNavManageStream` | Uses `selectEmailNavSeriesRows` (same as detail API / FOF list), not `selectEmailSourceStream` |
| Unit/cum ratio from custody history | `applyEmailUnitNavCorrection` | Learns ratio from **any** prior email where `cum - unit > 0.05` (custody 估值表, virtual TA, etc.) |
| Seed + email merge | `mergeManagedProductDetailNav` | Post-seed email merged via `mergeNavSeriesWithEmail(seedBase, extensionPoints)` so cum/adj rechains from the verified seed tail |
| Email points loader | `loadManagedProductEmailPoints` | Returns corrected email + manual points before seed merge; used by detail route and `fund-nav-series.ts` |

**Do not** block post-seed email for managed products with a seed file — email is still the primary source for dates after the xlsx reference ends. The seed is authoritative **through its last date**; email extends after that with proper rechaining.

### Verified Correct Values (after fix)

Seed reference (xlsx `抱朴聚融祥和一号净值20260627.xlsx`):

| Date | 单位净值 | 累计净值 | 复权净值 |
|---|---|---|---|
| 2026-06-22 | 1.9983 | 2.5632 | ~2.5893 |

When email sends `nav == cum == 1.9983` on 2026-06-23 (累计 stored as unit), merge against seed yields:

| Date | 单位净值 | 累计净值 | 复权净值 |
|---|---|---|---|
| 2026-06-23 | 1.9983 | 2.5632 | ~2.5893 |

When 资产净值公告 needs unit inference (custody 估值表 ratio ≈ 0.779):

```
inferred_unit = attachment_nav × (last_unit / last_cumulative) ≈ 1.9983 × 0.779 ≈ 1.5579
```

### Regression Checks

SSG947-specific (no DB required):

```bash
npx tsx scripts/ma/test_ssg947_email.mjs
```

Still re-run SBAH99 / SNF018 checks after NAV pipeline edits:

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

This fix does **not** change SBAH99 dividend formulas or SNF018 virtual-first FOF logic — only unifies managed-product email selection and seed+email merge context.

---

## What Was Fixed (荣熙恒盈2号A类 — BAH99A)

**荣熙恒盈2号A类** is a separate share class from **荣熙恒盈2号** (SBAH99). It appears in FOF概览 as an underlying holding with its own备案号 **BAH99A**. Two independent bugs were fixed: wrong NAV in the list, and wrong fund detail page when clicking the name.

---

### Fix 1 — FOF list showed share count as unit NAV

#### The Problem

Two email streams arrive on the same date for this A-class share:

| Source | Example date | Stored `nav` | Actual meaning |
|---|---|---|---|
| **【净值表】** attachment (`product_code = BAH99A`) | 2026-06-26 | **1.2729** | Correct 单位净值 |
| **虚拟计提净值表** attachment (`product_code` null) | 2026-06-26 | **6273466.11** | 持仓份额 mis-parsed as unit NAV |

Symptoms on FOF监控 → 概要汇总:

- 最新单位净值 showed **6273466.1100** instead of **~1.27**
- 近一周/一月/三月/六月收益 showed absurd values (e.g. +478,488,558%)

The **【净值表】** row with correct unit + cum was already in `ops_email_nav_records`; the bad row won selection.

#### Root Causes

1. **Equal source tier** — Both rows are `attachment_nav_table`; tie-break used higher `id`, favouring the later 虚拟计提 ingest.
2. **Name batch before beian batch** — `BatchNavResolver` checks `emailByName` before `emailByBeian`. The name-keyed stream had only the bad row (no `product_code`); the beian-keyed stream (`BAH99A`) had the correct row but was never reached.
3. **No plausibility guard** — Nothing rejected unit NAV in the millions when cumulative was ~1.48.

#### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Plausibility check | `isPlausibleEmailUnitNav` | Unit NAV must be 0.1–50 and not orders of magnitude above cumulative |
| Per-date row tie-break | `preferEmailNavRow` | After source tier: prefer plausible unit NAV → matching `product_code` → deprioritize `虚拟计提净值表` subjects |
| FOF list SQL | `buildEmailNavLatestJoins` ORDER BY | Same plausible-nav / product-code / accrual-table ordering in lateral joins |
| Nightly cache ETL | `loadEmailNavBatch`, `loadEmailNavByNameBatch` | Use `preferEmailNavRow` instead of source-tier-only dedupe |
| Resolver fallback | `BatchNavResolver.resolveAt` | When name batch NAV is implausible, use beian batch if plausible |

#### Verified Correct Values (after fix)

| Date | 单位净值 | 累计净值 |
|---|---|---|
| 2026-06-26 | **1.2729** | 1.4829 |

After cache refresh, `ops_fof_overview_list_cache` shows `unit_nav = 1.272900` for 荣熙恒盈2号A类.

#### Regression Checks

```bash
npx tsx scripts/ma/_diag_slu153_nav.ts
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

---

### Fix 2 — Clicking the name opened 荣熙恒盈2号 (SBAH99) instead of A类

#### The Problem

Clicking **荣熙恒盈2号A类** in FOF概览 opened the fund detail page for **荣熙恒盈2号** (managed product SBAH99): wrong title, wrong NAV series (~1.28 main-class), wrong 团队净值 seed merge.

Link target was `/ma/dashboard/private-funds/BAH99A` but routing resolved it to SBAH99.

#### Root Causes

1. **`remapManagedProductBeianCode("BAH99A")`** mapped A-class code to parent `SBAH99` (intended for 在管产品 only, not FOF底层 share classes).
2. **`lookupManagedProductOverride("荣熙恒盈2号A类")`** matched parent via `id.includes("荣熙恒盈2号")` without checking share class.
3. **`resolveManagedProductBeian`** had the same loose `includes` match.
4. **Detail API fallback order** called `lookupFundInfoFallback(rawId)` before `lookupFundInfoFallback(beian_hao)`, so fuzzy name lookup returned SBAH99 even after `resolveRouteFundId` had correctly found BAH99A.
5. **`lookupFundInfoFallback` queries** lacked `sqlShareClassProductNameGuard`, so `荣熙恒盈2号A类` matched the parent row in `private_fund_info_bfl`.

#### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Share-class override matching | `managedProductOverrideNameMatches`, `resolveManagedProductBeian`, `lookupManagedProductOverride` | Parent name `includes` only when share class matches (both null or same A/B/C) |
| Remove A-class remap | `remapManagedProductBeianCode` | Removed `BAH99A` / `SBAH99A` → `SBAH99`; share-class codes stay distinct |
| Route resolution order | `resolveFundBeianHao` | Direct beian lookup in DB **first**; managed override only when code is not already registered |
| Detail API fallback | `app/ma/api/private-funds/[beian_hao]/route.ts` | `lookupFundInfoFallback(beian_hao)` before `lookupFundInfoFallback(rawId)` |
| Name fallback guards | `lookupFundInfoFallback` | `sqlShareClassProductNameGuard` on bfl / managed_products / type6 / email queries |

#### Verified Routing (after fix)

| URL / identifier | Resolves to | Product name |
|---|---|---|
| `BAH99A` | `BAH99A` | 荣熙恒盈2号A类 |
| `荣熙恒盈2号A类` | `BAH99A` | 荣熙恒盈2号A类 |
| `SBAH99` | `SBAH99` | 荣熙恒盈2号 (unchanged) |
| `荣熙恒盈2号` | `SBAH99` | 荣熙恒盈2号 (unchanged) |

#### Regression Checks

```bash
npx tsx scripts/ma/_diag_bah99a_route.ts
```

---

### What This Fix Does NOT Change

- SBAH99 dividend formulas (`syncExDivAdjustedNav`, `rechainDerivedFromPrev`, etc.)
- SNF018 virtual-first FOF email priority
- SSG947 managed-product seed + email merge
- Main-class 荣熙恒盈2号 detail page and 在管产品 NAV pipeline

Still re-run SBAH99 checks after any edit to `email-nav-query.ts` or `managed-product-beian.ts`:

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

---

## Dividend Rechaining (SBAH99 reference)

### Step 1 — Detect the ex-dividend date (`isLikelyDividendExDate`)

A date is considered ex-dividend when ALL of the following are true:
- Unit NAV drops more than **1.5%** vs previous day (`unitDrop > 0.015`)
- Cumulative NAV stays within **±5%** of its previous level (`cumRef ≥ prevCum × 0.995` and `≤ prevCum × 1.05`)

This works because on ex-div dates: unit drops sharply (dividend paid out) while cumulative stays near its prior level (since cumulative = unit + total dividends ever paid, and the new dividend adds to the total, offsetting the unit drop).

### Step 2 — Compute adj on the ex-dividend date (`syncExDivAdjustedNav`)

Use the **dividend-reinvestment formula**:

```
D_new = (cum_today - unit_today) - (cum_prev - unit_prev)   // new dividend per unit paid
adj_today = prevAdj × (unit_today + D_new) / unit_prev
```

- `D_new` is the newly distributed dividend per unit (increase in the cum−unit gap)
- This formula treats the dividend as immediately reinvested, so adj grows by more than cum
- Result: `adj_today > cum_today` ✓

This function **skips** dates where adj is already valid (`existingAdj >= cum`), so it does not override correct values from seed files.

### Step 3 — Forward-chain adj for subsequent dates (`propagateMissingAdjRows` + `rechainDerivedFromPrev`)

For every subsequent date after the ex-div event, use the **cumulative-ratio formula** (not unit ratio):

```
adj_today = prevAdj × cum_today / cum_prev
```

This keeps `adj / cum = constant` (the ratio established on the ex-div date). Since the ratio is set above 1.0 in Step 2, `adj > cum` is guaranteed for all future dates regardless of how far unit NAV moves.

**Why not unit ratio?**  
`cum = unit + D_offset` (constant offset after dividend). If adj grows at the unit rate, adj/cum drifts below 1 when unit falls. Using the cum rate keeps adj/cum fixed.

`propagateMissingAdjRows` also sets `cum_nav_withdrawal` when it is absent, so that chains of unit-only email rows (no cumulative provided) don't lose the adj/cum ratio.

---

## Rules for Future Code Changes

### DO NOT touch these without re-verifying the invariant

| Function | Risk if changed |
|---|---|
| `syncExDivAdjustedNav` | Controls adj on ex-div dates — wrong formula breaks invariant immediately |
| `rechainDerivedFromPrev` | Used everywhere adj is re-derived — switching back to `unitRatio` for adj breaks invariant after unit drops |
| `propagateMissingAdjRows` | Fills adj for manual-upload rows — removing it leaves cum without adj for ops_team_nav_manual data |
| `alignPreDividendNavRows` | Sets pre-dividend rows to unit = cum = adj — threshold `hasDividendOffset > 0.05` determines which rows are "pre-dividend" |
| `repairAdjBelowCumRows` | Fixes stale legacy 复权 that drifted below 累计 when email refreshes unit+cum — runs before `alignPreDividendNavRows` |
| `repairAdjCollapsedToUnitRows` | Fixes legacy rows where 复权 = 单位 while 累计 >> 单位 (AVM354 pattern) — runs before `repairAdjBelowCumRows` |
| `filterEmailNavManageStream` | Must use `selectEmailNavSeriesRows` — reverting to `selectEmailSourceStream` breaks 在管产品 email unit correction |
| `mergeManagedProductDetailNav` | Post-seed email must merge against seed base via `mergeNavSeriesWithEmail` — pre-finalizing email alone loses unit/cum context |
| `applyEmailUnitNavCorrection` | Must learn unit/cum ratio from custody rows with distinct unit+cum, not only TA virtual subjects |
| `preferEmailNavRow` / `isPlausibleEmailUnitNav` | Reject 虚拟计提 share-count rows; prefer `product_code`-matched 净值表 — reverting to id-only tie-break breaks BAH99A FOF list |
| `isPlausibleEmailCumulativeNav` | Reject valuation column bleed (cum/unit > 2) — disabling re-breaks SBFM35 unit inference |
| `selectEmailNavSeriesRows` per-date fallback | Use share-class email only when no parent row exists for that date — reverting to global pool drops SBFM35 A-class dates |
| `repairSwappedCumAdjRows` | Fixes legacy rows where 累计 and 复权 DB columns are swapped (`cum > adj`) — disabling leaves SQX078-style corrupt 平台数据 |
| `sanitizeVShapeNavOutliers` | Removes single-day V-shaped legacy outliers (~7–15% dip/spike with flat neighbors) — disabling lets corrupt platform rows distort max-drawdown and period returns |
| `preferLegacyNavRow` / `dedupeLegacyNavRowsByDate` | When group + per-fund tables disagree on ex-div dates, prefer the row whose 累计 stayed near the prior level (SLA063) — reverting to pri-only tie-break keeps wrong group cum |
| `resolveFundBeianHao` | Direct beian DB lookup must run before managed-product override — otherwise BAH99A routes to SBAH99 |
| `remapManagedProductBeianCode` | Do not remap A/B/C share-class codes (e.g. BAH99A) to parent 在管产品 beian |
| `lookupManagedProductOverride` | Must use share-class-aware name match — loose `includes` maps A类 names to parent managed product |
| `finalizeNavSeries` (call order) | `syncExDivAdjustedNav` must run before `propagateMissingAdjRows`, which must run before `refreshStaleDerivedFields`, then `repairAdjBelowCumRows`, then `alignPreDividendNavRows` |

### After any change to the NAV pipeline

Run a sanity check against 荣熙恒盈2号 (SBAH99) covering the 2026-04-30 to 2026-05-10 window and verify:
1. Every row satisfies `adj >= cum >= unit`
2. On the ex-div date (~2026-05-06), adj is slightly above cum (not equal, not far above)
3. adj/cum ratio is approximately constant after the ex-div date

You can use `scripts/ma/_check_nav_output.ts` for this:
```bash
npx tsx scripts/ma/_check_nav_output.ts
```

### Safe pattern for adding a new NAV source

Any new data source that provides rows for managed products must:
1. Map 累计净值 → `cum_nav_withdrawal` (not `cumulative_nav`)
2. Map 复权净值 → `cumulative_nav` (or leave it empty `""` to be computed)
3. If 复权净值 is not available, leave `cumulative_nav = ""` — `propagateMissingAdjRows` will fill it in

---

## Data Priority for FOF Underlying / List Views

When the same fund has both pre-investment manager NAV emails and post-investment TA emails:

```
TA虚拟净值 / 虚拟净值 body emails  (highest — invested position, unit + cumulative separated)
        ↓
资产净值公告 attachment_nav_table  (may store 累计净值 in the unit column when nav == cumulative_nav)
        ↓
legacy NAV tables
```

Post-investment sources are detected when the email subject contains `TA虚拟净值`, `【基金虚拟净值表现估算】`, `虚拟业绩报酬_`, or `虚拟净值` (excluding `虚拟净值表现` attachment estimates).

When only an attachment row exists but virtual history established a unit/cumulative ratio, infer unit NAV as `attachment_nav × (last_virtual_unit / last_virtual_cumulative)`.

List / FOF SQL: `buildEmailNavLatestJoins()` in `lib/server/email-nav-query.ts`.  
Nightly cache ETL: `BatchNavResolver` in `lib/server/list-cache-nav-batch.ts`.

This is separate from the 在管产品 detail merge pipeline below — do not change dividend formulas in `mergeNavSeriesWithEmail` when adjusting source priority.

Detail pages and chart series use `loadEmailNavSeries()` → `selectEmailNavSeriesRows()` (same virtual-first + unit correction as list cache).

---

## Data Priority for 在管产品 (Managed Products)

```
ops_team_nav_manual  (highest — manual Excel uploads)
        ↓
ops_email_nav_records  (email-parsed data, excluded for dates covered by manual)
        ↓
JSON seed files in data/managed-product-nav/<beian_hao>.json
```

When a verified xlsx seed exists:

- Seed rows are **authoritative through the seed's last date** (e.g. SSG947 through 2026-06-22).
- Email extends **after** that date via `mergeManagedProductDetailNav(seed, emailPoints, legacy)`.
- Post-seed email is merged **against the seed base** so cum/adj rechains from the verified tail — never finalized in isolation.

Email selection for 在管产品 uses the same path as the detail page: `loadManagedProductEmailPoints` → `filterEmailNavManageStream` → `selectEmailNavSeriesRows` → `applyEmailUnitNavCorrection`.

The managed product pipeline is in:
- `lib/server/team-nav-manage-pg.ts` → `loadManagedProductEmailPoints`, `loadManagedProductNavSeries`
- `lib/server/managed-product-nav-seed.ts` → `mergeManagedProductDetailNav`

---

## Known Limitations

- Micro-dividends where unit NAV still rises on the ex-div date (market return > dividend per unit) are **not detected** by `isLikelyDividendExDate` since there is no unit drop. For large dividends like 荣熙恒盈2号's 0.21/unit this cannot happen.
- `复权净值` is always computed, never stored from manual uploads. Slight numerical differences vs fund-manager-provided adj values are expected (~0.001–0.003 range).

---

## What Was Fixed (百奕小天鹅2号B类 — 2026-06-22 Dividend)

### Context

The fund paid a large dividend (~0.3384/unit) on 2026-06-22 (ex-date). Excel verified:

| Date | 单位净值 | 累计净值 | 涨跌幅 |
|---|---|---|---|
| 2026-06-18 | 1.3552 | 1.3552 | +1.29% |
| 2026-06-22 | 1.0500 | 1.3884 | **+2.45%** |
| 2026-06-23 | 1.0192 | 1.3576 | -2.93% |

Before fixes, the UI showed unit=cum=adj=1.05 on 2026-06-22 and price_change=−22.82%.

### Fix 1 — `email-nav-extract.ts` section 2b (`perfRowM` index)

In the Huatai 虚拟业绩报酬 body-table parser, `cumulativeNav` was reading `perfRowM[7]` (unit NAV) instead of `perfRowM[8]` (actual cumulative NAV). Changed index from 7 → 8.

Row format: `CODE FUNDNAME DATE S-CODE INVESTOR HOLDINGS VIRTUAL_NAV UNIT_NAV CUM_NAV`  
Groups: `[6]=VIRTUAL_NAV  [7]=UNIT_NAV  [8]=CUM_NAV`

### Fix 2 — `email-nav-query.ts` `rechainDerivedFromPrev` / `refreshDerivedForUnitOnlyEmailRows`

When an email provides both unit and cumulative NAV (no adj), the date is added to `unitOnlyEmailDates` so `refreshDerivedForUnitOnlyEmailRows` can rechain `复权净值`. However, `rechainDerivedFromPrev` was called **without** the current cum, so `isLikelyDividendExDate` used unit (1.05) as the cumulative reference. That caused the check `cumRef >= prevCum * 0.995` (1.05 ≥ 1.3484) to fail, so it fell through to the non-dividend path and **overwrote the correct cum (1.3884) with unit (1.05)**.

Fix: `rechainDerivedFromPrev` now accepts an optional `currCum` argument. `refreshDerivedForUnitOnlyEmailRows` reads `cum_nav_withdrawal` from the merged row and passes it as `currCum`. When the dividend check passes, `cum = currCum` is used directly instead of estimating from the unit ratio.

### Fix 3 — `email-nav-query.ts` `recomputeNavPriceChanges`

On dividend ex-dates the economic return is the cumulative NAV ratio, not the unit ratio. The function was always dividing by the unit NAV, producing -22.5% instead of +2.45%. Fix: when `isLikelyDividendExDate` is true for the current row, use the cum ratio `(currCum / prevCum - 1) * 100` for `price_change`.

### Fix 4 — `nav-cleaner.ts` `detectColumns` adjustedScore threshold

`adjustedIndex` was assigned whenever `adjustedScore > 1`. Since a fully-numeric column has a baseline score of 3 (`numericCount/sampleCount × 3`), any column could be picked as the 复权净值 column even with no matching header. In 3-column attachments (date, unit, cum) the last column was wrongly treated as adj, shifting unitIndex to the cum column. Raised threshold to `> 4` so a header keyword match (adds 5) is required before assigning a column as 复权净值.

---

## What Was Fixed (2026-06-30 — site-wide loading hang, stale FOF cache, copy button, stale test)

A user reported fund detail pages stuck on 加载中 / blank white pages, plus 荣熙恒盈2号A类 (BAH99A) still showing a wrong NAV in FOF概览. Four distinct issues were found and fixed.

### Fix 1 — Site-wide loading hang from a PostgreSQL lock cascade

**Symptom:** Clicking any fund hung on 加载中; some pages rendered fully blank (the dashboard layout returns `null` while `/api/auth/me` is pending, and that request was frozen too). Server logs showed `connect ECONNREFUSED` and a growing queue of stuck connections.

**Root cause — a 3-step cascade on `ops_email_nav_records`:**

1. A `SELECT … ILIKE '%…%'` on `ops_email_nav_records` ran for **40+ minutes** (full table scan), holding a shared lock.
2. Every new server worker calls `ensureEmailNavTable()`, which ran `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN`. That DDL needs an `ACCESS EXCLUSIVE` lock, so it **queued behind** the slow SELECT.
3. Once DDL is queued for a lock, PostgreSQL blocks **all** subsequent reads/writes on that table — so every API request (including `/api/auth/me`) froze. 12+ connections piled up.

**The Correct Fixes Applied:**

| Area | File / function | What changed |
|---|---|---|
| Per-query safety net | `lib/db.ts` `makePool` | Added `statement_timeout: 60_000`, `connectionTimeoutMillis: 10_000`, `idleTimeoutMillis: 30_000`. Because `statement_timeout` counts lock-wait time, a stuck SELECT **or** a lock-waiting `ALTER TABLE` now aborts after 60 s instead of hanging forever — worst case is a brief stall, never a site-wide freeze. Applies to every table's DDL, not just email. |
| Skip DDL on the hot path | `lib/server/email-nav-pg.ts` `ensureEmailNavTable` / `_runEnsure` | Now first checks `information_schema.columns` + `pg_constraint`. If the table, both migrated columns (`attachment_filename`, `adjusted_nav`), and the `uq_email_nav_record_date` constraint already exist (the normal production case), it **skips all DDL** — so it never takes an `ACCESS EXCLUSIVE` lock. DDL runs only on first deploy. |

**Recovery action (one-time):** terminated the 40-min SELECT and the queued `ALTER TABLE` with `pg_terminate_backend`, which instantly unblocked the connection queue. Diagnostic/recovery script: `scripts/ma/_kill_blocking_queries.ts` (run with `--kill`).

**Rule:** never run `ALTER TABLE` unconditionally on a request path. Guard all `ensureXxxTable()` helpers with an existence check, and rely on the pool `statement_timeout` as the backstop.

### Fix 2 — 荣熙恒盈2号A类 (BAH99A) wrong NAV was a stale cache, not the email logic

The email-selection logic was already correct (verified: `selectEmailNavSeriesRows` and `BatchNavResolver` both return **1.2729**, correctly rejecting the `6273466.11` 虚拟计提净值表 share-count row via `isPlausibleEmailUnitNav` / `preferEmailNavRow`). But `ops_fof_overview_list_cache` still held the old `6273466.11` from **before** the BAH99A fix was deployed — and its nightly rebuild had not re-run (likely killed by the lock cascade above).

**Fix:** rebuilt the cache via `refreshFofOverviewListCache()` (recomputes all 44 funds from the corrected `BatchNavResolver`, so already-correct funds stay correct). BAH99A cache went `6273466.11 → 1.2729` (daily return −0.14%). Script: `scripts/ma/_refresh_fof_cache.ts`.

**Rule:** `ops_fof_overview_list_cache` only auto-rebuilds when **empty** (`ensureFofOverviewListCachePopulated`) or via the nightly ETL. After deploying any email-selection / NAV fix, rebuild the cache or the FOF list keeps serving stale values.

### Fix 3 — Copy button next to product names did nothing over plain HTTP

**Root cause:** the internal site is served over **plain HTTP** (`http://8.154.33.143`). `navigator.clipboard` only exists in *secure contexts* (HTTPS / localhost), so it was `undefined`, the call threw, and an empty `catch` swallowed it silently.

**Fix** (`components/ma/copyable-inline-text.tsx`): added `copyTextToClipboard()` — uses `navigator.clipboard` only when `window.isSecureContext`, otherwise falls back to a hidden-textarea + `document.execCommand("copy")`. Covers all `CopyableInlineText` / `CopyableProductName` / `CopyableProductText` / `FundProductNameLink` usages.

### Fix 4 — Stale assertion in `scripts/test-nav-rechain.mjs`

The `adj pct ~ -2%` assertion checked `adj_0622 / adj_0618 ≈ −2.02%`. That encoded the **old unit-ratio** adj rechain, which commits `1caf71ae` / `b50e3237` deliberately replaced with **cum-ratio** rechaining (see "Step 3 — Forward-chain" above). With cum-ratio rechaining the adj move is −1.74% (correct), while −2.02% is actually the **unit-NAV daily return** (`price_change`).

**Fix:** the assertion now checks the two correct properties instead: (1) the 0622 `price_change` ≈ −2.02% (unit-based daily return on a non-ex-div date), and (2) the adj/cum ratio is preserved between 0618 and 0622 (constant ratio ⇒ cum-ratio rechain). This was a stale test, **not** a code regression — the cum-ratio behavior is the documented, intended one.

### What this session did NOT change

- No change to any protected NAV function (`syncExDivAdjustedNav`, `rechainDerivedFromPrev`, `propagateMissingAdjRows`, `repairAdjBelowCumRows`, `mergeNavSeriesWithEmail`, etc.) — `lib/server/email-nav-query.ts` and `managed-product-nav-seed.ts` are byte-identical to before.
- All regression checks pass afterward: `scripts/test-nav-rechain.mjs` (40+ assertions), `scripts/ma/check_fof_nav_invariant.ts` (all 44 funds `adj ≥ cum ≥ unit`), `scripts/ma/_diag_bah99a_route.ts` (routing).

---

## What Was Fixed (六妙星九紫一号 — SBPC20, 2026-07-02 — historical cum/adj losing dividend offset)

### The Problem

The fund detail page for 六妙星九紫一号 showed `累计净值: 1.3936` and `复权净值: 1.3936` on 2026-07-01 (correct), but all historical rows displayed `单位净值 = 累计净值 = 复权净值` (e.g. 1.1603 for 2026-06-30), hiding the dividend offset entirely. Additionally, 2026-07-01 incorrectly showed `-20.11%` daily change.

**What the email DB actually contained (correct data all along):**

| Date | nav (unit) | cumulative_nav | Source |
|---|---|---|---|
| 2026-06-11 | **1.000000** | 1.213100 | attachment_nav_table (CORRECTION email) |
| 2026-06-12 | 1.016000 | 1.229100 | attachment_nav_table |
| 2026-06-30 | 1.160300 | 1.373400 | attachment_nav_table |
| 2026-07-01 | 1.180500 | 1.393600 | attachment_nav_table |

### Root Causes (Two Interacting Bugs in `preferEmailNavRow`)

**Bug 1 — CORRECTION email lost on 2026-06-11 (ex-dividend date)**

The fund sent a correction email `【返账更正重发：净值更新】` with the correct ex-dividend unit NAV (1.000000). The original email had nav=1.213100 (wrong, unit=cum).

Both are `attachment_nav_table` (same tier). The correction arrived with a higher DB id. In `preferEmailNavRow`, within the same tier, the first row (wrong original) was kept. The correction was discarded.

Result: `selectEmailNavSeriesRows` returned nav=1.213100, cum=1.213100 for 2026-06-11 — no dividend offset detected.

**Bug 2 — FOF-manager "虚拟业绩报酬" body emails overrode correct attachment rows (2026-06-12 to 2026-06-30)**

Every day in this window had multiple row types:
- `attachment_nav_table`: nav=1.157100, cum=1.370200 ← **correct post-dividend structure**
- `body_table` (subject `虚拟业绩报酬_衡颐海泰1号…_SBPC20_…`): nav=1.157100, cum=1.095400 ← **FOF manager fee calculation accrual, wrong cum**

The `虚拟业绩报酬_` subject pattern sets `emailNavSourceTier = -1` (highest priority, added for SNF018). So the body_table row had tier **−1** and the attachment had tier **0**. The body_table row **won every date**, replacing correct cum 1.3702 with wrong cum 1.0954.

Result: All 2026-06-12 to 2026-06-30 dates used incorrect cumulative → `findFirstDividendRowIndex` could not find a pre-2026-07-01 dividend row → `alignPreDividendNavRows` swept everything to unit=cum=adj → 2026-07-01 appeared as the "first dividend" with a -20.11% change.

**Why SNF018 was not broken:** for SNF018, the attachment stores **cumulative in the unit field** (nav ≈ cum → no distinct cumulative). The new guard only protects attachment rows that already have a distinct cumulative, so SNF018 virtual rows still correctly win.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Attachment wins over virtual when it carries the dividend offset | `lib/server/email-nav-query.ts` `preferEmailNavRow` | When a virtual email (tier -1) would override an attachment_nav_table row (tier 0): check if the attachment has a distinct cumulative (cum ≠ unit). If yes, keep the attachment. SNF018 attachments have nav ≈ cum (no distinct), so virtual still wins there. |
| Correction emails win over original same-tier rows | `lib/server/email-nav-query.ts` `preferEmailNavRow` | Within the same source tier, if the candidate has a distinct cumulative (ex-dividend structure: unit dropped, cum stayed up) and the current does not (unit = cum), prefer the candidate. This causes "返账更正重发" correction emails to replace the original wrong attachment. |

Note: the earlier `refreshStaleDerivedFields` change (passing `currCum`) is also retained — it is a correct defensive fix for funds where the platform DB stores the correct cumulative but a stale adj might be overwritten without the currCum parameter.

### What This Fix Does NOT Change

- `syncExDivAdjustedNav`, `rechainDerivedFromPrev`, `propagateMissingAdjRows`, `repairAdjBelowCumRows` — all unchanged.
- SBAH99 dividend formulas — unchanged (managed product seed path).
- SNF018 virtual-first FOF email priority — **unchanged**. SNF018 attachments store cum-as-unit (nav ≈ cum → no distinct cumulative), so the new guard does not trigger and virtual emails still win.
- SSG947 managed-product seed + email merge — unchanged.
- BAH99A routing — unchanged.
- `emailNavSourceTier` itself — unchanged; tier -1 for virtual emails is preserved.

### Verified Correct Values (after fix)

| Date | 单位净值 | 累计净值 | 复权净值 | 涨跌幅 |
|---|---|---|---|---|
| 2026-06-11 | 1.0000 | 1.2131 | 1.2131 | −19.48% (unit ratio; cum also dipped) |
| 2026-06-25 | 1.1571 | 1.3702 | 1.3702 | +2.10% |
| 2026-06-30 | 1.1603 | 1.3734 | 1.3734 | +0.35% |
| 2026-07-01 | 1.1805 | 1.3936 | 1.3936 | **+1.74%** (was −20.11%) |

### Regression Checks

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

All 43 test assertions pass. All 52 FOF底层 funds satisfy `adj >= cum >= unit`.

---

## What Was Fixed (2026-07-09 — SBPC20 Jul 8 unit=cum=adj regression)

**Symptom:** Fund detail for **六妙星九紫一号 (SBPC20)** showed **单位净值 = 累计净值 = 复权净值 = 1.1565** on **2026-07-08** (reference platform: unit **1.1565**, cum **~1.3696**, adj **~1.4030**). Historical Jun–Jul rows also collapsed to unit-only after **2026-06-11**.

**Root cause (two gaps in the prior SBPC20 fix):**

1. **`preferEmailNavRow` was one-directional** — attachment-wins-over-virtual only fired when attachment was already `current` and virtual was `candidate`. When a **虚拟业绩报酬** row was stored first, later attachment rows could not displace it.
2. **Merge accepted virtual `cum` below unit** — FOF fee-accrual body emails carry cum slightly under unit; `hasDistinctCumulative` treated that as valid 累计, blocking rechaining from the Jun-11 dividend anchor.

**Fix (extends 2026-07-02 SBPC20 logic; SNF018 virtual-first unchanged):**

| Area | File / function | What changed |
|---|---|---|
| Symmetric attachment guard | `preferEmailNavRow`, `emailRowHasAttachmentDividendOffset` | When virtual is `current` and attachment is `candidate`, keep attachment if it has post-dividend cum > unit |
| Reject sub-unit email cum | `isUsableEmailCumulativeNav`, `mergeNavSeriesWithEmail` | Ignore email 累计 when cum < unit; finalize rechains from prior dividend row |

**Verified after fix (2026-07-08):** unit **1.1565**, cum **1.3696**, adj **1.3696**; **2026-07-01** daily change **+1.74%** (not −20%).

Regression: `npx tsx scripts/test-nav-rechain.mjs` (SBPC20 Jul 8 virtual-first + merged cum cases).

**Does NOT change:** SNF018 virtual-first, SNF018 legacy-adj keep, SBAH99, SSG947, SLA063, SQX078, SBPU97 fixes.

---

## What Was Fixed (2026-07-09 — SBPC20 legacy tail overwriting email 累计)

**Symptom:** After deploy, fund detail still showed **单位 = 累计 = 复权** on recent dates and a **sharp drop** on the 复权 chart — even though email-only merge was correct.

**Root cause:** `mergeNavSeriesWithEmail` correctly stored email **累计** (e.g. **1.3696** on 2026-07-08), then added those dates to `unitOnlyEmailDates` because attachment `adjusted_nav` equalled cum. `refreshDerivedForEmailRows` **rechained both cum and adj** from pre-email legacy rows (Feb–May platform data with unit = cum), wiping the email 累计.

**Fix:** Split email-derived dates into **`adjOnlyEmailDates`** (email supplied unit + cum, rechain 复权 only) vs **`unitOnlyEmailDates`** (unit only, rechain both). `refreshDerivedForEmailRows` preserves email 累计 on adj-only dates.

**Verified (2026-07-08, legacy + email path):** unit **1.1565**, cum **1.3696**, adj **1.3696**; chart no longer cliffs at unit-only scale.

---

## What Was Fixed (衡颐海泰1号 — SBPU97, 2026-07-06 — wrong seed scale caused NAV cliff)

### The Problem

Fund detail page for **衡颐海泰1号** showed a corrupt NAV series:

| Date | Shown (wrong) | Expected |
|---|---|---|
| 2026-06-26 | unit **1.5848** | unit **~1.068** |
| 2026-06-29 | unit **1.0733** (−32.27% daily) | unit **~1.073** (smooth) |
| 2026-07-02 | unit 1.0775 | unit **~1.078** |

Symptoms: 收益曲线 showed a sharp cliff at the end; 成立以来最大回撤 inflated to **−37%**; header metrics (latest unit ~1.08, +7.75% since inception) disagreed with the historical table/chart (~1.58 scale).

### Root Cause

`data/managed-product-nav/SBPU97.json` was built from **`低波稳健FOF 1号合并净值.xlsx`** — the internal **merged FOF portfolio** NAV (~1.48–1.58 scale, history back to 2023-12-29).

The product detail page for **衡颐海泰1号** must use the **product unit NAV** (~1.0 at inception 2026-03-10, ~1.07 by June 2026), verified in `衡颐海泰1号净值20260626.xlsx`.

Post-seed email rows (correct ~1.07 scale) were merged after the wrong seed tail (~1.58), producing the −32% cliff.

**Do not** use the merged FOF xlsx as the managed-product seed for SBPU97. That file remains for FOF weekly reports via `BUNDLED_FOF_NAV_BY_BEIAN` in `lib/server/fof-weekly-report.ts`.

### The Correct Fix Applied

| Area | What changed |
|---|---|
| Seed file | Rebuilt `data/managed-product-nav/SBPU97.json` from `衡颐海泰1号净值20260626.xlsx` (71 rows, 2026-03-10 → 2026-06-23, unit ~1.0 → ~1.0682) |
| FOF weekly report | `resolveBundledNavDateRange` in `fof-weekly-report.ts` reads date span from bundled merged xlsx, not product seed — weekly reports still use `低波稳健FOF 1号合并净值.xlsx` |
| Pipeline | **No NAV merge code changes** — existing `mergeManagedProductDetailNav` seed+email merge is correct once the seed scale matches the product |

Rebuild command:

```bash
npx tsx scripts/ma/build_managed_nav_seed.mjs "衡颐海泰1号净值20260626.xlsx" SBPU97 --all
```

Verify:

```bash
npx tsx scripts/ma/compare_sbpu97_nav.mjs "衡颐海泰1号净值20260626.xlsx"
```

### What This Fix Does NOT Change

- `preferEmailNavRow`, `mergeNavSeriesWithEmail`, `syncExDivAdjustedNav`, etc. — unchanged
- SBAH99 / SNF018 / SSG947 / BAH99A / SBPC20 / SLA063 / SQX078 fixes — unchanged
- FOF weekly report bundled nav (`低波稳健FOF 1号合并净值.xlsx`) — unchanged

### Regression Checks

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/compare_sbpu97_nav.mjs "衡颐海泰1号净值20260626.xlsx"
```

After deploy, refresh managed-products cache if the list still shows stale values:

```bash
npx tsx scripts/ma/email_nav_etl.ts --refresh-only
```


### Problem 1 — Fund detail page returned HTTP 404

Clicking 木莲安澜1号A类 in the 在管产品 list navigated to `/ma/dashboard/private-funds/ATL22A`. The API returned 404 because `ATL22A` was not in `MANAGED_PRODUCT_BEIAN_OVERRIDES`, and none of the DB lookup tables (`private_fund_info`, `private_fund_info_bfl`, `type6_ops_team_full`) had a row for this code. `lookupFundInfoFallback("ATL22A")` also returned null since the email records used the product name rather than the code.

**Fix:** Added `木莲安澜1号A类: "ATL22A"` to `MANAGED_PRODUCT_BEIAN_OVERRIDES` in `lib/server/managed-product-beian.ts`.

- `lookupManagedProductOverride("ATL22A")` now returns `{ product_name: "木莲安澜1号A类", beian_hao: "ATL22A" }`, which satisfies `lookupFundInfoFallback` and the detail API.
- The share-class guard in `managedProductOverrideNameMatches` ensures "木莲安澜1号" (no share class) does **not** match this override — the fix is share-class–scoped.
- Since there is no seed file (`data/managed-product-nav/ATL22A.json`), `resolveManagedProductListNavAt("ATL22A", ...)` returns null and the managed override path in the cache refresh falls through to the email/legacy NAV resolver — no change to the list view values.

### Problem 2 — 最新涨跌幅 and period returns empty (root cause)

Diagnosis confirmed: ATL22A's NAV data never comes from `ops_email_nav_records` (0 rows). The nav 1.1020 shown in the UI comes from `ops_managed_fof_underlying` — the FOF fund's 估值表 attachment that lists ATL22A as a holding. Only **one** such row exists (valuation_date = 2026-06-30). `fof_underlying_summary.latest_return_pct = null` for ATL22A. Legacy tables have historical data but only under `beian_hao = 'SATL22'` / `product_name = '木莲安澜1号'` (the parent fund, with different NAVs from the A-class). `BatchNavResolver` finds no data under `ATL22A` or `木莲安澜1号A类`.

With one data point, `resolvePreviousNav` finds no T-1 nav → `calcDailyReturnPct` returns null. `calcPeriodReturns` also returns all-null.

**Fix 1 — Forward-looking (automatic as more data arrives)**:
Added `loadManagedUnderlyingNavHistory` in `lib/server/managed-fof-underlying-pg.ts` that loads ALL historical `ops_managed_fof_underlying` entries within the lookback window. `BatchNavResolver` now exposes `setValuationNavHistory(byCode, byName)` so these FOF-holding NAV points are included in `resolveAt` and `buildMergedHistory` as a last-resort fallback (after email / type6 / legacy all miss). `refreshFofOverviewListCache` in `lib/server/fof-overview-list-cache-pg.ts` now calls `loadManagedUnderlyingNavHistory` and injects it into the resolver.

Effect: once the FOF's next monthly 估值表 is parsed (adding e.g. a 2026-07-31 row for ATL22A), the 最新涨跌幅 will be computed automatically. After two months, the 1-month return will also populate.

**Fix 2 — fallbackReturnPct**:
`calcDailyReturnPct` was also changed to return `fallbackReturnPct` (from `fof_underlying_summary.latest_return_pct`) when no T-1 nav is found. For ATL22A this is currently null too, so no immediate effect — but will work if the field is populated.

**Why returns remain empty now**: only one data point exists (June 30). The system needs ≥ 2 months of FOF 估值表 data for 最新涨跌幅 to compute, ≥ 1 month offset for period returns.

**To populate returns immediately**: create a seed file `data/managed-product-nav/ATL22A.json` with actual A-class historical NAV data, or re-parse older FOF 估值表 emails that include ATL22A as a holding (those would add more rows to `ops_managed_fof_underlying`).

### What This Fix Does NOT Change

- No change to `syncExDivAdjustedNav`, `rechainDerivedFromPrev`, `propagateMissingAdjRows`, `repairAdjBelowCumRows`, `mergeNavSeriesWithEmail`, or `finalizeNavSeries` call order.
- SBAH99 dividend formulas — unchanged.
- SNF018 virtual-first FOF email priority — unchanged.
- SSG947 managed-product seed + email merge — unchanged.
- BAH99A routing — unchanged.
- SBPC20 attachment-wins-over-virtual logic — unchanged.

### After deployment

The FOF overview cache was already rebuilt using the new `loadManagedUnderlyingNavHistory` injection. To rebuild the managed products cache too:

```bash
npx tsx scripts/ma/email_nav_etl.ts --refresh-only
```

To rebuild the FOF overview cache:

```bash
npx tsx scripts/ma/_refresh_fof_cache.ts
```

Then verify regression:

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

---

## What Was Fixed (杉阳云杉混合1号 — SLA063, 2026-07-03)

### The Problem

Fund detail page and tracking list showed corrupt NAV on **2022-10-11**:

| Symptom | Wrong value |
|---|---|
| 复权净值 chart | Sharp V-shaped dip on 2022-10-11 |
| 成立以来最大回撤 | **−11.43%** (should be ~3%) |
| 近六个月收益 (list) | **−11.43%** (should be small positive) |
| 累计净值 / 复权净值 | Distorted around the bad row |

Correct reference (platform 净值): smooth 复权 curve, max drawdown ~3%, latest cum **1.4390**, adj **~1.5072**.

### Root Cause

备案号 is **SLA063** (not SLA033). On **2022-10-11** (real dividend ex-date, unit 1.127 → 1.000) two legacy tables disagree:

| Source | unit | 累计 | 复权 |
|---|---|---|---|
| `private_fund_nav_group` (wrong) | 1.000 | **1.139** | **1.139** |
| `private_fund_nav` (correct) | 1.000 | **1.265** | **1.283** |

`loadPrivateFundLegacyNavRows` used `DISTINCT ON (price_date) … ORDER BY pri ASC`, so the **group** row (lower pri) always won — collapsing cum/adj to the post-div unit level and creating the chart V-dip (−11.43% max drawdown / stale 近六个月收益).

### The Correct Fix Applied

| Area | File / function | What changed |
|---|---|---|
| Legacy source tie-break | `preferLegacyNavRow`, `dedupeLegacyNavRowsByDate` | On ex-div unit drops, prefer the row whose 累计 stayed near the prior level (or keeps dividend offset). |
| Legacy loader | `loadPrivateFundLegacyNavRows` | Fetch all pri rows, dedupe in JS instead of SQL `DISTINCT ON pri`. |
| Detail API | `app/ma/api/private-funds/[beian_hao]/route.ts` | Uses `loadPrivateFundLegacyNavRows` (same dedupe path). |
| V-shape outlier removal | `sanitizeVShapeNavOutliers` | Still handles non-ex-div single-day corrupt rows (separate pattern). |

### What This Fix Does NOT Change

- `syncExDivAdjustedNav`, `rechainDerivedFromPrev` formulas — unchanged.
- SBAH99 / SNF018 / SSG947 / BAH99A / SBPC20 fixes — unchanged.
- `preferEmailNavRow`, `alignPreDividendNavRows` — unchanged.

### After deployment

| List cache period returns | `BatchNavResolver.calcPeriodReturns`, `loadLegacyNavBatch` | Use **复权净值** (`return_nav`) for ret_1w/1m/3m/6m/1y when legacy adj is available; legacy batch uses same `dedupeLegacyNavRowsByDate` as detail page. |

```bash
npx tsx scripts/ma/email_nav_etl.ts --refresh-only
```

Regression checks:

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

---

## What Was Fixed (奇盾抱朴专享1号 — SSGD35, custody-only 估值表)

### The Problem

Funds like **奇盾抱朴专享1号** (SSGD35) receive custody **估值表** emails but no dedicated **净值表**. The FOF底层 list showed latest unit NAV (e.g. **1.0878** on 2026-06-30) but **最新涨跌幅** and period returns (近一周/一月/三月) were empty.

### Root Causes

1. **Zip 估值表 skipped NAV ingest** — In `email-parse-fetch.ts`, unit NAV was only copied from 估值表 attachments when `!isValuationZipFilename(att.filename)`. Valuation zips saved full holdings to `ops_email_valuation_records` but never wrote NAV rows to `ops_email_nav_records`.

2. **Historical gap** — Even non-zip 估值表 rows with `unit_nav` in `ops_email_valuation_records` were not backfilled into `ops_email_nav_records`. `BatchNavResolver` / `loadEmailNavBatch` only read the NAV table, so period returns had ≤ 1 data point.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Zip + non-zip 估值表 NAV ingest | `email-parse-fetch.ts` | When an email has no 净值表 attachment, copy unit NAV from **every** 估值表 payload (including zip inner files) into `ops_email_nav_records` with `source = attachment_valuation_table` |
| Historical backfill | `email-valuation-nav-backfill.ts` `backfillCustodyValuationNavFromRecords` | Idempotent upsert of all plausible custody 估值表 `unit_nav` rows into `ops_email_nav_records`; skips FOF multi-level sheets via `isFofUnderlyingValuationEmailRow` |
| ETL hook | `email-parse-fetch.ts`, `email_nav_etl.ts` | Run backfill after valuation upsert (parse) and in `--refresh-only` before list-cache rebuild |

### What This Fix Does NOT Change

- `preferEmailNavRow`, `EMAIL_NAV_PRIMARY_SOURCE_FILTER`, virtual-first priority (SNF018) — 净值表 / TA virtual still beat 估值表 at read time
- SSG947 custody ratio learning, seed merge, SBPC20 attachment-wins-over-virtual — unchanged
- SBAH99 dividend formulas — unchanged
- FOF multi-level 估值表 rejection — unchanged; backfill uses the same guard

### After deployment

Backfill existing valuation history and rebuild FOF cache:

```bash
npx tsx scripts/ma/email_nav_etl.ts --refresh-only
```

Or full re-parse:

```bash
npx tsx scripts/ma/email_nav_etl.ts --days=400
npx tsx scripts/ma/_refresh_fof_cache.ts
```

Regression checks:

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

---

## What Was Fixed (特夫郁金香全量化 — SQX078, 2026-07-03)

### The Problem

Fund detail page **平台数据** table for 特夫郁金香全量化 showed corrupt 累计净值 / 复权净值 on several recent dates (e.g. **2026-05-18**, **2026-05-22**, **2026-05-25**):

| Date | Shown (wrong) | Expected |
|---|---|---|
| 2026-05-18 | unit 1.0889, cum **2.7925**, adj **2.2526** | unit 1.0889, cum **2.2526**, adj **2.7925** |
| 2026-05-25 | unit 1.1056, cum **2.8354**, adj **2.2693** | unit 1.1056, cum **2.2693**, adj **2.8354** |

Symptoms: **adj < cum** (violates `adj >= cum >= unit`), 涨跌幅 on 复权净值 chart/table inconsistent with unit moves, and 复权净值 line distorted on affected dates.

Correct reference row (2026-05-15 and 2026-05-29 were already fine):

| Date | 单位净值 | 累计净值 | 复权净值 |
|---|---|---|---|
| 2026-05-29 | 1.0984 | 2.2621 | 2.8169 |

### Root Cause

Some legacy platform ingest rows stored **累计净值 in `cum_nav_withdrawal`** and **复权净值 in `cumulative_nav`** with the two values reversed. `repairAdjBelowCumRows` cannot fix this — it rechains adj upward from prior rows but does not swap mis-mapped columns.

### The Correct Fix Applied

| Area | File / function | What changed |
|---|---|---|
| Column swap repair | `repairSwappedCumAdjRows` | When `cum > adj` and both are materially above unit, swap the two fields so `adj >= cum >= unit` |
| Pipeline order | `finalizeNavSeries` | Runs `repairSwappedCumAdjRows` immediately after `sanitizeMisassignedUnitNavRows`, before V-shape / dividend logic |

### What This Fix Does NOT Change

- `syncExDivAdjustedNav`, `rechainDerivedFromPrev`, `propagateMissingAdjRows` — unchanged.
- SBAH99 dividend formulas — unchanged.
- SNF018 virtual-first FOF email priority — unchanged.
- SSG947 managed-product seed + email merge — unchanged.
- BAH99A routing / plausible-nav guards — unchanged.
- SBPC20 attachment-wins-over-virtual — unchanged.
- SLA063 `preferLegacyNavRow` ex-div tie-break — unchanged.

### Regression Checks

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
---

---

## Fund-specific NAV correction rules (per-fund overrides)

When upstream data has **wrong early history** for one fund only, add a JSON rule under `data/fund-nav-correction-rules/<备案号>.json` (or save via fund detail → **净值修正规则** UI). Other funds are unaffected.

| Field | Meaning |
|---|---|
| `series_start_date` | Drop all NAV rows strictly before this date |
| `preserve_high_nav_scale` | Skip return-index spike/tail sanitization (~4 NAV is correct) |
| `product_names` | Extra name aliases for list-cache / tracking pool matching |

**Preconfigured examples:**

| Fund | 备案号 | Start date | Note |
|---|---|---|---|
| 锐耐稳健对冲11号 | SBDF95 | 2026-07-03 | Discard wrong ~1 history; ~4 scale from Citics rebased series |
| 锐耐稳健对冲11号A类 | BDP99A | 2026-07-09 | Same for A-class share |

API: `GET /ma/api/fund-nav-correction-rules?code=SBDF95`, `POST /ma/api/fund-nav-correction-rules/save`

After rule change, refresh tracking list cache for affected funds:

```bash
npx tsx scripts/ma/_fix_tracking_sbdf95.ts
# or full refresh:
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only
```

---

## What Was Fixed (锐耐稳健对冲11号 — SBDF95, 2026-07-03)

### The Problem

Fund detail page for **锐耐稳健对冲11号** (Citics auto-disclosure 【基金净值】 email, 备案号 **SBDF95**) showed a corrupt latest row on **2026-07-03**:

| Date | Shown (wrong) | Expected |
|---|---|---|
| 2026-07-01 | unit 1.0214, cum 1.0214, adj 1.0214 | (correct) |
| 2026-07-03 | unit **4.6587**, cum **4.6587**, adj **4.6587**, 涨跌幅 **+356%** | unit **~1.02**, cum/adj rechained from prior |

Symptoms: 成立以来收益 **+365%**, 收益曲线 spiked vertically at the end, max drawdown / Sharpe distorted.

The value **4.6587 ≈ 1 + 365.87%** — a cumulative-return index (成立以来复权倍数), not unit NAV.

### Root Causes

1. **Legacy / summary row as NAV** — Platform or attachment summary rows can store cumulative-return multiples with unit = cum = adj collapsed. No prior-row context exists for `repairCorruptUnitNavRows` (all fields corrupt together).

2. **Citics 【基金净值】 xlsx column bleed** — Headers like **基金资产净值** / bare **净值** matched unit-NAV scoring in `nav-cleaner`, allowing total-AUM or return-index columns to win on summary rows at the bottom of the workbook.

3. **Gap after enabling attachment ingest** — `【基金净值】` subjects were added to NAV-table detection in the same release as SBPU97; SBDF95 email rows merge correctly through **2026-07-01**, but **2026-07-03** came from a corrupt legacy/summary row with no email override.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Terminal spike removal | `sanitizeIsolatedNavSpikes` | Drop last (or gap) rows where unit/cum/adj are equal and unit jumps >100% from prior; skip ex-div dates and V-shape middles (still handled by `sanitizeVShapeNavOutliers`) |
| Multi-day return-index tail | `sanitizeReturnIndexTail` | After spike cleanup, drop trailing run of unit=cum=adj rows still at ~成立以来倍数 vs last sane baseline (SBDF95 **2026-07-07/08** when first row spiked from **2026-07-01**). Baseline uses median of prior ~30 sane unit rows so consecutive corrupt rows (07-03→07-06→07-08) are all removed even when day-over-day change is flat. |
| Pipeline order | `finalizeNavSeries` | Runs `sanitizeIsolatedNavSpikes` then `sanitizeReturnIndexTail`, before corrupt-unit repair |
| Citics xlsx column guard | `isNonUnitNavHeader`, `UNIT_NAV_HEADER_PATTERNS` | Exclude 资产净值 / 净资产 / 份额 / 收益率 headers from unit scoring; require explicit 单位净值-style headers |
| Workbook row filter | `filterImplausibleWorkbookNavRows` | Skip same-pattern spike rows during `analyzeNavWorkbook` ingest |

### What This Fix Does NOT Change

- `syncExDivAdjustedNav`, `rechainDerivedFromPrev`, `propagateMissingAdjRows` — unchanged.
- SBAH99 / SNF018 / SSG947 / BAH99A / SBPC20 / SBPU97 / SLA063 / SQX078 fixes — unchanged.
- `preferEmailNavRow`, virtual-first FOF priority — unchanged.

### After deployment

Re-parse Citics email or refresh cache so list views pick up corrected series:

```bash
npx tsx scripts/ma/email_nav_etl.ts --refresh-only
```

Regression checks:

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
npx tsx scripts/ma/_diag_sbdf95.ts
```

---

## What Was Fixed (2026-07-08 — custody 估值表 date shift + nightly ETL + FOF底层)

Some **在管产品** and **FOF底层** rows showed stale NAV dates while newer custody emails were already in the mailbox (e.g. **SBTX45 衡颐承和FOF1号** with subject `…_4级科目估值表_20260706`, unit NAV **1.0013** on **2026-07-06**; **SNF018 钜融添宝20号** stuck at **2026-07-02** in FOF底层). Four separate issues contributed.

### 1. Custody 估值表 NAV date shifted back one trading day

**Symptom:** Guohai / GTJA **4级科目估值表_YYYYMMDD** emails were parsed and stored, but `nav_date` / `valuation_date` was **one China trading day earlier** than the workbook header. Example: email for **2026-07-06** stored as **2026-07-03** (Mon → Fri) with wrong unit NAV **1.002** instead of **1.0013**.

**Root cause:** `resolveValuationTableNavDate()` in `email-valuation-attachment.ts` treated every `估值表_YYYYMMDD` subject/filename as a **batch send date** and always called `previousChinaTradingDay(subjectDate)`, even when the spreadsheet header already showed `估值日期：2026-07-06` matching the subject date.

**Fix:**

| Area | File / function | What changed |
|---|---|---|
| Date resolution | `resolveValuationTableNavDate()` | When header or summary `valuation_date` equals the subject `估值表_YYYYMMDD` date, use that date directly. Only shift back when header is absent (legacy custodians that embed send-date in filename). |
| DB repair (one-time) | `scripts/ma/repair_valuation_nav_shift.mjs --db-fix-dates` | For rows already in DB: correct `valuation_date` from stored `summary.valuation_date`, extract unit NAV from `summary.header_rows` (`单位净值：…`), delete mis-dated NAV rows, re-insert at correct date. Handles duplicate valuation rows (shifted + correct) by deleting the shifted copy. |
| Re-parse path | `repair_valuation_nav_shift.mjs` (default) | Deletes all custody 估值表 NAV rows and re-fetches mail via IMAP with fixed date logic. Use when production has the code deploy and mail credentials. |

**Products corrected (2026-07-08 repair — 在管产品):** SBTX45, SBPC69, SAVW72 → **2026-07-06**; SSG947 unchanged (no Jul 6 email in DB yet).

**What this fix does NOT change:** `preferEmailNavRow`, `syncExDivAdjustedNav`, virtual-first priority (SNF018), SSG947 seed merge, SBPC20 attachment-wins-over-virtual, FOF multi-level 估值表 rejection — unchanged.

### 2. List cache stuck (investment_pool_metrics timeout)

**Symptom:** `ops_managed_products_list_cache` stopped refreshing after **2026-07-05** while email data was fresher.

**Root cause:** Nightly `step_investment_pool_metrics()` ran `email_nav_etl.ts --refresh-only`, which includes heavy valuation JSONB backfills and exceeded the **60-minute** timeout before reaching `refreshManagedProductsListCache()`.

**Fix:**

| Area | File | What changed |
|---|---|---|
| Cache-only refresh | `scripts/ma/email_nav_etl.ts` | New `--cache-only` flag: skips valuation/holdings backfills; rebuilds list caches only (~2 min). |
| Nightly orchestrator | `scripts/ma/nightly_etl.py` `step_investment_pool_metrics()` | Calls `--refresh-only --cache-only`. Full `--refresh-only` can still be run manually after deploy when valuation sync is needed. |

### 3. Email parse timeout (400-day lookback every night)

**Symptom:** Nightly `email_nav_parse` timed out scanning **400 days** of mail on every run.

**Fix:** Incremental per-mailbox scan from checkpoint:

| Area | File | What changed |
|---|---|---|
| Cursor store | `lib/server/email-parse-cursor.ts` | Per-mailbox cursors in `data/ops_email_parse_cursors.json`; bootstrap from existing parse records. |
| Lookback config | `lib/server/email-parse-lookback.ts` | `INITIAL_DAYS` (default 400) for first-time mailbox; `OVERLAP_DAYS` (default 2) for incremental overlap. |
| Fetch | `lib/server/email-parse-fetch.ts` | Uses `resolveAccountScanSince()` per account; updates cursor after successful scan. |
| Default parse | `email_nav_etl.ts --parse-only` | No `--days` → incremental scan. Explicit `--days=N` or `--full-backfill` for manual backfill. |
| New mailbox | `lib/server/crawl-emails.ts` | Resets cursor when a mailbox is newly added. |

### 4. FOF底层 table stale dates

**Symptom:** FOF底层 (底层汇总) showed old **最新净值日期** for many rows (e.g. SNF018 **2026-07-02**, ATL22A **2026-07-01**, BGW80A **2026-06-05**) while the UI cutoff was **2026-07-08**. `ops_fof_overview_list_cache` had not refreshed since **2026-07-04**.

**Root causes:**

1. **Same custody date-shift bug (§1)** — parent 估值表 rows and FOF holding history used mis-dated `valuation_date`, so `loadManagedUnderlyingNavHistory()` could not surface Jul 6 points for holdings-backed underlyings.
2. **FOF cache not rebuilt** — the manual recovery run used `--managed-only`, which skips `refreshFofOverviewListCache()`. Nightly `--cache-only` (no `--managed-only`) rebuilds **在管产品 + FOF底层 + 跟踪产品** together once deployed.
3. **Two NAV sources for FOF underlyings** — `refreshFofOverviewListCache()` resolves latest NAV via `BatchNavResolver` (email / type6 / legacy) first, then `resolveManagedUnderlyingValuationNav()` / `loadManagedUnderlyingNavHistory()` (parent FOF 估值表 holdings). Email-backed funds update immediately after §1 repair; holdings-only funds (no rows in `ops_email_nav_records`) only advance when the underlying appears in a newer parent 估值表.

**Fix applied (2026-07-08):**

| Step | Command / file | Result |
|---|---|---|
| Custody date repair | `repair_valuation_nav_shift.mjs --db-fix-dates --since=2026-06-01` | 59 valuation dates fixed; 140 NAV rows re-inserted at correct dates (shared with 在管产品) |
| Custody NAV backfill | `backfillCustodyValuationNavFromRecords({ sinceDate: "2026-06-01" })` | 58 rows copied from corrected 估值表 into `ops_email_nav_records` |
| FOF list cache rebuild | `refreshFofOverviewListCache()` via `--refresh-only --cache-only --fof-only` | **52 rows** in `ops_fof_overview_list_cache`; refreshed **2026-07-08** (~15 min via SSH tunnel) |
| Helper script | `scripts/ma/_refresh_fof_cache.ts` | Optional: custody backfill + `refreshManagedFofUnderlying()` + FOF cache. **Avoid** for routine use — `refreshManagedFofUnderlying()` calls `backfillFundHoldingSymbols()` which can hang >20 min. |

**FOF底层 products updated after cache rebuild:**

| Product | Beian | Before | After | Source |
|---|---|---|---|---|
| 钜融添宝20号 | SNF018 | 2026-07-02 | **2026-07-06** | Email NAV |
| 木莲安澜1号A类 | ATL22A | 2026-07-01 | **2026-07-06** | FOF 估值表 holding history (corrected parent dates) |
| 特夫郁金香全量化 | SQX078 | 2026-05-29 | **2026-07-06** | FOF 估值表 holding history (legacy 平台 was stale) |
| 敦和芝诺量化CTA专享3号A类 | BGW80A | 2026-06-05 | 2026-06-05 | Holdings-only — no newer parent 估值表 row in DB |
| 天戈钻选CTA1号B类 | VN917B | 2026-06-12 | 2026-06-12 | Holdings-only — same |

**Follow-up fix — stale legacy blocking fresher 估值表 (SQX078):**

| Area | File / function | What changed |
|---|---|---|
| Latest NAV selection | `BatchNavResolver.resolveAt()` in `list-cache-nav-batch.ts` | Among type6 / legacy / valuation (when no email NAV), pick the **newest plausible `nav_date`** instead of always preferring legacy over FOF 估值表 holdings. Email NAV priority unchanged. |

**What this fix does NOT change:** Email-first priority, seed overrides, SNF018 virtual-first, SQX078 cum/adj repair in `finalizeNavSeries` — unchanged.

**Code paths (FOF底层 list):**

| Concern | File |
|---|---|
| API route | `app/ma/api/ops/fof-underlying/list/route.ts` |
| Nightly cache | `lib/server/fof-overview-list-cache-pg.ts` `refreshFofOverviewListCache()` |
| FOF holding NAV history | `lib/server/managed-fof-underlying-pg.ts` `loadManagedUnderlyingNavHistory()` |
| Underlying snapshot (slow; optional) | `lib/server/managed-fof-underlying-pg.ts` `refreshManagedFofUnderlying()` |
| Frontend table | `app/ma/dashboard/private-funds/page.tsx` (FOF底层 tab) |

### Manual recovery commands

```bash
# Fix already-parsed custody rows in DB (no IMAP; safe via SSH tunnel)
npx tsx scripts/ma/repair_valuation_nav_shift.mjs --db-fix-dates --since=2026-06-01

# Rebuild 在管产品 list cache only (fast; no valuation backfill)
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --managed-only

# Rebuild FOF底层 list cache only (~15 min via tunnel; uses corrected 估值表 dates + email NAV)
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --fof-only

# Rebuild all three list caches (在管产品 + FOF底层 + 跟踪产品; nightly default after deploy)
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only

# Optional — full FOF underlying snapshot + cache (symbol backfill can hang; prefer --fof-only above)
# npx tsx scripts/ma/_refresh_fof_cache.ts

# Full re-parse after code deploy (needs IMAP credentials on server)
npx tsx scripts/ma/repair_valuation_nav_shift.mjs --days=90

# Incremental nightly parse (default after deploy)
npx tsx scripts/ma/email_nav_etl.ts --parse-only
```

See also **在管产品 data flow** in `docs/managed-products-list-data.md` for ETL trigger details.

---

## What Was Fixed (2026-07-09 — Jul 7 custody emails stored as Jul 6)

**Symptom:** After nightly ETL, **衡颐海宸1号 (SBPC69)**, **衡颐承和FOF1号 (SBTX45)**, **荣熙共赢 (SBNX55)**, and other custody funds stayed on **2026-07-06** while Jul 7 emails were already in the mailbox (e.g. SBPC69 `_20260707_估值表`, unit NAV **1.0293** on **2026-07-07**).

**Root cause:** Same custody date-shift bug as §1 (2026-07-08), still running on production when last night's parse executed. Emails **were parsed** but `nav_date` / `valuation_date` was shifted back one trading day (`2026-07-07` → `2026-07-06`) because production had not yet deployed the `resolveValuationTableNavDate()` fix. Stored `summary.valuation_date` was already correct (`2026-07-07`).

**SBNX55 nuance:** Email rows for **2026-07-07** were already correct in DB; only the **list cache** was stale until refresh.

**Recovery (2026-07-09):**

```bash
npx tsx scripts/ma/repair_valuation_nav_shift.mjs --db-fix-dates --since=2026-07-01
npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --managed-only
```

Result: SBPC69 → **2026-07-07 / 1.0293**, SBTX45 → **2026-07-07**, SBNX55 → **2026-07-07**, SBPU97 / SAVW72 → **2026-07-07**.

**Prevent recurrence:** Deploy local `resolveValuationTableNavDate()` fix to production (`/root/new_market_project`) so incremental nightly parse writes the correct date without manual `--db-fix-dates`.

---

## What Was Fixed (2026-07-09 — SNF018 复权净值 flat after attachment emails)

**Symptom:** Fund detail for **钜融添宝20号 (SNF018)** showed **复权净值 = 累计净值** (e.g. **1.7395** on 2026-07-07) while reference platforms show **~1.8095** — the 收益曲线 (复权净值) and period returns were understated.

**Root cause:** After 2026-06-15, **资产净值公告** attachment emails stored `adjusted_nav` equal to **累计净值** (not a true 复权). Additionally, email rows overlapping legacy Apr–May dates **cleared** good legacy 复权 whenever email supplied unit+cum without adj, forcing a rechained ratio (~**1.033**) lower than the true legacy ratio (~**1.040**).

**Fix (does not change SNF018 virtual-first priority or unit inference):**

| Area | File / function | What changed |
|---|---|---|
| Ignore fake email adj | `isPlausibleEmailAdjustedNav`, `mergeNavSeriesWithEmail` | Only accept email `adjusted_nav` when strictly **above** 累计; cum-copied adj triggers rechain like `adjusted_nav: null` |
| Keep good legacy adj | `mergeNavSeriesWithEmail` | When email confirms unit+cum only and legacy already has plausible 复权, **keep** legacy adj instead of clearing |
| Repair flat adj series | `repairAdjBelowCumRows` | Forward-fill 复权 using last good **adj/cum** ratio when rows have adj ≈ cum but history had adj > cum |

**Verified after fix (2026-07-07):** unit **1.3291**, cum **1.7395**, adj **~1.809** (ratio ≈ 1.040, aligned with reference ~1.8095).

Regression: `npx tsx scripts/test-nav-rechain.mjs` (SNF018 flat-adj + legacy tail cases).

---

## What Was Fixed (2026-07-09 — 笃熙泰渊流1号A类 — AVM354, 复权 collapsed to unit)

### The Problem

Fund detail for **笃熙泰渊流1号A类 (AVM354)** showed corrupt headline metrics and a broken 收益曲线:

| Symptom | Wrong value |
|---|---|
| 成立以来收益 / 今年以来 | Both **+66.01%** (identical) |
| 成立以来年化 | **+16959.59%** |
| 成立以来夏普比率 | **85.49** |
| 复权净值 (latest) | **1.9440** (= 累计, should track reinvested wealth) |
| 收益曲线 | Near-vertical spike at series start |

Correct reference (same unit / 累计 on latest dates): 复权 **~2.09**, 成立以来收益 **~109%**, 成立以来年化 **~75%**, Sharpe **~4.86**.

Unit NAV and 累计净值 in the table were already correct (e.g. unit **1.1950**, cum **1.9440** on 2026-07-08). Only **复权** and derived metrics were wrong.

### Root Cause

On post-dividend dates (after the **2026-02-03** ex-dividend event where unit dropped from **1.687** to **1.000** while 累计 stayed **~1.749**), legacy platform rows stored **单位净值 in the `cumulative_nav` (复权) column** while `cum_nav_withdrawal` (累计) was correct.

Example corrupt row:

| Date | 单位 | 累计 (`cum_nav_withdrawal`) | 复权 (`cumulative_nav`) — wrong |
|---|---|---|---|
| 2026-06-03 | 1.1710 | 1.9226 | **1.1710** (= unit) |

Headline metrics use `nav_series[0].cumulative_nav` as the inception anchor. When the visible series start had **复权 = 单位** instead of **~1.92**, `成立以来收益` became `1.944 / 1.171 − 1 ≈ 66%` over only **~36 days** → annualized return exploded to **~17000%**.

Email NAV history (when fully merged) is fine; the bug appears when legacy/platform points with mis-mapped 复权 win or supply the series tail.

### The Correct Fix Applied

| Area | File / function | What changed |
|---|---|---|
| Adj=unit repair | `repairAdjCollapsedToUnitRows` | When `cum − unit > 0.05` but `adj ≈ unit` (not `≈ cum`), rechain 复权 from prior row cum-ratio or fall back to 累计 |
| Pipeline order | `finalizeNavSeries` | Runs after `clampSanityNavRows`, before `repairAdjBelowCumRows` |

### What This Fix Does NOT Change

- `syncExDivAdjustedNav`, `rechainDerivedFromPrev`, SNF018 virtual-first / flat-adj repair — unchanged
- SBAH99 dividend formulas, SSG947 seed merge, SBPC20 attachment-wins-over-virtual — unchanged
- `alignPreDividendNavRows`, `preferEmailNavRow` — unchanged

### Regression Checks

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
```

---

## What Was Fixed (六妙星豪鑫主观2号 — SQU767, 2026-07-10)

### The Problem

**跟踪产品** list showed absurd values for **六妙星豪鑫主观2号** (备案号 **SQU767**):

| Field | Shown (wrong) | Expected |
|---|---|---|
| 最新单位净值 | **219550733.5500** | **~3.33** |
| 最新涨跌幅 | **+9125892889.86%** | ~±1% |
| 近三月收益 | **+9138047579.60%** | ~±10% |

Correct **【净值表】** emails from **2026-06-18** onward stored unit NAV ~**3.14–3.33** with `nav == cumulative_nav`.

### Root Causes

1. **AUM stored as unit NAV** — Earlier **【净值表】** rows (e.g. **2026-06-01–04**) stored **基金资产净值** (~212M) in `nav` while `cumulative_nav` held the true per-unit value (~**2.77–2.90**).

2. **Continuity gate blocked good rows** — `selectEmailNavSeriesRows` kept the corrupt AUM rows, then skipped **2026-06-18+** dates because the >15% day-over-day jump from ~222M to ~3.14 looked like a share-class discontinuity.

3. **List cache used uncorrected batch NAV** — `loadEmailNavBatch` pushed implausible `nav` without recovering from `cumulative_nav`; stale `ops_tracking_funds_list_cache` held the bad value.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| AUM recovery | `recoverPlausibleEmailUnitNav` | When `nav` is implausible but `cumulative_nav` is a sane unit NAV, use cumulative as unit |
| Email series selection | `selectEmailNavSeriesRows`, `applyEmailUnitNavCorrection` | Recover unit before continuity check; skip dates still implausible after recovery |
| List batch | `loadEmailNavBatch`, `loadEmailNavByNameBatch` | Apply recovery; skip rows still implausible |
| Resolver guard | `BatchNavResolver.resolveAt` | Reject implausible email point; symmetric name/beian fallback |

### DB repair (one-time via tunnel)

Delete corrupt email rows where `nav > 1000`:

```bash
npx tsx scripts/ma/_repair_squ767_aum.ts
npx tsx scripts/ma/_fix_tracking_squ767.ts
```

### What This Fix Does NOT Change

- SBAH99 / SNF018 / SSG947 / BAH99A / SBPC20 / SBDF95 / SBDW42 / SLA063 fixes — unchanged
- `syncExDivAdjustedNav`, `rechainDerivedFromPrev`, virtual-first priority — unchanged
- SBDW42 share-class continuity skip — unchanged (still applies when only one class row and >15% jump)

### Regression Checks

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/_diag_haoxin_subjective2.ts
```

---

## What Was Fixed (六妙星豪鑫3号A类 — ASX73A, period returns vs max drawdown, 2026-07-10)

### The Problem

**跟踪产品 / 彭博运维池** showed **近一月收益 −38.89%** for **六妙星豪鑫3号A类** (ASX73A) while the fund detail page showed **成立以来最大回撤 −5.79%** on the 复权 curve — impossible if both used the same return series.

Same pattern affected multiple dividend / virtual-NAV funds in `ops_tracking_funds_list_cache`.

### Root Causes

1. **Mixed NAV scales in period returns** — Latest point came from email/virtual (**单位净值** ~1.02) while the 1-month base came from legacy with **复权** ~1.67. `calcReturn(1.02, 1.67) ≈ −39%`.

2. **Email tail without `return_nav`** — `loadEmailNavBatch` stored unit NAV only; `navForReturn` fell back to unit on recent dates but used `return_nav` (复权) on older legacy bases.

3. **Stale cache** — Rows were computed before `isSameShareClassNavLevel` / `resolvePeriodBase` guards and never rebuilt.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| 复权 forward-fill | `enrichReturnNavSeries` | Propagate legacy `return_nav / unit` ratio onto email-only tail points |
| Period returns | `calcPeriodReturns` | Build from enriched `mergedHistoryForRiskMetrics` + `resolvePeriodBaseFromHistory` (same scale end-to-end) |
| Sanity cap | `capPeriodReturnByDrawdown` | Null out period loss when \|ret\| exceeds lifetime/window max drawdown on the same series |
| Cache rebuild | `scripts/ma/_refresh_tracking_cache.ts` | Recompute all `ops_tracking_funds_list_cache` rows |

### What This Fix Does NOT Change

- SBAH99 / SNF018 / SSG947 / BAH99A / SBPC20 / SBDF95 / SBDW42 / SQU767 / SLA063 fixes — unchanged
- `resolvePeriodBase` (share-class / stale-base guards for other callers) — unchanged
- `syncExDivAdjustedNav`, virtual-first priority — unchanged

### After deployment

```bash
npx tsx scripts/ma/_refresh_tracking_cache.ts
```

Regression checks:

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/_diag_asx73a_returns.ts 2026-07-02
```

---

## What Was Fixed (邮箱运维池 — email fund coverage, 2026-07-10)

### The Problem

**投资 → 团队跟踪 → 邮箱运维池** showed only **59** funds while **105+** distinct products appeared in mailbox parse / NAV data. Example: **邦客鼎成精选 (SAUV26)** appeared in email subjects but not in the pool when searching **邦客**.

### Root Causes

1. **Pool sync used `listTeamData` + 备案号 required** — funds without a resolved 备案号 were skipped (3 known cases).
2. **`dedupeShareClassDisplayFunds` in pool sync** — collapsed **70** beian-resolved funds to **59** by display name (e.g. parent vs A类 rows).
3. **Subject-only discovery missing** — funds present in email subjects (parse UI) but without a stored NAV row never entered `ops_email_nav_records`, so they were invisible to the old sync.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Pool fund loader | `loadEmailPoolFunds` in `team-data-query-pg.ts` | Union NAV rows, valuation rows, and subject metadata (DB subjects + `ops_email_parse_records.json`) |
| Register number | `emailPoolRegisterNumber` | Use 备案号 when available; else product code; else stable fund key |
| Pool sync | `syncEmailTrackingPool` | Uses `loadEmailPoolFunds` directly — no display-name dedupe, no 备案号 gate |
| Parse records | `getAllEmailParseRecords` | Exposes all parse subjects for nightly pool sync on the server |

### Production backfill (2026-07-10)

Ran `syncEmailTrackingPool` + cache refresh: **59 → 86** funds in `custom_email_nav`, including **SAUV26 邦客鼎成精选**.

### After deployment

```bash
npx tsx scripts/ma/seed_email_tracking_pool.ts
npx tsx scripts/ma/_sync_email_pool_cache.ts
```

Nightly `email_nav_etl.ts` already calls `syncEmailTrackingPool` after parse.

---

## What Was Fixed (国信托管 净值邮件 — SAUV26 邦客鼎成精选, 2026-07-10)

### The Problem

**邮箱运维池** showed **邦客鼎成精选 (SAUV26)** at **2026-06-05 / 1.3594** (stale platform NAV) while the mailbox had **2026-07-09 / 1.3014** from Guosen/国信托管 (`gxtgwbhs@guosen.com.cn`).

### Root Cause

Guosen custody emails use subject/filename pattern **`净值20260709`** (no **净值表** suffix). Old attachment selectors required **净值表**, so the `.xls` attachment was skipped and the body table row (`产品代码 … 日期 … 单位净值`) had no dedicated parser.

### Fix

| Area | Change |
|---|---|
| `email-nav-attachment.ts` | Match `净值20\d{6}` / `净值YYYY-MM-DD` in subject and filename |
| `email-nav-extract.ts` | `parseGuosenCustodyNavSubject` + Guosen body-table row parser |
| Production backfill | Inserted 2026-07-09 email NAV; cache refreshed to **1.3014** |

After deploy, re-parse recent mail: `npx tsx scripts/ma/email_nav_etl.ts --parse-only --days=30`

---

## What Was Fixed (青钱基石1号 — SBDW42, manage stream remap, 2026-07-10)

### The Problem

**私募基金 → 青钱基石1号** (备案号 **SBDW42**) detail page showed **2026-07-09 unit NAV 1.0867** (−25% daily) while the email **【净值表】** had **1.4548** on the same date.

### Root Cause

`filterEmailNavManageStream` called `selectEmailNavSeriesRows` correctly (parent ~**1.45** series), then **discarded the selection** when re-attaching DB row ids: it fell back to `typeFiltered.find(r => r.nav_date === row.nav_date)`, which returned the **first** raw row for that date — the **B-class ~1.09** NAV also stored under product code **SBDW42** in the same attachment.

The public `loadEmailNavSeries` path was unaffected; only **在管 / manage** streams (`loadEmailNavManagePoints`, `loadManagedProductNavSeries`, `loadFundNavSeries` with manual team NAV) showed the wrong values.

### Fix

| Area | Change |
|---|---|
| `filterEmailNavManageStream` | Reattach ids by matching **nav_date + nav** (then name), and always spread selected `row` values last |

### What This Fix Does NOT Change

- SBDW42 `selectEmailNavSeriesRows` share-class continuity logic — unchanged
- SQU767 / ASX73A / SNF018 / other protected fixes — unchanged

### Regression

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/_diag_sbdw42_detail.ts
```

---

## What Was Fixed (长江证券 虚拟净值 — SB969A 铸锋太阿3号A类, 2026-07-10)

### The Problem

**投资 → 团队跟踪 → 邮箱运维池** search for **铸锋太阿3号A类** showed a pool row but **all NAV columns empty** (—). The product detail page had **0 条** platform NAV rows despite a Changjiang email with **2026-07-09 / 1.0000** (`cjtgdata@pbcjsc.com`, subject `虚拟净值-铸锋太阿3号…-20260709.xls`).

### Root Cause

1. **No parser** for Changjiang **虚拟净值** body tables — column is **试算后单位净值**, not **单位净值**.
2. **Attachment skipped** — `selectNavTableAttachments` required **净值表** in subject/filename; `虚拟净值-*.xls` was excluded by the old `!/虚拟净值/` filter.
3. **Name-only pool key** — pool row used `register_number = '铸锋太阿3号A'` (from subject discovery) instead of product code **SB969A**, so cache could not join email NAV.

### Fix

| Area | Change |
|---|---|
| `email-nav-extract.ts` | Changjiang virtual body-table parser (试算后单位净值 row) |
| `email-nav-attachment.ts` | Accept `^虚拟净值-` subjects/filenames; do not exclude virtual-NAV xls |
| `nav-cleaner.ts` | **试算后单位净值** as unit column; exclude **试算前** headers from unit scoring |
| `email-parse-fetch.ts` | `hasTableNav` accepts **试算后单位净值** body tables |
| Production backfill | `_fix_sb969a.ts` inserts 2026-07-09 row; pool key → **SB969A** |

After deploy, re-parse recent mail: `npx tsx scripts/ma/email_nav_etl.ts --parse-only --days=30`

### Regression

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/_diag_sb969a.ts
```

---

## What Was Fixed (六妙星豪鑫6号 — SBHK26, custody unit inference, 2026-07-10)

### The Problem

**私募基金 → 六妙星豪鑫6号** (SBHK26) detail page showed **2026-06-29 unit NAV 0.9726** (−26.62% daily) while the custody **【基金估值表】** stored **1.1227** on the same date.

### Root Cause

`applyEmailUnitNavCorrection` learned a **unit/cum ratio (~0.867)** from **BHK26A** post-investment virtual emails (A-class share class) and applied it to the parent fund’s own **attachment_valuation_table** row where `nav == cumulative_nav`. That scaled **1.1227 × 0.867 ≈ 0.9726**.

SSG947-style inference is correct for **资产净值公告** rows that store cumulative as unit — but must **not** run on the fund’s own custody **估值表** rows, and must **not** learn ratios from share-class (parent-code) virtual streams.

### Fix

| Area | Change |
|---|---|
| `applyEmailUnitNavCorrection` | Skip unit inference for `isCustodyValuationEmailRow`; learn ratio only from non-share-class rows (`!isParentCodeEmailRow`) |

### What This Fix Does NOT Change

- SSG947 custody ratio learning + 资产净值公告 inference — unchanged
- SBDW42 share-class continuity / manage-stream remap — unchanged
- SQU767 AUM recovery, ASX73A period returns, SNF018 virtual-first — unchanged

### Regression

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/_diag_sbhk26.ts
```

After deploy, refresh tracking cache if needed: `npx tsx scripts/ma/_fix_sbhk26.ts`

---

## What Was Fixed (笃熙景泰泰渊流1号 — SAVM35, halved legacy unit + email rechain, 2026-07-10)

### The Problem

**私募基金 → 笃熙景泰泰渊流1号** (SAVM35) showed **unit NAV 0.7400** with **累计 1.4890** and a near-vertical drop on the 收益曲线, while custody **4级科目估值表** emails had **~1.195–1.215** on the same dates.

### Root Cause

1. **Legacy platform halved unit NAV** after a dividend (unit ≈ cum/2) while cumulative stayed at the pre-scale level (~1.489).
2. **Email custody rows** store unit-only (`cumulative_nav` null). When email corrected unit from ~0.74 → ~1.21, `rechainDerivedFromPrev` rejected the >50% jump and **kept stale cumulative**.
3. When email did not merge (or cum was not cleared), the page showed the raw halved legacy values.

### Fix

| Area | Change |
|---|---|
| `rechainDerivedFromPrev` | Gap-based rechain when unit jump >50% but prior row has post-div cum-unit gap |
| `mergeNavSeriesWithEmail` | Clear stale cum/adj when email unit jumps >25% vs legacy (force gap rechain) |

### What This Fix Does NOT Change

- AVM354 `repairAdjCollapsedToUnitRows`, SBHK26 custody inference, SSG947 seed merge — unchanged
- SBDW42 / SQU767 / ASX73A / SNF018 protected fixes — unchanged

### Regression

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/_diag_savm35_window.ts
```

After deploy: `npx tsx scripts/ma/_fix_savm35.ts`

### Follow-up (2026-07-10 — list cache stuck on last 净值公告)

**Symptom:** **SAVM35** parent was in **邮箱运维池** but list showed **2026-05-28 / 1.167** while custody **4级科目估值表** emails through **2026-07-09 / 1.215** were already parsed.

**Root cause:** `BatchNavResolver.resolveEmailNavAt()` and `buildEmailNavLatestJoins()` treated **估值表** as fallback only when **no** primary 净值公告 existed. SAVM35 still had a May **资产净值公告** row, so fresher Jul **估值表** rows were ignored for latest NAV.

**Fix:** When primary and valuation streams both exist, pick the **fresher `nav_date`** (same-date ties still prefer primary). Custom **邮箱运维池** list query now dedupes by **register_number**, not display name — keeps parent + share classes (SBAH99 / BAH99A / BAH99C).

---

## What Was Fixed (荣熙恒盈2号 — SBAH99 / BAH99A / BAH99C, 邮箱运维池 share classes, 2026-07-10)

### The Problem

**邮箱运维池** search for **荣熙恒盈2号** showed only **A类** and **C类** rows — missing the parent **荣熙恒盈2号 (SBAH99)**. Clicking **荣熙恒盈2号A类** opened the **parent** fund detail (SBAH99 / 荣熙恒盈2号) because the pool row used `register_number = SBAH99` with `product_name = 荣熙恒盈2号A类`. **BAH99A** was dropped entirely.

### Root Cause

1. **`dedupeEmailPoolFundsByDisplayName`** collapsed all rows sharing a display name into one register number — when SBAH99 was mislabeled as **荣熙恒盈2号A类**, it beat **BAH99A**.
2. **Latest email row wins** for `product_name` per register — A类-tagged valuation rows could overwrite the parent **SBAH99** name.
3. No **canonical name from BFL** per 备案号 in pool sync.

### Fix

| Area | Change |
|---|---|
| `dedupeEmailPoolFundsByDisplayName` | Keep **all** fund-code registers; drop only Chinese name-only duplicates |
| `canonicalEmailPoolProductName` | Parent codes (SBAH99) strip A/B/C suffix; class codes get matching suffix |
| `emailPoolRowIdentityScore` | Prefer rows whose product_code / fund_name align with register suffix |
| Production repair | `_repair_sbah99_pool.ts` — sync pool + refresh SBAH99 / BAH99A / BAH99C cache |

### What This Fix Does NOT Change

- BAH99A FOF/detail routing (`resolveRouteFundId`, `sqlShareClassProductNameGuard`) — unchanged
- SBAH99 dividend rechaining / managed-product seed — unchanged
- SBHK26 / SAVM35 / other pool coverage fixes — unchanged

### Regression

```bash
npx tsx scripts/ma/_diag_sbah99_pool.ts
npx tsx scripts/test-nav-rechain.mjs
```

After deploy: `npx tsx scripts/ma/_repair_sbah99_pool.ts`

---

## What Was Fixed (金友至远1号 — SBFM35, corrupt valuation cum + unit inference bleed, 2026-07-11)

### The Problem

**跟踪产品** and fund detail for **金友至远1号 (SBFM35)** showed absurd unit NAV:

| Field | Shown (wrong) | Expected |
|---|---|---|
| 最新单位净值 | **0.3699** | **~1.08** |
| 最新涨跌幅 | **−63.96%** | ~+5% |
| 2026-06-12 detail row | unit **0.3606**, cum **2.3343** | unit **~1.05**, cum **~1.05** |

### Root Causes

1. **Corrupt 累计 on custody 估值表** — `2026-05-29` valuation row stored `nav=1.0263, cumulative_nav=**3.0000**` (wrong column — likely 成立以来倍数, not 累计净值).

2. **Bad unit/cum ratio learned** — `applyEmailUnitNavCorrection` learned ratio `1.0263/3.0 ≈ 0.342` from that row and scaled later **BFM35A 资产净值公告** rows (`nav == cum ≈ 1.05`) down to **~0.36**.

3. **Legacy halved unit kept on merge** — `emailNavLooksLikeCumulativeNotUnit` treated a normal +2.7% unit move (1.026→1.054) as “cum stored as unit”, keeping legacy unit **0.360573** instead of email **1.054**.

4. **A-class-only dates dropped** — global share-class pool excluded BFM35A-only dates when any parent valuation row existed; fixed with per-date pool fallback.

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Reject corrupt email 累计 | `isPlausibleEmailCumulativeNav`, `isUsableEmailCumulativeNav` | Ignore cum when `cum/unit > 2` (column bleed) |
| No ratio from bad cum | `applyEmailUnitNavCorrection` | Only learn unit/cum ratio from plausible 累计; strip corrupt cum |
| No inference on share-class rows | `applyEmailUnitNavCorrection` | Skip `inferEmailUnitNav` for `isParentCodeEmailRow` (BFM35A when querying SBFM35) |
| Prefer plausible cum in tie-break | `preferEmailNavRow` | Deprioritize rows with implausible 累计; exclude from “distinct cum” bonus |
| Per-date share-class fallback | `selectEmailNavSeriesRows` | Use A/B/C-class email only when no parent row exists for that date; don't advance `prevNav` from fallback rows |
| Fix false cum-as-unit merge | `emailNavLooksLikeCumulativeNotUnit` | Require `nav/prevUnit > 1.05` (unit actually jumped to cum level), not merely `> 0.995` |

### Verified Correct Values (after fix)

| Date | 单位净值 | 累计净值 |
|---|---|---|
| 2026-05-29 | 1.0263 | 1.0263 |
| 2026-06-12 | 1.0540 | 1.0540 |
| 2026-06-30 | **1.0813** | 1.0813 |

List cache refreshed: `unit_nav 0.3699 → 1.0813`, `return_pct −63.96% → +5.36%`.

**BFM35A (南京金友A类)** had the same stale cache (`0.3699 / −65.6%`) even though email selection was already correct. Additional fixes:

| Area | Change |
|---|---|
| `BatchNavResolver.resolveAt` | Share-class beians (`*A/*B/*C`) prefer `emailByBeian` direct code rows over fuzzy `emailByName` (which pulled parent SBFM35 估值表 on 2026-06-30) |
| `selectEmailNavSeriesRows` | A-class per-date fallback uses **exact** `product_code` match only — not parent `SBFM35` via `shareClassProductCodesMatch` |
| `upsertTrackingFundListCacheEntry` | Use `user_custom_pool` display name (`南京金友A类`) as `short_name` when BFL has none |

BFM35A cache after refresh: **2026-07-03 / 1.0745**.

### What This Fix Does NOT Change

- SBAH99 / SNF018 / SSG947 / SBPC20 / SBHK26 custody skip / SBDW42 manage-stream remap — unchanged
- `syncExDivAdjustedNav`, `rechainDerivedFromPrev` formulas — unchanged

### Regression Checks

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/_diag_sbfm35.ts
```

After deploy:

```bash
npx tsx scripts/ma/_fix_sbfm35.ts
```

---

## What Was Fixed (六妙星九紫一号 — SBPC20, 2026-07-12 — Jul 2 unit=cum collapse + Jul 3 +15% cliff regression)

### The Problem

Fund detail for **六妙星九紫一号 (SBPC20)** regressed after the **SBFM35** fix:

| Date | Shown (wrong) | Expected |
|---|---|---|
| 2026-07-02 | unit **1.1855**, cum **1.1855**, adj **1.1855** | unit **1.1855**, cum **~1.3986**, adj **~1.3986** |
| 2026-07-03 | daily change **+15.88%** | daily change **~-2%** (cum-on-cum) |

The Jul 2 cliff appeared only when **Jul 3** email was present (3-row series); Jul 2 alone merged correctly.

### Root Cause

Not the SBFM35 `emailNavLooksLikeCumulativeNotUnit` threshold (`0.995` → `1.05`) — that change is safe for SBPC20.

The regression was in **`sanitizeMisassignedUnitNavRows`** inside `finalizeNavSeries`:

1. Jul 2 legacy row had **collapsed** `cum_nav_withdrawal` (= unit) while email confirmed unit **1.1855** without distinct cum → `unitOnlyEmailDates` correctly set.
2. With Jul 3 present, `sanitizeMisassignedUnitNavRows` treated Jul 2 (unit=cum) as a misassigned ex-div row and rewrote unit to `currCum / (nextCum/nextUnit)` ≈ **1.0017**.
3. `sanitizeVShapeNavOutliers` then saw a V-shaped **unit** dip and restored unit to **prevUnit = 1.1805** (Jul 1 level).
4. `refreshDerivedForEmailRows` rechained cum from unit **1.1805**, producing cum **1.3936** (Jul 1 cum, not Jul 2's correct **~1.3986**).

### The Correct Fixes Applied

| Area | File / function | What changed |
|---|---|---|
| Skip misassigned-unit fix on mild post-div middle rows | `sanitizeMisassignedUnitNavRows` | When neighbors both carry post-div cum>unit and middle unit moves mildly (<5% vs each neighbor), skip ratio-based unit fix — let cum rechain handle it |
| Collapsed cum between post-div neighbors | `sanitizeVShapeNavOutliers` | Detect middle row with unit≈cum sandwiched between post-div rows; rechain cum/adj from prev |
| Force unit-only rechain after ex-div anchor | `mergeNavSeriesWithEmail` | When email supplies unit only and prior row has dividend offset, always add `unitOnlyEmailDates` and clear stale legacy 复权 |
| Split-field legacy detection | `emailUnitOnlyNeedsRechain`, `legacyCumCollapsedButAdjShowsPostDiv` | When `cum_nav_withdrawal` collapsed but `cumulative_nav` still shows post-div, always rechain |

### Verified Correct Values (after fix)

| Date | 单位净值 | 累计净值 | 复权净值 | 涨跌幅 |
|---|---|---|---|---|
| 2026-07-02 | 1.1855 | ~1.3986 | ~1.3986 | ~+0.42% |
| 2026-07-03 | 1.1606 | 1.3737 | 1.3737 | ~-2.1% (cum ratio) |

### Follow-up (2026-07-12 live DB — AUM-as-nav attachments)

**Still wrong on production UI after the finalize-path fix** because live email rows for Jun–Jul store **基金资产净值 (AUM)** in `nav` (e.g. `4650928.29`) while subject carries `单位净值：1.1855` and `cumulative_nav` is the true 累计 (`1.3986`).

Additional root causes:

1. **`emailRowHasAttachmentDividendOffset` used raw AUM nav** → attachment never counted as post-div → virtual `虚拟业绩报酬` (tier −1) won.
2. **`applyEmailUnitNavCorrection` stripped cum before recovering unit** → `cum << AUM` looked implausible → good 累计 wiped.
3. **`pickEmailNavRowWithContinuity` saw AUM as a >15% jump** vs prior unit → replaced attachment with continuous virtual (wrong cum).

| Area | Change |
|---|---|
| `recoverPlausibleEmailUnitNav` | Prefer **subject unit hint** before treating cum as unit (keeps SBPC20 dividend offset; SQU767 still recovers from cum when subject has no hint) |
| `emailRowHasAttachmentDividendOffset` / `preferEmailNavRow` | Evaluate dividend offset on **recovered** unit |
| `applyEmailUnitNavCorrection` | Recover unit **before** stripping implausible cum |
| `pickEmailNavRowWithContinuity` | Never override attachment that already has post-div cum; use recovered unit for continuity |

**Live verified (SSH tunnel → DB):**

| Date | unit | cum | daily |
|---|---|---|---|
| 2026-07-02 | 1.1855 | **1.3986** | +0.42% |
| 2026-07-03 | 1.1606 | 1.3737 | **−2.10%** (was +15.88%) |

### Follow-up (2026-07-12 — chart 复权 cliff / missing adj premium)

Even with correct unit/cum, the **收益曲线 (复权净值)** still looked wrong vs reference:

| Field | Ours (wrong chart) | Reference |
|---|---|---|
| 2026-06-11 daily | **−19.48%** (unit cliff) | soft ex-div (~cum move) |
| 2026-07-09 复权 | **1.3774** (= cum) | **~1.4124** |
| 成立以来收益 | **35.73%** | **~39.18%** |

**Root cause:** Jun 11 first ex-div has unit collapse (1.24→1.00) while cum only dips (1.24→1.21). Classic `isLikelyDividendExDate` required flat cum, so:
1. Daily change used **unit ratio** (−19%)
2. `syncExDivAdjustedNav` never seeded **adj > cum**
3. Gap-only `D_new` on first ex-div collapses adj to cum when cum dipped; `refreshStaleDerivedFields` then wiped any premium

| Area | Change |
|---|---|
| `isLikelyDividendExDate` | Soft first-ex-div: large unit drop + much smaller cum drop + post-div gap |
| `syncExDivAdjustedNav` | On first ex-div use **unit-drop D** so adj stays near prevAdj (reinvested); don't skip when email set adj==cum |
| `rechainDerivedFromPrev` | Same first-ex-div D so stale refresh cannot collapse adj to cum |
| `refreshStaleDerivedFields` | Skip ex-div rows that already have adj > cum |

**Live after fix:** Jun 11 daily **−2.32%**, Jul 9 adj **~1.410**, 成立以来 **~38.95%** (reference ~39.18% / adj ~1.4124).

**Deploy note:** Fund detail computes NAV in process — production must rebuild/restart after updating `email-nav-query.ts` or the UI keeps serving the old cliff.

No email ETL rewrite needed — selection/merge fix is enough. Deploy code, then hard-refresh fund detail.

### What This Fix Does NOT Change

- SBFM35 / BFM35A corrupt-cum and ratio-bleed fixes — unchanged
- SNF018 virtual-first, SBAH99 dividend formulas — unchanged
- SBPC20 attachment-wins-over-virtual — unchanged
- SLA033 V-shape outlier restoration — unchanged
- SQU767 AUM→cum recovery — unchanged (subject has no unit hint)

### Regression Checks

```bash
npx tsx scripts/test-nav-rechain.mjs
npx tsx scripts/ma/check_fof_nav_invariant.ts
# with tunnel: npx tsx scripts/ma/_diag_sbpc20_chart.ts
```

---

## What Was Fixed (笃熙禀泰多资产轮动策略2号 — SNG210, wrong pool name, 2026-07-10)

### The Problem

**邮箱运维池** search for **多资产轮动策略2号** / **SNG210** did not find the fund — it was stored as **笃熙禀泰文艺复兴16号** because BFL maps register **SNG210** to the wrong name, while every custody email uses **笃熙禀泰多资产轮动策略2号**.

### Fix

| Area | Change |
|---|---|
| `canonicalEmailPoolProductName` | When email `product_code` matches the register but `fund_name` disagrees with BFL, use the **email name** for pool display |
| Production repair | `_repair_sng210_pool.ts` — resync pool + refresh cache (**2026-07-09 / 1.1970**) |

**Note:** **多资产轮动策略3号** is **SQQ300** (a different fund). Search **2号** or **SNG210** for this email product.

After deploy: `npx tsx scripts/ma/_repair_sng210_pool.ts`
