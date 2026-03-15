"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { FREQ_LABELS } from "@/components/charts/current-market-prediction-chart"
import type { Freq } from "@/components/charts/current-market-prediction-chart"

type Latest = {
  date: string
  cluster: number | null
}

// Match CLUSTER_COLORS from the scatter chart
const CLUSTER_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728"]

// Layout: 2×2 grid, top row = PC2+ (避险↑), left col = PC1- (增长↓)
// Order: [top-left Q2=族1, top-right Q1=族0, bottom-left Q3=族2, bottom-right Q4=族3]
const QUADRANTS = [
  {
    cluster: 1,
    col: 1, row: 1,                         // top-left  (PC1-, PC2+)
    title: "衰退期",
    axes: "增长↓  避险↑",
    summary: "债券 · 黄金走强，股票 · 商品承压",
    detail:
      "经济持续下行，市场全面避险。债券与黄金受益，股票和大宗商品普遍承压。",
  },
  {
    cluster: 0,
    col: 2, row: 1,                         // top-right (PC1+, PC2+)
    title: "滞胀 / 政策收紧担忧",
    axes: "增长↑  避险↑",
    summary: "股票最纠结，黄金 · 国债受青睐",
    detail:
      "经济数据强劲，但市场担忧通胀与加息，资金涌入黄金与国债避险，股票表现最为分化。",
  },
  {
    cluster: 2,
    col: 1, row: 2,                         // bottom-left  (PC1-, PC2-)
    title: "复苏早期",
    axes: "增长↓  避险↓",
    summary: "政策宽松，股票筑底，信用债受益",
    detail:
      "经济数据仍弱，但政策开始宽松，市场情绪回暖。信用债率先受益，股票可能正在筑底反弹。",
  },
  {
    cluster: 3,
    col: 2, row: 2,                         // bottom-right (PC1+, PC2-)
    title: "过热 / 繁荣期",
    axes: "增长↑  避险↓",
    summary: "股票 · 商品大涨，债券遭抛售",
    detail:
      "经济强劲，风险偏好高涨。股票与大宗商品大幅上涨，债券遭抛售，利率上行。",
  },
]

type Props = { freq: Freq; onFreqChange: (f: Freq) => void }

export default function EconomicQuadrantChart({ freq, onFreqChange }: Props) {
  const [latest, setLatest] = useState<Latest | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/ma/api/macro/current-market-prediction?freq=${freq}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.latest) setLatest(json.latest)
        else if (!cancelled) setLatest(null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [freq])

  const activeCluster = latest?.cluster ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>经济象限</CardTitle>
            <CardDescription>
              GMM 聚类对应的宏观经济状态
              {latest ? ` · 当前：族 ${activeCluster}（${QUADRANTS.find(q => q.cluster === activeCluster)?.title ?? "—"}）` : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1 mt-0.5">
            {(Object.keys(FREQ_LABELS) as Freq[]).map((f) => (
              <button
                key={f}
                onClick={() => onFreqChange(f)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  freq === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {FREQ_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : (
          <div className="relative h-[420px] select-none">

            {/* ── axis labels ── */}
            {/* PC1 horizontal arrow */}
            <div className="absolute left-10 right-4 bottom-[28px] flex items-center justify-between pointer-events-none z-10">
              <span className="text-[10px] text-muted-foreground font-medium">← 增长↓ (PC1)</span>
              <span className="text-[10px] text-muted-foreground font-medium">(PC1) 增长↑ →</span>
            </div>
            {/* PC2 vertical label */}
            <div className="absolute left-0 top-4 bottom-10 flex flex-col items-center justify-between pointer-events-none z-10 w-8">
              <span className="text-[10px] text-muted-foreground font-medium rotate-[-90deg] origin-center whitespace-nowrap">避险↑</span>
              <span className="text-[10px] text-muted-foreground font-medium rotate-[-90deg] origin-center whitespace-nowrap">避险↓</span>
            </div>

            {/* ── centre axis lines ── */}
            <div className="absolute left-10 right-4 top-4 bottom-10">
              {/* vertical */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border opacity-60" />
              {/* horizontal */}
              <div className="absolute top-1/2 left-0 right-0 h-px bg-border opacity-60" />

              {/* ── four quadrant cells ── */}
              <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-1 p-1">
                {QUADRANTS.map((q) => {
                  const isActive = activeCluster === q.cluster
                  const color = CLUSTER_COLORS[q.cluster]
                  return (
                    <div
                      key={q.cluster}
                      className={cn(
                        "rounded-md border p-2 flex flex-col gap-0.5 transition-all",
                        isActive ? "shadow-md" : "opacity-55",
                      )}
                      style={{
                        gridColumn: q.col,
                        gridRow: q.row,
                        borderColor: isActive ? color : undefined,
                        backgroundColor: isActive ? `${color}18` : undefined,
                      }}
                    >
                      {/* cluster badge + axes */}
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0 rounded-full leading-5"
                          style={{
                            backgroundColor: isActive ? color : undefined,
                            color: isActive ? "#fff" : color,
                            border: `1px solid ${color}`,
                          }}
                        >
                          族 {q.cluster}
                        </span>
                        <span className="text-[9px] text-muted-foreground">{q.axes}</span>
                      </div>
                      {/* title */}
                      <p
                        className="text-[11px] font-semibold leading-tight"
                        style={{ color: isActive ? color : undefined }}
                      >
                        {q.title}
                      </p>
                      {/* summary */}
                      <p className="text-[10px] text-muted-foreground leading-tight">{q.summary}</p>
                      {/* detail — only shown on active */}
                      {isActive && (
                        <p className="text-[10px] mt-1 leading-snug" style={{ color }}>
                          {q.detail}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
