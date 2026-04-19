"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const WINDOW_OPTIONS = [
  { value: "5",   label: "近 5 日" },
  { value: "10",  label: "近 10 日" },
  { value: "20",  label: "近 20 日" },
  { value: "60",  label: "近 60 日" },
]

export default function AdvisorCorrTimeseries({ height = 320 }: { height?: number }) {
  const [win,          setWin]          = useState("20")
  const [dates,        setDates]        = useState<string[]>([])
  const [avgCorr,      setAvgCorr]      = useState<number[]>([])
  const [effN,         setEffN]         = useState<number[]>([])
  const [accountCount, setAccountCount] = useState(0)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [showHelp,     setShowHelp]     = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/ma/api/mom-analysis/advisor-corr-ts?window=${win}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setDates(j.dates ?? [])
        setAvgCorr(j.avgCorr ?? [])
        setEffN(j.effN ?? [])
        setAccountCount(j.accountCount ?? 0)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [win])

  const option = useMemo(() => {
    const xAxisLabel = {
      fontSize: 11,
      rotate: 30,
      formatter: (v: string) => v.slice(0, 10),
      interval: Math.max(0, Math.floor(dates.length / 8) - 1),
    }
    return {
      grid: { left: 52, right: 72, top: 28, bottom: 48 },
      legend: {
        top: 4,
        right: 80,
        textStyle: { fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: xAxisLabel,
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: "value",
          name: "均值相关系数",
          nameLocation: "end",
          nameTextStyle: { fontSize: 10, color: "#3b82f6" },
          min: -1,
          max: 1,
          axisLabel: { fontSize: 10, color: "#3b82f6", formatter: (v: number) => v.toFixed(2) },
          axisLine: { lineStyle: { color: "#3b82f6" } },
          splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
        },
        {
          type: "value",
          name: "有效账户数",
          nameLocation: "end",
          nameGap: 8,
          nameTextStyle: { fontSize: 10, color: "#f97316", padding: [0, 0, 0, 40] },
          min: 1,
          max: Math.max(accountCount, 2),
          axisLabel: { fontSize: 10, color: "#f97316", formatter: (v: number) => v.toFixed(1) },
          axisLine: { lineStyle: { color: "#f97316" } },
          splitLine: { show: false },
        },
      ],
      tooltip: {
        trigger: "axis",
        formatter: (params: { seriesName: string; value: number }[]) => {
          if (!params.length) return ""
          const date = dates[dates.length - avgCorr.length + (params[0] as unknown as { dataIndex: number }).dataIndex] ?? ""
          let html = `${date}<br/>`
          for (const p of params) {
            const val = p.seriesName === "均值两两相关系数"
              ? p.value.toFixed(3)
              : p.value.toFixed(2)
            html += `${p.seriesName}：${val}<br/>`
          }
          return html
        },
      },
      series: [
        {
          name: "均值两两相关系数",
          type: "line",
          yAxisIndex: 0,
          data: avgCorr,
          showSymbol: false,
          lineStyle: { width: 1.5, color: "#3b82f6" },
          areaStyle: { color: "#3b82f6", opacity: 0.08 },
          itemStyle: { color: "#3b82f6" },
        },
        {
          name: "有效账户数",
          type: "line",
          yAxisIndex: 1,
          data: effN,
          showSymbol: false,
          lineStyle: { width: 1.5, color: "#f97316", type: "dashed" },
          itemStyle: { color: "#f97316" },
        },
      ],
    }
  }, [dates, avgCorr, effN, accountCount])

  return (
    <Card className="w-full h-full">
      {/* Help modal */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-xl p-5 max-w-lg w-full mx-4 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base">分散化指标计算方法</h3>
              <button onClick={() => setShowHelp(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-3 text-muted-foreground leading-relaxed">
              <div>
                <p className="font-medium text-foreground mb-1">📉 蓝线：均值两两相关系数</p>
                <p>对所有<strong className="text-foreground">有效账户</strong>（当日收益不全为零）两两计算皮尔逊相关系数，再取算术平均：</p>
                <p className="font-mono text-xs bg-muted rounded px-2 py-1.5 mt-1">
                  ρ̄ = ( 2 / N(N−1) ) × Σᵢ＜ⱼ ρᵢⱼ
                </p>
                <p className="mt-1">其中 ρᵢⱼ 为账户 i 与 j 在过去 <em>window</em> 个交易日收益率的皮尔逊相关系数：</p>
                <p className="font-mono text-xs bg-muted rounded px-2 py-1.5 mt-1">
                  ρᵢⱼ = Cov(rᵢ, rⱼ) / (σᵢ × σⱼ)
                </p>
                <p className="mt-1 text-xs">ρ̄ 越低说明账户间分散化越好；ρ̄ 趋近 1 则说明账户高度同涨同跌。全零收益账户（方差为零）排除在外以避免分母为零。</p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">🟠 橙线：有效账户数（Effective N）</p>
                <p>当日在选定回溯窗口内存在<strong className="text-foreground">非零收益</strong>的账户数量：</p>
                <p className="font-mono text-xs bg-muted rounded px-2 py-1.5 mt-1">
                  Nₑff = |&#123; i : σ(rᵢ) &gt; 0 &#125;|
                </p>
                <p className="mt-1 text-xs">Nₑff 越高说明参与计算的活跃账户越多，ρ̄ 的统计意义越强。</p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">📅 回溯窗口</p>
                <p className="text-xs">每个时间点的 ρᵢⱼ 使用<strong className="text-foreground">截至该日</strong>的最近 <em>window</em> 个交易日收益计算（滚动窗口），而非整段历史。</p>
              </div>
              <p className="text-xs border-t border-border pt-2">💡 理想状态：ρ̄ 低（蓝线低）+ Nₑff 高（橙线高），说明账户分散、独立性强，组合风险更低。</p>
            </div>
          </div>
        </div>
      )}
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium">分散化程度：均值两两相关系数 &amp; 有效账户数</CardTitle>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowHelp(true)}
            className="w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground text-xs leading-none flex items-center justify-center flex-shrink-0"
            title="计算方法说明"
          >?</button>
          <div className="flex items-center gap-1">
            {WINDOW_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setWin(o.value)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  win === o.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {error ? (
          <div className="flex items-center justify-center text-destructive text-sm" style={{ height }}>
            {error}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
            加载中...
          </div>
        ) : dates.length === 0 ? (
          <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
            暂无数据
          </div>
        ) : (
          <ReactECharts
            key={`corr-ts-${win}-${dates.length}-${accountCount}`}
            option={option}
            style={{ height, width: "100%" }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
