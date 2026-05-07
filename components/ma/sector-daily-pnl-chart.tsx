"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type SectorLatest = { sector: string; pnl: number }
type SectorLs = { sector: string; long: number; short: number }

export default function SectorDailyPnlChart({ height = 300 }: { height?: number }) {
  const [loading, setLoading] = useState(true)
  const [sectorView, setSectorView] = useState<"total" | "ls">("total")
  const [sectorLatest, setSectorLatest] = useState<SectorLatest[]>([])
  const [sectorLS, setSectorLS] = useState<SectorLs[]>([])

  useEffect(() => {
    let doneCount = 0
    const finish = () => { if (++doneCount >= 2) setLoading(false) }

    fetch("/ma/api/mom-analysis/category-pnl")
      .then((r) => r.json())
      .then((catJson) => {
        const sectorData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = catJson.sectorData ?? {}
        const dateNonZeroCount = new Map<string, number>()
        for (const rows of Object.values(sectorData)) {
          for (const row of rows) {
            if (row.pnl !== 0) dateNonZeroCount.set(row.date, (dateNonZeroCount.get(row.date) ?? 0) + 1)
          }
        }
        const latestActiveDate = [...dateNonZeroCount.entries()]
          .filter(([, count]) => count >= 2)
          .sort(([a], [b]) => b.localeCompare(a))[0]?.[0] ?? null

        const latest = Object.entries(sectorData)
          .map(([sector, rows]) => {
            const row = latestActiveDate
              ? [...rows].reverse().find((entry) => entry.date <= latestActiveDate)
              : rows[rows.length - 1]
            return { sector, pnl: row?.pnl ?? 0 }
          })
          .filter((item) => item.pnl !== 0)
          .sort((a, b) => b.pnl - a.pnl)

        setSectorLatest(latest)
      })
      .catch(() => {})
      .finally(finish)

    fetch("/ma/api/mom-analysis/sector-ls-pnl")
      .then((r) => r.json())
      .then((lsJson) => {
        const rawLS: SectorLs[] = lsJson.sectorLS ?? []
        setSectorLS([...rawLS].sort((a, b) => (b.long + b.short) - (a.long + a.short)))
      })
      .catch(() => {})
      .finally(finish)
  }, [])

  const totalOption = useMemo(() => ({
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: string; value: number; marker: string }[]) =>
        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>")
    },
    grid: { left: 70, right: 20, top: 20, bottom: 60 },
    xAxis: {
      type: "category",
      data: sectorLatest.map((s) => s.sector),
      axisLabel: { fontSize: 11, rotate: 30 }
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" }
    },
    series: [{
      type: "bar",
      data: sectorLatest.map((s) => ({
        value: s.pnl,
        itemStyle: { color: s.pnl >= 0 ? "#ef4444" : "#22c55e" }
      })),
      label: {
        show: true,
        position: "top",
        formatter: (p: { value: number }) => (p.value / 10000).toFixed(1) + "万",
        fontSize: 10
      }
    }]
  }), [sectorLatest])

  const lsOption = useMemo(() => ({
    tooltip: {
      trigger: "axis",
      formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
        const valid = params.filter((p) => p.seriesName === "多头" || p.seriesName === "空头")
        const lines = valid.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
        const net = valid.reduce((sum, p) => sum + Number(p.value), 0)
        lines.push(`合计: ${net.toLocaleString("zh-CN")} 元`)
        return [params[0]?.name, ...lines].join("<br/>")
      }
    },
    legend: { data: ["多头", "空头"], top: 5, itemWidth: 12, itemGap: 8 },
    grid: { left: 70, right: 20, top: 35, bottom: 60 },
    xAxis: {
      type: "category",
      data: sectorLS.map((s) => s.sector),
      axisLabel: { fontSize: 11, rotate: 30 }
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" }
    },
    series: [
      {
        name: "多头",
        type: "bar",
        stack: "ls",
        data: sectorLS.map((s) => ({
          value: s.long,
          itemStyle: { color: s.long >= 0 ? "#ef4444" : "#22c55e" }
        }))
      },
      {
        name: "空头",
        type: "bar",
        stack: "ls",
        data: sectorLS.map((s) => ({
          value: s.short,
          itemStyle: { color: s.short >= 0 ? "#ef444488" : "#22c55e88" }
        }))
      }
    ]
  }), [sectorLS])

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">板块当日盈亏</CardTitle>
          <div className="flex gap-1">
            <button
              onClick={() => setSectorView("total")}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${sectorView === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              合计
            </button>
            <button
              onClick={() => setSectorView("ls")}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${sectorView === "ls" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              多空
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {loading ? (
          <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
        ) : sectorView === "total" ? (
          <ReactECharts key="total" option={totalOption} style={{ height }} notMerge />
        ) : (
          <ReactECharts key="ls" option={lsOption} style={{ height }} notMerge />
        )}
      </CardContent>
    </Card>
  )
}