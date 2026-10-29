# 长期截面 (report_cs_long) research + calib — 2026-10-29

## Identity / Wind code

| Source | Code / label |
|---|---|
| UI | `report_cs_long` / **长期截面** (grid #2, blue `#1A73E8`) |
| Brochure CTA因子组合3号 | **长期截面 → GTJAQH022.WI**, method 价格对时间回归 |
| Wind Excel / `data/gtjaqh_closes.csv` (001–013) | UI maps to **GTJAQH013.WI**, file label 截面动量 |
| Live charts | `USE_WIND_GTJAQH=false`; 013 offline calib only |

**022 vs 013:** 001–013 dump has no GTJAQH022; same naming mismatch pattern as 基差 brochure GTJAQH021 vs Excel GTJAQH012. This round calibrates **GTJAQH013** (full daily closes). Do not invent a 022 closed form.

## Research clues (no Guojun closed-form found)

1. **Guojun brochure** (local OCR `/workspace/cta-report-small.txt`): 长期截面 = 价格对时间回归; CS L/S, equal notional, no net exposure.
2. **Guojun weekly/specials** (fxbaogao / Sina): GTJAQH tracks 商品截面动量 / 长周期截面动量 performance but does not disclose construction params.
   - https://www.fxbaogao.com/detail/4926547
   - https://finance.sina.com.cn/wm/2026-09-21/doc-inisqrkf6083558.shtml
3. **Dongzheng** style-factor table: CS mom long top 50% / short bottom 50%; mid windows 7/30/41/59d (peer, not Guojun).
   - https://www.hangyan.co/charts/3500920053795128454
4. **Huatai Futures** momentum: panel mom ranked by return; lookbacks include 120/250d.
   - https://www.htfc.com/upload/20170925/201709251506332534711.pdf
5. **Literature**: commodity CS mom often ~252d return rank + tercile/quintile L/S; often skip recent month.
   - https://matrixcqy.github.io/portfolio/momentum-carry-factor-library/

**Confidence:** brochure method high (OLS); Wind 013 ≡ UI 长期截面 medium (closest label); exact lookback/topFrac **low** (no public params → empirical fit).

## Method kept

Keep brochure: **log(P) ~ t OLS** → CS L/S. Did not switch primary path to pure return-rank (peer recipes did not systematically beat current OLS blend on this calib; would diverge from brochure).

## Before → after vs GTJAQH013 (Wind max 2026-10-02)

| Window | LIVE (0.5/0.25/0.25 ×1) | PROMOTE (0.2/0.35/0.45 ×0.95) | Wind |
|---|---:|---:|---:|
| 3m corr_ret / lvl | 0.333 / 0.776 | **0.461 / 0.858** | — |
| 3m end % | +2.5 | +2.9 | +4.5 |
| YTD corr_ret / lvl | 0.705 / 0.957 | **0.723 / 0.895** | — |
| YTD end % | +19.4 | **+12.4** | **+12.5** |
| H1 corr_ret | 0.779 | **0.788** | — |
| 1y corr_ret | 0.679 | **0.703** | — |

## Knobs changed

`REPORT_FIT.csLongBlend`:
- weights: `neg_slope` 0.5→**0.2**, `z` 0.25→**0.35**, `neg_z` 0.25→**0.45**
- scale: 1→**0.95**
- legs L / topFrac / sectorNeutral unchanged (120/0.15 secN, 120/0.2, 250/0.2 secN)

## Residual gaps

- **Jan–Feb 2026:** Wind 013 early drawdown (~-1% → -2.8%); promote path flat/slightly up — H1 early shape still weak.
- **3m end amp** still shallow vs 013 (+2.9 vs +4.5).
- **YTD level corr** soft drop (0.957→0.895) traded for 3m + end alignment — intentional.
- **022 true series unknown**; re-calib if 022 becomes available.
- No public Guojun closed-form; grid found no stable return-rank recipe that crushed the OLS blend.

## Artifacts

- `tmp_cslong_research_grid.{mts,md,json,log}`
- `tmp_cslong_research_refine.{mts,md,json,log}`
- `tmp_cslong_research_verify.{mts,md,json,log}`

## Live promote (2026-10-29 evening) — 3m path-shape

After user screenshots showed Jul crater / missing late-Sep rise vs 国君:
- Hybrid retuned: `ols_neg_slope K60 long_only w=0.38 scale=0.6` (was K120 ls w0.3 s0.85).
- 3m julMin −4.68→**−1.17** (Wind −0.64); end +2.62→**+5.63** (Wind +4.49); YTD end still ~**+13** (Wind +12.5).
- Wind calib ends 2026-10-02 / last real 9/30; 国君 10/08 spike not in file.
- Details: `docs/cta_cs_long_loop_20261029.md` Round 4.
