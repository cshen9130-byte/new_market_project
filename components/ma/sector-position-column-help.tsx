"use client"

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

function Latex({ math }: { math: string }) {
  const html = useMemo(
    () => katex.renderToString(math, { throwOnError: false, displayMode: true, strict: "ignore", trust: false }),
    [math],
  )
  return (
    <div
      className="overflow-x-auto rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 [&_.katex-display]:m-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

type Block = { title: string; body: string }
type Formula = { lead: string; latex: string }
type Topic = { key: string; name: string; blocks: Block[]; formulas: Formula[] }

const TOPICS: Topic[] = [
  {
    key: "group",
    name: "板块",
    blocks: [
      { title: "这一列是什么", body: "当前选中的分组。大类是商品、股指、国债。板块是农产、能源化工、黑色这一层。细分是油脂油料、烯烃这一层。后面每一列都按这一组汇总。" },
      { title: "和持仓的关系", body: "换分组只改怎么加总，不改总规模。总规模是整本产品的累计资本，筛选量化或主观时持仓会变，总规模仍是整本产品。" },
    ],
    formulas: [
      { lead: "表上的分组跟着上面的按钮走。", latex: String.raw`\text{分组}=\text{大类、板块或细分板块}` },
    ],
  },
  {
    key: "longMv",
    name: "多头市值",
    blocks: [
      { title: "这一列是什么", body: "该组买持仓的市值合计，单位元。同一组里的多头相加，不和空头对冲。" },
      { title: "怎么读", body: "它回答这块买了多少，不回答方向还剩多少，也不回答风险占多少。" },
    ],
    formulas: [
      { lead: "多头市值把该组每一笔买持仓加起来。", latex: String.raw`L=\sum \text{买持仓市值}` },
    ],
  },
  {
    key: "longPct",
    name: "多头占比",
    blocks: [
      { title: "这一列是什么", body: "多头市值除以总规模。总规模是报告抬头的累计资本，不是本组轧差，也不是多空市值合计。" },
      { title: "怎么读", body: "各组多头占比可以加起来远超 100%。持仓用杠杆，多头市值合计可以大于总规模。" },
    ],
    formulas: [
      { lead: "分母是整本产品的总规模。", latex: String.raw`\text{多头占比}=\dfrac{L}{\text{总规模}}` },
    ],
  },
  {
    key: "shortMv",
    name: "空头市值",
    blocks: [
      { title: "这一列是什么", body: "该组卖持仓的市值合计。表上取绝对值，所以显示为正数。" },
      { title: "怎么读", body: "空头市值大，只说明卖着的名义大。和多头对掉多少，要看轧差两列。" },
    ],
    formulas: [
      { lead: "计算时用正数，颜色不跟着空头走。", latex: String.raw`S=\left|\sum \text{卖持仓市值}\right|` },
    ],
  },
  {
    key: "shortPct",
    name: "空头占比",
    blocks: [
      { title: "这一列是什么", body: "空头市值除以同一个总规模。和多头占比共用分母。" },
      { title: "怎么读", body: "多头占比和空头占比接近，说明两边名义差不多，还不能说明轧完以后敞口小。直接轧差会把两边减掉，相关轧差只按相关系数减掉一部分。" },
    ],
    formulas: [
      { lead: "分母仍是总规模。", latex: String.raw`\text{空头占比}=\dfrac{S}{\text{总规模}}` },
    ],
  },
  {
    key: "directMv",
    name: "直接轧差市值",
    blocks: [
      { title: "这一列是什么", body: "多头市值减去空头市值。正数是净多，负数是净空，蓝橙色跟着这个符号。不同品种在这一步会互相减掉，等于假设它们是同一个合约。" },
      { title: "合计", body: "合计行是各行绝对值之和，不是把全表再轧成一个净额。所以合计可以大于任何一行。" },
    ],
    formulas: [
      { lead: "直接轧差不看品种之间的相关性。", latex: String.raw`N=L-S` },
      { lead: "合计把每一行的绝对值加起来。", latex: String.raw`\text{合计}=\sum |N|` },
    ],
  },
  {
    key: "directPct",
    name: "直接轧差占比",
    blocks: [
      { title: "这一列是什么", body: "直接轧差市值的绝对值除以总规模。占比本身不带负号，方向看左边的市值列。" },
      { title: "怎么读", body: "这一列小，只说明方向轧完以后的净额小。能源化工多头和空头都在一个亿以上，直接轧差可以只剩六百多万。那六百多万不是这块仓位的风险大小。" },
    ],
    formulas: [
      { lead: "占比用绝对值，所以没有负号。", latex: String.raw`\text{直接轧差占比}=\dfrac{|N|}{\text{总规模}}` },
    ],
  },
  {
    key: "corrMv",
    name: "相关轧差市值",
    blocks: [
      { title: "这一列是什么", body: "同一品种的多头和空头先合成一个净市值，多头为正、空头为负。不同品种再按最近 252 个交易日的收益率相关轧在一起。相关等于 1 时，结果等于直接轧差。相关低于 1 时，对冲两边不会全部抵消，绝对值会大于直接轧差；同向持仓不会全部叠加，绝对值会小于直接相加。" },
      { title: "符号", body: "符号仍跟着各品种净市值之和，用来表示净多还是净空。净额恰好为 0 时，保留正的幅度：对冲剩下的价差敞口不是 0。" },
      { title: "合计", body: "合计仍是各行绝对值之和。板块和板块之间没有再做一次相关轧差。用直接轧差和平均相关快估这一列，见左边「快估相关轧差」。" },
    ],
    formulas: [
      { lead: "MV 是品种净市值。ρ 是 252 日收益率相关。", latex: String.raw`E=\operatorname{sign}\!\left(\sum_i MV_i\right)\times\sqrt{\sum_i\sum_j MV_i\,MV_j\,\rho_{ij}}` },
      { lead: "所有相关系数都是 1 时，根号里面只剩下净额。", latex: String.raw`\rho_{ij}=1 \Rightarrow E=\sum_i MV_i=N` },
    ],
  },
  {
    key: "corrPct",
    name: "相关轧差占比",
    blocks: [
      { title: "这一列是什么", body: "相关轧差市值的绝对值除以总规模。它是折成市值以后的敞口占比，还不是风险贡献占比。" },
      { title: "怎么读", body: "2026-11-18 能源化工直接轧差占比 8.6%，相关轧差占比 16.0%。股指两个口径几乎一样，6.8% 和 6.9%，因为股指品种彼此高度同向。" },
    ],
    formulas: [
      { lead: "分母仍是总规模。", latex: String.raw`\text{相关轧差占比}=\dfrac{|E|}{\text{总规模}}` },
    ],
  },
  {
    key: "mktVol",
    name: "板块市场波动",
    blocks: [
      { title: "这一列是什么", body: "这个板块的市场本身最近 20 个交易日收益率的样本标准差，再乘 √252，写成百分数。它不看本组合持了多少。" },
      { title: "用哪条价格", body: "农产、能源化工、黑色、贵金属、新能源、有色，以及大类里的商品，用南华指数。其余分组用该组主力合约等权。" },
      { title: "可以换成平均相关", body: "表上方的「平均相关」把这一列换成该组持仓品种的两两相关系数。市场波动看的是板块指数，平均相关看的是本组合拿着的品种彼此有多同向。" },
    ],
    formulas: [
      { lead: "20 日样本标准差，年化。", latex: String.raw`\text{板块市场波动}=\operatorname{Std}_{20}(r^{\text{市场}})\times\sqrt{252}` },
    ],
  },
  {
    key: "avgCorr",
    name: "板块内品种平均相关",
    blocks: [
      { title: "这一列是什么", body: "当前分组里，本组合持有的品种两两之间的相关系数，再求平均。点表上方的「平均相关」，这一列替换板块市场波动。大类、板块、细分都按当前分组计算。" },
      { title: "怎么加权", body: "每一对的权重是两个品种绝对市值的乘积。大的持仓比小的持仓更影响这个平均数。同一品种的多空先合成一个净市值，再和别的品种算相关。对角线不进入平均。" },
      { title: "只有一个品种", body: "没有第二对可以配对时显示 —。航运往往只有一个品种，所以是 —。ρ 用最近 252 个交易日收益率，和相关轧差、风险贡献是同一套相关。" },
    ],
    formulas: [
      { lead: "i < j 只数每一对一次。", latex: String.raw`\bar\rho_s=\dfrac{\sum_{i<j}|MV_i|\,|MV_j|\,\rho_{ij}}{\sum_{i<j}|MV_i|\,|MV_j|}` },
    ],
  },
  {
    key: "holdVol",
    name: "板块持仓波动",
    blocks: [
      { title: "这一列是什么", body: "先把同品种多空合成净市值，再按市值的绝对值加权，合成一条收益率，取持仓日之前 20 个交易日的样本标准差，乘 √252。" },
      { title: "它不因对冲变小", body: "空头和多头都按正的权重进入。所以这是持仓品种本身的波动百分比，不是轧完以后的盈亏波动，也不随账面大小放大。能化 35.4%、农产 9.4%，只说明两边拿着的品种波动差了大约 3.8 倍。" },
    ],
    formulas: [
      { lead: "权重是绝对市值，不是带符号的净市值。", latex: String.raw`r_{s,t}=\sum_i \dfrac{|MV_i|}{\sum_k |MV_k|}\,r_{i,t}` },
      { lead: "年化以后写在表上。", latex: String.raw`\sigma_s=\operatorname{Std}_{20}(r_s)\times\sqrt{252}` },
    ],
  },
  {
    key: "rc",
    name: "风险贡献占比",
    blocks: [
      { title: "这一列是什么", body: "每个品种先做美元波动 dv = σ × 品种净市值。再乘上它和组合里所有品种的协方差，得到边际方差。板块把这些边际方差的绝对值加起来，除以全组合的绝对值合计。" },
      { title: "为什么取绝对值", body: "这一列回答风险库存落在哪个板块。它不会因为该板块和其他板块对冲而变成负数。56.5% 不是说净值的 56% 押了单边方向。" },
      { title: "和轧差的差别", body: "直接轧差先把整个板块减成一个净额。相关轧差按相关把板块收成一个净额。风险贡献在品种之间只按相关抵消一部分，然后每个品种的绝对值仍然相加。所以净额小的板块，风险贡献仍然可以很大。" },
    ],
    formulas: [
      { lead: "σ 用该品种最近 20 日收益率，ρ 用 252 日。", latex: String.raw`dv_i=\sigma_i\times MV_i` },
      { lead: "边际方差里，敞口和波动各出现两次。", latex: String.raw`mvc_i=dv_i\sum_j dv_j\,\rho_{ij}` },
      { lead: "表上的占比是绝对值份额。", latex: String.raw`\text{风险贡献占比}_s=\dfrac{\sum_{i\in s}|mvc_i|}{\sum_k |mvc_k|}` },
    ],
  },
  {
    key: "fastNet",
    name: "快估相关轧差",
    blocks: [
      { title: "用哪几个数", body: "直接轧差 N，平均相关 ρ̄，再加上每个品种净市值的平方和 Q。多头市值和空头市值不要代进去。同一品种的多空在 N、Q 和 ρ̄ 里都已经轧掉，相关按 1 处理。" },
      { title: "公式", body: "把每一对的相关系数都换成这一个平均数。相关等于 1 时，开方回到直接轧差。只有一个品种时 Q = N²，平均相关用不上，两列相等。符号跟着直接轧差。" },
      { title: "2026-11-18 农产，四个大品种", body: "单位用万元。豆粕 +2,492，白糖 +1,531，豆油 +687，菜粕 −1,280。直接轧差 2,492 + 1,531 + 687 − 1,280 = 3,430。平方和 2,492² + 1,531² + 687² + 1,280² = 10,664,394。平均相关 0.35。0.35 × 3,430² + 0.65 × 10,664,394 = 11,049,571，开方是 3,324 万。" },
      { title: "放回整个板块", body: "14 个品种都放进去，N = 3,227 万，Q = 1.122×10¹⁵ 元²，ρ̄ = 0.35，快估 3,307 万。表上相关轧差 3,120 万，直接轧差 3,227 万。能化 N = −657 万，ρ̄ = 0.63，平方和仍然很大，快估绝对值 1,464 万。表上 1,226 万，直接轧差只有 657 万。" },
      { title: "多头和空头不能当两笔", body: "√(多头² + 空头² − 2 × ρ̄ × 多头 × 空头) 会把同一品种的对冲也乘上 0.35。农产多头 1.355 亿、空头 1.033 亿，这样算出 1.387 亿，大约是表上相关轧差的 4.4 倍。里面各有约 8,050 万是同一品种，不应该按板块平均相关再拆开。" },
      { title: "和表上的差别", body: "快估用一个 ρ̄ 代替每一对。农产同向品种的加权平均相关是 0.33，反向是 0.38，所以 3,307 万比表上 3,120 万高一截。能化 1,464 万比表上 1,226 万高。只拿直接轧差和平均相关、不拿平方和，结果可以停在直接轧差，也可以比它大很多，两种都对得上公式。" },
    ],
    formulas: [
      { lead: "Q 是品种净市值的平方和。ρ̄ 是板块内品种平均相关。", latex: String.raw`|E|\approx\sqrt{\bar\rho\,N^{2}+(1-\bar\rho)\,Q}` },
      { lead: "每一对都用同一个 ρ̄ 时，这是从直接轧差推过来的。", latex: String.raw`N^{2}=Q+2\sum_{i<j}MV_i MV_j` },
      { lead: "交叉项乘上 ρ̄，再并回平方和。", latex: String.raw`E^{2}=Q+2\bar\rho\sum_{i<j}MV_i MV_j=\bar\rho\,N^{2}+(1-\bar\rho)\,Q` },
      { lead: "四个大品种，万元。3,430 的平方是 11,764,900。", latex: String.raw`0.35\times 3430^{2}+0.65\times 10\,664\,394=11\,049\,571` },
      { lead: "开方得到 3,324 万。", latex: String.raw`\sqrt{11\,049\,571}=3\,324` },
      { lead: "多头和空头直接代入，农产会得到 1.387 亿。", latex: String.raw`\sqrt{L^{2}+S^{2}-2\times 0.35\times L\times S}=1.387\times 10^{8}` },
    ],
  },
  {
    key: "fast",
    name: "快估风险贡献",
    blocks: [
      { title: "用哪两列", body: "用每一行的相关轧差占比和板块持仓波动。直接轧差占比会把跨品种对冲当成完全抵消，不能拿来估风险贡献。板块市场波动不看本组合的持仓结构。结果是份额，所以每一行都要算，不能只看一行。" },
      { title: "每一行先乘一次", body: "分数 s = 相关轧差占比 × 板块持仓波动。表上两个都是百分数，百分号先不除。能化 16.0 × 35.4 = 566.4。这一步是敞口乘一次波动。" },
      { title: "平方以后除以全体平方和", body: "风险贡献是方差份额，敞口和波动还要再出现一次。本行分数的平方，除以所有行分数的平方和，就是这一行的快估占比。" },
      { title: "2026-11-18 能化", body: "十行分数：能化 566.4，农产 381.6，黑色 282.5，股指 224.2，生鲜 223.6，贵金属 219.8，新能源 58.1，有色 56.2，国债 18.4，航运 8.4。平方和 701,752。能化 566.4 的平方是 320,809，320,809 / 701,752 = 45.7%。表上是 56.5%。农产同样算法是 20.8%，表上是 23.4%。" },
      { title: "只比两行时", body: "分母相同，比值就是两个分数之比再平方。(566.4 / 381.6)² = 2.20。表上 56.5 / 23.4 = 2.41。16% × 3.77 = 60.3% 不是能化的风险贡献，那一步还没有平方，也没有除以全体平方和。" },
      { title: "和表上还差一截", body: "快估把一个板块收成一个净额，并先不管板块之间的相关。表上把每个品种的边际方差绝对值相加，还带上和其他板块的协方差。能化快估 45.7%，表上 56.5%。黑色快估 11.4%，表上 5.0%。" },
      { title: "推导：根号用一次，平方再用一次", body: "相关轧差市值 E 里面有一个根号。ΣᵢΣⱼ MVᵢ MVⱼ ρᵢⱼ 的单位是元的平方。开方以后回到元，才能和总规模相除，得到占比 p。相关系数全是 1 时，根号里面是净额的平方，开方回到直接轧差。根号的作用是把相关二次型变回敞口，不是风险贡献本身的运算。" },
      { title: "平方从美元波动来", body: "把一个板块收成一笔仓以后，美元波动 dv = σ × E。边际方差是这笔美元波动再乘一次自己，所以是 (σ E)²。方差的单位是元的平方。风险贡献占比是方差除以方差。总规模在分子分母各出现两次，约掉以后只剩下 s² / Σ s²。这里用平方。再开一次方会退回美元波动之比：能化对农产是 1.48，表上的风险贡献之比是 2.41。" },
      { title: "误差出在三处替换", body: "第一，一个净额 E 代替了板块里每个品种。表上是各品种 |边际方差| 相加。能化内部对冲不完全，加总大于这一个净额的方差，所以 45.7% 低于表上 56.5%。第二，平方那一步把板块之间的相关设成 0，丢掉了 dvₛ 和其他板块的协方差。黑色单独的 dv² 不小，放进全组合以后边际方差更小，所以快估 11.4% 高于表上 5.0%。第三，σ 用的是绝对市值加权的板块持仓波动，不是每个品种自己的 σ。权重用市值绝对值，对冲不会把这个百分比压低。能化品种自身的平均波动大约 41%，表上是 35.4%。" },
    ],
    formulas: [
      { lead: "p 是相关轧差占比，σ 是板块持仓波动。百分号先不除。", latex: String.raw`s_i=p_i\times\sigma_i` },
      { lead: "这一行的快估风险贡献。", latex: String.raw`\widehat{\text{风险贡献占比}}_i=\dfrac{s_i^{2}}{\sum_j s_j^{2}}` },
      { lead: "2026-11-18，能化这一行。", latex: String.raw`16.0\times 35.4=566.4` },
      { lead: "566.4 的平方，除以十个板块的平方和。", latex: String.raw`\dfrac{566.4^{2}}{701\,752}=45.7\%` },
      { lead: "表上的能化是 56.5%。", latex: String.raw`\text{表上}=56.5\%` },
      { lead: "只比较能化和农产时，平方和约掉。", latex: String.raw`\left(\dfrac{566.4}{381.6}\right)^{2}=2.20` },
      { lead: "根号在相关轧差里。里面是元²，开方回到元。", latex: String.raw`E_s=\operatorname{sign}\!\left(\sum_i MV_i\right)\times\sqrt{\sum_i\sum_j MV_i\,MV_j\,\rho_{ij}}` },
      { lead: "美元波动只乘一次波动。", latex: String.raw`dv_s=\sigma_s E_s` },
      { lead: "板块之间的相关先取 0，边际方差就是美元波动的平方。", latex: String.raw`mvc_s\approx dv_s^{2}=(\sigma_s E_s)^{2}` },
      { lead: "总规模约掉。p = |E| / 总规模，s = p × σ。", latex: String.raw`\dfrac{(\sigma_s E_s)^{2}}{\sum_k(\sigma_k E_k)^{2}}=\dfrac{s_s^{2}}{\sum_k s_k^{2}}` },
      { lead: "真实边际方差还多一项：和其余板块的协方差。", latex: String.raw`mvc_s=dv_s^{2}+dv_s\sum_{k\neq s}dv_k\,\rho_{sk}` },
      { lead: "若在份额上再开方，得到的是美元波动之比 1.48。", latex: String.raw`\sqrt{\dfrac{s_A^{2}}{s_B^{2}}}=\dfrac{s_A}{s_B}=1.48` },
    ],
  },
]

function clampDialogOffset(el: HTMLElement, x: number, y: number) {
  const w = el.offsetWidth
  const h = el.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const edge = 72
  return {
    x: Math.min((vw + w) / 2 - edge, Math.max(edge - (vw + w) / 2, x)),
    y: Math.min((vh + h) / 2 - 48, Math.max(-(vh - h) / 2, y)),
  }
}

export function SectorColumnHelpButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(TOPICS[0].key)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const topic = TOPICS.find((item) => item.key === active) ?? TOPICS[0]

  function startDrag(clientX: number, clientY: number, dialog: HTMLElement, kind: "pointer" | "mouse") {
    const start = { x: clientX, y: clientY, ox: offset.x, oy: offset.y }
    drag.current = { x: clientX, y: clientY, ox: offset.x, oy: offset.y }
    const moveName = kind === "pointer" ? "pointermove" : "mousemove"
    const upName = kind === "pointer" ? "pointerup" : "mouseup"
    const move = (event: Event) => {
      const point = event as MouseEvent
      setOffset(clampDialogOffset(dialog, start.ox + point.clientX - start.x, start.oy + point.clientY - start.y))
    }
    const up = () => {
      drag.current = null
      window.removeEventListener(moveName, move)
      window.removeEventListener(upName, up)
    }
    window.addEventListener(moveName, move)
    window.addEventListener(upName, up)
  }

  function onTitlePointerDown(event: ReactPointerEvent<HTMLHeadingElement>) {
    if (event.button !== 0) return
    const dialog = event.currentTarget.closest("[data-slot='dialog-content']")
    if (!(dialog instanceof HTMLElement)) return
    startDrag(event.clientX, event.clientY, dialog, "pointer")
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
  }

  function onTitleMouseDown(event: React.MouseEvent<HTMLHeadingElement>) {
    if (event.button !== 0 || drag.current) return
    const dialog = event.currentTarget.closest("[data-slot='dialog-content']")
    if (!(dialog instanceof HTMLElement)) return
    startDrag(event.clientX, event.clientY, dialog, "mouse")
  }

  return (
    <>
      <button
        type="button"
        aria-label="各列怎么算"
        onClick={() => {
          setOffset({ x: 0, y: 0 })
          setOpen(true)
        }}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-input text-[11px] font-medium leading-none text-muted-foreground hover:bg-muted hover:text-foreground ${className}`}
      >
        ?
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[min(90vh,920px)] w-full max-w-[min(1080px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1080px,calc(100vw-2rem))]"
          style={{ translate: `calc(-50% + ${offset.x}px) calc(-50% + ${offset.y}px)` }}
        >
          <DialogTitle
            className="cursor-grab touch-none border-b border-zinc-200 px-5 py-3 pr-12 text-base select-none active:cursor-grabbing dark:border-zinc-800"
            onPointerDown={onTitlePointerDown}
            onMouseDown={onTitleMouseDown}
          >
            板块持仓分析怎么算
          </DialogTitle>
          <DialogDescription className="sr-only">各列定义、计算公式，以及用相关轧差和持仓波动估算风险贡献</DialogDescription>
          <div className="flex min-h-0 flex-1">
            <aside className="w-44 shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              {TOPICS.map((item) => {
                const on = item.key === topic.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActive(item.key)}
                    className={[
                      "block w-full px-3 py-2 text-left text-sm",
                      on
                        ? "bg-white font-medium text-red-600 dark:bg-zinc-950 dark:text-red-400"
                        : "text-zinc-600 hover:bg-white/70 dark:text-zinc-300 dark:hover:bg-zinc-950/60",
                    ].join(" ")}
                  >
                    {item.name}
                  </button>
                )
              })}
            </aside>
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{topic.name}</h3>
              {topic.blocks.map((block) => (
                <section key={block.title} className="mt-4">
                  <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{block.title}</h4>
                  <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{block.body}</p>
                </section>
              ))}
              <section className="mt-4 space-y-3">
                {topic.formulas.map((formula) => (
                  <div key={formula.latex}>
                    <p className="mb-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{formula.lead}</p>
                    <Latex math={formula.latex} />
                  </div>
                ))}
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
