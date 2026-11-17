"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import type { EnvStrategy, EnvTone, StrategyEnvironmentPayload } from "@/lib/ma/strategy-environment"
import { StrategyEnvironmentMethodDialog } from "./StrategyEnvironmentMethodDialog"

const StrategyEnvironmentCompare = dynamic(
  () => import("./StrategyEnvironmentCompare").then((m) => m.StrategyEnvironmentCompare),
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

function Spark({ values, tone }: { values: number[]; tone: EnvTone }) {
  if (values.length < 2) return <div className="h-6" />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const w = 96
  const h = 24
  const d = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * w
      const y = h - ((value - min) / span) * (h - 2) - 1
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")
  const stroke = tone === "good" ? "#e11d48" : tone === "weak" ? "#059669" : "#71717a"
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-24" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function rankedLine(strategies: EnvStrategy[]): string {
  const ranked = strategies.filter((item) => item.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
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

  const active = data?.strategies.find((item) => item.key === selected) ?? data?.strategies[0] ?? null

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">策略环境</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {data?.asOf ? `行情截至 ${data.asOf}` : "按最近一个交易日"}
            。分数高表示这个策略更好做，不是它已经赚了多少。红涨绿跌是近 5 个交易日的分数变化。
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
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{rankedLine(data.strategies)}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {data.strategies.map((item) => {
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
                      <div className={`text-2xl font-semibold tabular-nums leading-none ${TONE_SCORE[item.tone]}`}>
                        {item.score == null ? "—" : item.score.toFixed(1)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Spark values={item.history.slice(-24).map((point) => point.score)} tone={item.tone} />
                      <span className="text-xs tabular-nums">
                        <Delta value={item.delta5} />
                      </span>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-zinc-500">{item.headline}</p>
                </button>
              )
            })}
          </div>

          {active && (
            <section className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
                <div>
                  <div className="text-[11px] text-zinc-400">{active.group}{active.asOf ? ` · ${active.asOf}` : ""}</div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    {active.name}
                    <span className={`ml-2 text-2xl tabular-nums ${TONE_SCORE[active.tone]}`}>
                      {active.score == null ? "—" : active.score.toFixed(1)}
                    </span>
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`rounded px-2 py-0.5 text-xs ${TONE_PILL[active.tone]}`}>{active.rating}</span>
                  <span className="tabular-nums"><Delta value={active.delta5} /></span>
                </div>
              </div>

              <div className="mt-3 grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
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

          <StrategyEnvironmentMethodDialog
            open={methodOpen}
            onOpenChange={setMethodOpen}
            strategies={data.strategies}
            activeKey={methodKey}
            onSelect={setMethodKey}
          />
        </>
      )}
    </div>
  )
}
