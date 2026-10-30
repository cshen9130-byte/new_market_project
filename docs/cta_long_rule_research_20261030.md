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

## Method kept

- **LIVE construction remains time-series mom + high-vol skip** (`momLowVol`), not brochure MA-cross.
- Brochure `maCross` (esp. 60/240 peer-long) improved H1/YTD *corr_ret* but **wrecked 3m end amp and YTD end sign** vs 010 — kept as `longRuleKind: "maCross"` code path for future, **not promoted**.
- Empirically, lengthening mom lookback 150→200 and dropping the legacy flip (scale sign cleaned to +0.5) was the Pareto win vs 010.

## Before → after vs GTJAQH010 (Wind max 2026-10-02; fair fixed Wind anchor)

| Window | LIVE (L150 flip scale−0.7 cap1.2) | PROMOTE (L200 no-flip scale0.5 cap1.0) | Wind |
|---|---:|---:|---:|
| 3m corr_ret / lvl | 0.736 / 0.841 | **0.819 / 0.972** | — |
| 3m end % / MAE | +3.20 / 0.48 | **+2.81 / 0.19** | **+2.76** |
| YTD corr_ret / lvl | 0.447 / 0.548 | **0.549 / 0.699** | — |
| YTD end % | +0.30 | −0.25 | **+0.38** |
| H1 corr_ret / lvl | 0.255 / 0.785 | **0.388 / ~0.75** | — |

## Knobs changed

`REPORT_FIT` long-rule block:
- `longRuleKind`: `"momLowVol"` (new explicit; `"maCross"` available)
- `longRuleL`: 150 → **200**
- `longRuleVolCap`: 1.2 → **1.0**
- `longRuleFlip`: true → **false**
- `longRuleScale`: −0.7 → **0.5**
- added `longRuleFast`/`longRuleSlow` defaults (20/120) for maCross experiments

## Residual gaps / next steps

- **YTD end** slightly negative (−0.25) vs Wind +0.38 — LIVE was closer on the endpoint; promote trades endpoint for much better path corr/level.
- **Brochure MA-cross** still not matching 010 ends; if GTJAQH019 daily series becomes available, re-calib MA short/long on that series (may differ from 010).
- Exact Guojun MA lengths still unknown; do not claim Wind formula.

## Artifacts

- `tmp_long_rule_research_grid.{mts,md,json,log}`
- `tmp_long_rule_research_refine.{mts,md,json,log}`
- `tmp_long_rule_research_verify.{mts,md,json,log}`
- `tmp_long_rule_L200_micro.{mts,json,log}`
