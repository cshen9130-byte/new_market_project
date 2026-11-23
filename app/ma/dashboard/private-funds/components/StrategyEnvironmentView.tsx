"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { headlineFromHistory, scoreSpark, type EnvStrategy, type EnvTone, type StrategyEnvironmentPayload } from "@/lib/ma/strategy-environment"
import { StrategyEnvironmentMethodDialog } from "./StrategyEnvironmentMethodDialog"

const StrategyEnvironmentCompare = dynamic(
  () => import("./StrategyEnvironmentCompare").then((m) => m.StrategyEnvironmentCompare),
  { ssr: false },
)

const StrategyAverageNavChart = dynamic(
  () => import("./StrategyAverageNavChart").then((m) => m.StrategyAverageNavChart),
  { ssr: false },
)

const TONE_SCORE: Record<EnvTone, string> = {
  good: "text-red-600 dark:text-red-400",
  mid: "text-zinc-900 dark:text-zinc-100",
  weak: "text-emerald-700 dark:text-emerald-400",
  empty: "text-zinc-400",
}

const TONE_PILL: Record<EnvTone, string> = {
  good: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
  mid: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  weak: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  empty: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800",
}

function barColor(score: number): string {
  if (score >= 64) return "#e11d48"
  if (score >= 50) return "#a1a1aa"
  return "#059669"
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="text-zinc-400">5日 —</span>
  if (Math.abs(value) < 0.05) return <span className="text-zinc-400">5日 持平 →</span>
  const up = value > 0
  return (
    <span className={up ? "text-red-500" : "text-green-600"}>
      5日 {up ? "+" : ""}
      {value.toFixed(1)} {up ? "↑" : "↓"}
    </span>
  )
}

/** Same red the chart uses for 环境分, drawn on the chart's 0–100 axis. */
function Spark({ values }: { values: Array<number | null> }) {
  if (values.length < 2) return <div className="h-6" />
  const w = 96
  const h = 24
  let drawing = false
  const d = values
    .map((value, index) => {
      if (value == null || !Number.isFinite(value)) {
        drawing = false
        return ""
      }
      const x = (index / (values.length - 1)) * w
      const y = h - 1 - (Math.min(100, Math.max(0, value)) / 100) * (h - 2)
      const cmd = drawing ? "L" : "M"
      drawing = true
      return `${cmd}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")
  if (!d.trim()) return <div className="h-6" />
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-24" aria-hidden>
      <path d={d} fill="none" stroke="#e11d48" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function rankedLine(strategies: EnvStrategy[]): string {
  const ranked = strategies.filter((item) => item.totalScore != null).sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
  if (ranked.length < 2) return ""
  const better = ranked.slice(0, 3).map((item) => item.name).join("、")
  const worse = ranked.slice(-2).map((item) => item.name).join("、")
  return `当前更好做的是${better}。更要收着做的是${worse}。`
}

export function StrategyEnvironmentView() {
  const [data, setData] = useState<StrategyEnvironmentPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState("quant")
  const [methodOpen, setMethodOpen] = useState(false)
  const [methodKey, setMethodKey] = useState("quant")

  async function load(nocache = false) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/private-funds/market/strategy-environment${nocache ? "?nocache=1" : ""}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "加载失败")
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
  }, [])

  const strategies = (data?.strategies ?? []).map((item) => {
    const headline = headlineFromHistory(item)
    return headline ? { ...item, ...headline } : item
  })
  const active = strategies.find((item) => item.key === selected) ?? strategies[0] ?? null

  return (
    <div className="w-full shrink-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">策略环境</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {data?.asOf ? `行情截至 ${data.asOf}` : "按最近一个交易日"}
            。大数字是合计。α 是近 10 日的超额环境分，β 是相对沪深300的贝塔乘近 10 日涨跌。市场下跌而贝塔高时 β 为负，合计会被拉低。红涨绿跌是合计比 5 个交易日前的变化。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMethodKey(active?.key ?? selected)
              setMethodOpen(true)
            }}
            disabled={!data}
            className="rounded border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            计算说明
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="rounded border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {loading ? "计算中…" : "重新计算"}
          </button>
        </div>
      </div>

      {error && !data && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && !data && (
        <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
          正在读取行情，计算 8 个策略的环境分…
        </div>
      )}

      {data && (
        <>
          <div className="sticky -top-5 z-30 -mx-5 border-b border-zinc-200 bg-background px-5 py-2 shadow-sm dark:border-zinc-800">
            <div className="flex flex-wrap gap-1.5">
              {strategies.map((item) => {
                const on = item.key === active?.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelected(item.key)}
                    aria-pressed={on}
                    className={[
                      "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors",
                      on
                        ? "border-red-400 bg-red-50 text-zinc-900 dark:border-red-700 dark:bg-red-950/40 dark:text-zinc-50"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300",
                    ].join(" ")}
                  >
                    <span>{item.name}</span>
                    <span className={`tabular-nums ${on ? TONE_SCORE[item.tone] : "text-zinc-400"}`}>
                      {item.totalScore == null ? "—" : item.totalScore.toFixed(0)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{rankedLine(strategies)}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {strategies.map((item) => {
              const on = item.key === active?.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelected(item.key)}
                  aria-pressed={on}
                  className={[
                    "flex flex-col gap-1.5 rounded border px-3 py-2.5 text-left transition-colors",
                    on
                      ? "border-red-400 bg-red-50/50 dark:border-red-700 dark:bg-red-950/20"
                      : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400">{item.group}</span>
                    <span className={`max-w-[9rem] truncate rounded px-1.5 py-0.5 text-[11px] ${TONE_PILL[item.tone]}`}>
                      {item.rating}
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{item.name}</div>
                      <div className="text-[11px] text-zinc-400">合计</div>
                      <div className={`text-2xl font-semibold tabular-nums leading-none ${TONE_SCORE[item.tone]}`}>
                        {item.totalScore == null ? "—" : item.totalScore.toFixed(1)}
                      </div>
                      <div className="mt-1 flex gap-2 text-[11px] tabular-nums text-zinc-500">
                        <span>α {item.alphaScore == null ? "—" : item.alphaScore.toFixed(1)}</span>
                        <span className={item.betaScore == null ? "" : item.betaScore > 0 ? "text-red-500" : item.betaScore < 0 ? "text-green-600" : ""}>
                          β {item.betaScore == null ? "—" : `${item.betaScore > 0 ? "+" : ""}${item.betaScore.toFixed(1)}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1" title="近 6 个月环境分，与下方图中的红线相同">
                      <Spark values={scoreSpark(item)} />
                      <span className="text-xs tabular-nums">
                        <Delta value={item.totalDelta} />
                      </span>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-zinc-500">{item.headline}</p>
                </button>
              )
            })}
          </div>

          {active && (
            <section className="relative z-10 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
                <div>
                  <div className="text-[11px] text-zinc-400">{active.group}{active.asOf ? ` · ${active.asOf}` : ""}</div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    {active.name}
                    <span className="ml-2 text-xs font-normal text-zinc-400">合计</span>
                    <span className={`ml-1 text-2xl tabular-nums ${TONE_SCORE[active.tone]}`}>
                      {active.totalScore == null ? "—" : active.totalScore.toFixed(1)}
                    </span>
                  </h2>
                  <p className="mt-1 text-xs tabular-nums text-zinc-500">
                    α {active.alphaScore == null ? "—" : active.alphaScore.toFixed(1)}
                    <span className="mx-2">·</span>
                    β {active.betaScore == null ? "—" : `${active.betaScore > 0 ? "+" : ""}${active.betaScore.toFixed(1)}`}
                    {active.marketBeta != null && active.market10d != null && (
                      <span className="ml-2 text-zinc-400">
                        贝塔 {active.marketBeta.toFixed(2)} × 近10日沪深300 {active.market10d > 0 ? "+" : ""}{active.market10d.toFixed(1)}%
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`rounded px-2 py-0.5 text-xs ${TONE_PILL[active.tone]}`}>{active.rating}</span>
                  <span className="tabular-nums"><Delta value={active.totalDelta} /></span>
                </div>
              </div>

              <div className="mt-3 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
                {active.factors.length > 0 && (
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-1">
                    {active.factors.map((factor) => (
                      <div key={factor.key} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-zinc-800 dark:text-zinc-100">{factor.label}</div>
                          {factor.weight != null && (
                            <div className="text-[11px] tabular-nums text-zinc-400">
                              权重 {Math.round(factor.weight * 100)}% · 贡献 {(factor.score * factor.weight).toFixed(1)}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                              <div
                                className="h-1.5 rounded-full"
                                style={{ width: `${Math.max(0, Math.min(100, factor.score))}%`, background: barColor(factor.score) }}
                              />
                            </div>
                            <span className="w-8 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                              {factor.score.toFixed(0)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs leading-5 text-zinc-500">{factor.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                  {active.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              </div>
            </section>
          )}

          {active && <StrategyEnvironmentCompare strategyKey={active.key} strategyName={active.name} />}

          <StrategyAverageNavChart activeKey={active?.key ?? selected} />

          <StrategyEnvironmentMethodDialog
            open={methodOpen}
            onOpenChange={setMethodOpen}
            strategies={strategies}
            activeKey={methodKey}
            onSelect={setMethodKey}
          />
        </>
      )}
    </div>
  )
}
