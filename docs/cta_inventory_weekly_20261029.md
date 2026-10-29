# 库存 weekly rebal vs GTJAQH007 — 2026-10-29

## Goal
Wire white-paper **周度换仓** (GTJAQH017 slogan: 库存变化率 CS, 做多去库做空累库) into live `report_inventory`, measure vs Wind calib **GTJAQH007**, promote REPORT_FIT only on a clear win.

## Implementation
- File: `lib/server/futures-style-factors.ts`
- New knob: `invRebal: "daily" | "weeklyFri" | "weeklyMon" | "weeklyWed"` (default **`daily`** = prior LIVE).
- Refactor: `inventoryBuildScores` → `inventoryHoldFromScores` → `inventoryMarkHold`.
- On rebal days rebuild equal-notional L/S (or LO) holdings; between rebal days **hold weights**, mark daily PnL on underlying returns.
- Blend path keeps **per-leg** hold state. Single-kind path honors `invTopN` / `invMode`.

## Grid (Wind max 2026-10-02)

| name | 3m cr / end / pathMae | YTD cr / lvl / end / softMae | score |
|---|---|---|---:|
| **LIVE_daily** (keep) | **0.697 / +5.41 / 0.64** | **0.569 / 0.939 / +8.83 / 1.48** | **0.503** |
| LIVE_weeklyMon | 0.743 / +4.66 / 0.73 | 0.594 / 0.607 / +5.75 / 3.93 | 0.429 |
| LIVE_weeklyWed | 0.720 / +5.15 / 0.99 | 0.548 / 0.822 / +10.28 / 2.30 | 0.432 |
| LIVE_weeklyFri | 0.642 / +3.54 / 1.22 | 0.554 / 0.806 / +6.57 / 2.48 | 0.399 |
| Mon_aw0.25_sc5.5 (best weekly) | 0.750 / +6.05 / 0.75 | 0.617 / 0.674 / +7.79 / 4.13 | 0.464 |
| WP social5 Fri | 0.362 / +1.17 / 2.29 | 0.387 / 0.030 / +0.89 / 3.20 | 0.076 |
| WP social5 Mon | 0.705 / +2.16 / 1.98 | 0.454 / 0.747 / +5.00 / 2.83 | 0.366 |

Wind: 3m end **+3.99%**; YTD end **+8.23%**.

## Decision
**No REPORT_FIT promote.** Weekly is implemented and measurable, but:

- Fri (WP day) **hurts** 3m corr and path MAE vs LIVE daily.
- Mon lifts 3m/YTD **return** corr but **collapses YTD level corr** (~0.94→0.60) and soft Apr–Aug MAE (~1.5→4+).
- Scaling Mon to match YTD end worsens soft path further.
- WP-simple Δ% CS alone (even weekly) stays far behind LIVE 5-leg blend.

Keep live: `invRebal: "daily"` + existing `invRetBlend` 5-leg × scale 4.75.

## Residuals / next levers
- Apr–Aug soft months still main gap under daily.
- Weekly may need **enter/exit buffer** or **signal lag** (publish delay) rather than bare Fri hold.
- Inventory coverage / Choice EDB gaps — not blocking this pass (existing series sufficient for measurement).
- Brochure 017 series still unknown; calib remains 007.

## Artifacts
`tmp_inv_weekly_grid.{mts,md,json,log}`, `tmp_inv_weekly_refine.{mts,md,json,log}`
