"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Freq } from "./current-market-prediction-chart"
import { FREQ_LABELS } from "./current-market-prediction-chart"

// ── types ────────────────────────────────────────────────────────────────────
type Loading = {
  asset: string
  label: string
  pc1: number
  pc2: number
}

type BiplData = {
  loadings: Loading[]
  explained_variance: number[]
}

type Point = {
  date: string
  cluster: number | null
  pc1: number | null
  pc2: number | null
}

// ── constants ────────────────────────────────────────────────────────────────
const CLUSTER_COLORS = ["#1f77b4", "#ff7f0e", "#d62728", "#2ca02c"]
const CLUSTER_LABELS = ["簇 0", "簇 1", "簇 2", "簇 3"]
const ARROW_SCALE = 0.85   // arrows end at loading × 0.85

// Unit circle: 361 points (last = first to close)
const UNIT_CIRCLE_DATA = Array.from({ length: 361 }, (_, i) => {
  const a = (2 * Math.PI * i) / 360
  return [Math.cos(a), Math.sin(a)]
})



interface Props {
  freq: Freq
  onFreqChange: (f: Freq) => void
}

// ── component ─────────────────────────────────────────────────────────────
export default function PcaBiplotChart({ freq, onFreqChange }: Props) {
  const [loadings, setLoadings] = useState<Loading[]>([])
  const [explained, setExplained] = useState<number[]>([0, 0])
  const [scores, setScores] = useState<Point[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Loadings are static — fetch once
  useEffect(() => {
    fetch("/ma/api/macro/pca-biplot")
      .then((r) => r.json())
      .then((d: BiplData) => {
        setLoadings(d.loadings ?? [])
        setExplained(d.explained_variance ?? [0, 0])
      })
      .catch(() => {/* leave empty */})
  }, [])

  // Scores change with freq
  useEffect(() => {
    let cancelled = false
    setLoadingData(true)
    fetch(`/ma/api/macro/current-market-prediction?freq=${freq}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setScores(d.data ?? [])
          setLoadingData(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingData(false)
      })
    return () => { cancelled = true }
  }, [freq])

  const option = useMemo(() => {
    if (!scores.length || !loadings.length) return {}

    // ── normalize scores to fit inside the unit circle ──────────────────
    const pc1s = scores.filter((s) => s.pc1 != null).map((s) => s.pc1 as number)
    const pc2s = scores.filter((s) => s.pc2 != null).map((s) => s.pc2 as number)
    const maxVal = Math.max(
      Math.max(...pc1s.map(Math.abs)),
      Math.max(...pc2s.map(Math.abs)),
    )
    const scaleF = maxVal > 0 ? 0.82 / maxVal : 1

    const normPt = (pt: Point): [number, number, string] => [
      (pt.pc1 ?? 0) * scaleF,
      (pt.pc2 ?? 0) * scaleF,
      pt.date,
    ]

    // ── 4 cluster scatter series ─────────────────────────────────────────
    const byCluster: [number, number, string][][] = [[], [], [], []]
    for (const r of scores) {
      if (r.cluster != null && r.pc1 != null && r.pc2 != null) {
        const c = Math.min(3, Math.max(0, r.cluster))
        byCluster[c].push(normPt(r))
      }
    }
    const clusterSeries = CLUSTER_LABELS.map((name, c) => ({
      name,
      type: "scatter" as const,
      data: byCluster[c],
      symbolSize: 5,
      itemStyle: { color: CLUSTER_COLORS[c], opacity: 0.45 },
      tooltip: {
        formatter: (p: any) =>
          `${name}<br/>日期: ${p.data[2]}<br/>PC1: ${(+p.data[0] / scaleF).toFixed(4)}<br/>PC2: ${(+p.data[1] / scaleF).toFixed(4)}`,
      },
    }))

    // ── latest day — red hollow circle ───────────────────────────────────
    const latest = scores[scores.length - 1]
    const latestSeries =
      latest?.pc1 != null && latest?.pc2 != null
        ? [{
            name: "最新交易日",
            type: "scatter" as const,
            data: [normPt(latest)],
            symbolSize: 22,
            symbol: "circle",
            itemStyle: { color: "transparent", borderColor: "#e00", borderWidth: 2.5 },
            z: 10,
            tooltip: {
              formatter: () =>
                `最新: ${latest.date}<br/>PC1: ${latest.pc1?.toFixed(4)}<br/>PC2: ${latest.pc2?.toFixed(4)}<br/>簇: ${latest.cluster}`,
            },
          }]
        : []

    // ── unit circle (dashed reference) ───────────────────────────────────
    const unitCircleSeries = {
      name: "_unitcircle",
      type: "line" as const,
      data: UNIT_CIRCLE_DATA,
      symbol: "none",
      lineStyle: { color: "#666", width: 1, type: "dashed" as const, opacity: 0.5 },
      animation: false,
      silent: true,
      tooltip: { show: false },
    }

    // ── arrow + label custom series ────────────────────────────────────────
    // Uses api.coord() so all geometry is computed in PIXEL space — arrows
    // always point outward regardless of the chart's aspect ratio, and
    // labels are placed beyond each tip with collision separation.

    // Pre-compute perpendicular label separation for close-angle pairs.
    const CLOSE_DEG = 22
    const SEP_PX    = 14
    const loadAngles = loadings.map((l) => Math.atan2(l.pc2, l.pc1) * 180 / Math.PI)
    const labelSepPx = new Array(loadings.length).fill(0) as number[]
    for (let i = 0; i < loadings.length; i++) {
      for (let j = i + 1; j < loadings.length; j++) {
        let da = Math.abs(loadAngles[i] - loadAngles[j])
        if (da > 180) da = 360 - da
        if (da >= CLOSE_DEG) continue
        // Push the higher-pc2 asset toward screen-up (negative sep), the other down
        const [up, dn] = loadings[i].pc2 >= loadings[j].pc2 ? [i, j] : [j, i]
        labelSepPx[up] = -SEP_PX
        labelSepPx[dn] =  SEP_PX
      }
    }

    const arrowCustomSeries = {
      name: "_arrows",
      type: "custom" as const,
      renderItem: (params: any, api: any) => {
        const idx = params.dataIndex
        const l   = loadings[idx]
        const sep = labelSepPx[idx]

        // Pixel positions via api.coord — accounts for aspect ratio automatically
        const [ox, oy] = api.coord([0, 0]) as [number, number]
        const [tx, ty] = api.coord([l.pc1 * ARROW_SCALE, l.pc2 * ARROW_SCALE]) as [number, number]

        const dx = tx - ox, dy = ty - oy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = dx / len, ny = dy / len   // unit forward (screen space)
        const perp_x = -ny, perp_y = nx      // unit CCW perpendicular

        const HL = 11, HW = 5                // arrowhead: length, half-width
        const bx = tx - HL * nx, by = ty - HL * ny  // shaft end

        // Label: outward from tip + perpendicular separation
        const LDIST = 30
        const lx = tx + nx * LDIST + sep * perp_x
        const ly = ty + ny * LDIST + sep * perp_y
        const tAlign   = nx >  0.3 ? "left"   : nx < -0.3 ? "right"  : "center"
        const vAlign   = ny >  0.35 ? "top"   : ny < -0.35 ? "bottom" : "middle"

        return {
          type: "group",
          children: [
            {
              type: "line",
              shape: { x1: ox, y1: oy, x2: bx, y2: by },
              style: { stroke: "#f97316", lineWidth: 2, fill: "none" },
              silent: true,
            },
            {
              // Arrowhead polygon: tip + two base corners
              type: "polygon",
              shape: {
                points: [
                  [tx, ty],
                  [bx + HW * perp_x, by + HW * perp_y],
                  [bx - HW * perp_x, by - HW * perp_y],
                ],
              },
              style: { fill: "#f97316", stroke: "none" },
              silent: true,
            },
            {
              type: "text",
              style: {
                text: l.label,
                x: lx,
                y: ly,
                textAlign: tAlign,
                textVerticalAlign: vAlign,
                fill: "#fb923c",
                fontWeight: "bold",
                fontSize: 11,
                font: "bold 11px sans-serif",
              },
              silent: true,
            },
          ],
        }
      },
      data: loadings.map((l) => [l.pc1 * ARROW_SCALE, l.pc2 * ARROW_SCALE]),
      symbol: "none",
      silent: true,
      tooltip: { show: false },
      z: 12,
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: { trigger: "item" },
      legend: {
        data: [...CLUSTER_LABELS, "最新交易日"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: "12%", right: "8%", top: "8%", bottom: "15%" },
      xAxis: {
        type: "value" as const,
        name: `PC1（${(explained[0] * 100).toFixed(1)}% 方差）`,
        nameLocation: "middle" as const,
        nameGap: 28,
        min: -1.2,
        max: 1.2,
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "value" as const,
        name: `PC2（${(explained[1] * 100).toFixed(1)}% 方差）`,
        nameLocation: "middle" as const,
        nameGap: 46,
        min: -1.2,
        max: 1.2,
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: [unitCircleSeries, ...clusterSeries, ...latestSeries, arrowCustomSeries],
    }
  }, [loadings, explained, scores])

  const latest = scores[scores.length - 1]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>PCA 双标图</CardTitle>
            <CardDescription>
              市场聚类分布与资产载荷方向（{FREQ_LABELS[freq]}）
              {latest ? ` · 最新 ${latest.date}，所属簇 ${latest.cluster ?? "—"}` : ""}
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
        {loadingData ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : !scores.length ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            暂无数据
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: 420 }} />
        )}
      </CardContent>
    </Card>
  )
}
