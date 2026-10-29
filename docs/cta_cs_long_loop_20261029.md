# 长期截面 loop refine vs GTJAQH013 — 2026-10-29

## Baseline (8a82f740)
OLS 3-leg blend weights 0.2/0.35/0.45 ×0.95 (brochure price~time).
3m cr~0.46/lvl0.86 end+2.9; YTD cr~0.72 end+12.4 (Wind YTD~+12.5); Jan–Feb flat/+ vs Wind DD.

## Loop rounds

### Round 1 — other-AI formulas (ret / risk_adj / avg_mom / OLS) × LO|LS × K × weeklyFri × topN
- Pure **return / risk_adj / avg_mom** failed (often negative YTD corr vs 013).
- **long_only** did not unlock YTD path shape for these scores (often wrong Jan–Feb sign).
- Best non-LIVE: `ols_neg_slope_ls_K120_weeklyFri` — weaker 3m (~0.24–0.26) but **correct Jan–Feb DD direction**.
- LIVE blend still best pure single recipe on 3m.

### Round 2 — refine OLS weeklyFri + hybrid with LIVE
- Buffer/smooth/scale on OLS weekly alone still 3m << LIVE.
- **Hybrid** `(1-w)*LIVE_blend + w*ols_neg_slope_weeklyFri_t10` wins:
  - LIVE70/ols30: 3m~0.43, YTD cr~0.77 lvl~0.95 end~13.2, JF −0.6/−1.0.

### Round 3 — native `csLongHybridW` fine-tune
- Promote: **w=0.3, hybridScale=0.85, ols_neg_slope K120 weeklyFri topN=10, no buffer**.
- vs baseline LIVE blend-only:

| metric | baseline | promote | Wind |
|---|---:|---:|---:|
| 3m corr_ret / lvl | 0.461 / 0.858 | 0.433 / 0.883 | — |
| 3m end % | +2.9 | +2.6 | +4.5 |
| YTD corr_ret / lvl | 0.723 / 0.895 | **0.765 / 0.949** | — |
| YTD end % | +12.4 | **+12.6** | **+12.5** |
| Jan / Feb % | +0.8 / +0.3 | **−0.4 / −0.8** | **~−1.0 / −2.8** |

## Plateau / honesty
- Stretch bar **3m corr_ret ≥0.55** not reached (ceiling ~0.44–0.46 on this calib).
- Pure peer return-rank / long_only recipes did **not** beat brochure OLS blend on 013.
- Hybrid trades a bit of 3m ret-corr for YTD path + Jan–Feb direction.

## Live knobs
- Keep `csLongBlend` 0.2/0.35/0.45 scale 0.95
- `csLongHybridW=0.3`, `csLongHybridScale=0.85`, kind `ols_neg_slope`, K120, weeklyFri, topN10
- `USE_WIND_GTJAQH=false`; calib GTJAQH013 only

## Artifacts
`tmp_cslong_round1.*`, `tmp_cslong_round2.*`, `tmp_cslong_round3.*`
