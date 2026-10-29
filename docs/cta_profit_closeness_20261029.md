# CTA 利润 closeness pass — 2026-10-29 (Asia/Shanghai)

## Calib target
**GTJAQH009.WI** (WP / Excel dump 利润; Bloomberg GTJAFPRF). Live `USE_WIND_GTJAQH=false`.

## Research (see `docs/cta_profit_research_20261029.md`)
- Guojun classic-8: **时序**, industry-profit level vs history — long low / short high; avg pos ~20.9%; sample from 2019.
- Peers: 南华 hist percentile; 国君系列二十 boll/quantile on 利润; single-name 高炉/压榨/进口利润 as ±1 rules.
- Our engine: sparse EDB margins (~13 products, many weekly) + dense carryMom proxy.

## Grids
- `tmp_profit_research_grid.*` — 475 configs (edb±flip, edbMom, edbBlend, carryMom, cmb, WP blends). **LIVE won** on construction; pure EDB+flip lost.
- `tmp_profit_refine_grid.*` / `tmp_profit_verify.*` — amp/MAE refine.

## Before / after vs GTJAQH009 (eval to 2026-10-02)

| | 3m corr_ret | 3m corr_lvl | 3m end / Wind | 3m MAE | YTD corr_ret | YTD end / Wind | YTD MAE | y1 corr_ret |
|---|---|---|---|---|---|---|---|---|
| **BEFORE** (scale=1) | 0.4893 | 0.3941 | 0.43 / 2.54 | 1.06 | 0.202 | 2.63 / 8.33 | 2.84 | 0.1647 |
| **AFTER** (scale=3) | 0.4893 | 0.3927 | **1.29 / 2.54** | **0.49** | 0.202 | **8.05 / 8.33** | **2.33** | 0.1647 |

corr_ret unchanged (same signal). Clear amp/MAE win → **REPORT_FIT promoted** (`profitRetBlend.scale: 1 → 3`).

Near-miss (not promoted): `edb60_w0.1_scale3` → 3m cr 0.4985 / lvl 0.415, but YTD amp short (6.84) and adds sparse-EDB risk.

## Files touched
- `lib/server/futures-style-factors.ts` — REPORT_FIT scale
- `app/.../FuturesStyleCalcHelp.tsx` — WP + amp notes
- `docs/cta_profit_research_20261029.md`, `docs/cta_profit_closeness_20261029.md`

## Not done
- No PM2 / no workday deploy
- No server app changes
- Choice/妙想: still need denser crush/smelting margins (see `tmp_choice_wishlist_inv_profit.md`)

## Residual levers
1. Broader daily EMI/EDB profit codes → re-test WP `edb`+flip / `|z|` 时序 weights
2. Soft 3m lvl corr still ~0.39 (path shape); may need weekly rebal / buffers like 基差
3. Tiny edb60@10% blend once margins denser
