# CTA「基差」因子公开构建调研（GTJAQH012 / peers）

Generated: 2026-10-28 Asia/Shanghai. Calib target: **GTJAQH012 only**. Live = EMI spot − OI-near futures; Wind/Excel offline score only (`USE_WIND_GTJAQH=false`).

## Verdict on Wind / 国君 GTJAQH012

- **No public formula** for Wind `GTJAQH012.WI` / 国泰君安商品策略周报「基差」指数构建细节 was found.
- Public Guotai materials cover: (a) commodity **index** `GTJAQH000` methodology (not the factor codes); (b) **股指**基差因子体系（直接基差/基差动量/变化/高频情绪）— equity-index timing, not commodity CS spot−futures; (c) weekly CTA report naming「基差」as one of ~8 equal-weight CS factors — **marketing / high-level**, not a recipe.
- Treat GTJAQH012 as a **calib target NAV**, not a live data source. Reconstruct with self-contained spot−futures logic.

## Peer constructions (credible, actionable)

### 1) 华泰期货 — 基差 = 现货 − 期货；年化基差率 + 方向扩大（时序）
- Source: [华泰 CTA 策略环境分析 PDF](https://htfc.com/wz_upload/png_upload/20241114/1731576619994d43be9.pdf) (also mirrored 2024-11-17 outlook PDF).
- Definition: `基差 = S − F`；因子公式（文中 OCR）实质为年化基差率  
  `ann = (S/F − 1) * 365 / T`，`T` = 主力剩余到期天数；并看 `Δann`。
- Signal: **ann>0 且朝正向扩大 → 多**；**ann<0 且朝负向扩大 → 空**；日频收盘信号、次日交易。
- Note: 2024 年该策略夏普大幅下滑（升贴水结构异常）— 与期限结构失效同向。
- Public vs fluff: **formula + signal rules are concrete**; universe/weights not fully specified → implementable as CS score variants.

### 2) 中泰期货金工 — 基差率水平弱，**基差率变化**强（周频截面）
- Source: [期现价格收敛性及基差相关因子构建](https://finance.sina.cn/2022-11-29/detail-imqqsmrp7922304.d.html?vt=4)
- Definition: `基差 = S − F`；`基差率` 替代绝对基差；周频、5 组分位、多高空低、等权。
- Result: 基差率 IC≈0.007；**基差率变化** IC≈0.039，年化~22%、Sharpe~1.35。
- Public vs fluff: **clear CS recipe**; strongest peer evidence to try **Δ(basis rate)** instead of / on top of level.

### 3) 华泰早期 — 期限结构 / 展期收益（近−远，**≠** 现货基差）
- Source: [CTA 量化策略因子系列（三）：期限结构因子](https://www.htfc.com/upload/20171025/201710251508893187512.pdf)
- Roll yield via near vs dominant / spot proxy; CS long high roll / short low; best H≈60–120d, top~30%.
- Maps to our UI「**期限基差**」(report_basis / GTJAQH004), **not**「基差」. Do not merge charts.

### 4) Boons–Prado basis-momentum / 华泰 Curve / 天风
- Basis-momentum = near vs deferred momentum differential (curve curvature/slope change), not physical spot.
- Useful for term-structure charts; **out of scope** for spot「基差」live path (already burned as roll-as-基差).

### 5) 享科 / 海通 FICC 等博客级综述
- Spot−futures CS: long 贴水 (S>F), short 升水; spot source matters (生意社/Choice/Wind/SMM).
- Confirms directionality we already use (`longHigh` on `(S−F)/F`).

### 6) 国泰君安期货 — 股指基差系列
- Source: [股指策略系列三：股指期货基差因子](https://fxbaogao.com/detail/4504167)
- Direct basis, basis mom, Δbasis, HF corr, premium/discount frequency — **equity index**, not commodity EMI spot CS.

## Mapping → unburned tests for report_basis_spot

Already burned (do not rehash as live): Wed, topN grids, vol-weight, denom `/S`/`ln` (hygiene-identical), smooth, roll-as-基差 live, CS z/rank/clip/demean, sectorCap.

**Research-inspired, not yet burned:**

| Idea | Source | Score / filter |
|---|---|---|
| A `ann_pct` | 华泰 | `(S/F−1)*365/T`, T≈days to near-contract month |
| B `delta_pct` | 中泰 | `basis_t − basis_{t−L}`, L∈{1,5,10} |
| C `level_delta` | 华泰+中泰 | `basis + k·Δ`, k∈{0.5,1,2} |
| D `require_expand` | 华泰 signal | long_only ∩ (basis>0 ∧ Δ>0) |
| Keep skeleton | live | Fri, equal, excl EC+SH, hygiene, enter/exit buffer, scale~0.30 |

Labels stay:「基差」= spot−futures；「期限基差」= near–far.

## URLs (quick list)
- https://htfc.com/wz_upload/png_upload/20241114/1731576619994d43be9.pdf
- https://www.htfc.com/wz_upload/png_upload/20241117/17318536264420315d9.pdf
- https://finance.sina.cn/2022-11-29/detail-imqqsmrp7922304.d.html?vt=4
- https://www.htfc.com/upload/20171025/201710251508893187512.pdf
- https://fxbaogao.com/detail/4504167
- https://finance.sina.cn/option/2022-05-31/detail-imizirau5836740.d.html?vt=4 (GTJAQH000 index细则, not 012)
- https://xkesoft.com/research/futures-fundamental-factors/
- https://ideas.repec.org/a/bla/jfinan/v74y2019/i1/p239-279.html (basis-momentum)
