# CTA 利润 factor research — 2026-10-29 (Asia/Shanghai)

## Wind / Guojun mapping
| Item | Value |
|---|---|
| Wind code (Excel dump / calib) | **GTJAQH009.WI** |
| Bloomberg | **GTJAFPRF** |
| Brochure CTA3 stack labels | often 017–023; **calib stays on dump 009** |
| Live key | `report_profit` (teal `#0d9488`) |
| USE_WIND_GTJAQH | false (calib only) |

## Guojun classic-8 白皮书 (2026.09, docs/cta_factors_doc_extract_20261029.md §利润 WP p37)
- **Construction class: 时序** (WP §1.1 weighting: `sign(factor)·|factor|`, net exposure allowed).
- One-sentence recipe (cleaned): 基于**产业利润**的估值回归；用各品种日频/高频利润数据，**做多当前利润相对历史偏低的品种，做空当前利润相对历史偏高的品种**；活跃合约；平均仓位约 **20.9%**。
- Sample: **2019/01–2026/06** (利润 starts 2019; matches calib CSV first nonzero `2019-01-07`).
- WP headline stats: ann 11.25% / vol 8.66% / Sharpe 1.30 / maxDD −11.07% / monthly win 63.3%.

### Interpretation for our engine
WP wording mixes **TS level-vs-history** (per-name z / percentile of industry margin) with a **cross-section of those scores**. Operationally:
1. Per product: rolling history z or percentile of processing / smelting / crush margin (EDB / EMI).
2. CS L/S: **long low** / **short high** ⇒ our `crossSectionLs(..., longHigh=true)` needs **`profitFlip: true`** for pure level kinds.
3. Weighting ideally `|z|` (时序) rather than equal-dollar CS — we currently use equal-dollar CS like sibling factors; residual lever.

## Peer broker clues
| Source | Clue |
|---|---|
| 国君《系列二十》规则型基本面 (2024-09) | 利润同库存：布林带/分位数阈值 → 交易信号；可与库存组合（PTA 库存-利润） |
| 国君单品种模型（螺纹/铁矿/豆粕…） | 高炉利润、进口利润、压榨现货/盘面利润等作为基本面腿，分位数或规则映射 ±1 |
| 南华「产业利润」工具 | 绝对利润 / 相对利润率 / **历史分位数** — same level-vs-history framing |
| 华泰库存白皮书（analog） | TS: short-window mean vs long-window percentile (80/20 + buffer); CS: Δ% rank L/S top5 |
| 国贸期货多因子分类 | 「价值类 / 基本面类」含 **产业链利润** |

No public closed-form for GTJAQH009 lookback / topN / rebal. Calibrate to Wind NAV path.

## Our live stack (pre this pass)
- Data: `raw_edb_industry_profit_daily` (sparse — historically ~5 EMI codes: ZN/RB/AL/TA/PF) + forward-fill onto panels; carryHist as dense proxy.
- `REPORT_FIT.profitKind = "profitRetBlend"` with 3 legs (push2):
  - carryMom L30 top0.4 scale0.05 w0.4
  - carryMom L20 top0.35 scale0.03 w0.1
  - carryMomBlend L20 topMom0.2 topLvl0.35 wMom0.4 scale0.08 w0.5
- Prior closeness notes: pure EDB weak on breadth; carryMom lifted 3m corr_ret ~0.28→0.49 vs GTJAQH009.

## Hypotheses to test this pass
1. **WP-aligned `edb` (+flip)** with longer L (60/120/252) may improve level corr / soft path even if return corr lags.
2. **`edbMom` / `edbBlend` / flip variants** around LIVE.
3. Knob grid on topFrac / scale / momL without changing kind family.
4. Promote REPORT_FIT **only on clear win** (3m+YTD corr_ret, end amp, soft MAE).

## Data gaps / 妙想
Still thin industry-margin coverage. Priority Choice EMI/EDB wishlist remains in `tmp_choice_wishlist_inv_profit.md` (CU/NI/blacks/oils/ags crush & smelting margins). Ask parent for Choice codes if grid stalls on data.

## Dense EMI data pass (2026-10-29)
- Upserted daily soy crush (农业部+汇易 → M/Y) + Cu RC + AL 百川 remap; catalog 17→21 codes / 13→14 products.
- Re-grid WP `edb`+flip / edbMom / tiny LIVE blends (`tmp_profit_dense_grid.*`): **LIVE still wins**; no REPORT_FIT change.
- Loader prefers one EMI per product (daily + primary). Residual: metals/blacks/chem beyond CU/ZN/AL/RB/HC/TA/V/SA/Y/M.


## Harder refine (2026-10-29)
- Diagnosed LIVE 3m: Sep gap −1.25pp dominates lvl soft (~0.39).
- Promoted combo: L0 momL25/top0.5 + L2 top0.15/wMom0.7 @ scale3 → 3m lvl 0.67, end 2.30/2.54, Sep −0.24; corr_ret tradeoff accepted for path.


## Round-3 (2026-10-29)
Weekly rebal + abs_score |score| basket weights + lag/buffer wired; grid vs LIVE_hard → **plateau, no promote**. Stop further topFrac/rebal/|z| loops unless new data/construction.

## Harder denser-EMI pass (2026-10-30 Asia/Shanghai) — NO PROMOTE

### Upsert (server EmQuant → raw_edb_industry_profit_daily)
- BEFORE: **21 codes / 9348 rows / 4753 nn**
- AFTER: **33 codes / 22059 rows / 10884 nn**
- Upserted window `2024-01-02..2026-10-30`; all 13 ok_codes, 0 bad.

| emi_code | product | nn | notes |
|---|---|---:|---|
| EMI01762767 | SN | 1033 | 锡精矿加工费 云南 daily (full) |
| EMI01762768 | SN | 1033 | 锡精矿加工费 江西 daily (full) |
| EMI01793714/15/16 | M | 692 | 大豆压榨利润 天津/山东 |
| EMI01793718/20 | Y | 691/579 | 日照/张家港进口 |
| EMI02082714 | HC | 147 | 冷轧 weekly |
| EMI02082722 | RB | 147 | 线材 weekly |
| EMI02082735 | AL | 147 | 氧化铝 weekly |
| EMI01808951 | FG | 139 | 浮法玻璃周利润 |
| EMI01709156 | CU | 139 | 长江铜精矿 TC/RC |
| EMI02082712 | V | 147 | catalog fix AL→V (PVC) |

### Catalog / loader
- `scripts/ma/fetch_edb_industry_profit_daily.py`: AL→V fix + harder block (SN/soy/steel/alumina/FG/CU).
- `loadEdbIndustryProfit` DISTINCT ON prefs: SN EMI01762767/768, AL EMI02082735, FG EMI01808951, HC/RB cold-roll/wire.

### WP retest vs GTJAQH009 (`tmp_profit_harder_edb_retest.*`, eval_to=2026-10-02, 136 configs)
LIVE hard (profitRetBlend scale3) still Pareto-best:

| | 3m cr | 3m lvl | 3m end/W | 3m MAE | Sep gap | YTD cr | YTD end/W |
|---|---:|---:|---:|---:|---:|---:|---:|
| **LIVE** | 0.427 | 0.671 | 2.30/2.54 | 0.51 | −0.24 | 0.144 | 8.53/8.33 |
| best blend (edb60f w0.1) | 0.392 | 0.628 | 1.98/2.54 | 0.72 | −0.56 | 0.157 | 7.09/8.33 |

Pure `edb`/`edbMom`+flip still anti-correlated after denser panel. **clear_wins=0 → REPORT_FIT unchanged.** Residual gaps: NI/PB/I-J-JM/SC crack daily profit still missing structurally; soy/SN denser but carryMom LIVE path already dominated.

NO PM2 restart this pass.
