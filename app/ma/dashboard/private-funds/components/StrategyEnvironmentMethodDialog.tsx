"use client"

import { useMemo } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { EnvFactor, EnvStrategy } from "@/lib/ma/strategy-environment"
import { STRATEGY_MATH, type MathStep } from "./strategy-environment-math"

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

function InlineMath({ math }: { math: string }) {
  const html = useMemo(
    () => katex.renderToString(math, { throwOnError: false, displayMode: false, strict: "ignore", trust: false }),
    [math],
  )
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function Steps({ steps }: { steps: MathStep[] }) {
  return (
    <ol className="mt-2 space-y-3">
      {steps.map((step, index) => (
        <li key={`${index}-${step.lead.slice(0, 24)}`}>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            <span className="mr-1.5 font-medium text-zinc-800 dark:text-zinc-100">{index + 1}.</span>
            {step.lead}
          </p>
          <div className="mt-1.5">
            <Latex math={step.latex} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function todayStep(strategy: EnvStrategy): MathStep | null {
  if (strategy.score == null) return null
  if (strategy.key === "swing") {
    const path = strategy.factors.find((factor) => factor.key === "path")
    const revert = strategy.factors.find((factor) => factor.key === "revert")
    const amp = strategy.factors.find((factor) => factor.key === "amp")
    const overnight = strategy.factors.find((factor) => factor.key === "overnight")
    if (!path || !revert || !amp || !overnight) return null
    const structure = Math.max(path.score, revert.score)
    return {
      lead: "把今天已经算好的四项分数代进去。结构分取路径和反转里较大的一个，再按 35%、50%、15% 相加，四舍五入到一位小数。",
      latex: String.raw`\begin{aligned} s_{\text{结构}}&=\max(${round1(path.score)},\,${round1(revert.score)})=${round1(structure)}\\ S&=\operatorname{round}_{1}(${round1(amp.score)}\times 0.35+${round1(structure)}\times 0.50+${round1(overnight.score)}\times 0.15)=${strategy.score.toFixed(1)} \end{aligned}`,
    }
  }
  if (strategy.key === "option-sell" && strategy.factors.length) {
    const book = strategy.factors.find((factor) => factor.key === "book")
    const liq = strategy.factors.find((factor) => factor.key === "liq")
    if (book) {
      const composite = liq == null ? "" : String.raw`,\qquad C=\operatorname{round}_{1}(${round1(book.score)}\times 0.7+${round1(liq.score)}\times 0.3)=${round1(book.score * 0.7 + liq.score * 0.3)}`
      return {
        lead: "环境分是全部品种隐波分位的等权平均，不是只把页面上点名的那几个平均。综合分另按隐波 70%、流动性 30% 合成，用来看卖的时候有没有成交配合。",
        latex: String.raw`S=${round1(book.score)}${composite}`,
      }
    }
  }
  const weighted = strategy.factors.filter((factor) => factor.weight != null)
  if (!weighted.length) return null
  const numerator = weighted.map((factor) => `${round1(factor.score)}\\times ${(factor.weight ?? 0).toFixed(3)}`).join("+")
  const denominator = weighted.map((factor) => (factor.weight ?? 0).toFixed(3)).join("+")
  return {
    lead: "把今天各项分数和页面上的权重代进去。这些权重已经按仍有数据的项归一，并保留三位小数。公布的环境分用的是归一后、保留三位小数之前的精确比例，所以手算可能和公布值差 0.1。",
    latex: String.raw`\dfrac{${numerator}}{${denominator}},\qquad \text{公布的环境分}=${strategy.score.toFixed(1)}`,
  }
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

type WorkLine = { label: string; expr: string; value: string; counted?: boolean }

function workedLines(strategy: EnvStrategy): WorkLine[] {
  if (strategy.key === "swing") {
    const path = strategy.factors.find((factor) => factor.key === "path")
    const revert = strategy.factors.find((factor) => factor.key === "revert")
    const amp = strategy.factors.find((factor) => factor.key === "amp")
    const overnight = strategy.factors.find((factor) => factor.key === "overnight")
    if (!path || !revert || !amp || !overnight) return weightedLines(strategy.factors)
    const structure = Math.max(path.score, revert.score)
    return [
      { label: "结构分", expr: `max(${round1(path.score)}, ${round1(revert.score)})`, value: round1(structure), counted: false },
      { label: "振幅", expr: `${round1(amp.score)} × 35%`, value: round1(amp.score * 0.35) },
      { label: "结构", expr: `${round1(structure)} × 50%`, value: round1(structure * 0.5) },
      { label: "隔夜", expr: `${round1(overnight.score)} × 15%`, value: round1(overnight.score * 0.15) },
    ]
  }
  if (strategy.key === "option-sell") {
    const book = strategy.factors.find((factor) => factor.key === "book")
    const liq = strategy.factors.find((factor) => factor.key === "liq")
    const names = strategy.factors.filter((factor) => factor.key.startsWith("px:"))
    if (!book) return []
    const lines: WorkLine[] = [
      { label: "全市场隐波", expr: "全部品种等权平均", value: round1(book.score) },
    ]
    if (liq) {
      lines.push({ label: "流动性", expr: "各品种成交分位再平均", value: round1(liq.score), counted: false })
      lines.push({
        label: "综合",
        expr: `${round1(book.score)} × 70% + ${round1(liq.score)} × 30%`,
        value: round1(book.score * 0.7 + liq.score * 0.3),
        counted: false,
      })
    }
    for (const factor of names) {
      lines.push({ label: factor.label, expr: "点名的品种，不重复计入环境分", value: round1(factor.score), counted: false })
    }
    return lines
  }
  return weightedLines(strategy.factors)
}

function weightedLines(factors: EnvFactor[]): WorkLine[] {
  return factors
    .filter((factor) => factor.weight != null)
    .map((factor) => {
      const weight = factor.weight ?? 0
      return {
        label: factor.label,
        expr: `${round1(factor.score)} × ${(weight * 100).toFixed(1)}%`,
        value: round1(factor.score * weight),
      }
    })
}

export function StrategyEnvironmentMethodDialog({
  open,
  onOpenChange,
  strategies,
  activeKey,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  strategies: EnvStrategy[]
  activeKey: string
  onSelect: (key: string) => void
}) {
  const strategy = strategies.find((item) => item.key === activeKey) ?? strategies[0]
  const writeup = strategy ? STRATEGY_MATH[strategy.key] : undefined
  const today = strategy ? todayStep(strategy) : null
  const lines = strategy ? workedLines(strategy) : []
  const lineTotal = lines.reduce((sum, line) => sum + (line.counted === false ? 0 : Number(line.value)), 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,920px)] w-full max-w-[min(1080px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1080px,calc(100vw-2rem))]">
        <DialogTitle className="border-b border-zinc-200 px-5 py-3 pr-12 text-base dark:border-zinc-800">
          环境分怎么算
        </DialogTitle>
        <div className="flex min-h-0 flex-1">
          <aside className="w-44 shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            {strategies.map((item) => {
              const on = item.key === strategy?.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelect(item.key)}
                  className={[
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                    on
                      ? "bg-white font-medium text-red-600 dark:bg-zinc-950 dark:text-red-400"
                      : "text-zinc-600 hover:bg-white/70 dark:text-zinc-300 dark:hover:bg-zinc-950/60",
                  ].join(" ")}
                >
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums text-xs text-zinc-400">
                    {item.score == null ? "—" : item.score.toFixed(1)}
                  </span>
                </button>
              )
            })}
          </aside>
          {strategy && writeup && (
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{strategy.name}</h3>
                <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {strategy.score == null ? "—" : strategy.score.toFixed(1)}
                </span>
                <span className="text-sm text-zinc-500">{strategy.rating}</span>
                {strategy.asOf && <span className="text-xs text-zinc-400">{strategy.asOf}</span>}
              </div>

              <section className="mt-4">
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">为什么这样设计</h4>
                <div className="mt-1 space-y-2">
                  {writeup.why.map((paragraph) => (
                    <p key={paragraph} className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">{paragraph}</p>
                  ))}
                </div>
              </section>

              {strategy.score != null && strategy.delta5 != null && (
                <section className="mt-4">
                  <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">近 5 日变化</h4>
                  <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    用今天的环境分，减去往前第 5 个已经打出分的交易日。比较日是 {strategy.compareDate ?? "5 个交易日前"}，按打分日计数，不是自然日。
                  </p>
                  <div className="mt-1.5">
                    <Latex math={String.raw`\Delta_5=S_t-S_{t-5}=${strategy.score.toFixed(1)}-(${(strategy.score - strategy.delta5).toFixed(1)})=${strategy.delta5 > 0 ? "+" : ""}${strategy.delta5.toFixed(1)}`} />
                  </div>
                </section>
              )}

              {writeup.shared.length > 0 && (
                <section className="mt-5">
                  <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">后面每一项都会用到</h4>
                  <Steps steps={writeup.shared} />
                </section>
              )}

              <div className="mt-5 space-y-4">
                {strategy.factors.map((factor) => {
                  const factorMath = writeup.factors[factor.key] ?? writeup.fallback
                  return (
                    <section key={factor.key} className="rounded border border-zinc-200 px-3 py-3 dark:border-zinc-800">
                      <div className="flex items-baseline justify-between gap-3">
                        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{factor.label}</h4>
                        <span className="tabular-nums text-sm text-zinc-700 dark:text-zinc-200">{factor.score.toFixed(1)}</span>
                      </div>
                      {factorMath && (
                        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{factorMath.why}</p>
                      )}
                      {factorMath && <Steps steps={factorMath.steps} />}
                      <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">今日读数：{factor.detail}</p>
                    </section>
                  )
                })}
              </div>

              <section className="mt-5">
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">合成环境分</h4>
                <Steps steps={[...writeup.combine, ...writeup.rating, ...(today ? [today] : [])]} />
                {lines.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
                    <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                      用今天的分数把上式摊开
                    </div>
                    {lines.map((line) => (
                      <div key={line.label} className="grid grid-cols-[7rem_1fr_4rem] gap-2 border-b border-zinc-100 px-3 py-1.5 text-sm last:border-b-0 dark:border-zinc-800">
                        <span className="text-zinc-700 dark:text-zinc-200">{line.label}</span>
                        <span className="tabular-nums text-zinc-500">{line.expr}</span>
                        <span className="text-right tabular-nums text-zinc-800 dark:text-zinc-100">{line.value}</span>
                      </div>
                    ))}
                    {strategy.key !== "option-sell" && (
                      <div className="grid grid-cols-[7rem_1fr_4rem] gap-2 bg-zinc-50 px-3 py-1.5 text-sm font-medium dark:bg-zinc-900">
                        <span>环境分</span>
                        <span className="font-normal text-zinc-400">
                          {strategy.key === "swing" ? "三项相加" : "贡献相加"}
                          {strategy.score != null && Math.abs(lineTotal - strategy.score) > 0.15 ? "，分项按一位小数" : ""}
                        </span>
                        <span className="text-right tabular-nums">{strategy.score == null ? round1(lineTotal) : strategy.score.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="mt-5">
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">符号</h4>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  加、减、乘、除、分数线、括号、绝对值、求和号和上下标，都按通常的数学含义。下面列出本页自己定义的量。
                </p>
                <dl className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                  {writeup.symbols.map((item) => (
                    <div key={item.symbol} className="grid grid-cols-[minmax(7rem,11rem)_1fr] items-baseline gap-3 py-1.5">
                      <dt className="overflow-x-auto text-zinc-800 dark:text-zinc-100"><InlineMath math={item.symbol} /></dt>
                      <dd className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">{item.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
