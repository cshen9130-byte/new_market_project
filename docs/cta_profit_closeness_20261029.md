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

## Dense EMI expand pass (2026-10-29 Asia/Shanghai) — no promote

### Codes upserted (server EmQuant, no PM2)
| code | product | role | nn (approx) |
|---|---|---|---:|
| EMI01732831 | M | 全国大豆压榨毛利润(农业部) daily | 666 |
| EMI01793711 | Y | 汇易全国平均 crush daily | 691 |
| EMI01793743 | Y | 汇易进口平均 crush daily | 587 |
| EMI01793725 | M | 汇易国产平均 crush daily | 577 |
| EMM01855423 | CU | 铜冶炼 RC | 379 |
| EMM01855422 | CU | 铜冶炼 TC (refresh) | 379 |
| EMI02082712 | AL | 毛利:电解铝(百川) — remapped V→AL | 147 |

Catalog now **21** EMI/EMM → **14** products; table ~9320 rows / **4750** non-null (was 17 codes / 5548 / 2167).

Loader: `loadEdbIndustryProfit` now `DISTINCT ON (trade_date, product)` preferring daily + primary EMI (avoid CU TC/RC vs 精炼铜 overwrite).

### Grid (`tmp_profit_dense_grid.*`, 126 configs, eval to 2026-10-02)
| | 3m cr | 3m lvl | 3m end/W | 3m MAE | YTD cr | YTD end/W | YTD MAE | score |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **LIVE** (scale3 carryMom blend) | **0.489** | **0.393** | **1.29/2.54** | **0.49** | 0.202 | **8.06/8.33** | **2.33** | **0.356** |
| best tiny edb60@10%+LIVE | 0.471 | 0.384 | 1.14/2.54 | 0.58 | 0.205 | 6.71/8.33 | 2.06 | 0.347 |
| best pure edbMom+flip | ~0.017 | ~0.08 | 0.67 | — | 0.09 | 0.78 | — | 0.087 |
| pure edb+flip (WP) | ≤0.05 | weak/neg | soft | — | ~0 | soft/neg | — | ≤0 |

### Promote?
**No.** Denser crush/Cu did **not** lift pure WP `edb`+flip enough; tiny edb blend softens YTD amp vs LIVE. Knobs unchanged (`profitRetBlend` scale **3**).

### Residual gaps
NI/PB/SN smelting; I/J/JM blacks; SC/FU/BU cracks; MA/PP/L/EG processing; CF/SR/C ags — still sparse or missing daily EMI.


## Harder refine pass (2026-10-29 Asia/Shanghai) — PROMOTED

### Diagnose (LIVE 3m vs GTJAQH009)
| month | ours | Wind | gap |
|---|---:|---:|---:|
| 2026-07 | 0.98 | 1.57 | -0.59 |
| 2026-08 | 1.33 | 1.43 | -0.10 |
| 2026-09 | 1.29 | 2.54 | **-1.25** |

Main residual was **Sep under-run** + soft 3m lvl corr (~0.39).

### Grid
`tmp_profit_hard_refine.*` (207) + `tmp_profit_hard_verify.*` — lookbacks/topFrac/wMom/4-leg/tiny edb hybrids.

### Before / after vs GTJAQH009 (eval to 2026-10-02)

| | 3m cr | 3m lvl | 3m end/W | 3m MAE | Sep gap | YTD cr | YTD end/W | YTD MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **BEFORE** (scale3 LIVE) | 0.489 | 0.393 | 1.29/2.54 | 0.49 | -1.25 | 0.202 | 8.06/8.33 | 2.33 |
| **AFTER** combo_m25_t0.5_wm0.7 | **0.427** | **0.671** | **2.30/2.54** | 0.51 | **-0.24** | 0.144 | **8.53/8.33** | **2.19** |

Safer near-miss (not promoted): `cmb_wm0.7_lt0.35` — lvl 0.465, cr 0.481, YTD 8.32; Sep still ~-1.2.

### Promote knobs
`profitRetBlend.scale` stays **3**; legs:
1. carryMom L**25** top**0.5** scale0.05 w0.4
2. carryMom L20 top0.35 scale0.03 w0.1 (unchanged)
3. carryMomBlend L20 top**0.15** lvlTop0.35 wMom**0.7** scale0.08 w0.5

### Residual
- corr_ret tradeoff (3m 0.49→0.43; YTD 0.20→0.14)
- Jul gap slightly worse (−0.59→−1.04); Sep fixed
- Still missing dense daily NI/PB/SN / blacks / crack EMI for true WP edb+flip
