"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent } from "@/components/ui/card"

type SbProd = { prod: string; mv: number; sigma: number }

export default function SandboxProductMcrPieChart({
  height = 300,
  prodNameMap,
  mcrData,
  liveData = false,
}: {
  height?: number
  prodNameMap: Record<string, string>
  mcrData?: { name: string; value: number }[]
  /** When true, never fetch static API — always use mcrData from the live sandbox */
  liveData?: boolean
}) {
  const hasExternalData = liveData || mcrData !== undefined
  const [loading, setLoading] = useState(!hasExternalData)
  const [prods, setProds] = useState<SbProd[]>([])
  const [corrMatrix, setCorrMatrix] = useState<number[][]>([])

  useEffect(() => {
    if (hasExternalData) {
      setLoading(false)
      return
    }
    fetch("/ma/api/mom-analysis/var-sandbox")
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return
        setProds((j.products ?? []).map((p: { prod: string; mv: number; sigma: number }) => ({
          prod: p.prod,
          mv: p.mv,
          sigma: p.sigma,
        })))
        setCorrMatrix(j.corrMatrix ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [hasExternalData])

  const localProdMcrData = useMemo(() => {
    if (prods.length === 0 || corrMatrix.length < prods.length) return [] as { name: string; value: number }[]
    const dv = prods.map((p) => p.sigma * p.mv)
    return prods
      .map((p, i) => {
        let covSum = 0
        for (let j = 0; j < dv.length; j++) covSum += dv[j] * (corrMatrix[i]?.[j] ?? 0)
        return { name: p.prod, value: Math.abs(dv[i] * covSum) }
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [prods, corrMatrix])

  const effectiveProdMcrData = hasExternalData ? (mcrData ?? []) : localProdMcrData

  const chartOption = useMemo(() => ({
    color: [
      "#5470c6", "#91cc75", "#fac858", "#73c0de", "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc",
      "#48b0f1", "#70d9a2", "#f7a35c", "#a0d8ef", "#c9b4d4", "#7cb5ec", "#f4a460", "#e4d354",
      "#2b908f", "#b0c4de", "#7798bf", "#aaeeee", "#d4e157", "#ffb74d", "#80cbc4", "#ce93d8", "#80deea"
    ],
    title: { text: "品种边际波动贡献占比(%)（沙盒持仓）", textStyle: { fontSize: 12, fontWeight: "bold" }, top: 0, left: 0 },
    tooltip: {
      trigger: "item",
      formatter: (p: { name: string; percent: number }) => {
        const cn = prodNameMap[p.name]
        return `${p.name}${cn ? `（${cn}）` : ""}: ${p.percent.toFixed(2)}%`
      }
    },
    legend: {
      type: "scroll",
      orient: "vertical",
      left: "56%",
      right: 0,
      top: 30,
      bottom: 10,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 10 },
      formatter: (name: string) => {
        const total = effectiveProdMcrData.reduce((s, d) => s + d.value, 0)
        const item = effectiveProdMcrData.find((d) => d.name === name)
        const pct = total > 0 && item ? (item.value / total * 100).toFixed(2) : "0.00"
        const cn = prodNameMap[name]
        return `${name}${cn ? `（${cn}）` : ""}, ${pct}%`
      },
    },
    series: [{
      type: "pie",
      radius: "44%",
      center: ["24%", "56%"],
      label: { show: false },
      labelLine: { show: false },
      data: effectiveProdMcrData.map((d) => d.name === "IM" ? { ...d, itemStyle: { color: "#ef4444" } } : d),
    }],
  }), [effectiveProdMcrData, prodNameMap])

  const dataKey = useMemo(
    () => effectiveProdMcrData.map((d) => `${d.name}:${Math.round(d.value)}`).join("|"),
    [effectiveProdMcrData],
  )

  return (
    <Card className="h-full">
      <CardContent className="p-3 pb-2 h-full">
        {loading ? (
          <p className="text-sm text-muted-foreground px-2 py-8">加载中...</p>
        ) : effectiveProdMcrData.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2 py-8">暂无数据</p>
        ) : (
          <ReactECharts
            key={dataKey}
            option={chartOption}
            style={{ height: "100%" }}
            notMerge
            lazyUpdate={false}
          />
        )}
      </CardContent>
    </Card>
  )
}