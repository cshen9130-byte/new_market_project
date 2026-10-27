# GTJAQH Wind closes (offline calibration only)

Source: user xlsx CTA因子 sheet (Wind Excel plugs with cached values).
File: `data/gtjaqh_closes.csv` (2019-01-02 → 2026-10-02).

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

See calibration report: box `/workspace/cta-digitize/out/wind_calibrate_refine.*`
