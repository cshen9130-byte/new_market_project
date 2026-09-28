"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Point = {
  account: string
  winRate: number
  payoff: number | null
  winDays: number
  lossDays: number
  avgWin: number | null
  avgLoss: number | null
  totalPnl: number
}

function breakevenPayoff(winRatePct: number): number {
  const p = winRatePct / 100
  if (!(p > 0.005)) return 20
  if (p >= 1) return 0
  return (1 - p) / p
}

function expectancyCurve(x0: number, x1: number): [number, number][] {
  const lo = Math.max(x0, 1)
  const hi = Math.min(x1, 99)
  if (!(hi > lo)) return []
  const n = 48
  const data: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n
    data.push([Number(x.toFixed(2)), Number(breakevenPayoff(x).toFixed(3))])
  }
  return data
}

function payoffAxes(xs: number[], ys: number[]) {
  const xSpan = Math.max(8, Math.max(...xs) - Math.min(...xs))
  const xMin = Math.max(0, Math.min(...xs, 50) - xSpan * 0.28)
  const xMax = Math.min(100, Math.max(...xs, 50) + xSpan * 0.28)
  const curve = expectancyCurve(xMin, xMax)
  const pointHi = Math.max(...ys, 0.2)
  const curveCap = Math.max(pointHi * 2.2, 1.6)
  const shown = curve.map((p) => p[1]).filter((y) => y <= curveCap)
  const yLo = Math.min(...ys, ...(shown.length ? shown : [0]))
  const yHi = Math.max(...ys, ...(shown.length ? shown : [0]))
  const ySpan = Math.max(0.35, yHi - yLo)
  return {
    xMin,
    xMax,
    yMin: Math.max(0, yLo - ySpan * 0.18),
    yMax: yHi + ySpan * 0.22,
    curve,
  }
}

function accountHit(account: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, "")
  if (!q) return false
  const name = account.toLowerCase().replace(/\s+/g, "")
  if (name.includes(q)) return true
  const qDigits = q.replace(/\D/g, "")
  return qDigits.length > 0 && name.replace(/\D/g, "").includes(qDigits)
}

function isRx380(account: string): boolean {
  return /^rx?380$/i.test(account.trim())
}

function fmtWan(n: number): string {
  const abs = Math.abs(n)
  const sign = n > 0 ? "+" : n < 0 ? "-" : ""
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`
  return `${sign}${Math.round(abs).toLocaleString("zh-CN")}`
}

export default function AdvisorWinPayoffScatter({ height = 380 }: { height?: number }) {
  const [data, setData] = useState<Point[]>([])
  const [span, setSpan] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [showRx380, setShowRx380] = useState(false)
  const [accountQuery, setAccountQuery] = useState("")

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch("/ma/api/mom-analysis/advisor-win-payoff")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setSpan({ from: j.from ?? null, to: j.to ?? null })
        setData((j.accounts ?? []) as Point[])
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [])

  const option = useMemo(() => {
    const searching = accountQuery.trim().length > 0
    const source = data.filter((d) => showRx380 || !isRx380(d.account) || accountHit(d.account, accountQuery))
    const usable = source.filter((d) => Number.isFinite(d.winRate))
    if (!usable.length) return {}

    const finiteY = usable.map((d) => d.payoff).filter((y): y is number => y != null && Number.isFinite(y))
    const maxFinite = finiteY.length ? Math.max(...finiteY) : 1
    const cap = Math.max(maxFinite * 1.25, 1.5)
    const plotted = usable.map((d) => {
      const noLoss = d.payoff == null && d.totalPnl > 0 && d.lossDays === 0
      const y = noLoss ? cap : (d.payoff ?? 0)
      return { ...d, y, noLoss }
    })
    const axes = payoffAxes(plotted.map((d) => d.winRate), plotted.map((d) => d.y))

    const seriesOf = (name: string, pick: (pnl: number) => boolean) => {
      const points = plotted
        .filter((d) => pick(d.totalPnl))
        .sort((a, b) => Number(accountHit(a.account, accountQuery)) - Number(accountHit(b.account, accountQuery)))
      if (!points.length) return null
      const tone = name === "盈利"
        ? { color: "rgba(239,68,68,0.85)", borderColor: "#dc2626" }
        : name === "亏损"
          ? { color: "rgba(34,197,94,0.85)", borderColor: "#16a34a" }
          : { color: "rgba(148,163,184,0.85)", borderColor: "#64748b" }
      return {
        name,
        type: "scatter" as const,
        itemStyle: { ...tone, borderWidth: 1 },
        label: { show: false },
        labelLayout: { hideOverlap: !searching },
        data: points.map((d) => {
          const hit = accountHit(d.account, accountQuery)
          return {
            name: d.account.toUpperCase(),
            value: [d.winRate, d.y] as [number, number],
            payoff: d.payoff,
            noLoss: d.noLoss,
            winDays: d.winDays,
            lossDays: d.lossDays,
            totalPnl: d.totalPnl,
            avgWin: d.avgWin,
            avgLoss: d.avgLoss,
            symbolSize: searching && hit ? 18 : plotted.length > 24 ? 10 : 14,
            label: {
              show: showLabels || (searching && hit),
              formatter: (p: { name?: string }) => p.name ?? "",
              position: "top" as const,
              fontSize: 10,
              fontWeight: searching && hit ? "bold" as const : "normal" as const,
              color: "#111827",
              distance: 6,
            },
            itemStyle: {
              ...tone,
              borderWidth: searching && hit ? 2 : 1,
              borderColor: searching && hit ? "#111827" : tone.borderColor,
              opacity: searching && !hit ? 0.15 : 1,
            },
          }
        }),
      }
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "item" as const,
        formatter: (p: { data?: { name?: string; value?: [number, number]; payoff?: number | null; noLoss?: boolean; winDays?: number; lossDays?: number; totalPnl?: number } }) => {
          const d = p.data
          if (!d?.value) return ""
          const [x, y] = d.value
          const need = breakevenPayoff(x)
          const payoffText = d.noLoss ? "无亏损日，图上放在顶部" : (d.payoff == null ? "—" : d.payoff.toFixed(2))
          const side = y > need ? "正" : y < need ? "负" : "打平"
          return [
            `<b>${d.name ?? ""}</b>`,
            `胜率 <b>${x.toFixed(1)}%</b>（${d.winDays ?? 0} 盈 / ${d.lossDays ?? 0} 亏）`,
            `盈亏比 <b>${payoffText}</b>（平均盈利日 / |平均亏损日|）`,
            `打平需要 <b>${need.toFixed(2)}</b>`,
            `期望 <b>${side}</b>`,
            `区间盈亏 <b>${fmtWan(d.totalPnl ?? 0)}</b>`,
          ].join("<br/>")
        },
      },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 56, right: 48, top: 28, bottom: 40 },
      xAxis: {
        type: "value" as const,
        name: "胜率",
        nameLocation: "middle" as const,
        nameGap: 26,
        nameTextStyle: { fontSize: 11 },
        min: axes.xMin,
        max: axes.xMax,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
        splitLine: { lineStyle: { type: "dashed" as const, color: "rgba(148,163,184,0.2)" } },
        axisLine: { show: true, lineStyle: { color: "rgba(148,163,184,0.4)" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "盈亏比",
        nameLocation: "middle" as const,
        nameGap: 42,
        nameTextStyle: { fontSize: 11 },
        min: axes.yMin,
        max: axes.yMax,
        axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(2) },
        splitLine: { lineStyle: { type: "dashed" as const, color: "rgba(148,163,184,0.2)" } },
      },
      series: [
        {
          name: "期望 0",
          type: "line" as const,
          showSymbol: false,
          silent: true,
          data: axes.curve,
          lineStyle: { type: "dashed" as const, width: 1, color: "#94a3b8" },
          itemStyle: { color: "#94a3b8" },
          endLabel: { show: true, formatter: "期望 0", fontSize: 10, color: "#64748b" },
          z: 1,
        },
        seriesOf("盈利", (pnl) => pnl > 0),
        seriesOf("亏损", (pnl) => pnl < 0),
        seriesOf("持平", (pnl) => pnl === 0),
      ].filter(Boolean),
    }
  }, [data, showLabels, showRx380, accountQuery])

  const rangeLabel = span.from && span.to ? `全部 · ${span.from} 至 ${span.to}` : "全部交易日"

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">胜率与盈亏比</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
              placeholder="搜索账户"
              className="h-7 w-28 rounded border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {accountQuery.trim() && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {data.filter((d) => accountHit(d.account, accountQuery)).length} 个
              </span>
            )}
            <span className="text-[11px] text-muted-foreground tabular-nums">{rangeLabel}</span>
            {data.some((d) => isRx380(d.account)) && (
              <button
                type="button"
                title="该账户盈亏比远高于其他账户。outlier off 时不画这个点，打开后纵轴会被拉得很高"
                onClick={() => setShowRx380((v) => !v)}
                className={`h-7 rounded px-2.5 text-xs font-medium border transition-colors ${
                  showRx380
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:text-foreground"
                }`}
              >
                {showRx380 ? "outlier on" : "outlier off"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowLabels((v) => !v)}
              className={`h-7 rounded px-2.5 text-xs font-medium border transition-colors ${
                showLabels
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:text-foreground"
              }`}
            >
              账户名
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          每个点是一个账户。胜率是盈利日占有盈亏交易日的比例。纵轴是平均盈利日 / |平均亏损日|，不是盈利总额 / 亏损总额。虚线是期望为 0，随胜率下降：胜率 90% 时盈亏比 0.8 已经是正期望。
        </p>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center text-sm text-destructive px-4 text-center" style={{ height }}>
            {error}
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        ) : (
          <ReactECharts
            key={`win-payoff-${data.length}-${showLabels}-${showRx380}-${accountQuery}`}
            option={option}
            style={{ height }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
