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
| `filterEmailNavManageStream` | Must use `selectEmailNavSeriesRows` — reverting to `selectEmailSourceStream` breaks 在管产品 email unit correction |
| `mergeManagedProductDetailNav` | Post-seed email must merge against seed base via `mergeNavSeriesWithEmail` — pre-finalizing email alone loses unit/cum context |
| `applyEmailUnitNavCorrection` | Must learn unit/cum ratio from custody rows with distinct unit+cum, not only TA virtual subjects |
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
