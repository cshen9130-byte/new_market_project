"use client"

import type { ReactNode } from "react"
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type ChartHelpId =
  | "iv-summary"
  | "iv-percentile-compare"
  | "qvix-history"
  | "series-iv-history"
  | "iv-percentile"
  | "iv-term"
  | "iv-smile"
  | "iv-smile-chain"
  | "iv-surface"
  | "iv-rv"
  | "peer-iv"
  | "skew-snapshot"
  | "skew-history"
  | "pcr-oi"
  | "pcr-history"
  | "term-slope"
  | "vol-cone"
  | "iv-heat"
  | "overview-vix"
  | "overview-pcr"
  | "overview-volume"
  | "overview-greeks"

type HelpSection = {
  title: string
  body: ReactNode
  formula?: ReactNode
}

type ChartHelpContent = {
  title: string
  summary: string
  sections: HelpSection[]
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1 text-foreground/90">
      {children}
    </div>
  )
}

export const CHART_HELP: Record<ChartHelpId, ChartHelpContent> = {
  "iv-summary": {
    title: "隐含波动率概览",
    summary: "按市值档 / 板块汇总各品种当前 ATM（或近月系列）隐含波动率及其历史分位。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            表格用于横向比较各标的期权的「贵贱」：当前 IV 反映市场对未来波动的定价，历史分位则说明该水平在样本期内处于什么位置。
            分位越高，相对历史越「贵」；越低则越「便宜」。
          </p>
        ),
      },
      {
        title: "当前 IV",
        body: (
          <p>
            金融期权取近月 ATM 隐含波动率指数（QVIX / ATM IV）；商品期权取交易所公布的近月系列隐含波动率。单位均为年化百分比。
          </p>
        ),
      },
      {
        title: "历史分位",
        body: (
          <p>
            用当日 IV 在该品种全历史 IV 序列中的百分位秩表示：有多少比例的历史交易日 IV 不高于今日。
          </p>
        ),
        formula: (
          <Formula>
            <div>Pct<sub>all</sub> = rank(IV<sub>t</sub>) / N × 100%</div>
            <div>评价：≥80% 偏高 · 60–80% 较高 · 40–60% 中性 · 20–40% 较低 · &lt;20% 偏低</div>
          </Formula>
        ),
      },
      {
        title: "分组",
        body: (
          <p>
            金融期权按小盘 / 中盘 / 大盘市值档归类；商品期权按农产品 / 黑色 / 有色 / 能化板块归类。多合约同一品种（如沪深两市 ETF）会合并展示，并在副行列出分项分位。
          </p>
        ),
      },
    ],
  },
  "iv-percentile-compare": {
    title: "全市场 IV 分位对比",
    summary: "将概览表中的全历史分位画成横向对比条，便于一眼看出谁相对更贵。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            横轴为 0–100% 的历史分位；条越长表示当前 IV 越接近该品种历史高位。背景色带对应小盘 / 中盘 / 大盘（或商品板块）分组。
          </p>
        ),
      },
      {
        title: "参考线",
        body: (
          <p>
            虚线标出 20%、50%、80% 分位。实务上常把 ≥80% 视为偏贵、≤20% 视为偏便宜；50% 为历史中枢。
          </p>
        ),
      },
      {
        title: "计算",
        body: <p>与「隐含波动率概览」同一套全历史分位（Pct<sub>all</sub>），仅做可视化对比，不引入新指标。</p>,
      },
    ],
  },
  "qvix-history": {
    title: "QVIX 时序",
    summary: "展示所选标的近约两年的 ATM 隐含波动率指数（QVIX）走势。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            QVIX 近似近月平值期权的隐含波动率，是该标的「期权市场定价的波动预期」。上升通常对应避险需求升温或对未来波动定价上调。
          </p>
        ),
      },
      {
        title: "如何读图",
        body: (
          <p>
            关注趋势、拐点与相对历史高低。与下方「IV 分位分析」对照：绝对水平（%）与相对分位（%）往往需同时看，才能判断贵贱。
          </p>
        ),
      },
    ],
  },
  "series-iv-history": {
    title: "系列 IV 时序",
    summary: "展示交易所公布的商品近月系列隐含波动率历史走势。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            商品期权使用交易所系列波动率（近月主力相关系列），代表市场对该品种近期波动的定价。与金融 QVIX 口径不同，但用途类似：跟踪波动定价水平变化。
          </p>
        ),
      },
      {
        title: "如何读图",
        body: (
          <p>
            结合下方分位图：高 IV 不一定「贵」，若分位仍低，可能只是该品种历史常态偏高；反之亦然。
          </p>
        ),
      },
    ],
  },
  "iv-percentile": {
    title: "IV 分位分析",
    summary: "把 IV 换算成相对历史与近一年的百分位，衡量「贵」还是「便宜」。",
    sections: [
      {
        title: "全历史分位",
        body: (
          <p>
            对截至当日的全部可用 IV 样本做百分位秩：今日 IV 高于历史上多少比例的交易日。
          </p>
        ),
        formula: (
          <Formula>
            <div>Pct<sub>all,t</sub> = |&#123;k ≤ t : IV<sub>k</sub> ≤ IV<sub>t</sub>&#125;| / t × 100%</div>
          </Formula>
        ),
      },
      {
        title: "1Y 滚动分位",
        body: (
          <p>
            仅在最近约 252 个交易日窗口内排名（最少约 60 日才开始计算），对近期体制变化更敏感。
          </p>
        ),
        formula: (
          <Formula>
            <div>Pct<sub>1Y,t</sub> = rank(IV<sub>t</sub> | 近 252 日) × 100%</div>
          </Formula>
        ),
      },
      {
        title: "如何读图",
        body: (
          <p>
            两条线接近且都高 → 中长期都偏贵；全历史高而 1Y 不高 → 长期偏贵但近期不算极端；反之则可能是短期升温。
          </p>
        ),
      },
    ],
  },
  "iv-term": {
    title: "IV 期限结构",
    summary: "各到期月（或合约系列）的 ATM 隐含波动率，刻画近远月波动定价差异。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            横轴多为到期天数 / 到期月，纵轴为对应 ATM IV。向上倾斜（远月更高）为典型 Contango；近月明显高于远月为 Backwardation，常伴随事件风险或短期恐慌。
          </p>
        ),
      },
      {
        title: "计算口径",
        body: (
          <p>
            每个到期取接近平值的期权隐含波动率（ATM）。金融期权按到期月截面；商品期权按各合约系列 ATM / 交易所系列波动率拼接。
          </p>
        ),
      },
    ],
  },
  "iv-smile": {
    title: "波动率微笑",
    summary: "近月虚值期权 IV 随行权价（或 moneyness）变化，反映尾部风险定价。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            若低行权价（Put 翼）IV 明显高于高行权价（Call 翼），市场更愿意为下行保护付费；两侧抬升则尾部风险整体定价更高。
          </p>
        ),
      },
      {
        title: "口径",
        body: (
          <p>
            取近月合约链上 OTM 点：行权价低于现货用 Put IV，高于现货用 Call IV，拼接成微笑曲线。
          </p>
        ),
      },
    ],
  },
  "iv-smile-chain": {
    title: "期权链微笑",
    summary: "近月整条期权链的 IV 与持仓量（OI）分布，把定价与仓位放在同一视野。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            IV 线展示微笑形状；持仓柱显示各行权价上 Call / Put 未平仓兴趣。IV 尖峰与 OI 堆积重叠处，常对应市场重点行权价或对冲密集区。
          </p>
        ),
      },
      {
        title: "如何读图",
        body: (
          <p>
            关注 ATM 附近是否平滑、Put/Call 翼是否不对称，以及最大 OI 行权价相对现货的位置（潜在支撑/阻力或到期轧空线索）。
          </p>
        ),
      },
    ],
  },
  "iv-surface": {
    title: "IV 波动率曲面（3D）",
    summary: "行权价 × 到期天数 × 隐含波动率的三维曲面，总览整条链的定价结构。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            把多个到期的微笑叠成曲面：可同时观察期限结构倾斜与微笑翼部形态。曲面「山谷」通常在 ATM 附近；翼部抬升表示尾部溢价。
          </p>
        ),
      },
      {
        title: "数据",
        body: (
          <p>
            由当日各到期、各行权价的隐含波动率网格插值 / 散点构成。缺失点可能因流动性不足而未报价。
          </p>
        ),
      },
    ],
  },
  "iv-rv": {
    title: "IV vs 实现波动率",
    summary: "比较期权隐含波动与标的实际已实现波动，衡量期权相对「贵」还是「便宜」。",
    sections: [
      {
        title: "实现波动率 (RV)",
        body: (
          <p>
            用标的日对数收益的滚动标准差年化得到。常用 20 日与 60 日窗口。
          </p>
        ),
        formula: (
          <Formula>
            <div>r<sub>d</sub> = ln(P<sub>d</sub> / P<sub>d−1</sub>)</div>
            <div>RV<sub>n</sub> = Std(r<sub>d−n+1…d</sub>) × √252 × 100%</div>
          </Formula>
        ),
      },
      {
        title: "溢价",
        body: (
          <p>
            IV − RV：&gt;0 表示隐含高于已实现（期权相对偏贵 / 波动风险溢价为正）；&lt;0 则隐含偏低。右轴通常展示该差值。
          </p>
        ),
      },
    ],
  },
  "peer-iv": {
    title: "同组 IV 对比",
    summary: "把同市值档或同板块品种的 IV 走势叠在一起，做相对价值比较。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            若某一品种 IV 相对同组持续偏高，可能存在结构性溢价或事件溢价；若突然偏离组内中枢，可关注均值回归或相对交易机会。
          </p>
        ),
      },
      {
        title: "分组",
        body: (
          <p>
            金融期权按小盘 / 中盘 / 大盘；商品期权按农产品 / 黑色 / 有色 / 能化。纵轴为 ATM / 系列 IV（%）。
          </p>
        ),
      },
    ],
  },
  "skew-snapshot": {
    title: "当日偏度结构",
    summary: "用 ±5% moneyness 翼部 IV 刻画 Risk Reversal 与 Butterfly。",
    sections: [
      {
        title: "翼部 IV",
        body: (
          <p>
            Put 翼：现货 × 0.95 处插值 IV；Call 翼：现货 × 1.05 处插值 IV；ATM 为现货附近 IV。
          </p>
        ),
      },
      {
        title: "Risk Reversal / Butterfly",
        body: <p>衡量下行相对上行的溢价，以及翼部相对 ATM 的凸性溢价。</p>,
        formula: (
          <Formula>
            <div>RR = IV<sub>put(−5%)</sub> − IV<sub>call(+5%)</sub></div>
            <div>Fly = ½(IV<sub>put</sub> + IV<sub>call</sub>) − IV<sub>ATM</sub></div>
          </Formula>
        ),
      },
      {
        title: "解读",
        body: (
          <p>
            RR &gt; 0：Put 翼更贵，市场更担忧下跌；Fly 升高：尾部两侧同时抬升，凸性（波动率微笑弯曲）加强。
          </p>
        ),
      },
    ],
  },
  "skew-history": {
    title: "偏度时序",
    summary: "Risk Reversal 与 Butterfly 的日度历史，观察偏度定价如何演变。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            由每日 ETL 沉淀截面偏度指标形成。样本初期可能仅有少量点，会随交易日累积变长。
          </p>
        ),
      },
      {
        title: "如何读图",
        body: (
          <p>
            RR 抬升常伴随避险需求；Fly 抬升说明微笑更「弯」。可与现货大跌、财报季或政策事件对照。
          </p>
        ),
      },
    ],
  },
  "pcr-oi": {
    title: "Put/Call OI",
    summary: "近月链上各行权价的 Call / Put 持仓量分布。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            持仓量反映未平仓兴趣。Put OI 堆积常被解读为下行保护或支撑相关行权价；Call OI 堆积则与上行阻力或备兑相关。
          </p>
        ),
      },
      {
        title: "PCR",
        body: (
          <p>
            整条链 Put OI / Call OI。偏高通常表示相对更多看跌保护，但需结合绝对仓位与现货位置解读，不宜单独作为方向信号。
          </p>
        ),
        formula: <Formula>PCR<sub>OI</sub> = Σ Put OI / Σ Call OI</Formula>,
      },
    ],
  },
  "pcr-history": {
    title: "PCR 时序",
    summary: "近月 Put/Call 持仓比的历史变化，跟踪情绪与对冲强度。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            PCR 上升：相对更多 Put 持仓；下降则 Call 相对增加。极端高/低位常与情绪过热或过冷相关，需结合 IV 与现货趋势确认。
          </p>
        ),
      },
      {
        title: "数据",
        body: <p>由每日近月链汇总沉淀；初期序列较短，随 ETL 逐日变长。</p>,
      },
    ],
  },
  "term-slope": {
    title: "期限斜率时序",
    summary: "远月 ATM IV 减去近月 ATM IV，刻画期限结构陡峭/倒挂的历史。",
    sections: [
      {
        title: "计算",
        body: <p>取当日期限结构中最近与最远有效到期点。</p>,
        formula: (
          <Formula>
            <div>Slope = IV<sub>far</sub> − IV<sub>near</sub></div>
            <div>Slope<sub>30D</sub> = Slope / (DTE<sub>far</sub> − DTE<sub>near</sub>) × 30</div>
          </Formula>
        ),
      },
      {
        title: "形态",
        body: (
          <p>
            Slope &lt; −0.5% 倾向 Backwardation（近贵远便宜）；Slope &gt; 2% 为较陡 Contango；介于其间为普通 Contango。倒挂常与短期事件风险有关。
          </p>
        ),
      },
    ],
  },
  "vol-cone": {
    title: "实现波动率锥",
    summary: "各回看窗口下已实现波动的历史分位带，并叠加当前 RV 与 IV。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            「波动率锥」展示不同持有期（如 10D / 20D / 60D…）实现波动在历史上的分位区间。当前 RV 落在锥的上沿附近说明近期波动已偏高；IV 相对锥的位置可辅助判断期权定价。
          </p>
        ),
      },
      {
        title: "计算要点",
        body: (
          <p>
            对每个窗口先算滚动年化 RV，再在历史样本上取分位数（如 25% / 50% / 75% 等）形成带状区域，最后标出最新 RV 与当前 IV。
          </p>
        ),
      },
    ],
  },
  "iv-heat": {
    title: "IV 分位热力图",
    summary: "全市场品种在「全历史分位」与「1Y 滚动分位」上的热力对比。",
    sections: [
      {
        title: "含义",
        body: (
          <p>
            颜色越偏红表示分位越高（相对越贵），越偏冷则越便宜。可快速扫描哪一类标的整体偏贵、哪一类有相对价值。
          </p>
        ),
      },
      {
        title: "两列指标",
        body: (
          <p>
            左列全历史分位偏长期；右列 1Y 滚动分位偏近期。两列都红 → 中长期皆贵；仅右列红 → 短期升温。
          </p>
        ),
      },
    ],
  },
  "overview-vix": {
    title: "波动率指数",
    summary: "计划展示金融与商品期权波动率的跨市场总览（即将接入）。",
    sections: [
      {
        title: "预期含义",
        body: (
          <p>
            将汇总主要金融指数/ETF 与商品板块的波动率水平，用于一屏比较「哪里更贵」。目前请先查看「金融期权」「商品期权」分项页中的概览与分位图。
          </p>
        ),
      },
    ],
  },
  "overview-pcr": {
    title: "买卖权比率",
    summary: "计划展示市场情绪类 Put/Call 指标（即将接入）。",
    sections: [
      {
        title: "预期含义",
        body: (
          <p>
            典型指标为成交量或持仓量的 Put/Call 比。偏高常解读为避险情绪升温，但需结合绝对水平与趋势，避免单独使用。
          </p>
        ),
      },
    ],
  },
  "overview-volume": {
    title: "按行权价的期权成交量",
    summary: "计划展示看涨 / 看跌成交量随行权价的分布（即将接入）。",
    sections: [
      {
        title: "预期含义",
        body: (
          <p>
            用于观察资金在哪些行权价更活跃，以及 Call / Put 成交是否失衡。可与持仓分布、IV 微笑对照阅读。
          </p>
        ),
      },
    ],
  },
  "overview-greeks": {
    title: "期权希腊值",
    summary: "计划汇总组合或市场层面的希腊值暴露（即将接入）。",
    sections: [
      {
        title: "预期含义",
        body: (
          <p>
            常见包括 Delta（方向）、Gamma（曲率）、Vega（波动率敏感度）、Theta（时间衰减）等。上线后将用于快速判断风险敞口结构。
          </p>
        ),
      },
    ],
  },
}

export function ChartHelpButton({
  chartId,
  className,
}: {
  chartId: ChartHelpId
  className?: string
}) {
  const help = CHART_HELP[chartId]

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground text-xs leading-none flex items-center justify-center flex-shrink-0 mt-0.5",
            className,
          )}
          title="图表说明"
          aria-label={`${help.title}：图表说明`}
        >
          ?
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{help.title}：图表说明</DialogTitle>
          <DialogDescription>{help.summary}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          {help.sections.map((section) => (
            <div key={section.title} className="space-y-1.5">
              <p className="font-semibold text-foreground">{section.title}</p>
              {section.body}
              {section.formula}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Card header with title, description, and help button aligned to the top-right. */
export function ChartCardHeader({
  title,
  description,
  chartId,
  titleClassName,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  chartId: ChartHelpId
  titleClassName?: string
  className?: string
}) {
  return (
    <CardHeader className={cn("flex flex-row items-start justify-between gap-2", className)}>
      <div className="space-y-1.5 min-w-0">
        <CardTitle className={titleClassName}>{title}</CardTitle>
        {description != null && description !== false && (
          <CardDescription>{description}</CardDescription>
        )}
      </div>
      <ChartHelpButton chartId={chartId} />
    </CardHeader>
  )
}
