# Amplitude diagnosis & improve — report_basis_spot vs GTJAQH012

Generated 2026-10-28 (Asia/Shanghai). Wind offline calib only (`USE_WIND_GTJAQH=false`). No PM2 / redeploy / commit.

## 1. Amplitude diagnosis summary

### Quantified mismatch (BEFORE = prior LIVE ann_pct s0.25)

| Metric | Ours (before) | GTJAQH012 | Ratio |
|---|---:|---:|---:|
| YTD daily ret-stdev | 0.00421 | 0.00260 | **1.62** |
| Roll20 ret-stdev ratio (med/mean) | 1.58 / 1.68 | 1.0 | — |
| Roll60 ret-stdev ratio (med) | 1.57 | 1.0 | — |
| Jun8–Jul15 maxDD | **−4.25%** (trough 2026-06-26) | **−2.33%** (trough 2026-07-02) | **1.82** |
| corr(\|ours\|, mktAbs) vs corr(\|012\|, mktAbs) Jun–Aug | **0.77** | **0.59** | ours tracks market vol more tightly |

Largest residual gaps include 2026-04-08 (−123bp vs +2), 2026-06-16/17, 2026-07-08 recovery overshoot, 2026-08-05.

### 2026.7 / late-June deeper drop — attribution

Holding book is **very concentrated**: enterFrac=0.15 on ~25–30 scored names ⇒ **~4 names**, equal **25%** each, gross=1 always.

**Fri 2026-06-26** (near our trough): EB, PP, PG, BU — **100% chem+energy**, no agri/metals. OI of held set was not thin that Friday (medOI/univ≈1.24), but **Jul 3 / Jul 10** books (PP/PG/SC/AD) had oiRatio **0.20 / 0.18** — thin names at full equal weight.

Drop-window days (bp):

| date | ours | 012 | gap |
|---|---:|---:|---:|
| 06-23 | −55 | −9 | −46 |
| 06-24 | −16 | −22 | +6 |
| 06-25 | −45 | −59 | +14 |
| 06-26 | −6 | +2 | −9 |
| 07-08 | +76 | +14 | +62 |

Our path is louder on idiosyncratic days and overshoots the rebound; 012 is smoother (consistent with de-risk / broader book).

### Ranked causes (evidence)

1. **[HIGH]** Equal-weight fixed top~15% long_only ⇒ **n≈4**, one name = 25% of book → large amplitude when those names move.
2. **[HIGH]** **No portfolio vol targeting / no market-vol gate** → full gross through stress. Ours |ret| correlates more with cross-market |ret| (0.77) than 012 (0.59) — supports 国君 lightening in high-vol regimes.
3. **[MED]** Liquidity: hygiene+excl EC/SH but **no OI/volume floor**; some Fridays held medOI ≪ universe (oiRatio~0.1–0.2).
4. **[MED]** **No sector caps** → stress weeks can be 50–100% chem/energy.
5. **[MED]** Holding intensity (scale 0.25) amplifies the concentrated book.
6. **[LOW]** Residual recipe gap (proprietary 国君 path / filters).

## 2. What was tested

Hooks added (defaults null/false until promote): `basisSpotVolTarget*`, `basisSpotMktVolGate*`, `basisSpotMinOiQuantile`, `basisSpotSectorNeutral`, `basisSpotSectorCap`, `basisSpotNameClip`, `basisSpotDynScaleDisp`.

Grids: `tmp_basis_spot_amp_grid` (~36 configs) + `tmp_basis_spot_amp_refine` (post vol-target scale fix).

| Lever | Result |
|---|---|
| Vol targeting (scaled) | Softens Jul DD but **hurts YTD corr_ret** (~0.53) — not promoted |
| **Mkt-vol gate 80%×0.7** | YTD/H1 corr **up**, 3m flat, modest amp help, end preserved |
| Scale 0.25→0.22 / 0.20 | Same corr path, amp better; end softens |
| OI quantile filter | Often **kills 3m corr** (universe change) |
| Sector-neutral / tight sector-cap | Amp better, corr_ret often worse |
| enter 0.25–0.30 (more names) | 3m ok/up, **YTD/H1 corr down** |
| invvol | Amp+YTD/H1 up, **3m −1pp** — borderline, not sole promote |
| nameClip | No-op at n=4 (w=0.25 already) |
| dynDisp | Tiny effect |

## 3. Before / after (promoted)

| | 3m cr/lvl | YTD cr/lvl/end | H1 cr | roll20 σ-ratio | Jul DD ours/012 |
|---|---|---|---|---|---|
| **BEFORE** s0.25 noGate | 0.8809 / 0.9404 | 0.6255 / 0.750 / **+5.88%** | 0.3123 | **1.583** | **−4.25%** / −2.33% |
| **AFTER** gate80×0.7 s0.22 | 0.8802 / 0.9383 | **0.6378** / **0.789** / +5.15% | **0.3236** | **1.340** | **−3.39%** / −2.33% |

- corr_not_worse: **true** (3m flat; YTD/H1 up)
- amp_better: **true** (σ-ratio 1.58→1.34; Jul depth ratio 1.82→1.46)
- Remaining gap: still ~1.3–1.5× 012 amplitude (concentration + recipe residual)

## 4. knobs_changed

**yes**

```
basisSpotKind: ann_pct_over_fut
basisSpotScale: 0.22          # was 0.25
basisSpotMktVolGatePct: 0.80  # was null
basisSpotMktVolGateScale: 0.7
# unchanged: weeklyFri, enter15/exit35, topN=5, spotLag=0, equal CS,
#            excl EC+SH, ruleHygiene=true, long_only
```

CalcHelp updated for 基差.

## 5. Artifact paths

- `tmp_basis_spot_amp_diag.{mts,json,md,log}` — diagnosis + Jul attribution
- `tmp_basis_spot_amp_grid.{mts,json,md,log}` + `_all.json` — first lever grid
- `tmp_basis_spot_amp_refine.{mts,json,md,log}` — refined after VT fix
- `tmp_basis_spot_amp_verify.{mts,json,md,log}` — official before/after
- `docs/cta_basis_spot_amp_20261028.md` — this file
- Code: `lib/server/futures-style-factors.ts` (hooks + LIVE knobs)
- UI: `app/ma/dashboard/private-funds/components/FuturesStyleCalcHelp.tsx`

## 6. Confirm

- **No PM2 / no redeploy / no commit / no push**
- **Wind not live** (`USE_WIND_GTJAQH=false`)
- Server `~/new_market_project` untouched
