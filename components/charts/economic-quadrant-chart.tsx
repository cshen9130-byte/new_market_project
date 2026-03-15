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
// 簇0 → top-left  (增长↓ 避险↑) 滞涨/中性
// 簇1 → bottom-left  (增长↓ 避险↓) 衰退
// 簇2 → top-right (增长↑ 避险↑) 过热
// 簇3 → bottom-right (增长↑ 避险↓) 复苏
const QUADRANTS = [
  {
    cluster: 0,
    col: 1, row: 1,                         // top-left  (PC1-, PC2+)
    title: "滞涨 / 中性",
    axes: "增长↓  避险↑",
    summary: "黄金 · 国债受青睐，股票表现分化",
    detail:
      "经济动能放缓，避险情绪升温。黄金与国债走强，股票表现最为分化，商品承压。",
  },
  {
    cluster: 2,
    col: 2, row: 1,                         // top-right (PC1+, PC2+)
    title: "过热期",
    axes: "增长↑  避险↑",
    summary: "经济强劲但避险并行，股票与黄金齐升",
    detail:
      "经济数据强劲，同时市场保持一定避险需求。股票与黄金可能同步上行，通胀压力显现。",
  },
  {
    cluster: 1,
    col: 1, row: 2,                         // bottom-left  (PC1-, PC2-)
    title: "衰退期",
    axes: "增长↓  避险↓",
    summary: "增长下滑，政策宽松预期升温",
    detail:
      "经济明显下行，政策开始宽松。债券受益于降息预期，股票处于底部探寻阶段，信用债和成长股可能率先反弹。",
  },
  {
    cluster: 3,
    col: 2, row: 2,                         // bottom-right (PC1+, PC2-)
    title: "复苏期",
    axes: "增长↑  避险↓",
    summary: "股票 · 商品走强，风险偏好回升",
    detail:
      "经济持续复苏，风险偏好升温。股票与大宗商品上行，资金从债券流向权益类资产。",
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
