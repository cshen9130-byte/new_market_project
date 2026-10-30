# report_pv_corr research + calib — 2026-10-30

## Identity / Wind code

| Source | Code / label |
|---|---|
| UI | `report_pv_corr` / **量价相关性** (grid #4, gold `#eab308`) |
| Brochure CTA3 / WP p21 | **量价相关性 → GTJAQH020.WI**, Bloomberg `GJFQVPC` |
| Wind Excel / `data/gtjaqh_closes.csv` | **GTJAQH011.WI** label 量价相关性 |
| Live charts | `USE_WIND_GTJAQH=false`; 011 offline calib only |

**020 vs 011:** same brochure/Excel numbering mismatch as 基差 021≠012, 长期截面 022≠013, 库存 017≠007, 长期规则 019≠010. This round calibrates **GTJAQH011**.

## Research findings (sources)

1. **Guojun white paper (local OCR p21):** 量价相关性 = 截面; daily corr(volume, price); long low corr / short high corr; equal L/S notional; turnover ~12%. Brochure Wind **GTJAQH020** — no public lookback.
2. **Local extract** `docs/cta_factors_doc_extract_20261029.md`: WP 020 ↔ Excel 011.
3. **Peer — 华泰期货《商品里的 alpha》(2021):** `-cor(vwap,volume,20)`, `-cor(high/low,volume,20)` — long divergence. https://www.htfc.com/wz_upload/png_upload/20210708/1625711204852a804cb.pdf
4. **Peer — GTJA Alpha191 (equity):** Alpha16 `-CORR(RANK(VOLUME), RANK(CLOSE), 6)` — same economy, not commodity CTA recipe.
5. **Peer — 海通 HF / 东吴 CPV / 基研系列九:** intraday corr signals; intuition only; we stay day-freq CS.
6. **Honest gap:** no public closed-form for 011/020 lookback or exact price series. Brochure = corr(volume, price) CS long-low; Excel calib = **011**.

## Method (LIVE) — PROMOTION 2026-10-30

- **Prior LIVE:** `pvKind=dOiShockBlend` (8-leg OI/turnover/amount shock, scale≈-0.183). Failed fair daily corr_ret vs GTJAQH011 (3m cr≈0.09, YTD cr≈-0.11).
- **Promoted LIVE:** `pvKind=corr`, `pvCorrMode=close` (=corr(close,volume)), `pvCorrL=55`, `pvTopFrac=0.08`, `pvCorrScale=0.2`, `pvCorrLongHigh=false`.
- Modes wired: absret|ret|close|logclose|dlog; optional pvCorrUseAmount. dOiShockBlend retained as alt.

## Before → after vs GTJAQH011 (Wind max 2026-10-02; fair fixed Wind anchor)

| Window | BEFORE (dOiShockBlend) | AFTER (corr close L55/tf0.08/s0.2) | Wind |
|---|---:|---:|---:|
| 3m corr_ret / lvl | 0.090 / 0.616 | **0.512 / 0.855** | — |
| 3m end % / MAE | -0.42 / 1.38 | **+2.25 / 0.80** | **+1.54** |
| YTD corr_ret / lvl | -0.109 / 0.111 | **+0.248 / 0.609** | — |
| YTD end % / MAE | -0.51 / 2.92 | **+4.88 / 1.76** | **+4.23** |
| H1 corr_ret / end % | -0.168 / +0.01 | **+0.195 / +1.81** | **+3.21** |

**Promote: YES** — clear win on 3m/YTD corr_ret, 3m lvl, YTD end closeness, MAE; brochure-aligned construction.

## Knobs (REPORT_FIT pv block)

- `pvKind`: **corr** LIVE; dOiShockBlend | dOiShock available
- `pvCorrMode`: **close**; alts absret|ret|logclose|dlog
- `pvCorrL`: **55**; `pvTopFrac`: **0.08**; `pvCorrScale`: **0.2**; `pvCorrLongHigh`: **false**
- `pvCorrUseAmount`: false; `pvHighPass`: 0
- `pvBlend`: legacy 8-leg (inert while kind!=dOiShockBlend)

## Residual gaps / next steps

- 3m end still overshoots Wind (+2.25 vs +1.54); logclose L55/tf0.15/s0.2 matched end better but weaker 3m lvl — not promoted.
- H1 end still shallow (+1.81 vs +3.21); H1 lvl soft (~0.30).
- If GTJAQH020 daily becomes available, re-calib on 020.
- Do not claim Wind closed-form; L/tf/scale are empirical vs 011.

## Scripts / artifacts

- `tmp_vpcorr_research_baseline.*` — LIVE + first probes
- `tmp_vpcorr_research_grid.*` — 418 peer constructions
- `tmp_vpcorr_research_refine.*` — close/logclose refine (~317)
- `tmp_vpcorr_research_verify.*` — post-promote fair verify
