# H1 direction fix — report_basis_spot vs GTJAQH012

Generated 2026-10-29 (Asia/Shanghai). Wind offline calib only (`USE_WIND_GTJAQH=false`). No PM2.

## User complaint (screenshot)

Left (our UI): **Jan–Apr steadily UP** (~0→~2.5%), then May–Jul drop toward **0%**.
Right (国君/GTJAQH012): **Jan–Mar DOWN/flat** (to ~0.99 / trough ~−1.1% YTD), Apr rally, May–Jul shallow drop staying **~+1%**.

## Quantified BEFORE (LIVE after amp pass cb2ac886)

long_only Fri ann_pct scale0.16 enter18/38 equal gate75×0.5 excl EC+SH hygiene.

| window | ours | 012 | corr_ret |
|---|---|---|---:|
| Jan | +0.36% | −0.17% | |
| Feb | +1.05% | +0.07% | |
| Mar | **+1.67%** | +0.18% (trough −1.12 @03-23) | |
| Apr | +1.63% | +2.32% | |
| **Jan–Apr** | end +1.63 | end +2.32 | **0.027** |
| H1 | end +0.22 | +1.25 | 0.339 |
| May→Jul | 2.43→0.01 (2.41pp) | 3.34→0.93 (2.40pp) | |
| 3m / YTD | | | 0.884 / 0.647 end +4.03% |

## Root cause

**`long_only` is structurally unable to reproduce GTJAQH012’s early-H1 path.**

国君/CTA brochure framing for 基差 is **做多贴水、做空升水** (L/S). Our long_only book only holds top backwardation names; in Jan–Mar those longs produced positive P&L while 012’s short-contango leg (and/or net L/S) drove the series flat/down. Evidence:

- Jan–Apr corr_ret ≈ **0.03** under long_only (essentially uncorrelated).
- Switching to **`mode=ls`** lifts Jan–Apr corr_ret to **~0.28–0.39** and creates a **March dip**.
- Sign flip (`longHigh=false`) **anti-correlates** (JA cr −0.3) — direction of long腿 is correct; missing short leg is the issue.
- Amp-only scale/gate tuning cannot fix H1 sign (scale-only preserves wrong shape).

## Winner

`basisSpotMode: ls` + `basisSpotCsWeight: invvol` + `basisSpotScale: 0.22`  
(keep enter 0.18 / exit 0.38 / mktVolGate 75%×0.5 / ann_pct / Fri / excl EC+SH / hygiene)

## Before / after

| | JA cr | J/F/M/A | H1 cr/lvl | 3m cr | YTD cr/end | May→Jul peak→trough |
|---|---:|---|---:|---:|---:|---|
| BEFORE LO | 0.027 | 0.36/1.05/**1.67**/1.63 | 0.339 / 0.62 | 0.884 | 0.647 / +4.03% | 2.43→**0.01** |
| AFTER invLS | **0.284** | **−0.41**/1.09/**−0.04**/0.80 | **0.476 / 0.90** | 0.858 | **0.680 / +3.54%** | 2.25→**0.23** |
| 012 | — | −0.17/0.07/0.18/2.32 | — | — | ~+5.6% | 3.34→0.93 |

clear_win: JA corr↑, Mar not strongly up, H1↑, summer trough≥0, YTD corr↑, 3m within −3pp.

## Residual gaps

1. **Feb spike** still (~+1.1% vs 012 ~0) — mid-Feb diverge on weekly overlay.
2. **Apr rally** softer (+0.8 vs +2.3).
3. **Summer absolute level** still low (trough +0.23 vs +0.93; peak +2.3 vs +3.3) — partly because fixing H1 up-drift enters May lower.
4. Recipe residual vs proprietary 国君 construction.

## Artifacts

- `tmp_basis_spot_h1_path_diag.*`, `tmp_basis_spot_h1_dir_grid.*`, `tmp_basis_spot_h1_dir_refine.*`, `tmp_basis_spot_h1_dir_verify.*`
- Code: `lib/server/futures-style-factors.ts`, `FuturesStyleCalcHelp.tsx`

## Confirm

- No PM2 / no redeploy
- Wind not live; calib **GTJAQH012** only
