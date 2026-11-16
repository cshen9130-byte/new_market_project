"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent } from "@/components/ui/card"
import { prodLabel } from "@/lib/ma/prod-sector"

const API_URL = "/ma/api/mom-analysis/var-mcr-timeseries?volDays=20&corrDays=252"
const POLL_MS = 60_000
const STALE_RETRY_MS = 8_000

const PRODUCT_SOFT = 30
const PRODUCT_HARD = 50
const SECTOR_SOFT = 50
const SECTOR_HARD = 65

const SECTOR_DISPLAY: Record<string, string> = {
  农产: "农产品",
}

const SECTOR_COLORS: Record<string, string> = {
  能源化工: "#1A365D",
  农产: "#C9A227",
  生鲜: "#DD6B20",
  黑色: "#4A5568",
  新能源: "#2B6CB0",
  有色: "#6B46C1",
  贵金属: "#B83280",
  股指: "#C53030",
  国债: "#2F855A",
  航运: "#2C7A7B",
  其他: "#A0AEC0",
}

const PRODUCT_COLORS: Record<string, string> = {
  MA: "#1A365D",
  EG: "#2B6CB0",
  JD: "#DD6B20",
  JM: "#C53030",
  AU: "#B83280",
  L: "#6B46C1",
  LC: "#2F855A",
  SF: "#975A16",
  M: "#2C7A7B",
  RB: "#4A5568",
  IM: "#9B2C2C",
}

const FALLBACK_PRODUCT_COLORS = [
  "#1A365D", "#2B6CB0", "#DD6B20", "#C53030", "#B83280",
  "#6B46C1", "#2F855A", "#975A16", "#2C7A7B", "#4A5568",
  "#9B2C2C", "#553C9A", "#2C5282",
]

const GOLD = "#C9A227"
const RED = "#C53030"
const TEAL = "#2B6CB0"
const GRAY_LINE = "#A0AEC0"

type McrPayload = {
  ok: boolean
  dates: string[]
  productData: Record<string, number[]>
  sectorData: Record<string, number[]>
  maxProductShare: number[]
  maxSectorShare: number[]
  distanceProduct: number[]
  distanceSector: number[]
  productSoft?: number
  productHard?: number
  sectorSoft?: number
  sectorHard?: number
  cacheStatus?: string
}

function sectorLabel(name: string): string {
  return SECTOR_DISPLAY[name] ?? name
}

function productColor(code: string, index: number): string {
  return PRODUCT_COLORS[code] ?? FALLBACK_PRODUCT_COLORS[index % FALLBACK_PRODUCT_COLORS.length]
}

function peakIndex(series: number[]): number {
  let best = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i] > series[best]) best = i
  }
  return best
}

function axisDate(v: string): string {
  return (v ?? "").slice(0, 10)
}

export default function VarMcrTimeseriesCharts() {
  const [data, setData] = useState<McrPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(API_URL, { cache: "no-cache" })
      const json = (await resp.json()) as McrPayload
      if (!json?.ok) {
        setError((json as { error?: string }).error || "加载失败")
        return
      }
      setError(null)
      setData(json)
      const stale = resp.headers.get("X-Mom-Cache") === "stale" || json.cacheStatus === "stale"
      if (stale) {
        if (staleTimer.current) clearTimeout(staleTimer.current)
        staleTimer.current = setTimeout(() => { void load() }, STALE_RETRY_MS)
      }
    } catch {
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onVis = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVis)
    const poll = setInterval(() => { void load() }, POLL_MS)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      clearInterval(poll)
      if (staleTimer.current) clearTimeout(staleTimer.current)
    }
  }, [load])

  const productSoft = data?.productSoft ?? PRODUCT_SOFT
  const productHard = data?.productHard ?? PRODUCT_HARD
  const sectorSoft = data?.sectorSoft ?? SECTOR_SOFT
  const sectorHard = data?.sectorHard ?? SECTOR_HARD
  const dates = data?.dates ?? []

  const distanceOption = useMemo(() => {
    if (!data || dates.length === 0) return null
    return {
      title: {
        text: `距离建议软预警线（品种${productSoft}% / 板块${sectorSoft}%）`,
        left: "center",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 600, color: "#1f2937" },
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: { seriesName: string; value: number; marker: string; axisValue: string }[]) => {
          const lines = params.map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(1)} 百分点`)
          return [params[0]?.axisValue, ...lines].join("<br/>")
        },
      },
      legend: {
        data: ["距品种软预警（百分点，负值=已突破）", "距板块软预警（百分点）"],
        bottom: 0,
        itemWidth: 14,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 52, right: 20, top: 36, bottom: 48 },
      xAxis: {
        type: "category",
        data: dates.map(axisDate),
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        name: "距离（百分点）",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } },
      },
      series: [
        {
          name: "距品种软预警（百分点，负值=已突破）",
          type: "line",
          data: data.distanceProduct,
          symbol: "none",
          lineStyle: { width: 1.6, color: TEAL },
          itemStyle: { color: TEAL },
          z: 3,
        },
        {
          name: "距板块软预警（百分点）",
          type: "line",
          data: data.distanceSector,
          symbol: "none",
          lineStyle: { width: 1.6, color: GOLD },
          itemStyle: { color: GOLD },
          z: 3,
        },
        {
          name: "零线",
          type: "line",
          data: dates.map(() => 0),
          symbol: "none",
          lineStyle: { width: 1, color: RED },
          tooltip: { show: false },
          silent: true,
          z: 2,
        },
      ],
    }
  }, [data, dates, productSoft, sectorSoft])

  const productsOption = useMemo(() => {
    if (!data || dates.length === 0) return null
    const entries = Object.entries(data.productData)
    const peak = entries
      .map(([code, series]) => ({ code, series, max: Math.max(0, ...series) }))
      .sort((a, b) => b.max - a.max)
    const highlighted = peak.filter(p => p.max >= productSoft)
    const others = peak.filter(p => p.max < productSoft)
    const series: Record<string, unknown>[] = []

    if (others.length > 0) {
      others.forEach((p, i) => {
        series.push({
          name: i === 0 ? "其余品种（从未到 30%）" : `__other_${p.code}`,
          type: "line",
          data: p.series,
          symbol: "none",
          lineStyle: { width: 0.7, color: GRAY_LINE, opacity: 0.45 },
          itemStyle: { color: GRAY_LINE },
          tooltip: { show: i === 0 },
          legendHoverLink: i === 0,
          z: 1,
        })
      })
    }

    highlighted.forEach((p, i) => {
      const color = productColor(p.code, i)
      const idx = peakIndex(p.series)
      series.push({
        name: prodLabel(p.code),
        type: "line",
        data: p.series,
        symbol: "none",
        lineStyle: { width: 1.7, color },
        itemStyle: { color },
        z: 3,
        markPoint: {
          symbol: "circle",
          symbolSize: 5,
          itemStyle: { color },
          label: {
            formatter: `${prodLabel(p.code)} ${Math.round(p.series[idx])}%`,
            fontSize: 10,
            color,
            offset: [0, -10],
          },
          data: [{ coord: [axisDate(dates[idx]), p.series[idx]] }],
        },
      })
    })

    series.push(
      {
        name: `品种软预警 ${productSoft}%`,
        type: "line",
        data: dates.map(() => productSoft),
        symbol: "none",
        lineStyle: { width: 1.2, type: "dashed", color: GOLD },
        itemStyle: { color: GOLD },
        tooltip: { show: false },
        z: 4,
      },
      {
        name: `品种硬干预 ${productHard}%`,
        type: "line",
        data: dates.map(() => productHard),
        symbol: "none",
        lineStyle: { width: 1.3, type: "dotted", color: RED },
        itemStyle: { color: RED },
        tooltip: { show: false },
        z: 4,
      },
    )

    return {
      title: {
        text: "全部品种边际波动贡献占比（时序，全历史）",
        left: "center",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 600, color: "#1f2937" },
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: { seriesName: string; value: number; marker: string; axisValue: string }[]) => {
          const rows = params
            .filter(p => !p.seriesName.startsWith("__other_") && !p.seriesName.includes("预警") && !p.seriesName.includes("干预"))
            .filter(p => typeof p.value === "number" && p.value > 0.5)
            .sort((a, b) => Number(b.value) - Number(a.value))
            .slice(0, 12)
            .map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(2)}%`)
          return [params[0]?.axisValue, ...rows].join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 24,
        right: 8,
        width: "70%",
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 10 },
        data: [
          ...highlighted.map(p => prodLabel(p.code)),
          ...(others.length ? ["其余品种（从未到 30%）"] : []),
          `品种软预警 ${productSoft}%`,
          `品种硬干预 ${productHard}%`,
        ],
      },
      grid: { left: 52, right: 20, top: 72, bottom: 28 },
      xAxis: {
        type: "category",
        data: dates.map(axisDate),
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        name: "贡献占比",
        nameTextStyle: { fontSize: 10 },
        min: 0,
        max: (value: { max: number }) => Math.max(90, Math.ceil((value.max + 5) / 10) * 10),
        axisLabel: { fontSize: 9, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } },
      },
      series,
    }
  }, [data, dates, productSoft, productHard])

  const sectorsOption = useMemo(() => {
    if (!data || dates.length === 0) return null
    const entries = Object.entries(data.sectorData)
      .map(([name, series]) => ({ name, series, max: Math.max(0, ...series) }))
      .sort((a, b) => b.max - a.max)

    const series: Record<string, unknown>[] = entries.map((s) => {
      const color = SECTOR_COLORS[s.name] ?? GRAY_LINE
      const crossed = s.max >= sectorSoft
      const idx = peakIndex(s.series)
      return {
        name: sectorLabel(s.name),
        type: "line",
        data: s.series,
        symbol: "none",
        lineStyle: { width: crossed ? 1.8 : 1.15, color, opacity: crossed ? 1 : 0.75 },
        itemStyle: { color },
        z: crossed ? 3 : 2,
        markPoint: crossed
          ? {
              symbol: "circle",
              symbolSize: 5,
              itemStyle: { color },
              label: {
                formatter: `${sectorLabel(s.name)} ${Math.round(s.series[idx])}%`,
                fontSize: 10,
                color,
                offset: [0, -10],
              },
              data: [{ coord: [axisDate(dates[idx]), s.series[idx]] }],
            }
          : undefined,
      }
    })

    series.push(
      {
        name: `板块软预警 ${sectorSoft}%`,
        type: "line",
        data: dates.map(() => sectorSoft),
        symbol: "none",
        lineStyle: { width: 1.2, type: "dashed", color: GOLD },
        itemStyle: { color: GOLD },
        tooltip: { show: false },
        z: 4,
      },
      {
        name: `板块硬干预 ${sectorHard}%`,
        type: "line",
        data: dates.map(() => sectorHard),
        symbol: "none",
        lineStyle: { width: 1.3, type: "dotted", color: RED },
        itemStyle: { color: RED },
        tooltip: { show: false },
        z: 4,
      },
    )

    return {
      title: {
        text: "全部板块边际波动贡献占比（时序，全历史）",
        left: "center",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 600, color: "#1f2937" },
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: { seriesName: string; value: number; marker: string; axisValue: string }[]) => {
          const rows = params
            .filter(p => !p.seriesName.includes("预警") && !p.seriesName.includes("干预"))
            .filter(p => typeof p.value === "number" && p.value > 0.05)
            .sort((a, b) => Number(b.value) - Number(a.value))
            .map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(2)}%`)
          return [params[0]?.axisValue, ...rows].join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 24,
        right: 8,
        width: "70%",
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 52, right: 20, top: 72, bottom: 28 },
      xAxis: {
        type: "category",
        data: dates.map(axisDate),
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        name: "贡献占比",
        nameTextStyle: { fontSize: 10 },
        min: 0,
        max: (value: { max: number }) => Math.max(100, Math.ceil((value.max + 5) / 10) * 10),
        axisLabel: { fontSize: 9, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } },
      },
      series,
    }
  }, [data, dates, sectorSoft, sectorHard])

  const footnote = dates.length > 0
    ? `口径对齐日间风控 VaR 沙盘（vol=20日, corr=252日, 含当日窗口）。共 ${Object.keys(data?.productData ?? {}).length} 个品种、${Object.keys(data?.sectorData ?? {}).length} 个板块，${dates[0]} 至 ${dates[dates.length - 1]}。彩色品种线为历史上曾达到或超过 ${productSoft}% 的品种；加粗板块线为曾达到或超过 ${sectorSoft}% 软预警的板块。`
    : "口径对齐日间风控 VaR 沙盘（含当日窗口）。"

  if (loading && !data) {
    return (
      <section id="section-intraday-mcr-history" className="mt-4">
        <p className="text-sm text-muted-foreground">边际波动贡献时序加载中...</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section id="section-intraday-mcr-history" className="mt-4">
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    )
  }

  if (!data || dates.length === 0) {
    return (
      <section id="section-intraday-mcr-history" className="mt-4">
        <p className="text-sm text-muted-foreground">暂无边际波动贡献时序数据</p>
      </section>
    )
  }

  return (
    <section id="section-intraday-mcr-history" className="mt-4 space-y-4">
      <Card>
        <CardContent className="p-3 pb-2">
          {distanceOption && (
            <ReactECharts option={distanceOption} style={{ height: 340 }} notMerge lazyUpdate={false} />
          )}
          <p className="text-[10px] text-muted-foreground px-1 pb-1">
            把「还差几个百分点」显化。负值表示已突破软预警。与持续时间一同判读，避免单日刺破就报警。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 pb-2">
          {productsOption && (
            <ReactECharts option={productsOption} style={{ height: 420 }} notMerge lazyUpdate={false} />
          )}
          <p className="text-[10px] text-muted-foreground px-1 pb-1">{footnote}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 pb-2">
          {sectorsOption && (
            <ReactECharts option={sectorsOption} style={{ height: 420 }} notMerge lazyUpdate={false} />
          )}
          <p className="text-[10px] text-muted-foreground px-1 pb-1">{footnote}</p>
        </CardContent>
      </Card>
    </section>
  )
}
