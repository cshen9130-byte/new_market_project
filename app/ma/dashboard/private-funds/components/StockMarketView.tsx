"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Menu } from "lucide-react"
import { HelpAnnualizedDiscount } from "@/components/ma/realtime-chart-help"
import { DateInput } from "@/components/ui/date-input"

const PAGE_TABS = [
  { key: "quant", label: "量化观察" },
  { key: "indices", label: "股票指数" },
  { key: "industry", label: "行业分析" },
  { key: "heat", label: "市场热度" },
] as const

type PageTab = (typeof PAGE_TABS)[number]["key"]

const PRODUCTS = ["IC", "IM", "IF", "IH"] as const
type ProductCode = (typeof PRODUCTS)[number]

const ROLE_ORDER = ["近月", "次月", "当季", "下季"] as const
const ROLE_LABEL: Record<(typeof ROLE_ORDER)[number], string> = {
  近月: "当月",
  次月: "下月",
  当季: "当季",
  下季: "下季",
}

const ROLE_STYLE: Record<
  (typeof ROLE_ORDER)[number],
  { color: string; dashed?: boolean; area?: boolean; width: number }
> = {
  近月: { color: "#5B8FF9", width: 1.6 },
  次月: { color: "#C5C5C5", dashed: true, width: 1.3 },
  当季: { color: "#C4A36A", dashed: true, width: 1.6 },
  下季: { color: "#5BA8A8", area: true, width: 2 },
}

const MIN_DAYS = 5

type Point = {
  date: string
  annualized_discount_pct: number
  days_to_maturity?: number
}

type ApiPayload = {
  roles?: Record<string, Record<string, Point[]>>
  error?: string
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function shiftDays(ymd: string, days: number): string {
  const dt = new Date(`${ymd}T12:00:00`)
  dt.setDate(dt.getDate() + days)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, "0")
  const d = String(dt.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function CompactDateInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <DateInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-[10.5rem]"
      inputClassName="h-8 rounded-sm border-zinc-200 pl-2 pr-8 text-sm text-zinc-700"
      displayClassName="left-2 text-sm"
    />
  )
}

function seriesName(product: ProductCode, role: (typeof ROLE_ORDER)[number]) {
  return `${product}${ROLE_LABEL[role]}年化升贴水率`
}

function niceYExtent(extent: { min: number; max: number }) {
  const span = Math.max(0.01, extent.max - extent.min)
  const pad = Math.max(0.8, span * 0.15)
  const interval = span + pad * 2 <= 8 ? 1 : span + pad * 2 <= 16 ? 2 : 4
  let min = Math.floor((extent.min - pad) / interval) * interval
  let max = Math.ceil((extent.max + pad) / interval) * interval
  if (max <= min) max = min + interval * 4
  return { min, max, interval }
}

export function StockMarketView() {
  const today = useMemo(() => shanghaiToday(), [])
  const [draftFrom, setDraftFrom] = useState(() => shiftDays(today, -92))
  const [draftTo, setDraftTo] = useState(today)
  const [appliedFrom, setAppliedFrom] = useState(() => shiftDays(today, -92))
  const [appliedTo, setAppliedTo] = useState(today)
  const [activeTab, setActiveTab] = useState<PageTab>("quant")
  const [product, setProduct] = useState<ProductCode>("IC")
  const [payload, setPayload] = useState<ApiPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<ReactECharts>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch("/ma/api/basis/contract-discount-timeseries")
      .then(async (res) => {
        const json = (await res.json()) as ApiPayload
        if (!res.ok) throw new Error(json.error || "加载升贴水数据失败")
        return json
      })
      .then((json) => {
        if (!cancelled) setPayload(json)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载升贴水数据失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleQuery = useCallback(() => {
    setAppliedFrom(draftFrom)
    setAppliedTo(draftTo)
  }, [draftFrom, draftTo])

  const handleDownload = useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" })
    const a = document.createElement("a")
    a.href = url
    a.download = `${product}_股指期货升贴水率_${appliedFrom}_${appliedTo}.png`
    a.click()
  }, [appliedFrom, appliedTo, product])

  const series = useMemo(() => {
    const roleMap = payload?.roles?.[product] || {}
    return ROLE_ORDER.map((role) => {
      const style = ROLE_STYLE[role]
      const name = seriesName(product, role)
      const data = (roleMap[role] || [])
        .filter((p) => p.date >= appliedFrom && p.date <= appliedTo)
        .filter((p) => typeof p.annualized_discount_pct === "number")
        .filter((p) => (p.days_to_maturity ?? MIN_DAYS) >= MIN_DAYS)
        .map((p) => [p.date, Number((-p.annualized_discount_pct).toFixed(2))] as [string, number])
      return {
        name,
        type: "line" as const,
        data,
        smooth: 0,
        showSymbol: false,
        symbol: "none",
        connectNulls: true,
        z: style.area ? 3 : 2,
        lineStyle: {
          width: style.width,
          color: style.color,
          type: style.dashed ? ("dashed" as const) : ("solid" as const),
        },
        itemStyle: { color: style.color },
        areaStyle: style.area
          ? {
              origin: 0,
              color: {
                type: "linear" as const,
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: "rgba(91,168,168,0.04)" },
                  { offset: 1, color: "rgba(91,168,168,0.32)" },
                ],
              },
            }
          : undefined,
        emphasis: { disabled: true },
      }
    })
  }, [appliedFrom, appliedTo, payload, product])

  const legendSelected = useMemo(
    () => ({
      [seriesName(product, "近月")]: false,
      [seriesName(product, "次月")]: false,
      [seriesName(product, "当季")]: true,
      [seriesName(product, "下季")]: true,
    }),
    [product],
  )

  const option = useMemo(
    () => ({
      animationDuration: 300,
      color: ROLE_ORDER.map((role) => ROLE_STYLE[role].color),
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "rgba(255,255,255,0.96)",
        borderColor: "#e5e7eb",
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: "#334155", fontSize: 12 },
        axisPointer: {
          type: "cross" as const,
          crossStyle: { color: "#94a3b8" },
          lineStyle: { color: "#94a3b8", type: "dashed" as const, width: 1 },
        },
        valueFormatter: (v: number) => (typeof v === "number" ? `${v.toFixed(2)}%` : "-"),
      },
      legend: {
        data: series.map((s) => s.name),
        selected: legendSelected,
        top: 8,
        left: 8,
        right: 8,
        icon: "roundRect",
        itemWidth: 16,
        itemHeight: 3,
        itemGap: 18,
        textStyle: { color: "#64748b", fontSize: 12 },
        selectedMode: true,
      },
      grid: { left: 12, right: 16, top: 52, bottom: 24, containLabel: true },
      xAxis: {
        type: "time" as const,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#e5e7eb" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          hideOverlap: true,
          margin: 10,
          formatter: (v: number) => {
            const d = new Date(v)
            const day = d.getDate()
            const month = d.getMonth() + 1
            if (day <= 3) return `${month}月`
            if ([8, 15, 22, 29].includes(day)) return String(day)
            return ""
          },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "年化升贴水率(%)",
        nameLocation: "middle" as const,
        nameGap: 48,
        nameTextStyle: { color: "#94a3b8", fontSize: 11 },
        scale: true,
        min: (extent: { min: number; max: number }) => niceYExtent(extent).min,
        max: (extent: { min: number; max: number }) => niceYExtent(extent).max,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { lineStyle: { color: "#eef2f6", type: "dashed" as const, width: 1 } },
      },
      series,
    }),
    [legendSelected, series],
  )

  const hasData = series.some((s) => s.data.length > 0)

  return (
    <div className="flex flex-col gap-3 -m-1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-white px-1">
        <div className="flex items-center gap-0">
          {PAGE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={[
                "px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px",
                activeTab === tab.key
                  ? "border-red-600 text-red-600 font-medium"
                  : "border-transparent text-zinc-600 hover:text-zinc-900",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 py-2">
          <span className="text-sm text-zinc-500 shrink-0">请选择时间范围：</span>
          <CompactDateInput value={draftFrom} onChange={setDraftFrom} placeholder="开始日期" />
          <span className="text-zinc-400 text-sm">~</span>
          <CompactDateInput value={draftTo} onChange={setDraftTo} placeholder="结束日期" />
          <button
            type="button"
            onClick={handleQuery}
            className="h-8 min-w-[4rem] px-4 rounded-sm border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            查询
          </button>
        </div>
      </div>

      {activeTab !== "quant" ? (
        <div className="px-1 py-16 text-center text-sm text-zinc-400">该功能正在建设中，敬请期待</div>
      ) : (
        <div className="px-1 pt-2">
          <h2 className="text-[15px] font-semibold text-red-600">对冲成本</h2>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-[3px] rounded-sm bg-red-500" />
                <span className="text-sm font-semibold text-zinc-800">股指期货升贴水率</span>
                <HelpAnnualizedDiscount />
              </div>
              <p className="mt-1 ml-[11px] text-xs text-zinc-400">年化升贴水率按交易日结算价更新。</p>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex items-center gap-1.5">
                {PRODUCTS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setProduct(code)}
                    className={[
                      "h-7 min-w-[2.5rem] px-2 rounded-sm border text-xs font-medium transition-colors",
                      product === code
                        ? "border-red-500 text-red-600 bg-white"
                        : "border-zinc-200 text-zinc-500 bg-white hover:border-zinc-300 hover:text-zinc-700",
                    ].join(" ")}
                  >
                    {code}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-colors"
                title="导出图片"
              >
                <Menu className="h-4 w-4" />
              </button>
            </div>
          </div>
          {loading ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-zinc-400">正在加载…</div>
          ) : error ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-red-500">{error}</div>
          ) : hasData ? (
            <ReactECharts ref={chartRef} option={option} style={{ height: 440 }} notMerge lazyUpdate />
          ) : (
            <div className="flex h-[420px] items-center justify-center text-sm text-zinc-400">所选区间暂无数据</div>
          )}
        </div>
      )}
    </div>
  )
}
