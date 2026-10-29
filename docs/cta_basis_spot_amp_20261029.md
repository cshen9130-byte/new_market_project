# Amplitude May→Jul path — report_basis_spot vs GTJAQH012

Generated 2026-10-29 (Asia/Shanghai). Wind offline calib only (`USE_WIND_GTJAQH=false`). No PM2 / redeploy.

## Problem (UI screenshot)

Left (our UI 基差): May→early-Jul path ~**+4% → ~0%** (~4pp visual drop).
Right (国君 CTA 6-factor 基差 / GTJAQH012): ~**+3% → ~+1%** (~2pp visual drop).

Metric used: YTD cum path peak in **2026-05-01..06-20**, trough through **07-31**.

| | peak YTD | trough YTD | visual pp | pathDrop |
|---|---:|---:|---:|---:|
| **BEFORE** LIVE s0.22 gate80×0.7 e15/35 | +3.70% (05-06) | −0.54% (06-26) | **4.24** | **−4.09%** |
| **GTJAQH012** | +3.27% (06-08) | +0.87% (07-02) | **2.40** | **−2.33%** |
| **AFTER** e18/38 s0.16 g75×0.5 | +2.43% | +0.01% | **2.41** | **−2.36%** |

## Root causes (deeper May→Jul drop)

1. **Equal + enter15%** → ~4 names @ 25% each; stress weeks 50–100% chem/energy.
2. **Scale 0.22** still ~1.3–1.5× 012 path amplitude after prior amp pass.
3. **mktVolGate 80%×0.7** only modest de-risk; summer stress still loud.
4. Prior Jul maxDD metric (−3.39 vs −2.33) understated the **UI visual** May→Jul peak→trough (4.24 vs 2.4 pp).

## Knobs tried (summary)

- Scale-only 0.12–0.18: matches amp, preserves corr, but trough often still &lt;0 and end soft.
- Stronger gate alone: helps amp, 3m corr softens at aggressive settings.
- Wide enter 0.25–0.30: often **worsens** summer path / YTD corr.
- invvol ± enter: strong 3m, trough &gt;0, but roll20σ often &lt;0.75 and end soft.
- **Winner**: mild diversify enter**0.18**/exit**0.38** + scale**0.16** + gate**75%×0.5**, keep equal CS.

## Before / after

| | May→Jul vis | pathDrop | 3m cr/lvl | YTD cr/lvl/end | H1 cr | roll20σ | Jun8–Jul15 maxDD |
|---|---:|---:|---:|---:|---:|---:|---:|
| BEFORE | 4.24pp | −4.09% | 0.880 / 0.938 | 0.638 / 0.789 / +5.15% | 0.324 | 1.340 | −3.39% |
| AFTER | **2.41pp** | **−2.36%** | **0.884 / 0.934** | **0.647 / 0.881 / +4.03%** | **0.339** | **0.885** | **−2.16%** |
| 012 | 2.40pp | −2.33% | — | end ~+5.6% | — | 1.0 | −2.33% |

- corr: **not worse** (3m/YTD/H1 all up slightly)
- amp: **clear win** on May→Jul visual and pathDrop
- residual: trough YTD ~0% vs 012 ~+0.9%; peak lower (~2.4 vs ~3.3); YTD end softens (~+4.0 vs +5.6); roll20σ slightly under 1

## knobs_changed

```
basisSpotEnterFrac: 0.18     # was 0.15
basisSpotExitFrac: 0.38      # was 0.35
basisSpotScale: 0.16         # was 0.22
basisSpotMktVolGatePct: 0.75 # was 0.80
basisSpotMktVolGateScale: 0.5 # was 0.7
# unchanged: weeklyFri, equal CS, excl EC+SH, ruleHygiene, ann_pct_over_fut, long_only, spotLag0
```

## Artifacts

- `tmp_basis_spot_mayjul2_grid.{mts,json,md,log}`
- `tmp_basis_spot_mayjul_refine.{mts,json,log}`
- `tmp_basis_spot_mayjul_verify.{mts,json,md,log}`
- Code: `lib/server/futures-style-factors.ts`
- UI: `FuturesStyleCalcHelp.tsx`

## Confirm

- No PM2 / no redeploy
- Wind not live (`USE_WIND_GTJAQH=false`)
- Calib target **GTJAQH012** only (not 021)
