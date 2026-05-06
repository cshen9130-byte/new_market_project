"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ProductLatest = { key: string; pnl: number }
type ProductLs = { prod: string; long: number; short: number }

interface Props {
  height?: number
  prodCatMap: Record<string, string>
  prodSectorMap: Record<string, string>
  prodSubSectorMap: Record<string, string>
  prodNameMap: Record<string, string>
}

export default function ProductDailyPnlChart({
  height = 260,
  prodCatMap,
  prodSectorMap,
  prodSubSectorMap,
  prodNameMap,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [prodView, setProdView] = useState<"total" | "ls">("total")
  const [prodLatest, setProdLatest] = useState<ProductLatest[]>([])
  const [prodLS, setProdLS] = useState<ProductLs[]>([])
  const [prodCatFilter, setProdCatFilter] = useState("全部")
  const [prodSectorFilter, setProdSectorFilter] = useState("全部")
  const [prodSubSectorFilter, setProdSubSectorFilter] = useState("全部")

  useEffect(() => {
    let doneCount = 0
    const finish = () => { if (++doneCount >= 2) setLoading(false) }

    fetch("/ma/api/mom-analysis/category-pnl")
      .then((r) => r.json())
      .then((catJson) => {
        const sectorData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = catJson.sectorData ?? {}
        const productData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = catJson.productData ?? {}
        const dateNonZeroCount = new Map<string, number>()
        for (const rows of Object.values(sectorData)) {
          for (const row of rows) {
            if (row.pnl !== 0) dateNonZeroCount.set(row.date, (dateNonZeroCount.get(row.date) ?? 0) + 1)
          }
        }
        const latestActiveDate = [...dateNonZeroCount.entries()]
          .filter(([, count]) => count >= 2)
          .sort(([a], [b]) => b.localeCompare(a))[0]?.[0] ?? null

        const latest = Object.entries(productData)
          .map(([key, rows]) => {
            const row = latestActiveDate
              ? [...rows].reverse().find((entry) => entry.date <= latestActiveDate)
              : rows[rows.length - 1]
            return { key, pnl: row?.pnl ?? 0 }
          })
          .filter((item) => item.pnl !== 0)
          .sort((a, b) => b.pnl - a.pnl)

        setProdLatest(latest)
      })
      .catch(() => {})
      .finally(finish)

    fetch("/ma/api/mom-analysis/sector-ls-pnl")
      .then((r) => r.json())
      .then((lsJson) => {
        const rawProdLS: ProductLs[] = lsJson.productLS ?? []
        setProdLS([...rawProdLS].sort((a, b) => (b.long + b.short) - (a.long + a.short)))
      })
      .catch(() => {})
      .finally(finish)
  }, [])

  const availableSectors = useMemo(() => ["全部", ...Array.from(new Set(
    Object.entries(prodSectorMap)
      .filter(([k]) => prodCatFilter === "全部" || prodCatMap[k] === prodCatFilter)
      .map(([, v]) => v)
  ))], [prodSectorMap, prodCatFilter, prodCatMap])

  const availableSubSectors = useMemo(() => ["全部", ...Array.from(new Set(
    Object.entries(prodSubSectorMap)
      .filter(([k]) => prodCatFilter === "全部" || prodCatMap[k] === prodCatFilter)
      .filter(([k]) => prodSectorFilter === "全部" || prodSectorMap[k] === prodSectorFilter)
      .map(([, v]) => v)
  ))], [prodSubSectorMap, prodCatFilter, prodCatMap, prodSectorFilter, prodSectorMap])

  const filteredProdLatest = useMemo(() => prodLatest
    .filter((p) => prodCatFilter === "全部" || prodCatMap[p.key] === prodCatFilter)
    .filter((p) => prodSectorFilter === "全部" || prodSectorMap[p.key] === prodSectorFilter)
    .filter((p) => prodSubSectorFilter === "全部" || prodSubSectorMap[p.key] === prodSubSectorFilter),
  [prodLatest, prodCatFilter, prodCatMap, prodSectorFilter, prodSectorMap, prodSubSectorFilter, prodSubSectorMap])

  const filteredProdLS = useMemo(() => prodLS
    .filter((p) => prodCatFilter === "全部" || prodCatMap[p.prod] === prodCatFilter)
    .filter((p) => prodSectorFilter === "全部" || prodSectorMap[p.prod] === prodSectorFilter)
    .filter((p) => prodSubSectorFilter === "全部" || prodSubSectorMap[p.prod] === prodSubSectorFilter)
    .sort((a, b) => (b.long + b.short) - (a.long + a.short)),
  [prodLS, prodCatFilter, prodCatMap, prodSectorFilter, prodSectorMap, prodSubSectorFilter, prodSubSectorMap])

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-sm">品种当日盈亏</CardTitle>
          <div className="flex gap-1 ml-auto">
            <button
              onClick={() => setProdView("total")}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${prodView === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >合计</button>
            <button
              onClick={() => setProdView("ls")}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${prodView === "ls" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >多空</button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={prodCatFilter}
            onChange={(e) => { setProdCatFilter(e.target.value); setProdSectorFilter("全部"); setProdSubSectorFilter("全部") }}
          >
            <option value="全部">大类资产</option>
            {["商品", "股指", "国债"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={prodSectorFilter}
            onChange={(e) => { setProdSectorFilter(e.target.value); setProdSubSectorFilter("全部") }}
          >
            {availableSectors.map((s) => <option key={s} value={s}>{s === "全部" ? "板块" : s}</option>)}
          </select>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={prodSubSectorFilter}
            onChange={(e) => setProdSubSectorFilter(e.target.value)}
          >
            {availableSubSectors.map((ss) => <option key={ss} value={ss}>{ss === "全部" ? "细分板块" : ss}</option>)}
          </select>
          {(prodCatFilter !== "全部" || prodSectorFilter !== "全部" || prodSubSectorFilter !== "全部") && (
            <button
              onClick={() => { setProdCatFilter("全部"); setProdSectorFilter("全部"); setProdSubSectorFilter("全部") }}
              className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            >重置</button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {loading ? (
          <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
        ) : prodView === "total" ? (
          <ReactECharts
            option={{
              tooltip: {
                trigger: "axis",
                formatter: (params: { name: string; value: number; marker: string }[]) =>
                  params.map((p) => {
                    const cn = prodNameMap[p.name]
                    const label = cn ? `${p.name}（${cn}）` : p.name
                    return `${p.marker}${label}: ${Number(p.value).toLocaleString("zh-CN")} 元`
                  }).join("<br/>")
              },
              grid: { left: 55, right: 10, top: 15, bottom: 50 },
              xAxis: {
                type: "category",
                data: filteredProdLatest.map((p) => p.key),
                axisLabel: { fontSize: 10, rotate: 45 }
              },
              yAxis: {
                type: "value",
                axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" }
              },
              series: [{
                type: "bar",
                data: filteredProdLatest.map((p) => ({
                  value: p.pnl,
                  itemStyle: { color: p.pnl >= 0 ? "#ef4444" : "#22c55e" }
                })),
                label: { show: false }
              }]
            }}
            style={{ height }}
            notMerge
          />
        ) : (
          <ReactECharts
            option={{
              tooltip: {
                trigger: "axis",
                formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
                  const valid = params.filter((p) => p.seriesName === "多头" || p.seriesName === "空头")
                  const cn = prodNameMap[params[0]?.name]
                  const label = cn ? `${params[0].name}（${cn}）` : params[0]?.name
                  const lines = valid.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
                  const net = valid.reduce((sum, p) => sum + Number(p.value), 0)
                  lines.push(`合计: ${net.toLocaleString("zh-CN")} 元`)
                  return [label, ...lines].join("<br/>")
                }
              },
              legend: { data: ["多头", "空头"], top: 5, itemWidth: 12, itemGap: 8 },
              grid: { left: 55, right: 10, top: 30, bottom: 50 },
              xAxis: {
                type: "category",
                data: filteredProdLS.map((p) => p.prod),
                axisLabel: { fontSize: 10, rotate: 45 }
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
                  data: filteredProdLS.map((p) => ({
                    value: p.long,
                    itemStyle: { color: p.long >= 0 ? "#ef4444" : "#22c55e" }
                  }))
                },
                {
                  name: "空头",
                  type: "bar",
                  stack: "ls",
                  data: filteredProdLS.map((p) => ({
                    value: p.short,
                    itemStyle: { color: p.short >= 0 ? "#ef444488" : "#22c55e88" }
                  }))
                }
              ]
            }}
            style={{ height }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}