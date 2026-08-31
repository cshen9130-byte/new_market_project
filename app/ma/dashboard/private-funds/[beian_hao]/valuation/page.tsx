"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import dynamic from "next/dynamic"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, BarChart2, Camera, Download } from "lucide-react"
import { FundDatabaseShell } from "@/components/ma/fund-database-shell"
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"
import type { DerivativeRow } from "./DerivativesPanel"
import type { DerivativeSectorShareRow } from "./SectorMarketSharePanel"
import type { OptionRow } from "./OptionsPanel"
import type { GreekLetterRow, TermAnalysisRow } from "./GreeksTermPanel"
import { FofFundsPanel, type FundHoldingRow } from "./FofFundsPanel"
import type { ReturnCurveSeries } from "./FofReturnCurvePanel"
import { OtherHoldingsPanel, type OtherHoldingRow } from "./OtherHoldingsPanel"
import type { ValuationHoldingDetailRow, StockRiskExposure } from "./EquityValuationPanel"
import type { AllocationTrendSeries } from "./AllocationTrendPanel"
import type { SectorWeightTrendData } from "./SectorWeightTrendPanel"
import type { LongShortMvTrendData } from "./LongShortMvTrendPanel"
import type { ContractMvShareTrendData } from "./ContractMvShareTrendPanel"
import type { ContractEquityTrendData } from "./ContractEquityTrendPanel"
import type { FofTrendAnalysisData } from "./FofShareTrendPanel"
import { IntervalMetricsTable, buildBenchmarkIntervalMetrics, type IntervalMetricValues } from "../components/IntervalMetricsTable"
import { buildFundIntervalMetricsFromNav } from "../components/performanceChartUtils"
import { resolveDefaultBenchmarkKey } from "@/lib/ma/team-benchmark"
import { resolveFundDisplayLabel } from "@/lib/fund-display-name"
import { computeFundNavMetrics } from "@/lib/fund-nav-metrics"
import { getNavFieldValue, type NavRow, type BenchmarkPoint, type PeerMonthlyRow, type PeerYearlyRow, type AnnualFundRow } from "../components/shared"
import { ChartCalcHelpButton } from "./ChartCalcHelpButton"

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false })
const FofVolatilityAnalysisPanel = dynamic(
  () => import("./FofVolatilityAnalysisPanel").then((m) => ({ default: m.FofVolatilityAnalysisPanel })),
  { ssr: false },
)
const FofReturnCurvePanel = dynamic(
  () => import("./FofReturnCurvePanel").then((m) => m.FofReturnCurvePanel),
  { ssr: false },
)
const FofReturnAnalysisPanel = dynamic(
  () => import("./FofReturnAnalysisPanel").then((m) => m.FofReturnAnalysisPanel),
  { ssr: false },
)
const ValuationEmptyAnalysis = dynamic(
  () => import("./ValuationEmptyAnalysis").then((m) => m.ValuationEmptyAnalysis),
  { ssr: false },
)
const FofTransactionAnalysisPanel = dynamic(
  () => import("./FofTransactionAnalysisPanel").then((m) => m.FofTransactionAnalysisPanel),
  { ssr: false },
)
const FofAllocationRiskCharts = dynamic(
  () => import("./FofAllocationRiskCharts").then((m) => ({ default: m.FofAllocationRiskCharts })),
  { ssr: false },
)
const FofRegimeAttributionPanel = dynamic(
  () => import("./FofRegimeAttributionPanel").then((m) => m.FofRegimeAttributionPanel),
  { ssr: false },
)
const EquityValuationPanel = dynamic(
  () => import("./EquityValuationPanel").then((m) => m.EquityValuationPanel),
  { ssr: false },
)
const DerivativesPanel = dynamic(
  () => import("./DerivativesPanel").then((m) => m.DerivativesPanel),
  { ssr: false },
)
const SectorMarketSharePanel = dynamic(
  () => import("./SectorMarketSharePanel").then((m) => m.SectorMarketSharePanel),
  { ssr: false },
)
const OptionsPanel = dynamic(
  () => import("./OptionsPanel").then((m) => m.OptionsPanel),
  { ssr: false },
)
const GreeksPanel = dynamic(
  () => import("./GreeksTermPanel").then((m) => m.GreeksPanel),
  { ssr: false },
)
const TermAnalysisPanel = dynamic(
  () => import("./GreeksTermPanel").then((m) => m.TermAnalysisPanel),
  { ssr: false },
)
const AllocationTrendPanel = dynamic(
  () => import("./AllocationTrendPanel").then((m) => m.AllocationTrendPanel),
  { ssr: false },
)
const SectorWeightTrendPanel = dynamic(
  () => import("./SectorWeightTrendPanel").then((m) => m.SectorWeightTrendPanel),
  { ssr: false },
)
const LongShortMvTrendPanel = dynamic(
  () => import("./LongShortMvTrendPanel").then((m) => m.LongShortMvTrendPanel),
  { ssr: false },
)
const ContractMvShareTrendPanel = dynamic(
  () => import("./ContractMvShareTrendPanel").then((m) => m.ContractMvShareTrendPanel),
  { ssr: false },
)
const ContractEquityTrendPanel = dynamic(
  () => import("./ContractEquityTrendPanel").then((m) => m.ContractEquityTrendPanel),
  { ssr: false },
)
const FofShareTrendPanel = dynamic(
  () => import("./FofShareTrendPanel").then((m) => m.FofShareTrendPanel),
  { ssr: false },
)
const WinRateAnalysisPanel = dynamic(
  () => import("../components/WinRateAnalysisPanel").then((m) => m.WinRateAnalysisPanel),
  { ssr: false },
)
const FundPerformanceIndicatorsPanel = dynamic(
  () => import("../components/FundPerformanceIndicatorsPanel").then((m) => m.FundPerformanceIndicatorsPanel),
  { ssr: false },
)
const MonthlyReturnsCalendar = dynamic(
  () => import("../components/MonthlyReturnsCalendar").then((m) => m.MonthlyReturnsCalendar),
  { ssr: false },
)
const AnnualMetricsTable = dynamic(
  () => import("../components/AnnualMetricsTable").then((m) => m.AnnualMetricsTable),
  { ssr: false },
)

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
  layout_type: "fof" | "derivative" | "equity"
  allocation: AllocationRow[]
  fund_holdings: FundHoldingRow[]
  stock_holdings: ValuationHoldingDetailRow[]
  bond_holdings: ValuationHoldingDetailRow[]
  wealth_holdings: ValuationHoldingDetailRow[]
  equity_other_holdings: ValuationHoldingDetailRow[]
  stock_risk_exposure: StockRiskExposure | null
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
  sector_trend?: SectorWeightTrendData
  long_short_trend?: LongShortMvTrendData
  contract_mv_trend?: ContractMvShareTrendData
  contract_equity_trend?: ContractEquityTrendData
  fof_trend?: FofTrendAnalysisData | null
}

const VALUATION_TABS = [
  "业绩指标",
  "产品表现",
  "持仓要素",
  "持仓分析",
  "收益分析",
  "归因分析",
  "交易分析",
] as const

type ConfigMode = "major" | "strategy1" | "strategy2"

const ALLOCATION_COLORS: Record<string, string> = {
  托管户现金: "#1e3a5f",
  清算备付金: "#5b9bd5",
  存出保证金: "#ed7d31",
  债券: "#548235",
  股票: "#2e75b6",
  理财: "#bf9000",
  私募基金: "#4472c4",
  公募基金: "#70ad47",
  其他: "#a5a5a5",
}

const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  portfolio: "port-simulated",
  investment: "inv-tracking",
  operations: "ops-strategy-tags",
  reports: "rpt-mine",
}

const BENCHMARK_OPTIONS = [
  { label: "无", key: "" },
  { label: "沪深300指数", key: "IF" },
  { label: "中证500指数", key: "IC" },
  { label: "中证1000", key: "IM" },
  { label: "上证50", key: "IH" },
  { label: "南华商品指数", key: "NHCI.NH" },
  { label: "中证商品指数", key: "100001.CCI" },
  { label: "国债ETF", key: "511010.SH" },
  { label: "黄金ETF", key: "518880.SH" },
] as const

function benchmarkKeyFromLabel(label: string): string {
  const hit = BENCHMARK_OPTIONS.find((o) => o.label === label)
  if (hit) return hit.key
  const text = label.replace(/\s+/g, "")
  if (text.includes("中证1000")) return "IM"
  if (text.includes("中证500")) return "IC"
  if (text.includes("沪深300")) return "IF"
  if (text.includes("上证50")) return "IH"
  if (text.includes("中证商品")) return "100001.CCI"
  if (text.includes("南华商品")) return "NHCI.NH"
  if (text.includes("国债")) return "511010.SH"
  if (text.includes("黄金")) return "518880.SH"
  return ""
}

function benchmarkLabelFromKey(key: string): string {
  return BENCHMARK_OPTIONS.find((o) => o.key === key)?.label ?? "业绩基准"
}

function normalizeBenchmarkLabel(raw: string | null | undefined): string {
  const key = benchmarkKeyFromLabel(raw ?? "")
  if (key) return benchmarkLabelFromKey(key)
  return "沪深300指数"
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

  const [navRows, setNavRows] = useState<NavRow[]>([])
  const [navLoading, setNavLoading] = useState(false)
  const [navError, setNavError] = useState<string | null>(null)
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkPoint[]>([])
  const [fundStrategy, setFundStrategy] = useState<string | null>(null)
  const [filterNavType, setFilterNavType] = useState("复权净值")
  const [peerMonthly, setPeerMonthly] = useState<PeerMonthlyRow[]>([])
  const [peerYearly, setPeerYearly] = useState<PeerYearlyRow[]>([])
  const [fundInfoMetrics, setFundInfoMetrics] = useState<IntervalMetricValues | null>(null)

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

  const loadReturnCurves = useCallback(async () => {
    if (!beian_hao || !filterFrom || !filterTo) return
    setCurvesLoading(true)
    const modeQs = configMode === "major" ? "mode=major" : "mode=all"
    try {
      const r = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(beian_hao)}/valuation?${modeQs}&curves=1&from=${encodeURIComponent(filterFrom)}&to=${encodeURIComponent(filterTo)}`,
      )
      if (!r.ok) {
        setReturnCurves([])
        return
      }
      const d = await r.json() as ValuationData
      setReturnCurves(d.return_curves ?? [])
    } catch {
      setReturnCurves([])
    } finally {
      setCurvesLoading(false)
    }
  }, [beian_hao, configMode, filterFrom, filterTo])

  const loadProductPerformance = useCallback(async () => {
    if (!beian_hao || !filterFrom || !filterTo) return
    setNavLoading(true)
    setNavError(null)
    try {
      const r = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}`)
      if (!r.ok) {
        const body = await r.json().catch(() => ({} as { error?: string }))
        throw new Error(body.error ?? `HTTP ${r.status}`)
      }
      const json = await r.json() as {
        nav_series?: NavRow[]
        metrics?: { latest_nav_date?: string | null }
        info?: {
          strategy_l1?: string | null
          strategy_l2?: string | null
          benchmark?: string | null
          team_benchmark?: string | null
          ret_1w?: string | null
          ret_1m?: string | null
          ret_3m?: string | null
          ret_6m?: string | null
          ret_1y?: string | null
          sharpe_1y?: string | null
          calmar_1y?: string | null
        }
      }
      const series = (json.nav_series ?? []).filter(
        (row) => row.price_date >= filterFrom && row.price_date <= filterTo,
      )
      setNavRows(series)
      setFundStrategy(json.info?.strategy_l1 ?? json.info?.strategy_l2 ?? null)
      const info = json.info
      const resolvedKey = resolveDefaultBenchmarkKey({
        teamBenchmark: info?.team_benchmark,
        strategyL1: info?.strategy_l1,
        strategyL2: info?.strategy_l2,
      })
      const nextBench = resolvedKey
        ? benchmarkLabelFromKey(resolvedKey)
        : info?.benchmark
          ? normalizeBenchmarkLabel(info.benchmark)
          : filterBench
      if (resolvedKey || info?.benchmark) setFilterBench(nextBench)
      setFundInfoMetrics(info ? {
        ret_1w:    info.ret_1w    ? parseFloat(info.ret_1w)    : null,
        ret_1m:    info.ret_1m    ? parseFloat(info.ret_1m)    : null,
        ret_3m:    info.ret_3m    ? parseFloat(info.ret_3m)    : null,
        ret_6m:    info.ret_6m    ? parseFloat(info.ret_6m)    : null,
        ret_1y:    info.ret_1y    ? parseFloat(info.ret_1y)    : null,
        sharpe_1y: info.sharpe_1y ? parseFloat(info.sharpe_1y) : null,
        calmar_1y: info.calmar_1y ? parseFloat(info.calmar_1y) : null,
      } : null)

      const benchKey = benchmarkKeyFromLabel(nextBench)
      if (!benchKey || series.length < 2) {
        setBenchmarkData([])
        return
      }
      const benchRes = await fetch(
        `/ma/api/private-funds/benchmark?key=${encodeURIComponent(benchKey)}&from=${encodeURIComponent(filterFrom)}&to=${encodeURIComponent(filterTo)}`,
      )
      const benchJson = await benchRes.json() as { ok?: boolean; data?: BenchmarkPoint[] }
      setBenchmarkData(benchRes.ok && benchJson.ok && Array.isArray(benchJson.data) ? benchJson.data : [])
    } catch (e) {
      const message = e instanceof Error ? e.message : "加载失败"
      setNavError(message)
      setNavRows([])
      setBenchmarkData([])
    } finally {
      setNavLoading(false)
    }
  }, [beian_hao, filterFrom, filterTo, filterBench])

  useEffect(() => {
    const needsNav =
      activeTab === "产品表现"
      || activeTab === "业绩指标"
      || activeTab === "归因分析"
    if (!needsNav || !beian_hao || !filterFrom || !filterTo) return
    void loadProductPerformance()
  }, [activeTab, beian_hao, filterFrom, filterTo, filterBench, loadProductPerformance])

  useEffect(() => {
    if (!beian_hao || !fundStrategy) {
      setPeerMonthly([])
      setPeerYearly([])
      return
    }
    const qs = `strategy=${encodeURIComponent(fundStrategy)}`
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/peer-monthly?${qs}`)
      .then((r) => r.ok ? r.json() : { monthly: [] })
      .then((d) => { if (Array.isArray(d.monthly)) setPeerMonthly(d.monthly) })
      .catch(() => setPeerMonthly([]))
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/peer-yearly?${qs}`)
      .then((r) => r.ok ? r.json() : { yearly: [] })
      .then((d) => { if (Array.isArray(d.yearly)) setPeerYearly(d.yearly) })
      .catch(() => setPeerYearly([]))
  }, [beian_hao, fundStrategy])

  useEffect(() => {
    if (!beian_hao || loading || error || data?.layout_type !== "fof" || !data.has_data) return
    if (
      activeTab !== "收益分析"
      && activeTab !== "持仓要素"
      && activeTab !== "归因分析"
      && activeTab !== "持仓分析"
    ) return
    if (!filterFrom || !filterTo) return
    void loadReturnCurves()
  }, [beian_hao, configMode, loading, error, data?.layout_type, data?.has_data, activeTab, filterFrom, filterTo, loadReturnCurves])

  const navigateFunds = useCallback((tab: string, side?: string) => {
    const sideItem = side ?? TAB_DEFAULT_SIDE[tab] ?? "private-funds"
    router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
  }, [router])

  const displayName = resolveFundDisplayLabel(
    null,
    data?.product_name ?? data?.fund_name ?? beian_hao,
  )
  const navDateLabel = data?.unit_nav_date ?? data?.valuation_date?.slice(0, 10) ?? "—"
  const isFofLayout = data?.layout_type === "fof" || Boolean(trendData?.fof_trend)
  const isEquityLayout = data?.layout_type === "equity"
  const hasFundHoldings = (data?.fund_holdings?.length ?? 0) > 0
  const showReturnAnalysis = isFofLayout && hasFundHoldings
  const appliedBenchKey = benchmarkKeyFromLabel(filterBench)
  const hasBenchmark = Boolean(appliedBenchKey && benchmarkData.length > 0)
  const benchmarkLabel = benchmarkLabelFromKey(appliedBenchKey)
  const productDateRangeLabel = filterFrom && filterTo ? `${filterFrom} ~ ${filterTo}` : ""

  const intervalCutoffDate = useMemo(() => {
    if (navRows.length > 0) {
      const sorted = [...navRows].sort((a, b) => a.price_date.localeCompare(b.price_date))
      return sorted[sorted.length - 1].price_date.slice(0, 10)
    }
    return filterTo.slice(0, 10)
  }, [navRows, filterTo])

  const fundIntervalMetrics = useMemo((): IntervalMetricValues => {
    if (!intervalCutoffDate) {
      return fundInfoMetrics ?? {
        ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null, sharpe_1y: null, calmar_1y: null,
      }
    }
    const fromNav = buildFundIntervalMetricsFromNav(navRows, filterNavType, intervalCutoffDate)
    if (!fundInfoMetrics) return fromNav
    return {
      ret_1w:    fundInfoMetrics.ret_1w    ?? fromNav.ret_1w,
      ret_1m:    fundInfoMetrics.ret_1m    ?? fromNav.ret_1m,
      ret_3m:    fundInfoMetrics.ret_3m    ?? fromNav.ret_3m,
      ret_6m:    fundInfoMetrics.ret_6m    ?? fromNav.ret_6m,
      ret_1y:    fundInfoMetrics.ret_1y    ?? fromNav.ret_1y,
      sharpe_1y: fundInfoMetrics.sharpe_1y ?? fromNav.sharpe_1y,
      calmar_1y: fundInfoMetrics.calmar_1y ?? fromNav.calmar_1y,
    }
  }, [navRows, filterNavType, intervalCutoffDate, fundInfoMetrics])

  const benchmarkIntervalMetrics = useMemo(() => {
    if (!hasBenchmark || !benchmarkData.length || !intervalCutoffDate) return null
    return buildBenchmarkIntervalMetrics(benchmarkData, intervalCutoffDate)
  }, [hasBenchmark, benchmarkData, intervalCutoffDate])

  const annualFundRows = useMemo((): AnnualFundRow[] => {
    if (navRows.length < 2) return []
    const groups = new Map<number, NavRow[]>()
    for (const row of navRows) {
      const year = parseInt(row.price_date.slice(0, 4), 10)
      if (!groups.has(year)) groups.set(year, [])
      groups.get(year)!.push(row)
    }
    const out: AnnualFundRow[] = []
    for (const [year, rows] of groups) {
      const sorted = [...rows].sort((a, b) => a.price_date.localeCompare(b.price_date))
      const dates = sorted.map((r) => r.price_date)
      const values = sorted.map((r) => getNavFieldValue(r, filterNavType))
      const metrics = computeFundNavMetrics({ dates, values })
      if (metrics) {
        out.push({
          year,
          interval: `${dates[0]} ~ ${dates[dates.length - 1]}`,
          metrics,
        })
      }
    }
    return out.sort((a, b) => b.year - a.year)
  }, [navRows, filterNavType])

  const peerByYear = useMemo(() => {
    const m = new Map<number, PeerYearlyRow>()
    for (const row of peerYearly) m.set(row.year, row)
    return m
  }, [peerYearly])

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
    if (activeTab === "收益分析" || activeTab === "持仓要素" || activeTab === "归因分析" || activeTab === "持仓分析") {
      void loadReturnCurves()
    }
    if (
      activeTab === "产品表现"
      || activeTab === "业绩指标"
      || activeTab === "归因分析"
    ) {
      void loadProductPerformance()
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
    setFilterNavType("复权净值")
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
          <span className="text-zinc-500 whitespace-nowrap">净值类型：</span>
          <select
            value={filterNavType}
            onChange={(e) => setFilterNavType(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none min-w-[88px]"
          >
            {["单位净值", "累计净值", "复权净值"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">业绩基准：</span>
          <select
            value={filterBench}
            onChange={(e) => setFilterBench(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none min-w-[120px]"
          >
            {BENCHMARK_OPTIONS.map((o) => (
              <option key={o.label}>{o.label}</option>
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
          const enabled =
            tab === "持仓要素"
            || tab === "持仓分析"
            || tab === "收益分析"
            || tab === "产品表现"
            || tab === "业绩指标"
            || tab === "交易分析"
            || tab === "归因分析"
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
            尚未抓取到该基金的估值表。可由 nightly ETL 从运维邮箱同步，也可在「运维 → 团队数据 → 估值表管理」手动上传，或在「运维 → 邮件解析」中触发抓取。
          </p>
        </div>
      )}

      {!loading && !error && activeTab === "业绩指标" && (
        <>
          {navError && (
            <div className="bg-white rounded-lg border border-red-200 p-4 mb-4 text-sm text-red-600">
              加载失败：{navError}
            </div>
          )}
          {navLoading ? (
            <div className="bg-white rounded-lg border border-zinc-100 p-12 text-center text-sm text-zinc-400">
              加载业绩指标数据…
            </div>
          ) : navRows.length < 2 ? (
            <div className="bg-white rounded-lg border border-zinc-100 p-12 text-center text-sm text-zinc-400">
              所选区间净值数据不足，无法展示业绩指标分析
            </div>
          ) : (
            <>
              <FundPerformanceIndicatorsPanel
                productName={displayName}
                rows={navRows}
                navType={filterNavType}
                benchmarkSeries={benchmarkData}
                benchmarkLabel={benchmarkLabel}
                hasBenchmark={hasBenchmark}
                dateFrom={filterFrom}
                dateTo={filterTo}
              />

              <IntervalMetricsTable
                productName={displayName}
                sampleGroup={fundStrategy}
                cutoffDate={intervalCutoffDate}
                fundMetrics={fundIntervalMetrics}
                benchmarkLabel={benchmarkLabel}
                benchmarkMetrics={benchmarkIntervalMetrics}
                hasBenchmark={hasBenchmark}
              />

              <MonthlyReturnsCalendar
                productName={displayName}
                sampleGroup={fundStrategy}
                rows={navRows}
                navType={filterNavType}
                peerMonthly={peerMonthly}
              />

              {annualFundRows.length > 0 && (
                <AnnualMetricsTable
                  productName={displayName}
                  sampleGroup={fundStrategy}
                  dateRangeLabel={productDateRangeLabel}
                  fundRows={annualFundRows}
                  peerByYear={peerByYear}
                  hasBenchmark={hasBenchmark}
                />
              )}
            </>
          )}
        </>
      )}

      {!loading && !error && activeTab === "产品表现" && (
        <>
          {navError && (
            <div className="bg-white rounded-lg border border-red-200 p-4 mb-4 text-sm text-red-600">
              加载失败：{navError}
            </div>
          )}
          {navLoading ? (
            <div className="bg-white rounded-lg border border-zinc-100 p-12 text-center text-sm text-zinc-400">
              加载产品表现数据…
            </div>
          ) : navRows.length < 2 ? (
            <div className="bg-white rounded-lg border border-zinc-100 p-12 text-center text-sm text-zinc-400">
              所选区间净值数据不足，无法展示产品表现分析
            </div>
          ) : (
            <WinRateAnalysisPanel
              beian_hao={beian_hao}
              productName={displayName}
              dateRangeLabel={productDateRangeLabel}
              rows={navRows}
              navType={filterNavType}
              benchmarkSeries={benchmarkData}
              benchmarkLabel={benchmarkLabel}
              hasBenchmark={hasBenchmark}
              sampleGroup={fundStrategy}
              companyStrategy={fundStrategy}
            />
          )}
        </>
      )}

      {!loading && !error && activeTab === "收益分析" && (
        showReturnAnalysis ? (
          <FofReturnAnalysisPanel
            series={returnCurves.length > 0 ? returnCurves : (data?.return_curves ?? [])}
            fundHoldings={data?.fund_holdings ?? []}
            loading={curvesLoading}
            displayName={displayName}
            fromDate={filterFrom}
            toDate={filterTo}
          />
        ) : (
          <ValuationEmptyAnalysis message="【当前产品没有基金持仓，不支持该类分析】" />
        )
      )}

      {!loading && !error && activeTab === "交易分析" && beian_hao && (
        <FofTransactionAnalysisPanel
          beianHao={beian_hao}
          productName={data?.product_name ?? data?.fund_name ?? null}
        />
      )}

      {!loading && !error && activeTab === "归因分析" && (
        showReturnAnalysis ? (
          <FofRegimeAttributionPanel
            displayName={displayName}
            navRows={navRows}
            navType={filterNavType}
            fromDate={filterFrom}
            toDate={filterTo}
            series={returnCurves.length > 0 ? returnCurves : (data?.return_curves ?? [])}
            fundHoldings={data?.fund_holdings ?? []}
            navLoading={navLoading}
            curvesLoading={curvesLoading}
          />
        ) : (
          <ValuationEmptyAnalysis message="【当前产品没有基金持仓，不支持该类分析】" />
        )
      )}

      {!loading && !error && activeTab === "持仓分析" && (
        <>
          {trendError && (
            <div className="bg-white rounded-lg border border-red-200 p-4 mb-4 text-sm text-red-600">
              加载失败：{trendError}
            </div>
          )}
          {isFofLayout && (
            <p className="text-xs text-zinc-500 mb-3">
              基金持仓分析所显示的占比均为市值占资产净值。
            </p>
          )}
          <AllocationTrendPanel
            dates={trendData?.dates ?? []}
            series={trendData?.series ?? []}
            displayName={displayName}
            fromDate={filterFrom}
            toDate={filterTo}
            loading={trendLoading}
          />
          {isFofLayout ? (
            <>
              <FofShareTrendPanel
                title="底层配置走势"
                data={trendData?.fof_trend?.underlying_trend ?? null}
                displayName={displayName}
                fromDate={filterFrom}
                toDate={filterTo}
                loading={trendLoading}
                chartType="area"
                exportLabel="底层配置走势"
              />
              <FofShareTrendPanel
                title="策略配置走势"
                data={trendData?.fof_trend?.strategy_trend ?? null}
                displayName={displayName}
                fromDate={filterFrom}
                toDate={filterTo}
                loading={trendLoading}
                chartType="area"
                exportLabel="策略配置走势"
                showStrategySelect
              />
              <FofShareTrendPanel
                title="月末时点底层配置"
                data={trendData?.fof_trend?.month_end_underlying ?? null}
                displayName={displayName}
                fromDate={filterFrom}
                toDate={filterTo}
                loading={trendLoading}
                chartType="bar"
                exportLabel="月末时点底层配置"
                minPoints={1}
              />
              <FofShareTrendPanel
                title="月末时点策略配置"
                data={trendData?.fof_trend?.month_end_strategy ?? null}
                displayName={displayName}
                fromDate={filterFrom}
                toDate={filterTo}
                loading={trendLoading}
                chartType="bar"
                exportLabel="月末时点策略配置"
                showStrategySelect
                minPoints={1}
              />
              <FofAllocationRiskCharts
                series={returnCurves.length > 0 ? returnCurves : (data?.return_curves ?? [])}
                fundHoldings={data?.fund_holdings ?? []}
                fromDate={filterFrom}
                toDate={filterTo}
                strategyTrend={trendData?.fof_trend?.strategy_trend ?? null}
                loading={trendLoading || curvesLoading}
                netAssetValue={data?.net_asset_value}
                otherHoldings={data?.other_holdings ?? []}
                weightStorageKey={beian_hao}
              />
            </>
          ) : (
            <>
            <SectorWeightTrendPanel
              data={trendData?.sector_trend ?? null}
              displayName={displayName}
              fromDate={filterFrom}
              toDate={filterTo}
              loading={trendLoading}
            />
            <LongShortMvTrendPanel
              data={trendData?.long_short_trend ?? null}
              displayName={displayName}
              fromDate={filterFrom}
              toDate={filterTo}
              loading={trendLoading}
            />
            <ContractMvShareTrendPanel
              data={trendData?.contract_mv_trend ?? null}
              displayName={displayName}
              fromDate={filterFrom}
              toDate={filterTo}
              loading={trendLoading}
            />
            <ContractEquityTrendPanel
              data={trendData?.contract_equity_trend ?? null}
              displayName={displayName}
              fromDate={filterFrom}
              toDate={filterTo}
              loading={trendLoading}
            />
            </>
          )}
        </>
      )}

      {!loading && !error && data?.has_data && activeTab === "持仓要素" && (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 bg-white rounded-lg border border-zinc-100 p-4 shadow-sm">
            <div className="flex items-center gap-1 mb-0.5">
              <div className="text-red-500 font-semibold text-sm">资产配置</div>
              <ChartCalcHelpButton
                heading="资产配置 · 计算说明"
                blocks={[
                  {
                    title: "切片",
                    paragraphs: [
                      "最新估值日各大类持仓市值。环上百分比与右侧表格「市值占比」都是市值 / 资产净值。",
                    ],
                    formula: "市值占比 = 该大类市值 / 资产净值 × 100",
                  },
                ]}
              />
            </div>
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

        {isEquityLayout ? (
          <EquityValuationPanel
            stockHoldings={data.stock_holdings ?? []}
            bondHoldings={data.bond_holdings ?? []}
            wealthHoldings={data.wealth_holdings ?? []}
            otherHoldings={data.equity_other_holdings ?? []}
            stockRiskExposure={data.stock_risk_exposure ?? null}
            valuationDate={data.valuation_date}
            displayName={displayName}
          />
        ) : isFofLayout ? (
          <>
            <FofFundsPanel
              rows={data.fund_holdings ?? []}
              valuationDate={data.valuation_date}
              displayName={displayName}
            />
            <FofVolatilityAnalysisPanel
              series={returnCurves.length > 0 ? returnCurves : (data.return_curves ?? [])}
              fundHoldings={data.fund_holdings ?? []}
              loading={curvesLoading}
              displayName={displayName}
              fromDate={filterFrom}
              toDate={filterTo}
              netAssetValue={data.net_asset_value}
              navRows={navRows}
              navType={filterNavType}
              otherHoldings={data.other_holdings ?? []}
              strategyTrend={trendData?.fof_trend?.strategy_trend ?? null}
              weightStorageKey={beian_hao}
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
