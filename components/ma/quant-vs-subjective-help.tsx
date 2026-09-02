"use client"

import type { ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ExposureMetric } from "@/lib/ma/quant-vs-subjective-signals"

function Formula({ children }: { children: ReactNode }) {
  return (
    <p className="rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground leading-snug">
      {children}
    </p>
  )
}

export function ChartHelp({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${title} 计算说明`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-input text-[11px] font-medium leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-[22rem] max-h-[70vh] overflow-y-auto text-xs leading-relaxed"
      >
        <div className="text-sm font-medium text-foreground mb-2">{title}</div>
        <div className="space-y-2 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

function MetricNote({ metric }: { metric: ExposureMetric }) {
  return metric === "risk" ? (
    <p>当前开关是<strong className="text-foreground">风险敞口</strong>：图上的数是风险%（可正可负）。</p>
  ) : (
    <p>当前开关是<strong className="text-foreground">保证金</strong>：图上的数是占用占比（≥ 0，本组内合计约 100%）。</p>
  )
}

function SharedDefs({ volDays }: { volDays: number }) {
  return (
    <>
      <p>量化 / 主观按本页右侧账户划分。同一品种不同合约先合成一个品种净仓。期权不计入。</p>
      <Formula>净市值 = 多头持仓市值 − 空头持仓市值</Formula>
      <Formula>σ = 近 {volDays} 日日收益标准差（换月跳空已剔除）</Formula>
      <Formula>品种净风险 = σ × 该品种净市值</Formula>
    </>
  )
}

export function HelpQuantMargin() {
  return (
    <ChartHelp title="量化保证金">
      <p>数字来自当日各量化账户日报的<strong className="text-foreground">保证金占用</strong>之和，不是客户权益。</p>
      <Formula>量化保证金 = Σ 量化账户「保证金占用」</Formula>
      <p>下方「占比」= 量化保证金 /（量化 + 主观）保证金。这是账户层实际占用，和板块图里的持仓保证金%分母可能略有差别（板块图不含期权）。</p>
    </ChartHelp>
  )
}

export function HelpSubjMargin() {
  return (
    <ChartHelp title="主观保证金">
      <p>数字来自当日各主观账户日报的<strong className="text-foreground">保证金占用</strong>之和。</p>
      <Formula>主观保证金 = Σ 主观账户「保证金占用」</Formula>
      <p>占比 = 主观保证金 /（量化 + 主观）保证金。</p>
    </ChartHelp>
  )
}

export function HelpConsensusKpi() {
  return (
    <ChartHelp title="共识加码信号">
      <p>统计决策信号里动作为「加码」的条数（板块 + 品种）。始终按<strong className="text-foreground">风险%</strong>判断，与保证金开关无关。</p>
      <p>先要存量同向：量化与主观风险% <strong className="text-foreground">同号</strong>，且两边绝对值都 ≥ 3%。再看主动调仓：1 日两边都在加该方向，或调仓不够大，或 1 日背离/同减但 5 日仍同加，才记加码。</p>
      <p>两边都 ≥ 8% 为强共识；合计 ≥ 25% 改记「控拥挤」。存量同向但边际反向记「暂缓加码」；两侧都在减记「减码准备」——都不计入本数字。</p>
    </ChartHelp>
  )
}

export function HelpMarginKpi() {
  return (
    <ChartHelp title="暂缓加码 / 减码准备">
      <p>这两项都是从「存量同向共识」里拆出来的，始终按风险%。存量仍同向（两边 |风险%| ≥ 3%），但主动调仓不再同向加仓，所以不再记「加码」。</p>
      <ul className="list-disc pl-4 space-y-1">
        <li><strong className="text-foreground">暂缓加码</strong>：1 日两边调仓方向相反（边际背离）。若 5 日仍是两边加仓，则仍记加码。</li>
        <li><strong className="text-foreground">减码准备</strong>：1 日两边都在减该方向。若 5 日仍是两边加仓，则仍记加码。</li>
      </ul>
      <Formula>主动调仓 = Δ手数 × 当日价（不含价格涨跌）</Formula>
      <p>变动需大约 ≥ 100 万且 ≥ 仓位的 5% 才算有效调仓。两边 |风险%| 之和 ≥ 25% 仍记控拥挤，不进这两个数字。</p>
    </ChartHelp>
  )
}

export function HelpDivKpi() {
  return (
    <ChartHelp title="方向分歧信号">
      <p>统计决策信号里动作为「观望」的条数。始终按风险%。</p>
      <p>计入条件：量化与主观风险% <strong className="text-foreground">异号</strong>，且两边绝对值都 ≥ 3%。这是存量方向相反，和「暂缓加码」（存量同向、边际反向）不是一类。</p>
    </ChartHelp>
  )
}

export function HelpSignals() {
  return (
    <ChartHelp title="MOM 决策信号">
      <p>只用风险%生成，不随「保证金」开关改变。存量阈值：</p>
      <ul className="list-disc pl-4 space-y-1">
        <li>加码：同向，两边 |风险%| ≥ 3%，且边际同向加仓（两边 ≥ 8% 为重仓共识）</li>
        <li>暂缓加码：存量同向，但 1 日主动调仓反向（5 日仍同加则维持加码）</li>
        <li>减码准备：存量同向，且 1 日两边都在减（5 日仍同加则维持加码）</li>
        <li>观望：反向，两边 |风险%| ≥ 3%</li>
        <li>补风格：一侧 ≥ 8%，另一侧 &lt; 1.5%</li>
        <li>控拥挤：同向且两边 |风险%| 之和 ≥ 25%</li>
        <li>扩容：量化户数占比 vs 量化保证金占比差得太大</li>
      </ul>
      <p>主动调仓 = 手数变化 × 当日价，不含涨跌。每条信号会对比<strong className="text-foreground">上一交易日</strong>：新增、动作变化（如观望→加码）、或维持。下方「已消失」是昨日在名单里、今日掉出阈值或未进前 18 的条目。</p>
      <p>表格按列拆开动作、板块/品种、方向解读、两侧风险%、边际标签、账户广度和强弱。长句解读、调仓金额放在悬停框里。点选截面日期可看任意历史日；点信号历史图上的日期也会跳转。点击板块/品种信号会筛下方多空持仓图。</p>
    </ChartHelp>
  )
}

export function HelpPie() {
  return (
    <ChartHelp title="资金在量化 / 主观之间的分配">
      <p>饼图用账户日报<strong className="text-foreground">保证金占用</strong>，不是名义市值、也不是客户权益。</p>
      <Formula>量化扇区 = Σ 量化账户保证金占用</Formula>
      <Formula>主观扇区 = Σ 主观账户保证金占用</Formula>
      <p>拖动右侧账户会重算全页。这是两组之间的资金切分；板块里的保证金%是<strong className="text-foreground">组内</strong>各板块怎么分。</p>
    </ChartHelp>
  )
}

export function HelpSectorBar({ metric, volDays }: { metric: ExposureMetric; volDays: number }) {
  return (
    <ChartHelp title="板块风险敞口：量化 vs 主观">
      <MetricNote metric={metric} />
      <SharedDefs volDays={volDays} />
      <p>板块净风险 = 该板块内各品种净风险相加（品种间多空可以对冲）。</p>
      <Formula>本组风险预算 = Σ |品种净风险|</Formula>
      <Formula>风险% = 板块净风险 / 本组风险预算</Formula>
      <Formula>保证金% = 该板块持仓保证金 / 本组持仓保证金合计</Formula>
      <p>风险%可超过 ±100% 吗？一般不会很大，因为分母是全组 |风险| 之和；单板块净方向风险是其中一块。保证金%在组内合计约 100%，多空都计、没有正负。</p>
      <p>悬停同时给出风险%和保证金%。量化柱和主观柱分母不同，不能加总。</p>
    </ChartHelp>
  )
}

export function HelpScatter({ metric, volDays, level }: { metric: ExposureMetric; volDays: number; level: "板块" | "品种" }) {
  return (
    <ChartHelp title={`${level}方向共识散点`}>
      <MetricNote metric={metric} />
      <SharedDefs volDays={volDays} />
      <p>每个点一个{level}。横轴 = 量化%、纵轴 = 主观%。点的大小与两边占全书的比重有关。点的颜色始终按<strong className="text-foreground">风险方向</strong>（共识做多/做空/分歧等）。</p>
      {metric === "risk" ? (
        <p>第一象限共识做多，第三象限共识做空，第二、四象限为分歧。</p>
      ) : (
        <p>保证金视图坐标都 ≥ 0：右上两边都配得多，靠右轴仅量化，靠上轴仅主观。</p>
      )}
    </ChartHelp>
  )
}

export function HelpFlowScatter({ level }: { level: "板块" | "品种" }) {
  return (
    <ChartHelp title={`${level}边际散点`}>
      <p>看的是<strong className="text-foreground">主动调仓</strong>，不是存量风险%。每个点一个{level}。</p>
      <Formula>主动调仓 = Δ手数 × 当日价（万元；不含价格涨跌）</Formula>
      <p>横轴 = 量化 1 日主动调仓，纵轴 = 主观。点的大小按两边存量风险%之和；颜色是边际标签（同向加仓 / 同向减仓 / 边际背离等）。</p>
      <p>第一象限两边加多；第三象限两边减多；第二、四象限一边加一边减，即边际背离。悬停还给出 5 日主动调仓；减仓侧会标止损撤退或获利了结。</p>
    </ChartHelp>
  )
}

export function HelpProductBar({ metric, volDays }: { metric: ExposureMetric; volDays: number }) {
  return (
    <ChartHelp title="品种风险敞口对比">
      <MetricNote metric={metric} />
      <SharedDefs volDays={volDays} />
      <Formula>风险% = 该品种净风险 / 本组风险预算</Formula>
      <Formula>保证金% = 该品种持仓保证金 / 本组持仓保证金合计</Formula>
      <p>排序按 |量化%| + |主观%|。悬停里的年化波动 = σ × √252。</p>
    </ChartHelp>
  )
}

export function HelpTs({ metric, volDays, level }: { metric: ExposureMetric; volDays: number; level: "板块" | "品种" }) {
  return (
    <ChartHelp title={`${level}风险敞口时序`}>
      <MetricNote metric={metric} />
      <SharedDefs volDays={volDays} />
      <p>每天用当天持仓和当天 σ 重算，口径与上方截面图最后一天对齐。</p>
      {metric === "risk" ? (
        <Formula>{level}风险% = 当天该{level}净风险 / 当天本组风险预算</Formula>
      ) : (
        <Formula>{level}保证金% = 当天该{level}持仓保证金 / 当天本组持仓保证金</Formula>
      )}
      <p>风险%可正可负。保证金% ≥ 0，同一天各{level}加总约 100%。</p>
    </ChartHelp>
  )
}

export function HelpSectorTable({ volDays }: { volDays: number }) {
  return (
    <ChartHelp title="板块对照表">
      <SharedDefs volDays={volDays} />
      <Formula>量化风险% = 该板块净风险 / 量化风险预算</Formula>
      <Formula>主观风险% = 该板块净风险 / 主观风险预算</Formula>
      <Formula>保证金% = 该板块持仓保证金 / 该组持仓保证金合计</Formula>
      <p>解读列按风险方向：同向且都大 = 共识；反向且都大 = 方向分歧。量化各板块保证金%加总约 100%，主观同理；两边不要加在一起。</p>
    </ChartHelp>
  )
}

export function HelpProductTable({ volDays }: { volDays: number }) {
  return (
    <ChartHelp title="品种对照表">
      <SharedDefs volDays={volDays} />
      <Formula>年化波动 = σ × √252</Formula>
      <Formula>风险% = 该品种净风险 / 本组风险预算</Formula>
      <Formula>保证金% = 该品种持仓保证金 / 本组持仓保证金合计</Formula>
      <p>国债等波动低时，同样保证金占比对应更小风险%。解读列同样按风险方向。</p>
    </ChartHelp>
  )
}

export function HelpBriefingMomSignals({ volDays = 20 }: { volDays?: number }) {
  return (
    <ChartHelp title="决策信号怎么算">
      <p>简报始终按<strong className="text-foreground">风险口径</strong>，量化 / 主观用默认账户划分。期权不计入。</p>
      <SharedDefs volDays={volDays} />
      <p>板块净风险 = 该板块内各品种净风险相加（板块内多空可以对冲）。量化、主观各自有一组风险预算，两边的%不能加总。</p>
      <Formula>本组风险预算 = Σ |品种净风险|</Formula>
      <Formula>风险% = 该板块净风险 / 本组风险预算　（正=净多，负=净空）</Formula>
      <p>板块表列出农产到国债共 10 个板块（不含「其他」）；未达阈值的记为「中性」，不从名单里拿掉。</p>
      <p>决策信号阈值（q = |量化风险%|，s = |主观风险%|）：</p>
      <ul className="list-disc pl-4 space-y-1">
        <li>加码：同向，且 q、s 都 ≥ 3%；1 日主动调仓同向加仓</li>
        <li>暂缓加码：存量同向，1 日主动调仓反向</li>
        <li>减码准备：存量同向，1 日两侧都在减</li>
        <li>观望：反向，且 q、s 都 ≥ 3%</li>
        <li>补风格：一侧 ≥ 8%，另一侧 &lt; 1.5%</li>
        <li>控拥挤：同向且 q + s ≥ 25%</li>
        <li>中性：其余（板块表列出，品种表不列）</li>
      </ul>
      <p>信号强弱分数（封顶 100）。book = 该板块占全书量化风险%绝对值 + 占全书主观风险%绝对值。</p>
      <Formula>控拥挤：q + s + book</Formula>
      <Formula>加码（两边都 ≥ 8%）：2 × min(q, s) + book</Formula>
      <Formula>加码（弱共识）：min(q, s) + 0.5 × book</Formula>
      <Formula>观望：1.5 × min(q, s) + book</Formula>
      <Formula>补风格：重仓一侧的 |风险%| + book</Formula>
      <Formula>中性：max(q, s)</Formula>
      <p>档位：分数 ≥ 20 为<strong className="text-foreground">强</strong>，≥ 8 为<strong className="text-foreground">中</strong>，其余为<strong className="text-foreground">弱</strong>。表上数字是这个分数取整。</p>
      <p>解读列：共识做多 / 共识做空 / 方向分歧 / 仅量化 / 仅主观 / 共识但拥挤 / 中性。</p>
      <p>量化风贡 / 主观风贡的箭头是风险% 今减昨：↑ 更偏多（空得更少），↓ 更偏空（多得更少）。边际用同一组数字：两边变动同号才是同向加/减仓，异号是边际背离。</p>
      <p>量化户 / 主观户是手数调仓的账户数（加多 1/7 = 7 户里有 1 户加了多）。风贡% = 该板块净风险 / 该组风险预算，别人板块变大或波动变化也会让%下降，所以可以↓但户列为 —。</p>
    </ChartHelp>
  )
}

export function HelpHoldingBar({ metric, sleeve }: { metric: ExposureMetric; sleeve: "量化" | "主观" }) {
  return (
    <ChartHelp title={`${sleeve} · 多空持仓`}>
      <p>只含{sleeve}账户。筛选大类/板块/细分/品种后，只加总选中品种。</p>
      {metric === "risk" ? (
        <>
          <p>当前是风险口径：柱高 = 持仓市值 × 当天该品种 σ。</p>
          <Formula>多头柱 = Σ 多头市值 × σ</Formula>
          <Formula>空头柱 = −Σ 空头市值 × σ</Formula>
        </>
      ) : (
        <>
          <p>当前是市值口径：柱高是持仓名义市值（不是保证金占用）。</p>
          <Formula>多头柱 = Σ 多头持仓市值</Formula>
          <Formula>空头柱 = −Σ 空头持仓市值</Formula>
        </>
      )}
      <p>红线净持仓 = 多头合计 + 空头合计（空头已是负数）。未选板块时，按商品 / 股指 / 国债拆开堆叠。</p>
      <p>图下「市值 Δ」拆成主动调仓（手数变化 × 当日价）和价格损益。红线最后一跳可能只是价格，不一定是他们卖了。</p>
    </ChartHelp>
  )
}

export function HelpCandle({ sleeve }: { sleeve: "量化" | "主观" }) {
  return (
    <ChartHelp title={`${sleeve} · K线与累计盈亏`}>
      <p>需先选板块、细分或品种。单品种用该品种主力/连续价；板块或细分为成分等权合成指数。</p>
      <Formula>当日盈亏 = 昨日{sleeve}净市值 × 今日涨跌幅</Formula>
      <Formula>累计盈亏 = Σ 当日盈亏（从区间第一天起）</Formula>
      <p>用的是净名义市值，不是保证金、也不是 σ×市值。第一天没有昨收，当日盈亏记 0。</p>
      <p>下方色块是该板块/品种的 MOM 决策信号（加码/暂缓加码/减码准备/观望/补风格/控拥挤），与 K 线同一套日期、同一条缩放条。选板块只显示该板块一行；选品种只显示该品种；选细分则列出该细分下的品种。空白=当日未达阈值。</p>
      <p>「补风格」只画在空仓的那一侧：仅主观重仓（如菜籽粕 RM）出现在量化图；仅量化重仓出现在主观图。加码、暂缓加码、减码准备、观望、控拥挤两边都显示。</p>
      <p>悬停色块会标好/坏：加码按该侧当日净仓方向持有至该段信号结束，随后盈亏&gt;0 为好信号，亏损为坏信号。控拥挤按拥挤方向减仓：随后价格逆着该方向走（如净多后下跌）为好信号，顺着走为坏信号。补风格按应对齐的那一侧方向看随后涨跌。最后一天尚无后续行情则为待验证。</p>
    </ChartHelp>
  )
}

export function HelpWaterfall() {
  return (
    <ChartHelp title="边际拆解">
      <p>把筛选范围内（当前大类/板块/细分/品种）量化、主观的<strong className="text-foreground">净名义市值</strong>从昨收到今收拆开，不是保证金、也不是 σ×市值。</p>
      <Formula>净市值 = 多头持仓市值 − 空头持仓市值</Formula>
      <Formula>主动调仓 = Δ净手数 × 当日价</Formula>
      <Formula>价格损益 = 今净仓 − 昨净仓 − 主动调仓（含换月残差）</Formula>
      <Formula>昨净仓 + 价格损益 + 主动调仓 = 今净仓</Formula>
      <p>四根柱：昨净仓、价格损益、主动调仓、今净仓。蓝柱量化、橙柱主观。涨跌进「价格」；手数变化进「主动调仓」。多空持仓图上的红线最后一跳可能只是价格，这一栏才是手数变化。口径与边际散点、决策信号相同。</p>
    </ChartHelp>
  )
}

export function HelpSignalHistory() {
  return (
    <ChartHelp title="决策信号历史">
      <p>用近约 400 个交易日的板块/品种风险%（与时序图同一套数），按当日阈值重算信号，并用持仓手数重算边际动作。不含「扩容」（扩容要账户数，历史截面没有）。</p>
      <p>上图：每日各动作条数。下图：板块当日动作（空白=未达阈值）。点击日期或色块会切换上方截面。</p>
      <p>历史重算只用组内风险%，没有当日「占全书」权重，排序可能和当日快照的前 18 条略有差别。</p>
    </ChartHelp>
  )
}
