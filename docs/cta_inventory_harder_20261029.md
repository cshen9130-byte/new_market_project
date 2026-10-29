# 库存 HARDER loop vs GTJAQH007 — 2026-10-29

## Identity
- UI `report_inventory` / **库存**; calib **GTJAQH007.WI** (Excel). Brochure CTA3 **GTJAQH017** slogan only — not switched.
- `USE_WIND_GTJAQH=false`. Baseline commit before loop: `479b21f4`.

## Other-AI candidates tested
1. **Ave_CR** `Inv/MA(N)−1` N=20/40/60/80 — LS mostly failed path (neg YTD lvl); **long_only Top8** strong on corr.
2. **PercentileRank** N=60/120/250 — LS weak path; LO overshoots amp.
3. **Z / Bollinger** N=20/60/120 — already in LIVE as socialZ; LO alone mid.
4. **TopN 5/8/10** + **long_only vs L/S** — topN8 LS improved soft months; LO on full LIVE overshot YTD (~19%).
5. Weekly Fri / buffer / 5d smooth — **not wired** this loop (residual).
6. Quality filter monthly-only — not separately gated (EDB priority already prefers better series).

## Loop rounds
### R1 — kinds + LO/TopN sweep
- LIVE still best raw composite; pure Ave/pctile LS failed.
- Signals: `LIVE_topN8` best soft MAE; Ave LO high corr but amp wild; `hy_live_ave_LO` interesting.

### R2 — topN8 × scale + Ave LO hybrid
- Winner: `hy_tN8_ave60LO_aw0.15_sc5` → 3m cr **0.684**, YTD cr **0.549**, lvl **0.934**, end **8.68** (Wind 8.23).

### R3 — fine-tune aw / N / scale
- Promote: **ave80_aw0.18_sc4.75** (topN8 LS 4-leg + socialAve80 LO w0.18 ×4.75).

## Before → after vs GTJAQH007 (Wind max 2026-10-02)

| Window | LIVE `479b21f4` | **PROMOTE** | Wind |
|---|---:|---:|---:|
| 3m corr_ret / lvl | 0.645 / 0.782 | **0.697 / ~0.78** | — |
| 3m end % | +4.41 | +5.41 | +3.99 |
| YTD corr_ret / lvl | 0.487 / 0.870 | **0.569 / 0.939** | — |
| YTD end % | +7.44 | **+8.83** | **+8.23** |
| soft Apr/May/Aug MAE | 2.78 | **1.36** | — |
| H1 corr_ret | ~0.41 | ~0.45+ | — |

Wind YTD months: 2.37/1.97/3.6/6.1/5.58/3.99/5.42/8.68/8.23  
Promote: 2.84/1.61/4.36/5.07/4.56/2.64/5.56/6.65/8.83

## Knobs
`invRetBlend.scale=4.75`, legs:
- social L5 topN8 w0.246
- warehouse L5 topN8 w0.205
- social L10 lag2 topN8 w0.164
- socialZ120 topN8 w0.205
- **socialAve L80 long_only topN8 w0.18**

New score kinds kept in code: `socialAve` / `warehouseAve` / `socialPctile` / `warehousePctile`; `invMode` ls|long_only; `invTopN`.

## Residuals
- Apr–May–Aug still soft vs Wind (esp Aug 6.65 vs 8.68).
- 3m end overshoots (~5.4 vs 4.0).
- Weekly Fri rebal / enter-exit buffer not implemented for inventory.
- No public Guojun closed-form; 017 series unknown.

## Artifacts
`tmp_inv_hard_r1.*`, `tmp_inv_hard_r2.*`, `tmp_inv_hard_r3.*`
