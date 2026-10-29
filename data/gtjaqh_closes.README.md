# GTJAQH Wind closes (offline calibration only)

Source: user xlsx CTA因子 sheet (Wind Excel plugs with cached values).
File: `data/gtjaqh_closes.csv` (2019-01-02 → 2026-10-02). Last real GTJAQH move in dump is 2026-09-30 (10/01-02 holiday flat copies).

**Live Futures Style charts do NOT use this file.** `USE_WIND_GTJAQH` defaults to `false`;
REPORT_FIT price/OI reconstructions power the UI. This CSV is ground truth for refining those formulas.

## Mapping

| UI | Wind | File label |
|---|---|---|
| 基差 | GTJAQH012.WI | 基差 |
| 量价相关性 | GTJAQH011.WI | 量价相关性 |
| 长期规则 | GTJAQH010.WI | 长期规则动量 |
| 长期截面 | GTJAQH013.WI | 截面动量 |
| 库存 | GTJAQH007.WI | 库存 |
| 利润 | GTJAQH009.WI | 利润 |

## Brochure vs Excel naming

CTA因子组合3号 brochure labels **长期截面 → GTJAQH022.WI** (价格对时间回归) and **基差 → GTJAQH021.WI**.
The 001–013 Excel dump has neither 021 nor 022; UI calib uses closest labels **013=截面动量** and **012=基差**.
Do not treat brochure numbers as Excel codes without verifying.

See also: `docs/cta_cs_long_research_20261029.md`, box `/workspace/cta-digitize/out/wind_calibrate_refine.*`
