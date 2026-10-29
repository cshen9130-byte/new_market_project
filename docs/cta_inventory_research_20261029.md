# 库存 (report_inventory) research + calib — 2026-10-29

## Identity / Wind code

| Source | Code / label |
|---|---|
| UI | `report_inventory` / **库存** (grid #3, green `#16a34a`) |
| Brochure CTA因子组合3 | **库存 → GTJAQH017.WI**, method 截面库存变化率，做多去库存、做空累库存 |
| Wind Excel / `data/gtjaqh_closes.csv` (001–013) | UI maps to **GTJAQH007.WI**, file label **库存** |
| Live charts | `USE_WIND_GTJAQH=false`; 007 offline calib only |

**017 vs 007:** same naming mismatch pattern as 基差 brochure GTJAQH021 vs Excel GTJAQH012 / 长期截面 022 vs 013. This round calibrates **GTJAQH007** (full daily closes through ~2026-10-02; last real move 2026-09-30). Do not invent a 017 closed form.

## Research clues (no Guojun closed-form found)

1. **Guojun brochure** (`docs/cta_factors_doc/CTA因子产品对比.xlsx` 因子构成对比): 库存 = 基于各品种库存数据计算库存变化率，做多去库存品种、做空累库存品种；构建方式 **截面**; Wind code GTJAQH017.
2. **Guojun weekly/specials** (fxbaogao): inventory as rule-based fundamental factor via Bollinger / percentile bands; combines with basis/profit. No GTJAQH007 construction params.
   - https://www.fxbaogao.com/detail/4511674
   - https://fxbaogao.com/detail/5207043
3. **Xingzheng期货** CTA专题（一）/（二）: Inventory_CR = Inv(t)/Ave(t−N,t−1)−1; long low / short high; CS top/bottom 20%; weekly rebal.
   - https://www.xzfutures.com/files/document/20180330/6365799715117203931076951.pdf
4. **华泰期货** 库存因子: (a) time-series percentile SW=5 vs LW=180 enter20/80; (b) CS weekly Δ% top5/bottom5. Prefers social inventory over仓单 where available.
   - https://www.htfc.com/wz_upload/png_upload/20230914/16946606051714b32e6.pdf
5. **天风** Stock_Dev = Stock0/Stock_ma; CS L/S 20%; weekly. Also YoY / second-diff variants.
6. **Sign:** low inventory / destocking → long (negative of inventory change or level z). Matches brochure and peers.

**Confidence:** brochure method high (CS Δ%); Wind 007 ↔ UI 库存 medium-high (Excel label); exact lookback/topFrac/amp **low** (no public Guojun params → empirical fit).

## Method kept

Keep brochure: **CS L/S on −Δ% inventory** (social + warehouse). Added **socialZ(120)** leg (peer level / Ave_CR-style) and **raised blend scale 1→6.5** for Wind amp. Did not switch primary path to pure percentile timing or weekly-only rebal (no inv weekly rebal knob yet; single-kind socZ/socAve underperformed LIVE blend on corr).

## Before → after vs GTJAQH007 (Wind max 2026-10-02)

| Window | LIVE (3-leg ×1) | PROMOTE (4-leg w0.3/0.25/0.2/0.25 ×6.5) | Wind |
|---|---:|---:|---:|
| 3m corr_ret / lvl | 0.657 / 0.808 | 0.645 / 0.782 | — |
| 3m end % | +0.58 | **+4.41** | **+3.99** |
| YTD corr_ret / lvl | 0.484 / 0.679 | **0.487 / 0.870** | — |
| YTD end % | +0.93 | **+7.44** | **+8.23** |
| YTD month-end MAE | 4.93 | **1.40** | — |
| H1 corr_ret | 0.427 | 0.412 | — |
| 1y corr_ret | 0.418 | ~0.42 | — |

Wind YTD month ends (%): 2.37 / 1.97 / 3.6 / 6.1 / 5.58 / 3.99 / 5.42 / 8.68 / 8.23  
Promote: 2.84 / 1.45 / 3.53 / 3.6 / 2.96 / 2.11 / 4.86 / 5.46 / 7.44

## Knobs changed

`REPORT_FIT.invRetBlend`:
- legs: 3 → **4** (add `socialZ` invZWin=120 topFrac0.25 scale0.08 w0.25)
- weights: 0.3 / 0.3 / 0.4 → **0.3 / 0.25 / 0.2 / 0.25**
- warehouse leg scale 0.15→**0.12**; social L10 scale 0.1→**0.08**
- blend scale: 1 → **6.5**
- default `invZWin`: 60 → **120**

## Residual gaps

- **Apr–May / Aug** still soft vs Wind (missing part of mid-year surge).
- **3m corr_ret** slightly down (0.657→0.645) traded for amp + YTD path/level — intentional.
- **017 true series unknown**; re-calib if 017 becomes available in dump.
- No public Guojun closed-form; peer pure socZ / long-L / weekly recipes did not beat 4-leg blend on this calib.
- Inventory still **daily** CS (peers often weekly Fri→Mon); weekly rebal not wired for inv yet.

## Artifacts

- `tmp_inv_research_grid.{mts,md,json,log}`
- `tmp_inv_research_refine.{mts,md,json,log}`
- `tmp_inv_research_verify.{mts,md,json,log}`
- `tmp_inv_brochure_extract.txt`

## Live promote (2026-10-29)

Clear win on path amp + YTD level corr; commit to main with `USE_WIND_GTJAQH=false`.
