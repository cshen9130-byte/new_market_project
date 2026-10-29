# Peer research + residual refine — report_basis_spot vs GTJAQH012

Generated 2026-10-29 (Asia/Shanghai). `USE_WIND_GTJAQH=false`. No PM2.

## Research findings (GTJAQH「基差」)

### No public closed-form for GTJAQH012 / GTJAQH021
| Source | What it is | Confidence | Implication |
|---|---|---|---|
| Wind Excel `GTJAQH012.WI` in weekly CTA dump | NAV calib series labeled「基差」 | **High** (our target) | Keep calib=012 |
| Brochure CTA因子组合 slogan「做多贴水、做空升水」maps to **GTJAQH021** in some materials | Marketing label; 021 absent from 001–013 dump | Med | Do **not** switch calib without 021 series |
| [国君商品期货指数编制细则](https://finance.sina.cn/option/2022-05-31/detail-imizirau5836740.d.html) | **GTJAQH000** passive commodity index only | High | Not factor 012 |
| [国泰期货 股指基差因子](https://fxbaogao.com/detail/4504167) | Equity-index basis / HF emotion | High | Wrong asset class |
| [国君商品策略周报](https://www.fxbaogao.com/detail/4545962) | 8 CS factors incl.「基差」equal-weight slogan | Med | Confirms CS L/S spirit; no formula |

### Peer recipes (actionable, not Guojun)
| Peer | Recipe | URL | Confidence |
|---|---|---|---|
| **华泰** | `ann=(S/F−1)×365/T`; long if ann>0 **and** expanding; short if ann<0 **and** expanding | [PDF](https://htfc.com/wz_upload/png_upload/20241114/1731576619994d43be9.pdf) | **High** formula |
| **中泰** | Weekly CS on **Δ基差率**; long top / short bottom; equal weight | [Sina](https://finance.sina.cn/2022-11-29/detail-imqqsmrp7922304.d.html) | **High** CS recipe |
| 华泰期限结构 | Near–far roll yield | [PDF](https://www.htfc.com/upload/20171025/201710251508893187512.pdf) | High — maps to UI「期限基差」/004, **not** 012 |

## Tests on LIVE (ls + invvol + ann_pct s0.22 e18/38 g75×0.5)

| Idea | Result |
|---|---|
| 华泰 `require_expand` | **Fails** — 3m/YTD collapse vs LIVE |
| 中泰 `Δ` / `Δann` score | **Fails** — 3m~0.1–0.36 |
| blend ann+k·Δann | Softens path, **hurts** 3m/YTD |
| Wed rebal / OI floor / equal LS | No clear Pareto vs LIVE |
| **enter0.19/exit0.39 + nameClip0.18 + scale0.24** | **Clear residual win** |

## Before / after

| | JA cr | J/F/M/A | H1 cr/lvl | 3m | YTD cr/end | May→Jul peak→trough |
|---|---:|---|---:|---:|---|---|
| BEFORE (ba3f51cb) | 0.284 | −0.41/1.09/−0.04/0.80 | 0.476 / 0.90 | 0.858 | 0.680 / **+3.54%** | 2.25→**0.23** |
| AFTER | **0.326** | −0.62/0.90/0.02/1.07 | **0.499 / 0.91** | 0.852 | **0.698 / +5.34%** | **3.05→0.86** |
| GTJAQH012 | — | −0.17/0.07/0.18/2.32 | — | — | ~+5.6% | 3.34→0.93 |

## knobs_changed
```
basisSpotEnterFrac: 0.19   # was 0.18
basisSpotExitFrac: 0.39    # was 0.38
basisSpotNameClip: 0.18    # was null
basisSpotScale: 0.24       # was 0.22
# unchanged: mode=ls, cs=invvol, Fri, ann_pct_over_fut, gate75×0.5, excl EC+SH, hygiene
```

## Residual
Feb still ~+0.9 vs ~0; Apr still soft vs +2.3; recipe gap to proprietary 国君 path remains (no public formula).

## Artifacts
`tmp_basis_spot_peer_refine.*`, `tmp_basis_spot_peer_verify.*`, `tmp_basis_spot_peer_combo.*`
