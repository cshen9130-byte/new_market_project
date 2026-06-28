"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import ReactECharts from "echarts-for-react"
import { ArrowLeft, BarChart2, Camera, Download } from "lucide-react"
import { FundDatabaseShell } from "@/components/ma/fund-database-shell"
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"
import { DerivativesPanel, type DerivativeRow } from "./DerivativesPanel"
import { SectorMarketSharePanel, type DerivativeSectorShareRow } from "./SectorMarketSharePanel"
import { OptionsPanel, type OptionRow } from "./OptionsPanel"
import { GreeksPanel, TermAnalysisPanel, type GreekLetterRow, type TermAnalysisRow } from "./GreeksTermPanel"
import { FofFundsPanel, type FundHoldingRow } from "./FofFundsPanel"
import { FofReturnCurvePanel, type ReturnCurveSeries } from "./FofReturnCurvePanel"
import { OtherHoldingsPanel, type OtherHoldingRow } from "./OtherHoldingsPanel"
import {
  AllocationTrendPanel,
  type AllocationTrendSeries,
} from "./AllocationTrendPanel"

type AllocationRow = {
  index: number
  category: string
  rowKind: string
  value: number
  pct: number
}

type ValuationData = {
  beian_hao: string
  product_name: string | null
  product_code: string | null
  fund_name: string | null
  valuation_date: string | null
  unit_nav: number | null
  unit_nav_date: string | null
  latest_nav_date: string | null
  net_asset_value: number | null
  total_asset: number | null
  custody_balance: number | null
  settlement_reserve: number | null
  margin_deposit: number | null
  paid_in_capital: number | null
  manager: string | null
  custodian: string | null
  inception_date: string | null
  layout_type: "fof" | "derivative"
  allocation: AllocationRow[]
  fund_holdings: FundHoldingRow[]
  return_curves: ReturnCurveSeries[]
  other_holdings: OtherHoldingRow[]
  derivatives: DerivativeRow[]
  derivative_sector_shares: DerivativeSectorShareRow[]
  options: OptionRow[]
  greek_letters: GreekLetterRow[]
  term_analysis: TermAnalysisRow[]
  has_data: boolean
  match_method: string | null
}

type AllocationTrendData = {
  dates: string[]
  series: AllocationTrendSeries[]
  has_data: boolean
  point_count: number
}

const VALUATION_TABS = [
  "业绩指标",
  "产品表现",
  "持仓要素",
  "持仓分析",
  "归因分析",
  "交易分析",
] as const

type ConfigMode = "major" | "strategy1" | "strategy2"

const ALLOCATION_COLORS: Record<string, string> = {
  托管户现金: "#1e3a5f",
  清算备付金: "#5b9bd5",
  存出保证金: "#ed7d31",
  私募基金: "#4472c4",
  公募基金: "#70ad47",
  其他: "#a5a5a5",
}

const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  portfolio: "port-simulated",
  investment: "inv-tracking",
  operations: "ops-strategy-tags",
}

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return `${n.toFixed(4)}%`
}

function fmtShares(n: number): string {
  return `${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 份`
}

function subtractFromDate(dateStr: string, amount: number, unit: "month" | "year"): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`)
  if (unit === "year") d.setFullYear(d.getFullYear() - amount)
  else d.setMonth(d.getMonth() - amount)
  return d.toISOString().slice(0, 10)
}

function resolvePeriodRange(
  period: string,
  endDate: string,
  inceptionDate?: string | null,
): { from: string; to: string } {
  const to = endDate.slice(0, 10)
  switch (period) {
    case "成立以来":
      return { from: inceptionDate?.slice(0, 10) ?? to, to }
    case "一年":
      return { from: subtractFromDate(to, 1, "year"), to }
    case "六月":
      return { from: subtractFromDate(to, 6, "month"), to }
    case "三月":
      return { from: subtractFromDate(to, 3, "month"), to }
    case "一月":
      return { from: subtractFromDate(to, 1, "month"), to }
    default:
      return { from: to, to }
  }
}

function valuationEndDate(data: ValuationData | null | undefined): string {
  return data?.valuation_date?.slice(0, 10) ?? data?.unit_nav_date ?? ""
}

function MetricLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-sm leading-7">
      <span className="text-zinc-500">{label}：</span>
      <span className="font-semibold text-zinc-900 tabular-nums">{value}</span>
    </div>
  )
}

function HeaderActionTip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <UiTooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="bg-zinc-800 text-white border-0 px-2.5 py-1 text-xs shadow-md [&>svg]:fill-zinc-800 [&>svg]:bg-zinc-800"
      >
        {label}
      </TooltipContent>
    </UiTooltip>
  )
}

async function downloadPageScreenshot(el: HTMLElement, filename: string) {
  const { default: html2canvas } = await import("html2canvas-pro")
  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true })
  const url = canvas.toDataURL("image/png")
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
}

export default function FundValuationAnalysisPage() {
  const params = useParams()
  const router = useRouter()
  const beian_hao = typeof params.beian_hao === "string" ? params.beian_hao : ""

  const [data, setData] = useState<ValuationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<(typeof VALUATION_TABS)[number]>("持仓要素")
  const [configMode, setConfigMode] = useState<ConfigMode>("major")

  const [filterPeriod, setFilterPeriod] = useState("一年")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterBench, setFilterBench] = useState("沪深300指数")

  const [returnCurves, setReturnCurves] = useState<ReturnCurveSeries[]>([])
  const [curvesLoading, setCurvesLoading] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)

  const [trendData, setTrendData] = useState<AllocationTrendData | null>(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendError, setTrendError] = useState<string | null>(null)

  const loadData = useCallback((mode: ConfigMode) => {
    if (!beian_hao) return
    setLoading(true)
    setError(null)
    setReturnCurves([])
    const qs = mode === "major" ? "mode=major" : "mode=all"
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/valuation?${qs}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({} as { error?: string }))
          throw new Error(body.error ?? `HTTP ${r.status}`)
        }
        return r.json() as Promise<ValuationData>
      })
      .then((d) => {
        setData(d)
        const endDate = valuationEndDate(d)
        if (endDate) {
          const { from, to } = resolvePeriodRange("一年", endDate, d.inception_date)
          setFilterFrom(from)
          setFilterTo(to)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false))
  }, [beian_hao])

  useEffect(() => {
    loadData(configMode)
  }, [loadData, configMode])

  const loadTrendData = useCallback(async () => {
    if (!beian_hao || !filterFrom || !filterTo) return null
    setTrendLoading(true)
    setTrendError(null)
    const qs = configMode === "major" ? "mode=major" : "mode=all"
    try {
      const r = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(beian_hao)}/valuation?trend=1&from=${encodeURIComponent(filterFrom)}&to=${encodeURIComponent(filterTo)}&${qs}`,
      )
      if (!r.ok) {
        const body = await r.json().catch(() => ({} as { error?: string }))
        throw new Error(body.error ?? `HTTP ${r.status}`)
      }
      const d = await r.json() as AllocationTrendData
      setTrendData(d)
      return d
    } catch (e) {
      const message = e instanceof Error ? e.message : "加载失败"
      setTrendError(message)
      setTrendData(null)
      return null
    } finally {
      setTrendLoading(false)
    }
  }, [beian_hao, configMode, filterFrom, filterTo])

  useEffect(() => {
    if (activeTab !== "持仓分析" || !beian_hao || !filterFrom || !filterTo) return
    void loadTrendData()
  }, [activeTab, beian_hao, filterFrom, filterTo, configMode, loadTrendData])

  useEffect(() => {
    if (!beian_hao || loading || error || data?.layout_type !== "fof" || !data.has_data) return
    let cancelled = false
    setCurvesLoading(true)
    const qs = configMode === "major" ? "mode=major&curves=1" : "mode=all&curves=1"
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/valuation?${qs}`)
      .then(async (r) => {
        if (!r.ok) return null
        return r.json() as Promise<ValuationData>
      })
      .then((d) => {
        if (!cancelled && d) setReturnCurves(d.return_curves ?? [])
      })
      .catch(() => {
        if (!cancelled) setReturnCurves([])
      })
      .finally(() => {
        if (!cancelled) setCurvesLoading(false)
      })
    return () => { cancelled = true }
  }, [beian_hao, configMode, loading, error, data?.layout_type, data?.has_data])

  const navigateFunds = useCallback((tab: string, side?: string) => {
    const sideItem = side ?? TAB_DEFAULT_SIDE[tab] ?? "private-funds"
    router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
  }, [router])

  const displayName = data?.product_name ?? data?.fund_name ?? beian_hao
  const navDateLabel = data?.unit_nav_date ?? data?.valuation_date?.slice(0, 10) ?? "—"
  const isFofLayout = data?.layout_type === "fof"

  const donutOption = useMemo(() => {
    if (!data?.allocation.length) return {}
    return {
      color: data.allocation.map((r) => ALLOCATION_COLORS[r.category] ?? "#a5a5a5"),
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/>${fmtMoney(p.value)} (${p.percent.toFixed(4)}%)`,
      },
      legend: {
        orient: "horizontal",
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12, color: "#666" },
        data: data.allocation.map((r) => r.category),
      },
      series: [{
        type: "pie",
        radius: ["48%", "72%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        label: {
          show: true,
          formatter: (p: { name: string; percent: number }) => `${p.name}: ${p.percent.toFixed(4)}%`,
          fontSize: 11,
        },
        labelLine: { length: 10, length2: 6 },
        data: data.allocation.map((r) => ({
          name: r.category,
          value: r.value,
          itemStyle: { color: ALLOCATION_COLORS[r.category] ?? "#a5a5a5" },
        })),
      }],
    }
  }, [data?.allocation])

  function applyPeriod(period: string) {
    setFilterPeriod(period)
    if (period === "自定义" || !data) return
    const endDate = valuationEndDate(data)
    if (!endDate) return
    const { from, to } = resolvePeriodRange(period, endDate, data.inception_date)
    setFilterFrom(from)
    setFilterTo(to)
  }

  function handleStartAnalysis() {
    loadData(configMode)
    if (activeTab === "持仓分析") {
      void loadTrendData()
    }
  }

  function handleReset() {
    if (!data) return
    const endDate = valuationEndDate(data)
    setFilterPeriod("一年")
    if (endDate) {
      const { from, to } = resolvePeriodRange("一年", endDate, data.inception_date)
      setFilterFrom(from)
      setFilterTo(to)
    }
    setFilterBench("沪深300指数")
    setConfigMode("major")
  }

  function handleExportCsv() {
    if (!data?.allocation.length) return
    const lines = [
      ["序号", "资产类别", "市值", "市值占比"].join(","),
      ...data.allocation.map((r) =>
        [r.index, r.category, r.value.toFixed(2), r.pct.toFixed(4)].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_资产配置_${data.valuation_date?.slice(0, 10) ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const handleScreenshot = useCallback(async () => {
    const el = captureRef.current
    if (!el) return
    const dateLabel = data?.valuation_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
    await downloadPageScreenshot(el, `${displayName}_估值表分析_${dateLabel}.png`)
  }, [data?.valuation_date, displayName])

  return (
    <FundDatabaseShell onNavigate={navigateFunds}>
      <div className="min-h-0">
      <Link
        href={`/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}`}
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        返回基金详情
      </Link>

      <div ref={captureRef}>
      {/* Header */}
      <div className="bg-white rounded-lg border border-zinc-100 px-5 py-4 mb-3">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900">{displayName}</h1>
            <span className="px-2 py-0.5 rounded text-xs border border-red-400 text-red-500 font-medium bg-red-50/50">
              估值表分析
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <HeaderActionTip label="截图">
              <button
                type="button"
                onClick={() => { void handleScreenshot() }}
                className="p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                <Camera className="h-[18px] w-[18px]" />
              </button>
            </HeaderActionTip>
            <HeaderActionTip label="估值表列表">
              <button
                type="button"
                onClick={() => router.push(
                  `/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}/valuation/records`,
                )}
                className="p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                <BarChart2 className="h-[18px] w-[18px]" />
              </button>
            </HeaderActionTip>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-1">
          {/* Left column */}
          <div className="space-y-0">
            <MetricLine
              label="最新净值"
              value={
                <>
                  {data?.unit_nav != null ? data.unit_nav.toFixed(4) : "—"}
                  <span className="text-zinc-400 text-xs font-normal ml-1">({navDateLabel})</span>
                </>
              }
            />
            <MetricLine
              label="资产净值"
              value={data?.net_asset_value != null ? `${fmtMoney(data.net_asset_value)} 元` : "—"}
            />
            <MetricLine
              label="实收资本"
              value={data?.paid_in_capital != null ? fmtShares(data.paid_in_capital) : "—"}
            />
            <MetricLine label="基金经理" value={data?.manager?.trim() ? data.manager : "—"} />
          </div>

          {/* Middle column */}
          <div className="space-y-0">
            <MetricLine
              label="托管户现金"
              value={data?.custody_balance != null ? `${fmtMoney(data.custody_balance)} 元` : "—"}
            />
            <MetricLine
              label="清算备付金"
              value={
                data?.settlement_reserve != null
                  ? `${fmtMoney(data.settlement_reserve)} 元`
                  : data?.has_data
                    ? `${fmtMoney(0)} 元`
                    : "—"
              }
            />
            <MetricLine
              label="存出保证金"
              value={
                data?.margin_deposit != null
                  ? `${fmtMoney(data.margin_deposit)} 元`
                  : data?.has_data
                    ? `${fmtMoney(0)} 元`
                    : "—"
              }
            />
          </div>

          {/* Right column */}
          <div className="space-y-0 md:text-right">
            <MetricLine
              label="总资产"
              value={data?.total_asset != null ? `${fmtMoney(data.total_asset)} 元` : "—"}
            />
            <MetricLine label="托管券商" value={data?.custodian?.trim() ? data.custodian : "—"} />
            <MetricLine label="备案编号" value={data?.beian_hao ?? beian_hao} />
            <MetricLine label="成立日期" value={data?.inception_date ?? "—"} />
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 mb-3 rounded-lg border border-zinc-100 bg-zinc-50 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">统计区间：</span>
          <select
            value={filterPeriod}
            onChange={(e) => applyPeriod(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
          >
            {["成立以来", "一年", "六月", "三月", "一月", "自定义"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <input
          type="date"
          value={filterFrom}
          onChange={(e) => { setFilterFrom(e.target.value); setFilterPeriod("自定义") }}
          className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
        />
        <span className="text-zinc-400">～</span>
        <input
          type="date"
          value={filterTo}
          onChange={(e) => { setFilterTo(e.target.value); setFilterPeriod("自定义") }}
          className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">业绩基准：</span>
          <select
            value={filterBench}
            onChange={(e) => setFilterBench(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none min-w-[120px]"
          >
            {["沪深300指数", "中证500指数", "无"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 rounded border border-red-500 text-red-500 hover:bg-red-50 font-medium transition-colors"
          >
            重置
          </button>
          <button
            type="button"
            onClick={handleStartAnalysis}
            className="px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
          >
            开始分析
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-zinc-100 mb-4 overflow-x-auto bg-white px-1">
        {VALUATION_TABS.map((tab) => {
          const enabled = tab === "持仓要素" || tab === "持仓分析"
          return (
          <button
            key={tab}
            type="button"
            disabled={!enabled}
            onClick={() => enabled && setActiveTab(tab)}
            className={[
              "pb-2.5 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              tab === activeTab
                ? "text-red-500 border-red-500 font-medium"
                : enabled
                  ? "text-zinc-500 border-transparent hover:text-zinc-700"
                  : "text-zinc-300 border-transparent cursor-not-allowed",
            ].join(" ")}
          >
            {tab}
          </button>
          )
        })}
      </div>

      {loading && (
        <div className="bg-white rounded-lg border border-zinc-100 p-12 text-center text-sm text-zinc-400">
          加载估值表数据…
        </div>
      )}

      {error && (
        <div className="bg-white rounded-lg border border-red-200 p-6 text-sm text-red-600">
          加载失败：{error}
        </div>
      )}

      {!loading && !error && data && !data.has_data && activeTab === "持仓要素" && (
        <div className="bg-white rounded-lg border border-zinc-100 p-10 text-center">
          <p className="text-zinc-700 font-medium mb-2">暂无估值表数据</p>
          <p className="text-sm text-zinc-500 max-w-lg mx-auto leading-relaxed">
            尚未从邮件中抓取到该基金的估值表。估值表由 nightly ETL 从运维邮箱同步，请确认邮箱已收到附件，或在「运维 → 邮件解析」中手动触发抓取。
          </p>
        </div>
      )}

      {!loading && !error && activeTab === "持仓分析" && (
        <>
          {trendError && (
            <div className="bg-white rounded-lg border border-red-200 p-4 mb-4 text-sm text-red-600">
              加载失败：{trendError}
            </div>
          )}
          <AllocationTrendPanel
            dates={trendData?.dates ?? []}
            series={trendData?.series ?? []}
            displayName={displayName}
            fromDate={filterFrom}
            toDate={filterTo}
            loading={trendLoading}
          />
        </>
      )}

      {!loading && !error && data?.has_data && activeTab === "持仓要素" && (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 bg-white rounded-lg border border-zinc-100 p-4 shadow-sm">
            <div className="text-red-500 font-semibold text-sm mb-0.5">资产配置</div>
            <div className="text-zinc-400 text-xs mb-2">
              规模统计 {data.valuation_date?.slice(0, 10) ?? "—"}
            </div>
            {data.allocation.length > 0 ? (
              <ReactECharts option={donutOption} style={{ height: 300 }} notMerge />
            ) : (
              <div className="h-[300px] flex items-center justify-center text-sm text-zinc-400">
                无资产配置明细
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-zinc-50">
              <button
                type="button"
                onClick={handleExportCsv}
                className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors"
                title="导出"
              >
                <Download className="h-4 w-4" />
              </button>
              <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
                {!isFofLayout && ([
                  ["major", "大类配置"],
                  ["strategy1", "一级策略"],
                  ["strategy2", "二级策略"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setConfigMode(key)}
                    className={[
                      "px-3 py-1 transition-colors",
                      configMode === key
                        ? "bg-red-50 text-red-500 border-red-400 font-medium"
                        : "text-zinc-600 hover:bg-zinc-50",
                      key !== "major" ? "border-l border-zinc-200" : "",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">资产类别</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">市值</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-zinc-500 w-32">市值占比</th>
                </tr>
              </thead>
              <tbody>
                {data.allocation.map((row) => (
                  <tr key={row.rowKind} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                    <td className="px-4 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
                    <td className="px-4 py-2.5 text-zinc-800">{row.category}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-800">{fmtMoney(row.value)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {configMode !== "major" && !isFofLayout && (
              <p className="px-4 py-3 text-xs text-zinc-400 border-t border-zinc-50">
                一级/二级策略视图开发中，当前展示全部资产类别。
              </p>
            )}
          </div>
        </div>

        {isFofLayout ? (
          <>
            <FofFundsPanel
              rows={data.fund_holdings ?? []}
              valuationDate={data.valuation_date}
              displayName={displayName}
            />
            <FofReturnCurvePanel
              series={returnCurves.length > 0 ? returnCurves : (data.return_curves ?? [])}
              loading={curvesLoading}
              displayName={displayName}
              fromDate={filterFrom}
              toDate={filterTo}
              benchmark={filterBench}
            />
            <OtherHoldingsPanel
              rows={data.other_holdings ?? []}
              valuationDate={data.valuation_date}
              displayName={displayName}
            />
          </>
        ) : (
          <>
        <DerivativesPanel
          derivatives={data.derivatives ?? []}
          valuationDate={data.valuation_date}
          displayName={displayName}
        />

        <SectorMarketSharePanel
          rows={data.derivative_sector_shares ?? []}
          displayName={displayName}
          valuationDate={data.valuation_date}
        />

        <OptionsPanel
          options={data.options ?? []}
          valuationDate={data.valuation_date}
          displayName={displayName}
        />

        <GreeksPanel greekLetters={data.greek_letters ?? []} />

        <TermAnalysisPanel termAnalysis={data.term_analysis ?? []} />
          </>
        )}
        </>
      )}
      </div>
      </div>
    </FundDatabaseShell>
  )
}
