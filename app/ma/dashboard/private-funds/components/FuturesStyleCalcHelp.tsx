"use client"

import { useMemo, useState, type ReactNode } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
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
  /** Plain monospace fallback (legacy section help). */
  formula?: string
  /** KaTeX math strings (display mode). */
  latex?: string[]
  bullets?: string[]
  /** Collapsible research diary — hidden by default. */
  collapsible?: boolean
}

type FactorHelp = {
  key: string
  title: string
  summary: string
  dataSources: { input: string; source: string }[]
  designLogic: string[]
  latex: string[]
  holdingRebal: string[]
  calibTarget: string
  researchNote?: string
}

function LatexBlock({ math }: { math: string }) {
  const html = useMemo(
    () =>
      katex.renderToString(math, {
        throwOnError: false,
        displayMode: true,
        strict: "ignore",
        trust: false,
      }),
    [math],
  )
  return (
    <div
      className="overflow-x-auto rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-[13px] leading-relaxed text-zinc-800 [&_.katex-display]:m-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function FormulaPlain({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap border border-zinc-100">
      {children}
    </pre>
  )
}

/** Per-factor calc text aligned with lib/server/futures-style-factors.ts (REPORT_FIT live path). */
export const FACTOR_CALC_HELP: Record<string, FactorHelp> = {
  report_basis: {
    key: "report_basis",
    title: "期限基差（国君 CTA 周报·近远月）",
    summary: "近远月升贴水的截面多空，刻画期限结构斜率；本地 REPORT_FIT 重构，校准 Wind GTJAQH004。",
    dataSources: [
      { input: "近月期货价 P_near", source: "主力/近月连续收盘（AkShare 主力连续 + EMQuant 近远月）" },
      { input: "远月期货价 P_far", source: "同品种次近月/远月连续收盘（EMQuant）" },
      { input: "品种池", source: "全商品期货池，排除股指/国债；默认剔除 EC" },
    ],
    designLogic: [
      "当近月相对远月贴水（远月升水）时，Carry 为正，通常对应库存偏松或持有成本补偿；反之近月升水往往对应短期紧缺。",
      "期限基差因子在全市场按 Carry 排序做多高 Carry、做空低 Carry，赚取「期限结构误定价/库存溢价」的截面收益，而不是单品种方向赌涨跌。",
      "与「现货−期货」基差互补：本因子只用期货曲线，不依赖现货数据源。",
    ],
    latex: [
      "\\mathrm{Carry}_i = \\ln\\frac{P^{\\mathrm{near}}_i}{P^{\\mathrm{far}}_i}",
      "r^{\\mathrm{term}} = \\mathrm{CS\\text{-}LS}(\\mathrm{Carry};\\ \\mathrm{topN}{=}8,\\ \\mathrm{excl.}[\\mathrm{EC}],\\ \\mathrm{longHigh}) \\times 0.1",
    ],
    holdingRebal: [
      "截面多空：按 Carry 从高到低，多头取 topN=8（不足时退回 topFrac=20%），空头取对称底部，等权。",
      "日频换仓；组合收益取下一交易日各品种主力连续收益，再乘 basisScale=0.1。",
    ],
    calibTarget: "Wind GTJAQH004.WI（Excel「期限基差」）；USE_WIND_GTJAQH=false，图不直连 Wind。",
  },

  report_basis_spot: {
    key: "report_basis_spot",
    title: "基差（国君/CTA 周报·现货−期货）",
    summary: "现货相对近月期货的年化升贴水截面；周五换仓 + 缓冲带；校准 Wind GTJAQH012。",
    dataSources: [
      { input: "现货 S", source: "Choice EDB 现货日频表 raw_edb_commodity_spot_daily（目录 data/edb_commodity_spot_catalog.json）" },
      { input: "期货 F", source: "同品种持仓量最大的近月连续合约收盘价（OI-near）" },
      { input: "到期天数 T", source: "距近月合约月份中点的日历天数" },
    ],
    designLogic: [
      "现货高于期货（贴水，S>F）时，远期价格偏低或现货偏紧，历史上「做多贴水、做空升水」具有均值回复逻辑。",
      "因此因子在截面上偏好年化基差率更高（更贴水）的品种做多，并允许对称空头腿；不是时序单边押注某一个商品。",
      "引入波动门控与单品种权重上限，是为了在市场急涨急跌时降低组合杠杆、避免少数高波品种主导收益。",
    ],
    latex: [
      "\\mathrm{score}_i = \\frac{S_i - F^{\\mathrm{near}}_i}{F^{\\mathrm{near}}_i}\\cdot\\frac{365}{T_i}",
      "r^{\\mathrm{basis}} = \\mathrm{CS\\text{-}LS}_{\\mathrm{buf}}(\\mathrm{score};\\ \\mathrm{enter}{=}19\\%,\\ \\mathrm{exit}{=}39\\%,\\ \\mathrm{invvol},\\ \\mathrm{nameClip}{=}0.18)\\times 0.24\\times g_{\\mathrm{vol}}",
      "g_{\\mathrm{vol}}=\\begin{cases}0.5 & \\text{若截面中位}|r|\\text{高于近 60 日 75\\% 分位}\\\\1 & \\text{否则}\\end{cases}",
    ],
    holdingRebal: [
      "每周五换仓；缓冲带 enter=19% / exit=39%，避免频繁进出。",
      "权重：腿内逆波动（invvol）；单品种 |w| 上限 nameClip=0.18。",
      "清洗：剔除 EC、SH（片碱）；丢弃 |S/F−1|>0.25 的异常基差（ruleHygiene）。",
      "spotLag=0：用可得的最新现货对齐当日期货，减少现货晚到带来的虚假信号。",
    ],
    calibTarget: "Wind GTJAQH012.WI（Excel「基差」）；图不直连 Wind，仅作离线校准。",
    researchNote:
      "白皮书口号码 GTJAQH021 为时序表述；本地校准仍用 Excel GTJAQH012。公开材料无闭式公式；华泰/中泰变体在 LS+invvol 上未优于当前年化基差率。详见 docs/cta_basis_spot_peer_20261029.md 等。",
  },

  report_cs_long: {
    key: "report_cs_long",
    title: "长期截面（国君 CTA 周报代理）",
    summary: "中长期价格趋势的截面多空（OLS 斜率/标准化合成）；校准 Wind GTJAQH013。",
    dataSources: [
      { input: "品种价格序列 P", source: "商品期货主力连续收盘（AkShare）" },
      { input: "板块分类", source: "本地品种→板块映射（用于板块内去均值）" },
    ],
    designLogic: [
      "长期截面捕捉「强者恒强 / 弱者恒弱」的中期趋势差异：价格对时间回归斜率更陡的品种，往往仍有资金与基本面惯性。",
      "LIVE 使用多腿 blend（负斜率、z、长窗负 z）再整体缩放，是为了同时覆盖趋势跟随与适度反转成分，使路径更接近周报「长期截面」。",
      "负的总 scale 用于对齐周报路径方向（实现细节），经济含义仍是对相对强弱做截面配置。",
    ],
    latex: [
      "P_{i,\\tau}=a_i+b_i\\tau+\\varepsilon_{i,\\tau},\\quad \\tau\\in[t-L+1,t],\\ L=120",
      "\\mathrm{score}_i = b_i\\ \\big(\\text{要求 }R^2_i\\ge 0.15\\big);\\ \\text{可选板块去均值 + 截面 }z",
      "r^{\\mathrm{cs}} = \\mathrm{Blend}\\big(\\mathrm{CS\\text{-}LS}(\\mathrm{score}_k)\\big)\\times 0.95",
    ],
    holdingRebal: [
      "默认日频；各腿 topFrac≈15%–20% 多空等权（或按腿设置）。",
      "csLongBlend：neg_slope(L120,w0.2) + z(L120,w0.35) + neg_z(L250,w0.45)，总 scale=0.95。",
      "简单 OLS 路径保留为 fallback（csLongScale=−1.0）。",
    ],
    calibTarget: "Wind GTJAQH013.WI（文件标签「截面动量」→ UI「长期截面」）；图不直连 Wind。",
    researchNote: "白皮书 GTJAQH022「回归系数×强度」试过 slope×R²/|t|，仅边际改善，未 promote。",
  },

  report_pv_corr: {
    key: "report_pv_corr",
    title: "量价相关性（国君 CTA 周报代理）",
    summary: "成交量与价格滚动相关的截面：做多相关低、做空相关高；校准 Wind GTJAQH011。",
    dataSources: [
      { input: "收盘价 close", source: "商品期货主力连续收盘（AkShare）" },
      { input: "成交量 volume", source: "同合约日成交量（AkShare）" },
    ],
    designLogic: [
      "量价高度同向相关，常意味着趋势拥挤或信息已被充分交易；相关偏低甚至背离，往往对应反转或「量能未确认」的定价空间。",
      "国君白皮书口径：按因子值从小到大，做多相关小、做空相关大，多空市值相等——本实现 longHigh=false 与此一致。",
      "因此它更像「拥挤度/确认度」的截面择品，而不是单纯的动量或反转。",
    ],
    latex: [
      "c_i=\\mathrm{corr}_{L=55}(\\mathrm{close}_i,\\ \\mathrm{volume}_i)",
      "r^{\\mathrm{pv}}=\\mathrm{CS\\text{-}LS}(c;\\ \\mathrm{topFrac}{=}8\\%,\\ \\mathrm{longHigh}{=}\\mathrm{false})\\times 0.2",
    ],
    holdingRebal: [
      "日频截面多空：多头取相关最低的约 8%，空头取相关最高的约 8%，等权。",
      "pvKind=corr，pvCorrMode=close（价格水平与成交量相关；非收益冲击模式）。",
    ],
    calibTarget: "Wind GTJAQH011.WI（brochure 口号码 GTJAQH020 / Bloomberg GJFQVPC 仅对照）；图走 REPORT_FIT。",
  },

  report_long_rule: {
    key: "report_long_rule",
    title: "长期规则（国君 CTA 周报代理）",
    summary: "低波动过滤后的长时间序列动量（momLowVol）；校准 Wind GTJAQH010。",
    dataSources: [
      { input: "价格 P", source: "商品期货主力连续收盘（AkShare）" },
      { input: "波动 σ", source: "由日收益滚动标准差估计（实现内计算）" },
    ],
    designLogic: [
      "长期规则动量假设：中长期趋势在波动可控时更可持续；若短期波动相对长期波动过高，信号可信度下降。",
      "因此先用长窗收益定方向，再用「短波/长波」门控剔除过热品种，并以逆波动加权，偏向「稳中有趋势」的品种。",
      "它偏时序（每品种独立给多空权重），与纯截面排序因子形成互补。",
    ],
    latex: [
      "R_i=\\frac{P_{i,t}}{P_{i,t-L}}-1,\\quad L=200",
      "\\text{若 }\\sigma_{i,20}>1.0\\cdot\\sigma_{i,120}\\ \\text{则跳过该品种}",
      "w_i=\\frac{\\mathrm{sign}(R_i)}{\\sigma_{i,40}},\\quad r=\\frac{\\sum w_i r_{i,t+1}}{\\sum|w_i|}\\times 0.5",
    ],
    holdingRebal: [
      "日频；至少约 4 个品种有权重才开仓。",
      "longRuleKind=momLowVol；longRuleFlip=false；scale=0.5。",
    ],
    calibTarget: "Wind GTJAQH010.WI（长期规则动量）；图不直连 Wind。",
  },

  report_inventory: {
    key: "report_inventory",
    title: "库存（国君 CTA 周报 · 社会库存/仓单）",
    summary: "去库做多、累库做空的多腿库存变化合成；校准 Wind GTJAQH007。",
    dataSources: [
      { input: "社会库存", source: "Choice EDB 表 raw_edb_commodity_inventory_daily" },
      { input: "仓单/库存仓单", source: "Choice 仓单日频 warehouse_receipts_daily（FTREGORDERVOL）" },
    ],
    designLogic: [
      "库存下降（去库）通常对应供需趋紧、价格易涨；库存上升（累库）则相反——这是商品基本面最直接的定价线索之一。",
      "因子对库存变化率、相对均线偏离、标准化水位等多视角打分，并在截面做多「更去库」、做空「更累库」。",
      "加入 long-only 的 Ave 腿，是为了在软行情里保留「低库存水位」多头暴露，改善与周报路径的贴合。",
    ],
    latex: [
      "\\mathrm{score}^{\\Delta}=-\\Delta\\%\\,\\mathrm{Inv},\\quad \\mathrm{score}^{\\mathrm{ave}}=-\\big(\\mathrm{Inv}/\\mathrm{MA}(N)-1\\big),\\quad \\mathrm{score}^{z}=-z(\\mathrm{Inv})",
      "r^{\\mathrm{inv}}=4.75\\sum_k w_k\\,\\mathrm{CS}(\\mathrm{score}_k)",
    ],
    holdingRebal: [
      "默认日频换仓（invRebal=daily；周度可选未 promote）。",
      "合成腿：social Δ L5、warehouse Δ L5、social Δ L10(lag2)、socialZ(120)、socialAve(MA80, long-only)；多数腿 topN=8 LS。",
      "总 scale=4.75。",
    ],
    calibTarget: "Wind GTJAQH007.WI（Excel「库存」；brochure CTA3 写 GTJAQH017 仅口号，不切换 calib）。",
    researchNote: "HARDER/weekly 实验见 docs/cta_inventory_harder_20261029.md、docs/cta_inventory_weekly_20261029.md。",
  },

  report_profit: {
    key: "report_profit",
    title: "利润（国君 CTA 经典 / Carry 代理）",
    summary: "产业利润/Carry 多 horizon 动量合成；校准 Wind GTJAQH009。",
    dataSources: [
      { input: "近远月 Carry", source: "期货近远月收盘（EMQuant / 连续合约）构造的期限 Carry" },
      { input: "产业利润（可选腿）", source: "Choice EDB 表 raw_edb_industry_profit_daily（覆盖仍偏窄，作补充）" },
    ],
    designLogic: [
      "产业链利润偏高时，供给往往随后扩张、价格承压；利润偏低则供给收缩、价格易修复——白皮书强调「利润相对历史偏低做多、偏高做空」。",
      "在现货利润序列覆盖不足时，LIVE 用多 horizon 的 Carry 动量作为可交易代理：Carry 改善常与利润/拥挤定价同向变化。",
      "多腿合成降低单一窗口噪声，使路径更接近周报「利润」因子。",
    ],
    latex: [
      "\\mathrm{score}^{(L)}=\\mathrm{Carry}_t-\\mathrm{Carry}_{t-L}",
      "r^{\\mathrm{profit}}=\\mathrm{Blend}\\big(\\mathrm{CS}(\\mathrm{score}^{(25)}),\\ \\mathrm{CS}(\\mathrm{score}^{(20)}),\\ \\mathrm{CS}(\\mathrm{carryMomBlend})\\big)\\times 3",
    ],
    holdingRebal: [
      "日频；profitKind=profitRetBlend，总 scale=3。",
      "腿：carryMom L25 top50% w0.4；carryMom L20 top35% w0.1；carryMomBlend L20 w0.5。",
    ],
    calibTarget: "Wind GTJAQH009.WI / Bloomberg GTJAFPRF；USE_WIND_GTJAQH=false。",
    researchNote: "纯 EDB level-z 在当前利润广度下未胜过 LIVE Carry 代理；更多冶炼/压榨利润 EMI 仍在 Choice wishlist。",
  },

  report_basis_mom: {
    key: "report_basis_mom",
    title: "基差动量（CTA/REPORT_FIT）",
    summary: "期限 Carry 相对 20 日前变化的截面动量。",
    dataSources: [
      { input: "Carry", source: "近远月期货收盘构造（同期限基差数据源）" },
    ],
    designLogic: [
      "基差动量关注升贴水本身的变化速度：Carry 快速走强，往往对应库存预期或曲线结构正在重新定价。",
      "做多 Carry 改善最大的品种、做空恶化最大的品种，捕捉曲线调整的惯性，而非静态水平。",
    ],
    latex: [
      "\\mathrm{score}_i=\\mathrm{Carry}_{i,t}-\\mathrm{Carry}_{i,t-20}",
      "r=\\mathrm{CS\\text{-}LS}(\\mathrm{score},\\ \\mathrm{longHigh}{=}\\mathrm{true})",
    ],
    holdingRebal: ["日频截面多空等权。"],
    calibTarget: "无独立 Wind 列时完全本地重构；期限基差水平见 GTJAQH004（校准-only）。",
  },

  report_mid_mom: {
    key: "report_mid_mom",
    title: "中期动量（CTA/REPORT_FIT）",
    summary: "MA20 与 MA60 交叉的时间序列动量（波动缩放）。",
    dataSources: [
      { input: "价格 P", source: "商品期货主力连续收盘（AkShare）" },
    ],
    designLogic: [
      "中期均线金叉/死叉是经典趋势规则：短均线穿越长均线，反映中期资金方向切换。",
      "按波动缩放权重，使高波品种不会过度主导组合，更接近「风险平价式」的时序动量。",
    ],
    latex: [
      "s_i=\\mathrm{sign}(\\mathrm{MA}_{20}-\\mathrm{MA}_{60})",
      "r=\\sum_i \\tilde{w}_i\\,r_{i,t+1}\\quad(\\tilde{w}\\ \\text{按波动缩放后归一})",
    ],
    holdingRebal: ["日频时序；波动缩放合成下一期收益。"],
    calibTarget: "Wind GTJAQH008.WI；图不直连 Wind。",
  },

  ts_mom_short: {
    key: "ts_mom_short",
    title: "时间序列动量(短)",
    summary: "L=20 的符号动量，逆波动加权。",
    dataSources: [{ input: "收益 R(20)", source: "主力连续收盘（AkShare）" }],
    designLogic: [
      "短期时序动量假设近期涨的品种短期内仍偏强；用波动倒数加权，降低高噪声品种权重。",
    ],
    latex: ["w_i=\\mathrm{sign}(R_i(20))/\\sigma_i,\\quad r=\\sum w_i r_{i,t+1}/\\sum|w_i|"],
    holdingRebal: ["日频时序，全商品池（除股指/国债）。"],
    calibTarget: "本地风格因子，无单独 Wind 校准码。",
  },
  ts_mom_mid: {
    key: "ts_mom_mid",
    title: "时间序列动量(中)",
    summary: "L=60 的符号动量，逆波动加权。",
    dataSources: [{ input: "收益 R(60)", source: "主力连续收盘（AkShare）" }],
    designLogic: ["与短窗 TS 动量相同逻辑，回看窗口改为 60 日，更平滑、换手更低。"],
    latex: ["w_i=\\mathrm{sign}(R_i(60))/\\sigma_i"],
    holdingRebal: ["日频时序。"],
    calibTarget: "本地风格因子，无单独 Wind 校准码。",
  },
  ts_mom_long: {
    key: "ts_mom_long",
    title: "时间序列动量(长)",
    summary: "L=120 的符号动量，逆波动加权。",
    dataSources: [{ input: "收益 R(120)", source: "主力连续收盘（AkShare）" }],
    designLogic: ["长窗时序动量捕捉季度级趋势，对噪音更不敏感，但对拐点反应更慢。"],
    latex: ["w_i=\\mathrm{sign}(R_i(120))/\\sigma_i"],
    holdingRebal: ["日频时序。"],
    calibTarget: "本地风格因子，无单独 Wind 校准码。",
  },
  cs_mom_short: {
    key: "cs_mom_short",
    title: "截面动量(短)",
    summary: "按 20 日收益排序的截面多空。",
    dataSources: [{ input: "R(20)", source: "主力连续收盘（AkShare）" }],
    designLogic: ["截面动量做多相对强势、做空相对弱势，赚取品种间强弱发散，而非绝对涨跌。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(R(20),\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频；多头最高约 20%，空头最低约 20%，等权。"],
    calibTarget: "本地风格因子。",
  },
  cs_mom: {
    key: "cs_mom",
    title: "截面动量",
    summary: "按 60 日收益排序的截面多空。",
    dataSources: [{ input: "R(60)", source: "主力连续收盘（AkShare）" }],
    designLogic: ["中期截面动量，逻辑同短窗，窗口更长、持仓更稳。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(R(60),\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频；多空各约 20% 等权。"],
    calibTarget: "本地风格因子。",
  },
  term_structure: {
    key: "term_structure",
    title: "期限结构因子",
    summary: "近远月 Carry 截面多空。",
    dataSources: [{ input: "Carry", source: "近/次近月连续（EMQuant）" }],
    designLogic: ["与期限基差同源：做多高 Carry（偏贴水）、做空低 Carry，收获曲线形态溢价。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\mathrm{Carry},\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "与 report_basis 同源思想；校准参见 GTJAQH004。",
  },
  basis: {
    key: "basis",
    title: "基差因子",
    summary: "与期限结构相同的 Carry 截面（展示名不同）。",
    dataSources: [{ input: "Carry", source: "近远月连续（EMQuant）" }],
    designLogic: ["实现上与 term_structure / carry_value 共用 Carry 截面多空。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\mathrm{Carry},\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  carry_value: {
    key: "carry_value",
    title: "价值收益因子",
    summary: "Carry 截面，与基差因子同源。",
    dataSources: [{ input: "Carry", source: "近远月连续（EMQuant）" }],
    designLogic: ["把期限升贴水视为「价值」信号：高 Carry 类似便宜的持有收益。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\mathrm{Carry},\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频；代码中复用 basis 当日收益。"],
    calibTarget: "本地风格因子。",
  },
  basis_mom: {
    key: "basis_mom",
    title: "基差动量(旧)",
    summary: "Carry 20 日变化截面（旧版命名）。",
    dataSources: [{ input: "ΔCarry(20)", source: "近远月连续（EMQuant）" }],
    designLogic: ["与 report_basis_mom 同思路：做多 Carry 改善、做空恶化。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\Delta_{20}\\mathrm{Carry},\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  basis_mom_short: {
    key: "basis_mom_short",
    title: "期限基差动量",
    summary: "同基差动量，主要出现在累计/区间图。",
    dataSources: [{ input: "ΔCarry", source: "近远月连续（EMQuant）" }],
    designLogic: ["与 basis_mom 同一套 ΔCarry 截面。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\Delta\\mathrm{Carry},\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  vol_short: {
    key: "vol_short",
    title: "波动因子(短)",
    summary: "20 日波动截面：做多低波、做空高波。",
    dataSources: [{ input: "σ_20", source: "由主力连续日收益估计" }],
    designLogic: ["低波异象：波动偏低的品种往往有更稳定的风险调整收益；做空高波以对冲尾部风险溢价。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\sigma_{20},\\ \\mathrm{longHigh}{=}\\mathrm{false})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  vol: {
    key: "vol",
    title: "波动因子",
    summary: "60 日波动截面：做多低波、做空高波。",
    dataSources: [{ input: "σ_60", source: "由主力连续日收益估计" }],
    designLogic: ["中期低波偏好，逻辑同短窗波动因子。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\sigma_{60},\\ \\mathrm{longHigh}{=}\\mathrm{false})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  liquidity: {
    key: "liquidity",
    title: "流动性因子",
    summary: "Amihud 非流动性：做多低、做空高。",
    dataSources: [
      { input: "|r| / 成交量", source: "主力连续收益与成交量（AkShare）" },
    ],
    designLogic: ["流动性越好（Amihud 越低）的品种冲击成本更低，长期可承载更大资金；做空非流动品种收取流动性溢价。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(|r|/\\overline{\\mathrm{Vol}},\\ \\mathrm{longHigh}{=}\\mathrm{false})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  price_dev: {
    key: "price_dev",
    title: "价格偏离因子",
    summary: "相对 MA20 偏离的反转截面。",
    dataSources: [{ input: "P / MA20", source: "主力连续收盘（AkShare）" }],
    designLogic: ["短期大幅偏离均线后常有均值回复；做多跌深（低 Dev）、做空涨伸（高 Dev）。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(P/\\mathrm{MA}_{20}-1,\\ \\mathrm{longHigh}{=}\\mathrm{false})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  skew: {
    key: "skew",
    title: "偏度因子",
    summary: "20 日收益偏度截面，做多低偏度。",
    dataSources: [{ input: "偏度", source: "近 20 日收益分布（由连续合约收益计算）" }],
    designLogic: ["高正偏度常伴随彩票型需求与拥挤；低偏度品种风险回报结构更「平常」，截面上偏好后者。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\mathrm{skew}_{20},\\ \\mathrm{longHigh}{=}\\mathrm{false})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  kurtosis: {
    key: "kurtosis",
    title: "峰度因子",
    summary: "20 日超额峰度截面，做多低峰度。",
    dataSources: [{ input: "峰度", source: "近 20 日收益分布" }],
    designLogic: ["高峰度意味着厚尾与跳价风险；做多分布更「正常」的品种，做空尾部风险更高的品种。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\mathrm{kurt}_{20},\\ \\mathrm{longHigh}{=}\\mathrm{false})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  spec_willingness: {
    key: "spec_willingness",
    title: "投机意愿因子",
    summary: "成交量/持仓量截面，做多意愿高。",
    dataSources: [
      { input: "volume / OI", source: "主力连续成交量与持仓量（AkShare）" },
    ],
    designLogic: ["量仓比升高通常反映投机活跃与信息交易增强；截面做多投机意愿更高的品种。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\mathrm{volume}/\\mathrm{OI},\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
  position_chg: {
    key: "position_chg",
    title: "持仓变化因子",
    summary: "sign(r)·ΔOI 截面，做多高分。",
    dataSources: [
      { input: "ΔOI 与日收益", source: "主力连续持仓量与收盘（AkShare）" },
    ],
    designLogic: ["价格上涨且增仓，或下跌且减仓，往往确认趋势方向；用 sign(r)·ΔOI 度量「有持仓确认的价格变动」。"],
    latex: ["r=\\mathrm{CS\\text{-}LS}(\\mathrm{sign}(r)\\cdot\\Delta\\mathrm{OI},\\ \\mathrm{longHigh}{=}\\mathrm{true})"],
    holdingRebal: ["日频截面等权。"],
    calibTarget: "本地风格因子。",
  },
}

const FACTOR_DEFINITIONS: HelpBlock = {
  title: "各因子的研究定义（已落地为真实多空组合）",
  paragraphs: [
    "信号一律用 t 及更早的价格/持仓数据构造，收益取各品种下一交易日主力连续合约收益。组合在商品期货池内做多空（剔除股指/国债）。",
    "价格主源：AkShare 主力连续 + EMQuant 近远月。报告名因子为本机 REPORT_FIT 价格/持仓重构（非 Wind NAV）。data/gtjaqh_closes.csv 仅作离线校准真值，默认不接入实时图（USE_WIND_GTJAQH=false）。",
    "点开各分因子图标题旁的「?」可查看该因子的数据来源、设计逻辑与公式。",
  ],
}

const DATA_SOURCE: HelpBlock = {
  title: "数据与板块",
  paragraphs: [
    "接口：GET /ma/api/style-factors/returns?from=&to=&sector=。报告名因子为 REPORT_FIT 本地重构；Wind CSV 仅离线校准，不作为实盘图源。",
  ],
  bullets: [
    "全部 / 商品：全商品池。",
    "黑色 / 有色 / 能化 / 农产：仅该板块品种。",
    "刷新：页面改日期后点「查询」，或切换板块会自动重新请求；底层表由夜间 ETL / AkShare·EMQuant 拉取更新。",
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
        paragraphs: ["取区间最后一个有行情的交易日 T 的因子组合日收益，乘 100 后保留两位小数。"],
        latex: ["\\text{卡片}(f)=\\mathrm{round}(100\\cdot r_f(T),\\ 2)"],
        bullets: ["正收益红色，负收益绿色，零为灰色。"],
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
          "日收益乘 100 后绘图；为避免极端值撑破纵轴，展示层截断到 [−3.8, 3.8]，截断只影响画图高度，不回写底层序列。",
        ],
        latex: ["y(f,t)=\\mathrm{clip}(\\mathrm{round}(100\\cdot r_f(t),\\ 2),\\ -3.8,\\ 3.8)"],
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
        paragraphs: ["对因子日收益做复利：R = ∏(1 + r_t) − 1，窗口截止于查询区间最后一个交易日。"],
        latex: ["\\text{区间}(f,k)=\\mathrm{round}\\Big(100\\cdot\\big(\\prod_{t\\in W_k}(1+r_f(t))-1\\big),\\ 2\\Big)"],
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
          "报告名因子用未年化日收益复利：(∏(1+r)−1)×100。其他风格因子可为日收益百分点算术累计。",
        ],
        latex: [
          "C_t^{\\text{报告}}=100\\cdot\\Big(\\prod(1+r_f)-1\\Big)",
          "C_0=0;\\quad C_t=\\mathrm{round}(C_{t-1}+100\\cdot r_f(t),\\ 2)",
        ],
        bullets: ["各分因子小图标题旁的「?」可查看该因子具体公式与设计逻辑。"],
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

function CollapsibleNote({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="space-y-1.5">
      <button
        type="button"
        className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 underline-offset-2 hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾ " : "▸ "}
        {title}
      </button>
      {open ? <p className="text-xs leading-relaxed text-zinc-500 whitespace-pre-wrap">{body}</p> : null}
    </section>
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
        {blocks.map((block) =>
          block.collapsible && block.paragraphs?.[0] ? (
            <CollapsibleNote key={block.title} title={block.title} body={block.paragraphs.join("\n")} />
          ) : (
            <section key={block.title} className="space-y-2">
              <h4 className="text-sm font-semibold text-zinc-900">{block.title}</h4>
              {block.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="text-xs leading-relaxed text-zinc-600">
                  {paragraph}
                </p>
              ))}
              {block.latex?.map((m) => (
                <LatexBlock key={m} math={m} />
              ))}
              {block.formula ? <FormulaPlain>{block.formula}</FormulaPlain> : null}
              {block.bullets ? (
                <ul className="list-disc pl-5 space-y-1 text-xs leading-relaxed text-zinc-600">
                  {block.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ),
        )}
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
            `因子「${displayName ?? factorKey}」暂无单独整理公式。实现见 lib/server/futures-style-factors.ts。`,
          ],
        },
      ],
    }
  }

  const dataBullets = help.dataSources.map((d) => `${d.input}：${d.source}`)

  return {
    title,
    summary: help.summary,
    blocks: [
      {
        title: "数据来源",
        bullets: dataBullets,
      },
      {
        title: "设计逻辑",
        paragraphs: help.designLogic,
      },
      {
        title: "计算公式",
        latex: help.latex,
      },
      {
        title: "持仓 / 换仓",
        bullets: help.holdingRebal,
      },
      {
        title: "校准目标",
        paragraphs: [help.calibTarget],
      },
      ...(help.researchNote
        ? [
            {
              title: "研发备注",
              paragraphs: [help.researchNote],
              collapsible: true,
            } satisfies HelpBlock,
          ]
        : []),
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
      {blocks.map((block) =>
        block.collapsible && block.paragraphs?.[0] ? (
          <CollapsibleNote key={block.title} title={block.title} body={block.paragraphs.join("\n")} />
        ) : (
          <section key={block.title} className="space-y-1.5">
            <h4 className="text-xs font-semibold text-zinc-800">{block.title}</h4>
            {block.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="text-xs leading-relaxed text-zinc-600">
                {paragraph}
              </p>
            ))}
            {block.latex?.map((m) => (
              <LatexBlock key={m} math={m} />
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
        ),
      )}
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
