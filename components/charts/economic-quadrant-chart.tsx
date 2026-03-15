"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { FREQ_LABELS } from "@/components/charts/current-market-prediction-chart"
import type { Freq } from "@/components/charts/current-market-prediction-chart"

type Latest = {
  date: string
  cluster: number | null
  pc1: number | null
  pc2: number | null
}

// Determine highlighted quadrant from actual PC1/PC2 scores (not cluster number)
// This is more accurate because GMM cluster centroids don't map 1:1 to PC quadrants
function getActiveQuadrant(latest: Latest | null): { col: number; row: number } | null {
  if (!latest || latest.pc1 == null || latest.pc2 == null) return null
  return {
    col: latest.pc1 >= 0 ? 2 : 1,  // PC1+ → right col, PC1- → left col
    row: latest.pc2 >= 0 ? 1 : 2,  // PC2+ → top row,  PC2- → bottom row
  }
}

// Match CLUSTER_COLORS from the scatter chart
const CLUSTER_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728"]

// Cluster centroids from GMM model (verified from pca_scores_clustered.csv):
//   Cluster 0: PC1≈-0.03, PC2≈+0.12  → top-left  (PC1-, PC2+)  | ~64% of days
//   Cluster 1: PC1≈-0.32, PC2≈+0.02  → left-side, near-zero PC2  | ~13% of days
//   Cluster 2: PC1≈+24.3, PC2≈-10.4  → extreme bottom-right outlier | 1 data point
//   Cluster 3: PC1≈+0.19, PC2≈-0.16  → bottom-right (PC1+, PC2-)  | ~22% of days
// Layout: 2×2 grid, top row = PC2+ (避险↑), left col = PC1- (增长↓)
const QUADRANTS = [
  {
    cluster: 0,
    col: 1, row: 1,                         // top-left  (PC1-, PC2+)
    title: "均衡 / 低增长",
    axes: "增长↓  避险↑",
    summary: "防守类资产相对占优，市场情绪偏谨慎",
    detail:
      "经济温和放缓，防守情绪主导。债券与黄金相对占优，股票和大宗商品整体承压。历史上最常见宏观状态（约占65%）。",
  },
  {
    cluster: 2,
    col: 2, row: 1,                         // top-right (PC1+, PC2+) — extreme outlier, < 0.1% of days
    title: "极端压力 / 危机",
    axes: "增长↑  避险↑",
    summary: "极低概率极端状态，历史极少出现",
    detail:
      "统计极端状态，历史上极少发生（< 0.1%），通常对应极端市场冲击或宏观异常事件。",
  },
  {
    cluster: 1,
    col: 1, row: 2,                         // bottom-left  (PC1-, PC2-)
    title: "衰退期",
    axes: "增长↓  避险↓",
    summary: "增长明显下滑，政策宽松预期升温",
    detail:
      "经济明显下行，政策开始宽松。债券受益于降息预期，股票处于底部探寻阶段，信用债和成长股可能率先反弹。",
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
  const activeQuadrant = getActiveQuadrant(latest)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>经济象限</CardTitle>
            <CardDescription>
              GMM 聚类对应的宏观经济状态
              {activeQuadrant
                ? ` · 当前：${QUADRANTS.find(q => q.col === activeQuadrant.col && q.row === activeQuadrant.row)?.title ?? "—"}（族 ${activeCluster}）`
                : ""}
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
                  const isActive = activeQuadrant
                    ? q.col === activeQuadrant.col && q.row === activeQuadrant.row
                    : false
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
