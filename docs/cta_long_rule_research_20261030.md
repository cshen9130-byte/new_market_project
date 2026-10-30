# 长期规则 (report_long_rule) research + calib — 2026-10-30

## Identity / Wind code

| Source | Code / label |
|---|---|
| UI | `report_long_rule` / **长期规则** (grid #5, purple `#9333ea`) |
| Brochure CTA因子组合3号 / WP p13 | **长期规则动量 → GTJAQH019.WI**, Bloomberg `GJFQLRM` |
| Wind Excel / `data/gtjaqh_closes.csv` (001–013) | **GTJAQH010.WI** label 长期规则动量 |
| Live charts | `USE_WIND_GTJAQH=false`; 010 offline calib only |

**019 vs 010:** same brochure/Excel numbering mismatch as 基差 021↔012, 长期截面 022↔013, 库存 017↔007. This round calibrates **GTJAQH010**. Do not invent a 019 closed form beyond the brochure one-liner.

## Research findings (sources)

1. **Guojun white paper (local OCR p13):** 长期规则动量 = 时序；日频短/长均线；**做多短均线在长均线之上、做空短在长之下**；日均换手 ~15.5%。Brochure Wind code GTJAQH019 — **no public lookback lengths**.
2. **Guojun CTA绩效追踪 (fxbaogao):** tracks「长周期时序规则」performance week-to-week; no construction params.
   - https://www.fxbaogao.com/detail/4980508
   - https://www.fxbaogao.com/detail/4926547
3. **Guojun 因子与指数投资揭秘系列二十 (2024-09):** rules toolkit = MA / dual-MA cross / Bollinger / Donchian / RSI — confirms MA-cross family for「规则型」but not the published 010/019 params.
   - https://www.fxbaogao.com/detail/4511674
4. **Peer — 东证衍生品 style factors:** long TS mom = avg of 41/58/59d mom, sign L/S, |score| weights (peer recipe, not Guojun).
   - https://www.hangyan.co/charts/3500920053795128454
5. **Peer — 华泰/文献 DMAC:** common long dual-MA **20/240** (Szakmary-style); Huatai long mom often ~230d return rank.
   - https://finance.sina.cn/2021-06-21/detail-ikqcfnca2338580.dhtml
   - https://www.htfc.com/wz_upload/png_upload/20230403/1680513388460298df4.pdf
6. **Honest gap:** no public closed-form for GTJAQH010/019 lookbacks. Brochure construction = MA-cross; Excel calib series = 010.

## Method kept (LIVE)

- **LIVE construction remains time-series mom + high-vol skip** (`momLowVol`), not brochure MA-cross.
- Empirically, lengthening mom lookback 150→200 and dropping the legacy flip (scale sign cleaned to +0.5) was the Pareto win vs 010 (commit `af933260`).
- Brochure `maCross` and unit-blend `hybrid` are wired as alts; **LIVE keeps `longRuleKind=momLowVol`, `longRuleHybridW=0`**.

## Before → after vs GTJAQH010 (Wind max 2026-10-02; fair fixed Wind anchor)

| Window | LIVE (L150 flip scale−0.7 cap1.2) | PROMOTE (L200 no-flip scale0.5 cap1.0) | Wind |
|---|---:|---:|---:|
| 3m corr_ret / lvl | 0.736 / 0.841 | **0.819 / 0.972** | — |
| 3m end % / MAE | +3.20 / 0.48 | **+2.81 / 0.19** | **+2.76** |
| YTD corr_ret / lvl | 0.447 / 0.548 | **0.549 / 0.699** | — |
| YTD end % | +0.30 | −0.25 | **+0.38** |
| H1 corr_ret / lvl | 0.255 / 0.785 | **0.388 / ~0.75** | — |

## Knobs (REPORT_FIT long-rule block)

- `longRuleKind`: `"momLowVol"` LIVE; `"maCross"` | `"hybrid"` available
- `longRuleL`: **200**; `longRuleVolCap`: **1.0**; `longRuleFlip`: **false**; `longRuleScale`: **0.5**
- `longRuleFast`/`longRuleSlow`: **60/240** (brochure/peer-long defaults for maCross/hybrid experiments; inert while kind=momLowVol and w=0)
- `longRuleHybridW`: **0** LIVE — unit blend `(1-w)*momLowVol + w*maCross` then `*scale`; promote only on clear Mar–Apr win

## Mar–Apr deepen pass (2026-10-30) — NO REPORT_FIT promote

**Problem:** LIVE Mar23 ≈ **−1.36%** vs Wind **≈−3.8%** (short ≈2.44); Mar–Apr MAE ≈1.12. LIVE often too shallow / wrong amplitude in March.

**Grid:** `tmp_long_rule_hybrid_grid.*` — 649 configs, L∈{180,200,220} × volCap∈{1,1.15} × MA∈{(60,240),(60,200),(40,200)} × w∈{0.15…0.4} × scale∈{0.4…0.65}. Focused band L∈{180,200,220} ma60/240 w∈{0.15…0.35} scale∈{0.45…0.6} volCap1 included. Stale PID 8896 gone; grid finished ~12:29 Asia/Shanghai.

**Script hard clear-win (14 hits):** e.g. `hy_L200_c1_ma60_240_w0.25_s0.65` Mar23 **−2.0** (short 1.80), MarApr mae **0.46**, 3m cr **0.823** / end **+3.31**, YTD cr **0.603** / end **−0.82**. Focused mildest hard-ish: `w0.15_s0.6` Mar23 **−1.76**, YTD end **−0.57**.

**Why not promote:**
1. Mar23 only closes ~0.4–0.7 of the 2.44 short vs Wind (−1.36→~−1.8…−2.05; Wind −3.8) — still large residual.
2. **YTD end blowup:** LIVE −0.25 → candidates −0.57…−0.94 (Wind +0.38). Structural cost of any useful maCross weight.
3. Jun trough deepens (~−4.0…−4.5 @ 2026-06-25); 3m end starts overshooting Wind (+2.76).
4. No candidate with mar short improved ≥0.3 **and** YTD end ≥ −0.45 under 3m cr ≥ LIVE−0.03.

**Decision:** keep LIVE momLowVol L200/cap1/scale0.5; **hybrid stays wired with w=0**. No REPORT_FIT promote.

| Metric | LIVE (kept) | Best hard hybrid (not promoted) | Wind |
|---|---:|---:|---:|
| Mar23 % | −1.36 | ~−2.0 | ~−3.8 |
| Mar–Apr MAE | 1.12 | ~0.46 | — |
| 3m cr / end % | 0.819 / +2.81 | ~0.823 / +3.31 | — / +2.76 |
| YTD cr / end % | 0.549 / −0.25 | ~0.603 / −0.82 | — / +0.38 |

## Residual gaps / next steps

- **Mar–Apr depth** still shallow vs 010 (−1.36 vs −3.8); hybrid unit-blend cannot close it without YTD end damage.
- **YTD end** soft (−0.25 vs Wind +0.38) unchanged by this pass.
- If GTJAQH019 daily becomes available, re-calib MA short/long on **019** (may differ from 010).
- Do not claim Wind closed-form; exact Guojun MA lengths still unknown.

## Artifacts

- `tmp_long_rule_research_grid|refine|verify.*`, `tmp_long_rule_L200_micro.*`
- `tmp_long_rule_marapr_{grid,refine,blend,micro,diag}.*`
- `tmp_long_rule_hybrid_grid.{mts,md,json,log}` — Mar–Apr hybrid 649-run (no promote)
