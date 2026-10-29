"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

type HelpSection = "latest" | "daily" | "interval" | "cumulative"

type HelpBlock = {
  title: string
  paragraphs?: string[]
  formula?: string
  bullets?: string[]
}

type FactorHelp = {
  key: string
  title: string
  summary: string
  paragraphs: string[]
  formula?: string
  bullets?: string[]
  note?: string
}

/** Per-factor calc text aligned with lib/server/futures-style-factors.ts (REPORT_FIT live path). */
export const FACTOR_CALC_HELP: Record<string, FactorHelp> = {
  report_basis: {
    key: "report_basis",
    title: "期限基差（国君 CTA 周报·近远月）",
    summary: "近远月套利差的截面收益，再乘 REPORT_FIT.basisScale。校准 GTJAQH004.WI。",
    paragraphs: [
      "信号：在 t 用近月/远月收盘构造 Carry_i = ln(近月价/远月价)（贴水为正、升水为负）。",
      "全商品池内按 Carry 排序：多头 topFrac，空头底 topFrac，等权差价（crossSectionLs longHigh=true）。",
      "组合下期收益取下一个交易日各品种连续合约 r_{i,t+1}，再乘 amp 缩放，使路径幅度靠近周报校准（非 Wind 净值盘）。",
    ],
    formula: `score_i = ln(P_near / P_far)
r_term_basis = CS_LS(score excl basisExclude, topN=basisTopN=8 else topFrac=0.2, longHigh) × basisScale(=0.1)`,
    bullets: [
      "当前 knobs：basisTopN=8, basisExclude=['EC'], basisTopFrac=0.2 fallback, basisScale=0.1；校准目标 Wind GTJAQH004（Excel「期限基差」）2026-10-28。",
      "UI 原名「基差(近远月)」已更名为「期限基差」；factor id report_basis 保持稳定以兼容 prefs。",
      "USE_WIND_GTJAQH=false；图表不会直接拉 GTJAQH*.WI。",
    ],
    note: "与「期限结构/套利价值」同源 Carry；国君周报「基差」请见 report_basis_spot。",
  },
  report_basis_spot: {
    key: "report_basis_spot",
    title: "基差（国君/CTA 周报·现货−期货）",
    summary: "现货 S vs OI 近月期货价的截面多头（贴水）；weeklyFri + buffer；校准 GTJAQH012.WI。",
    paragraphs: [
      "现货 S 来自 Choice EDB（raw_edb_commodity_spot_daily），按品种优先级选一系列并向前填充。",
      "期货 F 为同品种 OI 最大近月连续。默认 score=年化基差率 ((S−F)/F)×(365/T)（华泰；T≈近月合约月中剩余天；可选 /S 或 ln）；spotLag=0 用昨现货对今期货，避免现货晚到。",
      "截面：只做贴水端多头（ls(L/S)，不再美元中性空头腿——旧 LS 会抹掉 YTD 漂移）。equal weight + buffer enter/exit 0.18/0.38，rebal weeklyFri，排除 EC+SH（SH=片碱），ruleHygiene 丢弃 |S/F−1|>0.25。",
    ],
    formula: `score_i = ((S_i - F_near,i) / F_near,i) * (365 / T_near,i)   // ann_pct; T≈days to near-contract month mid
r_basis = CS_ls(L/S)_buffered(score excl EC+SH + ruleHygiene|S/F-1|>0.25, enter=18%, exit=38%, longHigh, rebal=Fri, mode=ls, cs=invvol) × basisSpotScale(=0.22) × mktVolGate(75pct→×0.5)`,
    bullets: [
      "校准目标：Wind GTJAQH012（Excel「基差」）；图不直连 Wind。",
      "2026-10-29 H1 dir pass: long_only structurally cannot match GTJAQH012 Jan–Apr (ours steadily up, 012 down/flat; JA corr_ret~0.03). Promote mode=ls + csWeight=invvol + scale0.22 (keep enter18/exit38 gate75×0.5). vs prior LO: JA cr 0.027→0.284; months 0.36/1.05/1.67/1.63 → −0.41/1.09/−0.04/0.80; H1 cr 0.339→0.476 lvl 0.62→0.90; 3m 0.884→0.858; YTD 0.647→0.680 end +4.03→+3.54; summer trough 0.01→0.23 (stays ≥0). Residual: Feb spike, Apr rally softer than 012, summer absolute level still low. See docs/cta_basis_spot_h1_dir_20261029.md. 2026-10-29 May→Jul path amp:2026-10-29 May→Jul path amp: enter 0.15→0.18 / exit 0.35→0.38, scale 0.22→0.16, mktVolGate 80%×0.7→75%×0.5 (equal Fri ann_pct excl EC+SH hygiene). vs prior LIVE: summer visual 4.24pp→2.41pp (012 2.4pp; YTD 3.7→-0.54 to 2.43→0.01); pathDrop -4.09%→-2.36% (012 -2.33%); 3m 0.880→0.884, YTD 0.638→0.647 lvl 0.789→0.881, H1 0.324→0.339; roll20σ 1.34→0.885; end +5.15%→+4.03% (012~+5.6%). Milder diversify + lower scale + stronger gate. See docs/cta_basis_spot_amp_20261029.md. 2026-10-28 amp pass: mktVolGate pct=0.80 scale=0.7 + basisSpotScale 0.25→0.22 (equal Fri ann_pct buf15/35 excl EC+SH hygiene). vs LIVE prior: Jul DD -4.25%→-3.39% (012 -2.33%); roll20 ret-σ ratio 1.58→1.34; 3m cr~0.880 flat, YTD 0.626→0.638, H1 0.312→0.324; end~+5.2% (012~+5.6%). Cause: n≈4 equal chem/energy book + no risk-off. See tmp_basis_spot_amp_diag.md / amp_refine.md.",
      "2026-10-28 research promote: kind=ann_pct_over_fut (华泰年化基差率), scale0.25, buf15/35 equal Fri excl EC+SH ruleHygiene — vs GTJAQH012 grid Pareto 3m~0.88/YTD~0.63/H1~0.31. See docs/cta_basis_factor_research_20261028.md. PRIOR unit/FX+hygiene live: excl EC+SH, scale0.30 buf15/35 equal Fri lag0 ruleHygiene → vs GTJAQH012: 3m cr~0.86/lvl~0.89; YTD cr~0.62/lvl~0.82 end~+5.6% DD~−4.8%; H1 cr~0.28. longHigh=(S−F)/F 高 = 做多贴水（现货溢价），非升水。",
      "PRIOR harder LS Wed scale0.27：3m cr~0.771 但 YTD end~0%/lvl−0.29（美元中性对冲掉漂移）。",
      "knobs：basisSpotMode=ls(L/S), rebal=weeklyFri, mode=ls, csWeight=invvol, enter=0.18, exit=0.38, kind=ann_pct_over_fut, scale=+0.22, spotLag=0, csWeight=equal, ruleHygiene=true, exclude=['EC','SH']（SH=片碱产品码，非上期所）。buffer 用 enter/exit 比例定仓位数；topN 在 buffer 开启时未接入。",
      "数据：data/edb_commodity_spot_catalog.json + fetch_edb_commodity_spot_daily.py（server EmQuant c.edb）。",
    ],
    note: "与「期限基差」（近远月）并列展示，不替代。",
  },

  report_cs_long: {
    key: "report_cs_long",
    title: "长期截面（国君 CTA 周报代理）",
    summary: "默认 csLongBlend 3腿（neg_slope L120 + z L120 + neg_z L250）；vs GTJAQH013 3m corr_ret≈0.333 / 1y≈0.679。",
    paragraphs: [
      "对每个品种用近 L 日收盘做 price ~ time 回归（L=csLongL=120），要求 R² ≥ csLongR2(=0.15)。",
      "打分取回归斜率 slope（csLongNegZ=false，不用 −z）。可选板块内 demean + 全截面 z-score 标准化。",
      "按分数做多 topFrac、做空 bottom（topFrac=0.15），日收益再乘 csLongScale(=−1.0)。",
      "代码里另有 csLongBlend 多腿（neg_z / neg_slope），但 enabled=false，线上不走 blend。",
    ],
    formula: `reg: P_τ = a + b·τ + ε,  τ∈[t−L+1,t], L=120
score = b   (若 R²≥0.15)
score ← sectorNeutral demean + 截面 z-score
r = CS_LS(score, topFrac=0.15) × (−1.0)`,
    bullets: [
      "对照离线校准：Wind GTJAQH013（文件标签「截面动量」）。",
      "负 scale 等价于翻转多空方向以贴合周报路径。",
    ],
  },
  report_pv_corr: {
    key: "report_pv_corr",
    title: "量价相关性（国君 CTA 周报代理）",
    summary: "多字段持仓/成交 shock 的加权 blend（dOiShockBlend），做空高冲击。",
    paragraphs: [
      "当前 pvKind = dOiShockBlend：对每条 leg 在窗口 L 内把字段序列做成截面 z-score（(x−μ)/σ）。",
      "字段包括 ΔOI、OI 百分比变化、成交额/持仓、sign(r)·ΔOI、成交额等；部分 leg 再做 EWMA 高通（hp）。",
      "每条 leg 做截面多空（longHigh=false，即做多低冲击/做空高冲击），日收益按 weight 加权后乘 pvBlend.scale。",
    ],
    formula: `z_i = (x_{i,t} − μ_L) / σ_L
r_leg = CS_LS(z, topFrac≈0.1, longHigh=false)  [再可选 HP]
r_pv = (Σ w_leg · HP(r_leg)) × pvBlend.scale(≈ −0.183)`,
    bullets: [
      "当前约 8 条 legs（dOi / oiPct / turnover / amount / signRetDoi 等不同 L、hp）。",
      "名称沿用周报「量价相关性」，实现已是多字段 shock blend，而非单纯 |r|–volume 相关。",
      "对照离线：Wind GTJAQH011。",
    ],
  },
  report_long_rule: {
    key: "report_long_rule",
    title: "长期规则（国君 CTA 周报代理）",
    summary: "低波动过滤后的长时间序列动量，逆波动加权并 flip。",
    paragraphs: [
      "回看 L=longRuleL(=150) 的累计收益 R，信号 s = sign(R)；若 longRuleFlip 则取反。",
      "波动过滤：若 20 日波动 > longRuleVolCap(=1.2)×120 日波动，该品种当日不参与。",
      "权重：非等权时 w = s / σ（σ 为 longRuleVolL=40 日收益波动）；至少 4 个品种才开仓。",
      "日收益 = Σ (w/Σ|w|) · r_{t+1}，再乘 longRuleScale(=−0.7)。",
    ],
    formula: `R = P_t/P_{t−L} − 1,  L=150
skip if σ_20 > 1.2 · σ_120
w = flip(sign(R)) / σ_40
r = (Σ w r_{t+1} / Σ|w|) × (−0.7)`,
    bullets: ["对照离线：Wind GTJAQH010（长期规则动量）。"],
  },
  report_inventory: {
    key: "report_inventory",
    title: "库存（国君 CTA 周报 · 注册仓单）",
    summary: "默认 invRetBlend 三腿（社库+仓单）；vs GTJAQH007 3m corr_ret≈0.657。",
    paragraphs: [
      "默认 invKind=invRetBlend（三腿：社库L5 w0.6 + 社库L10 lag1 w0.2 + 仓单L5 w0.2）。",
      "校准 vs GTJAQH007：3m corr_ret≈0.657 / corr_lvl≈0.826（先前双腿 0.611/0.819）；1y corr_ret≈0.417。",
      "备选 invKind：social / warehouse / socialZ / socialMulti / socialBlend / dOi；离线 ridge/GBM 未稳定抬升 OOS。",
    ],
    formula: `score_leg = -d% inventory (L per leg)
r = sum w_k * CS_LS(score_leg_k) * scale_k   (3-leg invRetBlend)`,
    bullets: [
      "数据：raw_futures_warehouse_receipts_daily。对照：Wind GTJAQH007（校准-only）。",
      "要再抬 corr_ret，需要更多品种的社会/港口/厂库库存序列（见 Choice wishlist）。",
    ],
  },
  report_profit: {
    key: "report_profit",
    title: "利润（国君 CTA 周报 · Carry 动量）",
    summary: "默认 profitRetBlend（carryMom 多 horizon 合成）；vs GTJAQH009 3m corr_ret≈0.489。",
    paragraphs: [
      "默认 profitKind=profitRetBlend（carryMom L30 top0.35 scale0.08 ⊕ L20 top0.2 scale0.05，等权；全日腿齐全才出信号）。",
      "校准 vs GTJAQH009：3m corr_ret≈0.489 / corr_lvl≈0.699（先前 L30-only 0.341/0.523）；1y corr_ret≈0.174（守 0.85×先验底）。",
      "备选：carryMom / carry / carryMomBlend / edb / edbMom / edbBlend；EDB 覆盖仍偏稀。",
    ],
    formula: `score = Carry_t - Carry_{t-L}   (L in {30,20})
r = 0.5*CS_LS(L30)*0.08 + 0.5*CS_LS(L20)*0.05`,
    bullets: [
      "对照：Wind GTJAQH009。更多盘面加工利润 EMI 见 Choice wishlist。",
    ],
  },
  report_basis_mom: {
    key: "report_basis_mom",
    title: "基差动量（CTA/REPORT_FIT）",
    summary: "Carry 相对 20 日前变化的截面动量。",
    paragraphs: [
      "score_i = Carry_{i,t} − Carry_{i,t−20}。",
      "做多变化大、做空变化小（longHigh=true）；无额外 scale（与旧「基差动量」同源思想）。",
    ],
    formula: `score = Carry_t − Carry_{t−20}
r = CS_LS(score, longHigh=true)`,
    bullets: ["无独立 Wind 列时完全本地重构；期限基差另见 GTJAQH004（校准-only）。"],
  },
  report_mid_mom: {
    key: "report_mid_mom",
    title: "中期动量（CTA/REPORT_FIT）",
    summary: "MA20 与 MA60 交叉的时间序列动量（波动缩放）。",
    paragraphs: [
      "对每个品种比较 MA20 与 MA60：金叉偏多、死叉偏空，再按波动缩放权重合成组合日收益（maCrossTsReturn）。",
    ],
    formula: `signal ≈ sign(MA20 − MA60)，权重按波动缩放
r = 组合下一期收益`,
    bullets: ["对照离线：Wind GTJAQH008。"],
  },
  ts_mom_short: {
    key: "ts_mom_short",
    title: "时间序列动量(短)",
    summary: "L=20 的符号动量，逆波动加权。",
    paragraphs: [
      "s_i = sign(R_i(20))，σ_i 为约 60 日波动，w_i = s_i/σ_i，日收益 = Σ w r / Σ|w|。",
    ],
    formula: `w_i = sign(R_i(20)) / σ_i
r = Σ w_i r_{i,t+1} / Σ|w_i|`,
  },
  ts_mom_mid: {
    key: "ts_mom_mid",
    title: "时间序列动量(中)",
    summary: "L=60 的符号动量，逆波动加权。",
    paragraphs: ["同短期 TS 动量，回看窗口改为 60 日。"],
    formula: `w_i = sign(R_i(60)) / σ_i`,
  },
  ts_mom_long: {
    key: "ts_mom_long",
    title: "时间序列动量(长)",
    summary: "L=120 的符号动量，逆波动加权。",
    paragraphs: ["同短期 TS 动量，回看窗口改为 120 日。"],
    formula: `w_i = sign(R_i(120)) / σ_i`,
  },
  cs_mom_short: {
    key: "cs_mom_short",
    title: "截面动量(短)",
    summary: "按 20 日收益排序的截面多空。",
    paragraphs: ["按过去 20 日收益排序，做多最高约 20%、做空最低约 20%，多空等权。"],
    formula: `r = CS_LS(R(20), longHigh=true)`,
  },
  cs_mom: {
    key: "cs_mom",
    title: "截面动量",
    summary: "按 60 日收益排序的截面多空。",
    paragraphs: ["按过去 60 日收益排序，做多最高约 20%、做空最低约 20%。"],
    formula: `r = CS_LS(R(60), longHigh=true)`,
  },
  term_structure: {
    key: "term_structure",
    title: "期限结构因子",
    summary: "近远月 Carry 截面多空。",
    paragraphs: ["Carry_i = 近月/次近月相关度量，做多高 Carry、做空低 Carry。"],
    formula: `r = CS_LS(Carry, longHigh=true)`,
  },
  basis: {
    key: "basis",
    title: "基差因子",
    summary: "与期限结构相同的 Carry 截面（展示名不同）。",
    paragraphs: ["实现上与 term_structure / carry_value 共用 Carry 截面多空。"],
    formula: `r = CS_LS(Carry, longHigh=true)`,
  },
  carry_value: {
    key: "carry_value",
    title: "价值收益因子",
    summary: "Carry 截面，与基差因子同源。",
    paragraphs: ["代码中直接复用 basis 当日收益。"],
  },
  basis_mom: {
    key: "basis_mom",
    title: "基差动量(旧)",
    summary: "Carry 20 日变化截面（旧版命名）。",
    paragraphs: ["score = Carry_t − Carry_{t−20}，做多高变化。与 report_basis_mom 思路相近。"],
    formula: `r = CS_LS(Δ_20 Carry, longHigh=true)`,
  },
  basis_mom_short: {
    key: "basis_mom_short",
    title: "期限基差动量",
    summary: "同基差动量，UI 主要出现在累计/区间面。",
    paragraphs: ["与 basis_mom 同一套 ΔCarry 截面。"],
  },
  vol_short: {
    key: "vol_short",
    title: "波动因子(短)",
    summary: "20 日波动截面：做多低波、做空高波。",
    paragraphs: ["σ 为 20 日收益波动，CS_LS(longHigh=false)。"],
    formula: `r = CS_LS(σ_20, longHigh=false)`,
  },
  vol: {
    key: "vol",
    title: "波动因子",
    summary: "60 日波动截面：做多低波、做空高波。",
    paragraphs: ["σ 为 60 日收益波动，CS_LS(longHigh=false)。"],
    formula: `r = CS_LS(σ_60, longHigh=false)`,
  },
  liquidity: {
    key: "liquidity",
    title: "流动性因子",
    summary: "Amihud 非流动性：|r|/均量，做多低、做空高。",
    paragraphs: ["Amihud ≈ |r|/20 日均成交量，longHigh=false。"],
    formula: `r = CS_LS(|r|/avgVol, longHigh=false)`,
  },
  price_dev: {
    key: "price_dev",
    title: "价格偏离因子",
    summary: "相对 MA20 偏离的反转截面。",
    paragraphs: ["Dev = P/MA20 − 1，做多低 Dev、做空高 Dev。"],
    formula: `r = CS_LS(P/MA20−1, longHigh=false)`,
  },
  skew: {
    key: "skew",
    title: "偏度因子",
    summary: "20 日收益偏度截面，做多低偏度。",
    paragraphs: ["对近 20 日收益算偏度，CS_LS(longHigh=false)。"],
  },
  kurtosis: {
    key: "kurtosis",
    title: "峰度因子",
    summary: "20 日超额峰度截面，做多低峰度。",
    paragraphs: ["对近 20 日收益算超额峰度，CS_LS(longHigh=false)。"],
  },
  spec_willingness: {
    key: "spec_willingness",
    title: "投机意愿因子",
    summary: "成交量/持仓量截面，做多意愿高。",
    paragraphs: ["score = volume/OI，CS_LS(longHigh=true)。"],
  },
  position_chg: {
    key: "position_chg",
    title: "持仓变化因子",
    summary: "sign(r)·ΔOI 截面，做多高分。",
    paragraphs: ["score = sign(日收益)·ΔOI，CS_LS(longHigh=true)。"],
  },
}

const FACTOR_DEFINITIONS: HelpBlock = {
  title: "各因子的研究定义（已落地为真实多空组合）",
  paragraphs: [
    "信号一律用 t−1 及更早的价格/持仓数据构造，收益取各品种下一交易日主力连续合约收益 r_{i,t} = P_{i,t}/P_{i,t−1} − 1。组合在商品期货池内做多空（剔除股指/国债）。",
    "价格主源：AkShare 主力连续 + EMQuant 近远月。报告名因子为本机 REPORT_FIT 价格/持仓重构（非 Wind NAV）。data/gtjaqh_closes.csv 仅作离线校准真值，默认不接入实时图表（USE_WIND_GTJAQH=false）。",
    "点开各分因子图标题旁的「?」可查看该因子的详细计算说明。",
  ],
  bullets: [
    "时间序列动量(短/中/长)：回看 L = 20 / 60 / 120，信号 s_i = sign(R_i(L))，σ_i 为 60 日波动，权重 w_i = s_i/σ_i，日收益 = Σ w_i r_{i,t} / Σ |w_i|。",
    "截面动量(短) / 截面动量：按 L = 20 / 60 过去收益排序，做多最高 20%、做空最低 20%，多空等权。",
    "期限结构 / 基差 / 价值收益：Carry 截面，做多 Carry 高、做空 Carry 低。",
    "基差动量：Carry 相对 20 日前的变化，做多变化高、做空变化低。",
    "波动因子(短)/波动：σ 为 20/60 日收益波动，做多低波动、做空高波动。",
    "流动性因子：Amihud ≈ |r|/成交量，做多 Amihud 低、做空高。",
    "价格偏离：Dev = P/MA20 − 1，反转：做多 Dev 低、做空 Dev 高。",
    "偏度 / 峰度：20 日收益偏度或超额峰度，做多低、做空高。",
    "投机意愿：成交量/持仓量；持仓变化：sign(r)·ΔOI。",
    "期限基差（周报/近远月）：CS ln(近/远)×basisScale；基差（现货−期货）：CS ann_pct=((S−F)/F)×(365/T)×basisSpotScale；长期截面：OLS slope 截面×负 scale；量价：dOiShockBlend；长期规则：momLowVol+flip；库存：−Δ%仓单L5；利润：ΔCarry(L20)；基差动量/中期动量：ΔCarry 与 MA20/60。",
  ],
}

const DATA_SOURCE: HelpBlock = {
  title: "数据与板块",
  paragraphs: [
    "接口：GET /ma/api/style-factors/returns?from=&to=&sector=。报告名因子为 REPORT_FIT 本地重构；Wind CSV 仅离线校准，不作为实时图源。",
  ],
  bullets: [
    "全部 / 商品：全商品池。",
    "黑色 / 有色 / 能化 / 农产：仅该板块品种；基差动量标在黑色，短期基差动量与基差因子标在能化。",
    "刷新：页面改日期后点「查询」，或切换板块会自动重新请求；底层表由夜间 ETL/AkShare·EMQuant 拉取更新。",
  ],
}

const HELP: Record<HelpSection, { heading: string; intro: string; blocks: HelpBlock[] }> = {
  latest: {
    heading: "最新风格因子收益 · 计算说明",
    intro: "每张卡片是查询区间内最后一个交易日、当前板块下该因子的真实日收益率（%）。",
    blocks: [
      DATA_SOURCE,
      {
        title: "卡片取值",
        paragraphs: [
          "取区间最后一个有行情的交易日 T 的因子组合日收益，乘 100 后保留两位小数。",
        ],
        formula: `卡片(f) = round( 100 × r_f(T) , 2 )`,
        bullets: [
          "正收益红色，负收益绿色，零为灰色。",
          "不再使用哈希伪随机或板块常数漂移。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
  daily: {
    heading: "单日风格因子收益 · 计算说明",
    intro: "每根柱子是该因子在该交易日的真实日收益率（%）。同一天的多个因子并排，图例可点选显隐。",
    blocks: [
      DATA_SOURCE,
      {
        title: "柱高",
        paragraphs: [
          "日收益乘 100 后画图；为避免极端值撑破坐标，展示层截断到 [−3.8, 3.8]，截断只影响画图高度，不回写底层序列。",
        ],
        formula: `y(f, t) = clip( round( 100 × r_f(t) , 2 ) , −3.8, 3.8 )`,
      },
      FACTOR_DEFINITIONS,
    ],
  },
  interval: {
    heading: "区间统计 · 计算说明",
    intro: "表格是各因子在近一周、近一月、近三月、近六月、近一年、今年以来的复利累计收益率（%）。",
    blocks: [
      DATA_SOURCE,
      {
        title: "区间收益",
        paragraphs: [
          "对因子日收益做复利：R = Π(1 + r_t) − 1，窗口截止于查询区间最后一个交易日。",
        ],
        formula: `区间(f, k) = round( 100 × ( Π_{t∈k} (1 + r_f(t)) − 1 ) , 2 )`,
        bullets: [
          "不再使用静态假表或板块平移。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
  cumulative: {
    heading: "风格因子累计收益 · 计算说明",
    intro: "折线是查询区间内各因子日收益率的累计路径。报告名因子为复利路径。",
    blocks: [
      DATA_SOURCE,
      {
        title: "累计路径",
        paragraphs: [
          "报告名因子用未四舍入日收益复利：(Π(1+r)−1)×100。其他风格因子可为日收益百分点算术累计。",
        ],
        formula: `报告名: C_t = ( Π (1+r_f) − 1 ) × 100
其他: C_0 = 0; C_t = round( C_{t−1} + 100 × r_f(t) , 2 )`,
        bullets: [
          "若真实收益接近平坦，曲线也可能较直；那是市场结果，不是常数漂移 mock。",
          "各分因子小图标题旁的「?」可查看该因子具体公式。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
}

function HelpTrigger({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[11px] font-semibold leading-none text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-800 transition-colors shrink-0"
      aria-label={label}
      title="计算说明"
    >
      ?
    </button>
  )
}

function HelpBody({
  heading,
  intro,
  blocks,
}: {
  heading: string
  intro: string
  blocks: HelpBlock[]
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base pr-6">{heading}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{intro}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm text-zinc-700">
        {blocks.map((block) => (
          <section key={block.title} className="space-y-2">
            <h4 className="text-sm font-semibold text-zinc-900">{block.title}</h4>
            {block.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="text-xs leading-relaxed text-zinc-600">
                {paragraph}
              </p>
            ))}
            {block.formula ? (
              <pre className="overflow-x-auto rounded bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap">
                {block.formula}
              </pre>
            ) : null}
            {block.bullets ? (
              <ul className="list-disc pl-5 space-y-1 text-xs leading-relaxed text-zinc-600">
                {block.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </>
  )
}

export function FuturesStyleCalcHelp({ section }: { section: HelpSection }) {
  const content = HELP[section]

  return (
    <Dialog>
      <DialogTrigger asChild>
        <span>
          <HelpTrigger label={content.heading} />
        </span>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <HelpBody heading={content.heading} intro={content.intro} blocks={content.blocks} />
      </DialogContent>
    </Dialog>
  )
}

/** Build help blocks for a factor key (shared by dialog ? and manage modal panel). */
export function getFactorHelpBlocks(
  factorKey: string,
  displayName?: string,
): { title: string; summary: string; blocks: HelpBlock[] } {
  const help = FACTOR_CALC_HELP[factorKey]
  const title = help?.title ?? displayName ?? factorKey
  if (!help) {
    return {
      title,
      summary: "本机风格因子真实多空组合日收益。",
      blocks: [
        {
          title: "暂无专项说明",
          paragraphs: [
            `因子「${displayName ?? factorKey}」暂未单独整理公式。实现见 lib/server/futures-style-factors.ts。`,
          ],
        },
      ],
    }
  }
  return {
    title,
    summary: help.summary,
    blocks: [
      {
        title: "计算逻辑（与代码一致）",
        paragraphs: help.paragraphs,
        formula: help.formula,
        bullets: help.bullets,
      },
      ...(help.note ? [{ title: "备注", paragraphs: [help.note] } satisfies HelpBlock] : []),
      {
        title: "通用约定",
        paragraphs: [
          "信号用 t 及更早数据，收益用下一交易日主力连续收益；商品池多空（剔除股指/国债）。",
          "报告名因子为 REPORT_FIT 本地重构；Wind GTJAQH*.WI 仅离线校准，默认不接入实盘图。",
        ],
      },
    ],
  }
}

/** Inline explanation panel (no dialog) — used inside 管理因子 modal. */
export function FuturesStyleFactorHelpPanel({
  factorKey,
  displayName,
  className,
}: {
  factorKey: string | null
  displayName?: string
  className?: string
}) {
  if (!factorKey) {
    return (
      <div className={["text-xs text-zinc-400 py-8 text-center", className].filter(Boolean).join(" ")}>
        点击左侧因子名称查看计算说明
      </div>
    )
  }
  const { title, summary, blocks } = getFactorHelpBlocks(factorKey, displayName)
  return (
    <div className={["space-y-3 text-sm text-zinc-700", className].filter(Boolean).join(" ")}>
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <p className="text-xs leading-relaxed text-zinc-500 mt-1">{summary}</p>
      </div>
      {blocks.map((block) => (
        <section key={block.title} className="space-y-1.5">
          <h4 className="text-xs font-semibold text-zinc-800">{block.title}</h4>
          {block.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="text-xs leading-relaxed text-zinc-600">
              {paragraph}
            </p>
          ))}
          {block.formula ? (
            <pre className="overflow-x-auto rounded bg-zinc-50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap border border-zinc-100">
              {block.formula}
            </pre>
          ) : null}
          {block.bullets ? (
            <ul className="list-disc pl-4 space-y-1 text-xs leading-relaxed text-zinc-600">
              {block.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  )
}

/** Per-factor 「?」 on 分因子累计收益 cards (and reusable elsewhere). */
export function FuturesStyleFactorHelp({
  factorKey,
  displayName,
}: {
  factorKey: string
  displayName?: string
}) {
  const { title, summary, blocks } = getFactorHelpBlocks(factorKey, displayName)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <span>
          <HelpTrigger label={`${title} · 计算说明`} />
        </span>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <HelpBody heading={`${title} · 计算说明`} intro={summary} blocks={blocks} />
      </DialogContent>
    </Dialog>
  )
}
