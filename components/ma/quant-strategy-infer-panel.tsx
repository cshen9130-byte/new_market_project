"use client"

import { QuantChartHelp, type ChartHelpSpec } from "@/components/ma/quant-strategy-help"
import type { StrategyInference } from "@/lib/ma/quant-strategy-infer"

export const INFER_HELP: ChartHelpSpec = {
  heading: "策略推断 · 方法说明",
  blocks: [
    {
      title: "在做什么",
      paragraphs: [
        "量化策略的打分/模型部分通常还原不了，但过滤器和约束会在成交上留下痕迹。后端先根据持仓周期和对冲度提出工作假设，再对常见规则做统计检验，只展示显著结果。不同账户检验结果不同。",
      ],
    },
    {
      title: "检验池",
      bullets: [
        "入场：价格相对 MA20/MA60、金叉/死叉、20 日新高/新低、5/20/60 日动量、RSI 超买超卖",
        "过滤：品种/板块 20 日波动最高档、成交量最低档是否更少开仓；夜盘占比",
        "仓位：同一天里各品种市值权重 vs 该品种 1/σ20 的 Spearman（截面，不是账户总回撤）；市值 HHI 集中度",
        "组合风控：南华（或品种池）20 日波动升高时，总敞口（持仓市值合计/权益）是降还是扛；敞口×波动是否随市场波动上升",
        "结构：持仓中位数、对冲度、品种池与板块池前后半段 Jaccard",
      ],
    },
    {
      title: "怎么算显著性",
      paragraphs: [
        "入场/过滤：在该账户常做的品种（≥8 个开仓日）上，把每个交易日标成「当天有没有开仓 / 开多」，再按信号分成两档，做两比例 z 检验。",
      ],
      formula: "P(开仓 | 信号) vs P(开仓 | 无信号)\nOR = 交叉比\nBH-FDR q ≤ 0.10 且 p ≤ 0.05，并且效应够大（概率差≥8% 或 OR≥1.4）才展示",
    },
    {
      title: "读法",
      bullets: [
        "支持 = 成交与这条规则同向且显著。不是说整套策略就是这一条。",
        "排除 = 显著相反，或持仓周期等结构直接矛盾。",
        "不显著的规则不出现，避免每个账户看起来都一样。",
        "「无法还原」是模型/截面选品/精确阈值，不是检验失败。",
        "「截面 1/σ」是同一天里吵的品种少配钱；「组合风控」是市场波动升高时整本总敞口降不降。两件事可以同时成立。",
      ],
    },
  ],
}

export function InferPanel({
  inference,
  period,
}: {
  inference: StrategyInference
  period?: string
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-medium">策略推断</h2>
          <QuantChartHelp spec={INFER_HELP} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>检验 {inference.tested} 条 · 展示 {inference.shown} 条</span>
          {period && (
            <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-medium tabular-nums">{period}</span>
          )}
        </div>
      </div>

      {inference.headline && (
        <p className="text-sm leading-relaxed">{inference.headline}</p>
      )}

      {inference.conclusions && inference.conclusions.length > 0 && (
        <div className="space-y-1">
          {inference.conclusions.map((p) => (
            <p key={p} className="text-xs text-muted-foreground leading-relaxed">{p}</p>
          ))}
        </div>
      )}

      {inference.plan.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1">工作假设</div>
          <ul className="text-xs text-muted-foreground leading-relaxed list-disc pl-4 space-y-0.5">
            {inference.plan.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {inference.supported.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1.5 text-red-700 dark:text-red-400">有证据</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {inference.supported.map((f) => (
              <div key={f.id} className="rounded-md border border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium">{f.title}</div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{f.family} · {f.stat}{f.q != null ? ` · q=${f.q < 0.01 ? "<0.01" : f.q.toFixed(2)}` : ""}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{f.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {inference.rejected.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1.5">已排除</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {inference.rejected.map((f) => (
              <div key={f.id} className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium">{f.title}</div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{f.family} · {f.stat}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{f.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {inference.unclassified.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1">无法从成交还原</div>
          <ul className="text-xs text-muted-foreground leading-relaxed list-disc pl-4 space-y-0.5">
            {inference.unclassified.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {inference.supported.length === 0 && inference.rejected.length === 0 && (
        <p className="text-xs text-muted-foreground">这一区间没有过门槛的规则痕迹。可能样本短，或入场不落在上述公开规则上。</p>
      )}
    </div>
  )
}
