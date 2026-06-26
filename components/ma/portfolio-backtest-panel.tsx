"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ChevronDown } from "lucide-react"

interface FundInput {
  beian_hao: string
  product_name: string
  initial_subscribe_date: string
  initial_amount: string
  nav_start_date?: string
  latest_nav_date?: string | null
}

interface CurvePoint {
  d: string
  v: number
}

interface BacktestMetrics {
  periodReturn: number | null
  annReturn: number | null
  annVol: number | null
  sharpe: number | null
  calmar: number | null
  downsideRisk: number | null
  maxDrawdown: number | null
  maxDdRecoveryDays: number | "未回补" | null
  longestNoNewHighDays: number | null
  sortino: number | null
  correlation: number | null
  infoRatio: number | null
  trackingError: number | null
  alpha: number | null
  beta: number | null
  skewness: number | null
  kurtosis: number | null
  var95: number | null
}

interface MetricRowDef {
  label: string
  portfolio: { text: string; highlight?: boolean }
  benchmark: { text: string; highlight?: boolean }
}

const STAT_PERIODS = [
  { key: "inception", label: "成立以来" },
  { key: "ytd", label: "今年以来" },
  { key: "1y", label: "近一年" },
  { key: "6m", label: "近六月" },
] as const

const BENCHMARK_OPTIONS = [
  { key: "hs300", label: "沪深300" },
  { key: "none", label: "无基准" },
] as const

function isoTodayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function minDate(dates: string[]) {
  return dates.filter(Boolean).sort()[0] ?? isoTodayLocal()
}

function maxDate(dates: string[]) {
  return dates.filter(Boolean).sort().at(-1) ?? isoTodayLocal()
}

function effectiveFundStart(f: FundInput): string {
  const nav = (f.nav_start_date || "").slice(0, 10)
  const sub = (f.initial_subscribe_date || "").slice(0, 10)
  if (nav && sub) return nav > sub ? nav : sub
  return nav || sub
}

async function fetchPortfolioBacktest(
  funds: FundInput[],
  from: string,
  to: string,
  benchmark: string,
) {
  const res = await fetch("/ma/api/portfolio/backtest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ funds, from, to, benchmark }),
  })
  if (!res.ok) {
    return {
      portfolio: [] as CurvePoint[],
      bench: [] as CurvePoint[],
      skipped: [] as string[],
      error: "回测请求失败",
    }
  }
  return res.json() as Promise<{
    portfolio: CurvePoint[]
    bench: CurvePoint[]
    skipped?: string[]
    suggestedFrom?: string
    suggestedTo?: string
    error?: string
  }>
}

function mean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function std(values: number[]) {
  if (values.length <= 1) return 0
  const m = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function skewness(values: number[]) {
  if (values.length < 3) return null
  const m = mean(values)
  const s = std(values)
  if (s === 0) return null
  const n = values.length
  const sum = values.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0)
  return (n / ((n - 1) * (n - 2))) * sum
}

function kurtosis(values: number[]) {
  if (values.length < 4) return null
  const m = mean(values)
  const s = std(values)
  if (s === 0) return null
  const n = values.length
  const sum = values.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0)
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
}

function periodicReturns(points: CurvePoint[]): number[] {
  const rets: number[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = 1 + points[i - 1].v / 100
    const curr = 1 + points[i].v / 100
    if (prev > 0) rets.push(curr / prev - 1)
  }
  return rets
}

function computeDrawdownSeries(points: CurvePoint[]): number[] {
  if (points.length === 0) return []
  let peak = 1 + points[0].v / 100
  return points.map((p) => {
    const level = 1 + p.v / 100
    if (level > peak) peak = level
    return peak > 0 ? ((level - peak) / peak) * 100 : 0
  })
}

function computeExcessSeries(portfolio: CurvePoint[], bench: CurvePoint[]): CurvePoint[] {
  const benchMap = new Map(bench.map((p) => [p.d, p.v]))
  return portfolio
    .filter((p) => benchMap.has(p.d))
    .map((p) => ({ d: p.d, v: p.v - (benchMap.get(p.d) ?? 0) }))
}

function alignBenchSeries(portfolio: CurvePoint[], bench: CurvePoint[]): CurvePoint[] {
  const benchMap = new Map(bench.map((p) => [p.d, p.v]))
  let last: number | null = null
  return portfolio
    .map((p) => {
      const v = benchMap.get(p.d)
      if (v != null) last = v
      return { d: p.d, v: last ?? NaN }
    })
    .filter((p) => Number.isFinite(p.v))
}

function maxDrawdownStats(points: CurvePoint[]) {
  if (points.length === 0) return { maxDrawdown: null as number | null, recoveryDays: null as number | "未回补" | null, longestNoNewHigh: null as number | null }

  let peak = 1 + points[0].v / 100
  let maxDd = 0
  let longestNoNewHigh = 0
  let currentNoNewHigh = 0
  let underwaterStart: number | null = null
  let recoveryDays: number | "未回补" | null = null

  points.forEach((point, idx) => {
    const level = 1 + point.v / 100
    if (level >= peak) {
      peak = level
      currentNoNewHigh = 0
      if (underwaterStart != null && recoveryDays == null) recoveryDays = idx - underwaterStart
      underwaterStart = null
    } else {
      currentNoNewHigh++
      longestNoNewHigh = Math.max(longestNoNewHigh, currentNoNewHigh)
      if (underwaterStart == null) underwaterStart = idx
      const dd = peak > 0 ? (peak - level) / peak : 0
      maxDd = Math.max(maxDd, dd)
    }
  })

  if (underwaterStart != null && recoveryDays == null) recoveryDays = "未回补"

  return {
    maxDrawdown: maxDd * 100,
    recoveryDays,
    longestNoNewHigh: longestNoNewHigh || null,
  }
}

function computeMetrics(points: CurvePoint[]): BacktestMetrics {
  if (points.length < 2) {
    return {
      periodReturn: null, annReturn: null, annVol: null, sharpe: null, calmar: null,
      downsideRisk: null, maxDrawdown: null, maxDdRecoveryDays: null, longestNoNewHighDays: null,
      sortino: null, correlation: null, infoRatio: null, trackingError: null,
      alpha: null, beta: null, skewness: null, kurtosis: null, var95: null,
    }
  }

  const rets = periodicReturns(points)
  const start = new Date(points[0].d).getTime()
  const end = new Date(points.at(-1)!.d).getTime()
  const days = Math.max(1, Math.round((end - start) / 86_400_000))
  const periodReturn = points.at(-1)!.v
  const totalRet = periodReturn / 100
  const annReturn = (Math.pow(1 + totalRet, 365 / days) - 1) * 100
  const annVol = std(rets) * Math.sqrt(252) * 100
  const downside = rets.filter((r) => r < 0)
  const downsideRisk = downside.length > 0 ? std(downside) * Math.sqrt(252) * 100 : 0
  const sharpe = annVol > 0 ? annReturn / annVol : null
  const { maxDrawdown, recoveryDays, longestNoNewHigh } = maxDrawdownStats(points)
  const calmar = maxDrawdown && maxDrawdown > 0 ? annReturn / maxDrawdown : null
  const downsideDev = downside.length > 0 ? std(downside) * Math.sqrt(252) * 100 : null
  const sortino = downsideDev && downsideDev > 0 ? annReturn / downsideDev : null
  const sorted = [...rets].sort((a, b) => a - b)
  const varIdx = Math.max(0, Math.floor(sorted.length * 0.05) - 1)
  const var95 = sorted[varIdx] ?? null

  return {
    periodReturn,
    annReturn,
    annVol,
    sharpe,
    calmar,
    downsideRisk,
    maxDrawdown,
    maxDdRecoveryDays: recoveryDays,
    longestNoNewHighDays: longestNoNewHigh,
    sortino,
    correlation: null,
    infoRatio: null,
    trackingError: null,
    alpha: null,
    beta: null,
    skewness: skewness(rets),
    kurtosis: kurtosis(rets),
    var95,
  }
}

function computeRelativeMetrics(portfolio: CurvePoint[], bench: CurvePoint[]) {
  const portMetrics = computeMetrics(portfolio)
  const benchMetrics = computeMetrics(bench)
  const portRets = periodicReturns(portfolio)
  const benchRets = periodicReturns(bench)
  const n = Math.min(portRets.length, benchRets.length)
  const p = portRets.slice(-n)
  const b = benchRets.slice(-n)

  let correlation: number | null = null
  let beta: number | null = null
  let trackingError: number | null = null
  let infoRatio: number | null = null
  let alpha: number | null = null

  if (n > 1) {
    const meanP = mean(p)
    const meanB = mean(b)
    const cov = p.reduce((sum, v, i) => sum + (v - meanP) * (b[i] - meanB), 0) / (n - 1)
    const varB = b.reduce((sum, v) => sum + (v - meanB) ** 2, 0) / (n - 1)
    correlation = varB > 0 ? cov / Math.sqrt(varB * p.reduce((sum, v) => sum + (v - meanP) ** 2, 0) / (n - 1)) : null
    beta = varB > 0 ? cov / varB : null
    const diff = p.map((v, i) => v - b[i])
    trackingError = std(diff) * Math.sqrt(252) * 100
    if (trackingError > 0 && portMetrics.annReturn != null && benchMetrics.annReturn != null) {
      infoRatio = (portMetrics.annReturn - benchMetrics.annReturn) / trackingError
    }
    if (portMetrics.annReturn != null && benchMetrics.annReturn != null && beta != null) {
      alpha = portMetrics.annReturn - beta * benchMetrics.annReturn
    }
  }

  return {
    portfolio: { ...portMetrics, correlation, beta, trackingError, infoRatio, alpha },
    benchmark: {
      ...benchMetrics,
      correlation: 1,
      beta: 1,
      trackingError: 0,
      infoRatio: null,
      alpha: 0,
    },
  }
}

function fmtPctText(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return `${v.toFixed(2)}%`
}

function fmtRatio(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return v.toFixed(4)
}

function fmtVar(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return v.toFixed(4)
}

function MetricValue({ text, highlight }: { text: string; highlight?: boolean }) {
  if (highlight && text !== "—") return <span className="text-red-500">{text}</span>
  return <>{text}</>
}

function buildMetricRows(
  metrics: { portfolio: BacktestMetrics; benchmark: BacktestMetrics },
): { left: MetricRowDef[]; right: MetricRowDef[] } {
  const p = metrics.portfolio
  const bm = metrics.benchmark

  return {
    left: [
      { label: "区间收益", portfolio: { text: fmtPctText(p.periodReturn), highlight: true }, benchmark: { text: fmtPctText(bm.periodReturn), highlight: true } },
      { label: "年化收益", portfolio: { text: fmtPctText(p.annReturn), highlight: true }, benchmark: { text: fmtPctText(bm.annReturn), highlight: true } },
      { label: "年化波动率", portfolio: { text: fmtPctText(p.annVol) }, benchmark: { text: fmtPctText(bm.annVol) } },
      { label: "夏普比率", portfolio: { text: fmtRatio(p.sharpe) }, benchmark: { text: fmtRatio(bm.sharpe) } },
      { label: "卡玛比率", portfolio: { text: fmtRatio(p.calmar) }, benchmark: { text: fmtRatio(bm.calmar) } },
      { label: "下行风险", portfolio: { text: fmtPctText(p.downsideRisk) }, benchmark: { text: fmtPctText(bm.downsideRisk) } },
      { label: "最大回撤", portfolio: { text: fmtPctText(p.maxDrawdown) }, benchmark: { text: fmtPctText(bm.maxDrawdown) } },
      {
        label: "最大回撤回补期（天）",
        portfolio: { text: p.maxDdRecoveryDays == null ? "—" : String(p.maxDdRecoveryDays) },
        benchmark: { text: bm.maxDdRecoveryDays == null ? "—" : String(bm.maxDdRecoveryDays) },
      },
      {
        label: "最长连续不创新高天数（天）",
        portfolio: { text: p.longestNoNewHighDays == null ? "—" : String(p.longestNoNewHighDays) },
        benchmark: { text: bm.longestNoNewHighDays == null ? "—" : String(bm.longestNoNewHighDays) },
      },
    ],
    right: [
      { label: "索提诺比率", portfolio: { text: fmtRatio(p.sortino) }, benchmark: { text: fmtRatio(bm.sortino) } },
      { label: "相关系数", portfolio: { text: fmtRatio(p.correlation) }, benchmark: { text: fmtRatio(bm.correlation) } },
      { label: "信息比率", portfolio: { text: fmtRatio(p.infoRatio) }, benchmark: { text: "—" } },
      { label: "跟踪误差", portfolio: { text: fmtPctText(p.trackingError) }, benchmark: { text: fmtPctText(bm.trackingError) } },
      { label: "Alpha", portfolio: { text: fmtPctText(p.alpha) }, benchmark: { text: fmtPctText(bm.alpha) } },
      { label: "Beta", portfolio: { text: fmtRatio(p.beta) }, benchmark: { text: fmtRatio(bm.beta) } },
      { label: "偏度", portfolio: { text: fmtRatio(p.skewness) }, benchmark: { text: fmtRatio(bm.skewness) } },
      { label: "峰度", portfolio: { text: fmtRatio(p.kurtosis) }, benchmark: { text: fmtRatio(bm.kurtosis) } },
      { label: "VaR（95%置信）", portfolio: { text: fmtVar(p.var95) }, benchmark: { text: fmtVar(bm.var95) } },
    ],
  }
}

function MetricsTable({ rows }: { rows: MetricRowDef[] }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-muted/40 border-b">
          <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-[42%]">指标名称</th>
          <th className="px-4 py-2.5 text-center font-semibold text-zinc-500 w-[29%]">组合</th>
          <th className="px-4 py-2.5 text-center font-semibold text-zinc-500 w-[29%]">沪深300(基准)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b last:border-b-0">
            <td className="px-4 py-2.5 text-zinc-600">{row.label}</td>
            <td className="px-4 py-2.5 text-center tabular-nums">
              <MetricValue text={row.portfolio.text} highlight={row.portfolio.highlight} />
            </td>
            <td className="px-4 py-2.5 text-center tabular-nums">
              <MetricValue text={row.benchmark.text} highlight={row.benchmark.highlight} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PortfolioBacktestPanel({ funds }: { funds: FundInput[] }) {
  const defaultFrom = useMemo(
    () => maxDate(funds.map(effectiveFundStart).filter(Boolean) as string[]),
    [funds],
  )
  const defaultTo = useMemo(() => isoTodayLocal(), [funds])
  const resolvedDefaultTo = defaultFrom > defaultTo ? defaultFrom : defaultTo

  const [statPeriod, setStatPeriod] = useState<(typeof STAT_PERIODS)[number]["key"]>("inception")
  const [fromDate, setFromDate] = useState(defaultFrom)
  const [toDate, setToDate] = useState(resolvedDefaultTo)
  const [benchmark, setBenchmark] = useState<(typeof BENCHMARK_OPTIONS)[number]["key"]>("hs300")
  const [loading, setLoading] = useState(false)
  const [portfolioSeries, setPortfolioSeries] = useState<CurvePoint[]>([])
  const [benchSeries, setBenchSeries] = useState<CurvePoint[]>([])
  const [analyzed, setAnalyzed] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [showInterval, setShowInterval] = useState(true)
  const [showExcess, setShowExcess] = useState(false)
  const [showDrawdownExcess, setShowDrawdownExcess] = useState(false)
  const autoRanRef = useRef(false)

  useEffect(() => {
    setFromDate(defaultFrom)
    setToDate(resolvedDefaultTo)
  }, [defaultFrom, resolvedDefaultTo])

  const portfolioReturn = portfolioSeries.at(-1)?.v ?? 0
  const benchReturn = benchSeries.at(-1)?.v ?? 0

  const metricRows = useMemo(() => {
    if (!analyzed || portfolioSeries.length < 2) return null
    const alignedBench = alignBenchSeries(portfolioSeries, benchSeries)
    if (benchmark === "hs300" && alignedBench.length >= 2) {
      return buildMetricRows(computeRelativeMetrics(portfolioSeries, alignedBench))
    }
    const emptyBench: BacktestMetrics = {
      periodReturn: null, annReturn: null, annVol: null, sharpe: null, calmar: null,
      downsideRisk: null, maxDrawdown: null, maxDdRecoveryDays: null, longestNoNewHighDays: null,
      sortino: null, correlation: null, infoRatio: null, trackingError: null,
      alpha: null, beta: null, skewness: null, kurtosis: null, var95: null,
    }
    return buildMetricRows({ portfolio: computeMetrics(portfolioSeries), benchmark: emptyBench })
  }, [analyzed, portfolioSeries, benchSeries, benchmark])

  async function runAnalysis(range?: { from: string; to: string }) {
    if (funds.length === 0) return
    let from = (range?.from || fromDate).slice(0, 10)
    let to = (range?.to || toDate).slice(0, 10)
    if (!from || !to) return
    if (from > to) to = from
    setLoading(true)
    setAnalysisError(null)
    try {
      const json = await fetchPortfolioBacktest(funds, from, to, benchmark)
      setPortfolioSeries(json.portfolio ?? [])
      setBenchSeries(json.bench ?? [])
      if ((json.portfolio ?? []).length === 0 && json.suggestedFrom && json.suggestedTo) {
        const nextFrom = json.suggestedFrom
        const nextTo = json.suggestedTo >= json.suggestedFrom ? json.suggestedTo : json.suggestedFrom
        setFromDate(nextFrom)
        setToDate(nextTo)
      }
      if ((json.portfolio ?? []).length === 0) {
        if (json.skipped?.length) {
          setAnalysisError(`以下基金在所选区间内无净值数据：${json.skipped.join("、")}`)
        } else if (json.error) {
          setAnalysisError(json.error)
        } else {
          setAnalysisError("暂无足够净值数据生成收益曲线")
        }
      }
      setAnalyzed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    autoRanRef.current = false
    setAnalyzed(false)
    setPortfolioSeries([])
    setBenchSeries([])
    setAnalysisError(null)
  }, [funds])

  useEffect(() => {
    if (autoRanRef.current || funds.length === 0) return
    if (!defaultFrom || !resolvedDefaultTo) return
    autoRanRef.current = true
    setFromDate(defaultFrom)
    setToDate(resolvedDefaultTo)
    void runAnalysis({ from: defaultFrom, to: resolvedDefaultTo })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds, defaultFrom, resolvedDefaultTo])

  function handleReset() {
    setStatPeriod("inception")
    setFromDate(defaultFrom)
    setToDate(resolvedDefaultTo)
    setBenchmark("hs300")
    setPortfolioSeries([])
    setBenchSeries([])
    setAnalyzed(false)
    setAnalysisError(null)
  }

  const chartOption = useMemo(() => {
    const dates = portfolioSeries.map((p) => p.d)
    const benchMap = new Map(benchSeries.map((p) => [p.d, p.v]))
    return {
      grid: { left: 56, right: 24, top: 48, bottom: 40 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => `${v.toFixed(2)}%`,
      },
      legend: {
        top: 8,
        data: [
          `组合 ${portfolioReturn.toFixed(2)}%`,
          ...(benchmark === "hs300" ? [`沪深300(基准) ${benchReturn.toFixed(2)}%`] : []),
        ],
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: {
          formatter: (v: string) => {
            const d = new Date(v)
            if (Number.isNaN(d.getTime())) return v
            return `${d.getMonth() + 1}月`
          },
        },
      },
      yAxis: {
        type: "value",
        name: "收益率(%)",
        axisLabel: { formatter: "{value}%" },
      },
      series: [
        {
          name: `组合 ${portfolioReturn.toFixed(2)}%`,
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: "#dc2626" },
          itemStyle: { color: "#dc2626" },
          data: portfolioSeries.map((p) => p.v),
        },
        ...(benchmark === "hs300"
          ? [{
              name: `沪深300(基准) ${benchReturn.toFixed(2)}%`,
              type: "line",
              smooth: true,
              showSymbol: false,
              lineStyle: { width: 2, color: "#7dd3fc" },
              itemStyle: { color: "#7dd3fc" },
              data: portfolioSeries.map((p) => benchMap.get(p.d) ?? null),
            }]
          : []),
      ],
    }
  }, [portfolioSeries, benchSeries, portfolioReturn, benchReturn, benchmark])

  const drawdownChartOption = useMemo(() => {
    if (!analyzed || portfolioSeries.length === 0) return null

    const dates = portfolioSeries.map((p) => p.d)
    const alignedBench = alignBenchSeries(portfolioSeries, benchSeries)
    const portDd = computeDrawdownSeries(portfolioSeries)
    const benchDd = alignedBench.length > 0 ? computeDrawdownSeries(alignedBench) : []
    const monthLabel = (v: string) => {
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) return v
      return d.getFullYear() === new Date(dates.at(-1) ?? v).getFullYear() && d.getMonth() === 0
        ? String(d.getFullYear())
        : `${d.getMonth() + 1}月`
    }

    if (showDrawdownExcess && benchmark === "hs300" && alignedBench.length > 0) {
      const excessDd = computeDrawdownSeries(computeExcessSeries(portfolioSeries, alignedBench))
      const minDd = Math.min(...excessDd)
      return {
        grid: { left: 56, right: 24, top: 48, bottom: 40 },
        tooltip: {
          trigger: "axis",
          valueFormatter: (v: number) => `${v.toFixed(2)}%`,
        },
        legend: { top: 8, data: ["超额回撤"] },
        xAxis: {
          type: "category",
          data: dates,
          axisLabel: { formatter: monthLabel },
        },
        yAxis: {
          type: "value",
          name: "回撤值(%)",
          max: 0,
          axisLabel: { formatter: "{value}%" },
        },
        series: [
          {
            name: "超额回撤",
            type: "line",
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 2, color: "#dc2626" },
            itemStyle: { color: "#dc2626" },
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: "rgba(220,38,38,0.05)" },
                  { offset: 1, color: "rgba(220,38,38,0.25)" },
                ],
              },
            },
            data: excessDd,
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: { type: "dashed", color: "#94a3b8" },
              label: { show: false },
              data: [{ yAxis: minDd }],
            },
          },
        ],
      }
    }

    const minPortDd = Math.min(...portDd)
    const legendData = ["组合", ...(benchmark === "hs300" && benchDd.length > 0 ? ["沪深300(基准)"] : [])]

    return {
      grid: { left: 56, right: 24, top: 48, bottom: 40 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => `${v.toFixed(2)}%`,
      },
      legend: { top: 8, data: legendData },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { formatter: monthLabel },
      },
      yAxis: {
        type: "value",
        name: "回撤值(%)",
        max: 0,
        axisLabel: { formatter: "{value}%" },
      },
      series: [
        {
          name: "组合",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: "#991b1b" },
          itemStyle: { color: "#991b1b" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(153,27,27,0.05)" },
                { offset: 1, color: "rgba(153,27,27,0.28)" },
              ],
            },
          },
          data: portDd,
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed", color: "#94a3b8" },
            label: { show: false },
            data: [{ yAxis: minPortDd }],
          },
        },
        ...(benchmark === "hs300" && benchDd.length > 0
          ? [{
              name: "沪深300(基准)",
              type: "line",
              smooth: true,
              showSymbol: false,
              lineStyle: { width: 2, color: "#7dd3fc" },
              itemStyle: { color: "#7dd3fc" },
              areaStyle: {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: "rgba(125,211,252,0.05)" },
                    { offset: 1, color: "rgba(125,211,252,0.28)" },
                  ],
                },
              },
              data: benchDd,
            }]
          : []),
      ],
    }
  }, [analyzed, portfolioSeries, benchSeries, benchmark, showDrawdownExcess])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 py-4 border-b flex flex-wrap items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">统计区间</span>
          <div className="relative">
            <select
              value={statPeriod}
              onChange={(e) => setStatPeriod(e.target.value as typeof statPeriod)}
              className="h-9 appearance-none rounded border bg-background pl-3 pr-8 text-sm min-w-[120px]"
            >
              {STAT_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 px-2 border rounded text-sm bg-background"
          />
          <span className="text-muted-foreground">至</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 px-2 border rounded text-sm bg-background"
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">业绩基准</span>
          <div className="relative">
            <select
              value={benchmark}
              onChange={(e) => setBenchmark(e.target.value as typeof benchmark)}
              className="h-9 appearance-none rounded border bg-background pl-3 pr-8 text-sm min-w-[120px]"
            >
              {BENCHMARK_OPTIONS.map((b) => (
                <option key={b.key} value={b.key}>{b.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded border text-sm hover:bg-muted transition-colors"
          >
            重置
          </button>
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={loading || funds.length === 0}
            className="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {loading ? "分析中…" : "开始分析"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
        <div className="border rounded-lg bg-background p-4 min-h-[420px]">
          <h3 className="text-sm font-semibold mb-3">收益曲线</h3>
          {!analyzed ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              点击「开始分析」查看组合回测结果
            </div>
          ) : portfolioSeries.length === 0 ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
              {analysisError ?? "暂无足够净值数据生成收益曲线"}
            </div>
          ) : (
            <ReactECharts option={chartOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
          )}
        </div>

        {metricRows && (
          <div className="border rounded-lg bg-background p-4 mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-sm text-zinc-600">
                统计区间：<span className="text-foreground">{fromDate} - {toDate}</span>
              </p>
              <div className="flex items-center gap-4 text-sm text-zinc-600">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showInterval}
                    onChange={(e) => setShowInterval(e.target.checked)}
                    className="h-4 w-4 accent-red-600"
                  />
                  显示区间
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showExcess}
                    onChange={(e) => setShowExcess(e.target.checked)}
                    className="h-4 w-4 accent-red-600"
                  />
                  超额
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <MetricsTable rows={metricRows.left} />
              <MetricsTable rows={metricRows.right} />
            </div>
          </div>
        )}

        {analyzed && portfolioSeries.length > 0 && drawdownChartOption && (
          <div className="border rounded-lg bg-background p-4 mt-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold mb-1">动态回撤</h3>
                <p className="text-sm text-zinc-600">
                  统计区间：<span className="text-foreground">{fromDate} ~ {toDate}</span>
                </p>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={showDrawdownExcess}
                  onChange={(e) => setShowDrawdownExcess(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                超额
              </label>
            </div>
            <ReactECharts option={drawdownChartOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
          </div>
        )}
      </div>
    </div>
  )
}
