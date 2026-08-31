"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, FolderOpen, Save, Search, Trash2 } from "lucide-react"
import { isValuationCashHoldingName, stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"
import {
  computeFofPortfolioVar,
  fofHoldingKey,
  gapReasonLabel,
  matchHoldingSeries,
  normalizeFofDisplayName,
  type FofGapAction,
  type FofNavGap,
  type FofProxyOption,
  type FofVarConfidence,
  type FofVarMethod,
  type FofWindowMethod,
} from "@/lib/fof-portfolio-var"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ReturnCurveSeries } from "./FofReturnCurvePanel"
import type { FundHoldingRow } from "./FofFundsPanel"
import { FofVolControlCharts } from "./FofVolControlCharts"
import { FofStockHedgeChart } from "./FofStockHedgeChart"
import { ChartCalcHelpButton } from "./ChartCalcHelpButton"
import { getNavFieldValue, type NavRow } from "../components/shared"
import type { OtherHoldingRow } from "./OtherHoldingsPanel"
import type { FofShareTrendData } from "./FofShareTrendPanel"

type Props = {
  series: ReturnCurveSeries[]
  fundHoldings: FundHoldingRow[]
  displayName: string
  fromDate?: string
  toDate?: string
  netAssetValue?: number | null
  loading?: boolean
  navRows?: NavRow[]
  navType?: string
  otherHoldings?: OtherHoldingRow[]
  strategyTrend?: FofShareTrendData | null
  weightStorageKey?: string
}

type FundNavRow = {
  price_date?: string
  nav?: string | number
  cumulative_nav?: string | number
  cum_nav_withdrawal?: string | number
}

function isStockRow(row: FundHoldingRow): boolean {
  if (/ETF/u.test(row.fundName)) return false
  if (row.rowKind === "stock") return true
  if (row.rowKind === "fund_or_stock") {
    const code = (row.valuationCode ?? "").replace(/\.(SZ|SH|BJ)$/i, "").trim()
    if (/^\d{6}$/.test(code)) return true
    if (!row.valuationCode && !row.beianHao) return true
  }
  return false
}

function isCashOrNonFundRow(row: FundHoldingRow): boolean {
  if (["bank_deposit", "settlement_reserve", "margin_deposit", "payable", "clearing"].includes(row.rowKind)) {
    return true
  }
  return isValuationCashHoldingName(row.fundName)
}

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(digits)}%`
}

function fmtCorr(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(2)
}

function navFromRow(row: FundNavRow): number | null {
  for (const field of [row.cum_nav_withdrawal, row.cumulative_nav, row.nav]) {
    const v = typeof field === "number" ? field : parseFloat(String(field ?? ""))
    if (Number.isFinite(v) && v > 0) return v
  }
  return null
}

function seriesLooksThin(series: ReturnCurveSeries[], holdingCount: number): boolean {
  if (series.length === 0) return true
  const rich = series.filter((s) => (s.points?.length ?? 0) >= 9).length
  return rich < Math.max(1, Math.ceil(Math.max(holdingCount, series.length) * 0.35))
}

const THIN_HOLDING_POINTS = 40
const THIN_WINDOW_POINTS = 24

const WINDOW_METHODS: Array<{ key: FofWindowMethod; label: string }> = [
  { key: "recent", label: "近期回溯" },
  { key: "longest", label: "最长历史" },
]

export function FofVolatilityAnalysisPanel({
  series,
  fundHoldings,
  displayName,
  fromDate,
  toDate,
  netAssetValue,
  loading,
  navRows = [],
  navType = "复权净值",
  otherHoldings = [],
  strategyTrend = null,
  weightStorageKey,
}: Props) {
  const [confidence, setConfidence] = useState<FofVarConfidence>(95)
  const [method, setMethod] = useState<FofVarMethod>("parametric")
  const [windowMethod, setWindowMethod] = useState<FofWindowMethod>("recent")
  const [fetchedSeries, setFetchedSeries] = useState<ReturnCurveSeries[]>([])
  const [fetchLoading, setFetchLoading] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, FofGapAction>>({})
  const [assumeVolDraft, setAssumeVolDraft] = useState("10")
  const [assumeCorrDraft, setAssumeCorrDraft] = useState("0.30")
  const [gapChoiceMade, setGapChoiceMade] = useState(false)
  const [proxySeries, setProxySeries] = useState<ReturnCurveSeries[]>([])
  const [proxyLoadingKeys, setProxyLoadingKeys] = useState<string[]>([])

  const holdings = useMemo(
    () => fundHoldings.filter((r) => !isStockRow(r) && !isCashOrNonFundRow(r) && r.marketValue > 0),
    [fundHoldings],
  )

  useEffect(() => {
    setOverrides({})
    setGapChoiceMade(false)
    setProxySeries([])
    setProxyLoadingKeys([])
  }, [fromDate, toDate])

  useEffect(() => {
    const thin = holdings.filter((holding) => {
      const matched = matchHoldingSeries(holding, series)
      const all = matched?.points ?? []
      if (all.length < THIN_HOLDING_POINTS) return true
      const inWindow = all.filter((p) => {
        if (fromDate && p.date < fromDate.slice(0, 10)) return false
        if (toDate && p.date > toDate.slice(0, 10)) return false
        return true
      })
      return inWindow.length < THIN_WINDOW_POINTS
    })
    if (thin.length === 0) {
      setFetchedSeries([])
      setFetchLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setFetchLoading(true)

    const queue = [...thin]
    const collected: ReturnCurveSeries[] = []

    const fetchPoints = async (id: string): Promise<Array<{ date: string; nav: number; returnPct: number }>> => {
      const r = await fetch(`/ma/api/private-funds/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      })
      if (!r.ok) return []
      const d = await r.json() as { nav_series?: FundNavRow[] }
      return (d.nav_series ?? [])
        .map((row) => {
          const nav = navFromRow(row)
          const date = row.price_date?.slice(0, 10)
          if (nav == null || !date) return null
          return { date, nav, returnPct: 0 }
        })
        .filter((p): p is { date: string; nav: number; returnPct: number } => p != null)
    }

    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const holding = queue.shift()
        if (!holding) break
        const ids = [...new Set(
          [holding.beianHao, holding.valuationCode]
            .map((v) => v?.trim())
            .filter((v): v is string => Boolean(v)),
        )]
        let points: Array<{ date: string; nav: number; returnPct: number }> = []
        for (const id of ids) {
          try {
            const next = await fetchPoints(id)
            if (next.length > points.length) points = next
          } catch {
            if (controller.signal.aborted) return
          }
        }
        const name = normalizeFofDisplayName(
          stripValuationSubjectPathPrefix(holding.fundName) || holding.fundName,
        )
        collected.push({
          fundName: holding.fundName,
          displayName: name,
          beianHao: holding.beianHao,
          valuationCode: holding.valuationCode,
          points,
        })
      }
    }

    void Promise.all(Array.from({ length: Math.min(6, thin.length) }, () => worker()))
      .then(() => {
        if (!cancelled) setFetchedSeries(collected)
      })
      .finally(() => {
        if (!cancelled) setFetchLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [holdings, series, fromDate, toDate])

  const holdingKeys = useMemo(
    () => new Set(holdings.map((h) => fofHoldingKey(h))),
    [holdings],
  )

  const externalProxyKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const action of Object.values(overrides)) {
      if (action.kind !== "proxy") continue
      const key = action.proxyKey.trim()
      if (!key || holdingKeys.has(key.toUpperCase())) continue
      keys.add(key)
    }
    return [...keys]
  }, [overrides, holdingKeys])
  const externalProxyKeySig = externalProxyKeys.slice().sort().join("|")

  useEffect(() => {
    const keys = externalProxyKeySig ? externalProxyKeySig.split("|") : []
    if (keys.length === 0) {
      setProxySeries([])
      setProxyLoadingKeys([])
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setProxyLoadingKeys(keys)

    const worker = async () => {
      const collected: ReturnCurveSeries[] = []
      for (const id of keys) {
        if (cancelled) return
        try {
          const r = await fetch(`/ma/api/private-funds/${encodeURIComponent(id)}`, {
            signal: controller.signal,
          })
          if (!r.ok) {
            collected.push({
              fundName: id,
              displayName: id,
              beianHao: id,
              valuationCode: null,
              points: [],
            })
            continue
          }
          const d = await r.json() as { nav_series?: FundNavRow[]; info?: { product_name?: string } }
          let points = (d.nav_series ?? [])
            .map((row) => {
              const nav = navFromRow(row)
              const date = row.price_date?.slice(0, 10)
              if (nav == null || !date) return null
              return { date, nav, returnPct: 0 }
            })
            .filter((p): p is { date: string; nav: number; returnPct: number } => p != null)
          if (fromDate) points = points.filter((p) => p.date >= fromDate.slice(0, 10))
          if (toDate) points = points.filter((p) => p.date <= toDate.slice(0, 10))
          const rawName = d.info?.product_name?.trim() || id
          collected.push({
            fundName: rawName,
            displayName: normalizeFofDisplayName(rawName),
            beianHao: id,
            valuationCode: null,
            points,
          })
        } catch {
          if (controller.signal.aborted) return
          collected.push({
            fundName: id,
            displayName: id,
            beianHao: id,
            valuationCode: null,
            points: [],
          })
        }
      }
      if (!cancelled) setProxySeries(collected)
    }

    void worker().finally(() => {
      if (!cancelled) setProxyLoadingKeys([])
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [externalProxyKeySig, fromDate, toDate])

  const activeSeries = useMemo(() => {
    return holdings.map((holding) => {
      const parent = matchHoldingSeries(holding, series)
      const fetched = matchHoldingSeries(holding, fetchedSeries)
      const best = [parent, fetched]
        .filter((s): s is ReturnCurveSeries => s != null)
        .sort((a, b) => (b.points?.length ?? 0) - (a.points?.length ?? 0))[0]
      const name = normalizeFofDisplayName(
        stripValuationSubjectPathPrefix(holding.fundName) || holding.fundName,
      )
      return {
        fundName: holding.fundName,
        displayName: name,
        beianHao: holding.beianHao,
        valuationCode: holding.valuationCode,
        points: best?.points ?? [],
      }
    })
  }, [holdings, series, fetchedSeries])

  const diagnosed = useMemo(
    () => computeFofPortfolioVar({
      holdings,
      series: activeSeries,
      fromDate,
      toDate,
      confidence,
      method,
      windowMethod,
    }),
    [holdings, activeSeries, fromDate, toDate, confidence, method, windowMethod],
  )

  const result = useMemo(
    () => computeFofPortfolioVar({
      holdings,
      series: activeSeries,
      fromDate,
      toDate,
      confidence,
      method,
      windowMethod,
      overrides,
      proxySeries,
    }),
    [holdings, activeSeries, fromDate, toDate, confidence, method, windowMethod, overrides, proxySeries],
  )
  const busy = fetchLoading || (Boolean(loading) && seriesLooksThin(series, holdings.length) && (result?.includedCount ?? 0) === 0)
  const gaps = diagnosed?.gaps ?? []
  const portfolioProxies = useMemo(() => {
    const map = new Map<string, FofProxyOption>()
    for (const f of diagnosed?.funds ?? []) {
      if (f.status === "ok") map.set(f.key, { key: f.key, name: f.name, strategy: f.strategy })
    }
    for (const g of gaps) {
      for (const p of g.suggestedProxies) map.set(p.key, p)
    }
    return [...map.values()]
  }, [diagnosed, gaps])
  const proxyReadyKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const s of proxySeries) {
      if ((s.points?.length ?? 0) >= 9) {
        const key = (s.beianHao?.trim() || s.valuationCode?.trim() || s.fundName).toUpperCase()
        keys.add(key)
      }
    }
    return keys
  }, [proxySeries])
  const derivedProxyLoadingKeys = useMemo(() => {
    const have = new Set(proxySeries.map((s) => (s.beianHao?.trim() || "").toUpperCase()))
    const pending = externalProxyKeys.filter((k) => !have.has(k.toUpperCase()))
    return [...new Set([...proxyLoadingKeys, ...pending])]
  }, [proxyLoadingKeys, externalProxyKeys, proxySeries])
  const defaultAssumeVol = useMemo(() => {
    const vols = (diagnosed?.funds ?? [])
      .filter((f) => f.status === "ok" && f.annVolPct != null && f.annVolPct > 0)
      .map((f) => f.annVolPct!)
      .sort((a, b) => a - b)
    if (!vols.length) return 10
    return +vols[Math.floor(vols.length / 2)].toFixed(1)
  }, [diagnosed])

  const okFunds = useMemo(
    () => (result?.funds ?? []).filter((f) => f.status === "ok"),
    [result],
  )

  const chartOption = useMemo(() => {
    if (!okFunds.length) return {}
    const sorted = [...okFunds].sort((a, b) => (a.riskContribPct ?? 0) - (b.riskContribPct ?? 0))
    return {
      grid: { left: 120, right: 36, top: 36, bottom: 28 },
      legend: {
        top: 4,
        right: 8,
        data: ["分析权重", "风险贡献"],
        textStyle: { fontSize: 11, color: "#52525b" },
        itemWidth: 12,
        itemHeight: 8,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const i = params[0]?.dataIndex
          if (i == null) return ""
          const f = sorted[i]
          const over = f.overContribPct ?? 0
          const color = over > 0 ? "#ef4444" : "#059669"
          const tag = over > 0 ? "风险高于权重" : over < 0 ? "风险低于权重" : "风险与权重匹配"
          return [
            `<b>${f.name}</b>`,
            `市值占比：${fmtPct(f.marketPct, 2)}`,
            `分析权重：${fmtPct(f.weightPct, 2)}`,
            `风险贡献：${fmtPct(f.riskContribPct, 2)}`,
            `年化波动：${fmtPct(f.annVolPct, 2)}`,
            `与组合相关：${fmtCorr(f.corrToPort)}`,
            `<span style="color:${color}">${tag} ${over >= 0 ? "+" : ""}${over.toFixed(2)}pp</span>`,
          ].join("<br/>")
        },
      },
      xAxis: {
        type: "value",
        name: "%",
        nameTextStyle: { fontSize: 11, color: "#71717a" },
        axisLabel: { fontSize: 11, color: "#71717a", formatter: (v: number) => `${v.toFixed(0)}%` },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      yAxis: {
        type: "category",
        data: sorted.map((f) => f.name),
        axisLabel: { fontSize: 10, color: "#52525b", width: 110, overflow: "truncate" },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
      },
      series: [
        {
          name: "分析权重",
          type: "bar",
          data: sorted.map((f) => ({
            value: +f.weightPct.toFixed(2),
            itemStyle: { color: "rgba(113,113,122,0.55)", borderRadius: [0, 3, 3, 0] },
          })),
          barMaxWidth: 10,
          barGap: "40%",
        },
        {
          name: "风险贡献",
          type: "bar",
          data: sorted.map((f) => ({
            value: +((f.riskContribPct ?? 0).toFixed(2)),
            itemStyle: {
              color: (f.overContribPct ?? 0) > 0 ? "rgba(239,68,68,0.85)" : "rgba(16,185,129,0.8)",
              borderRadius: [0, 3, 3, 0],
            },
          })),
          barMaxWidth: 10,
        },
      ],
    }
  }, [okFunds])

  function handleExport() {
    if (!result) return
    const headers = [
      "基金名称", "基金策略", "市值", "市值占比%", "分析权重%",
      "年化波动率%", "与组合相关", "风险贡献%", "贡献VaR", "净值点数", "状态",
    ]
    const lines = [
      headers.join(","),
      ...result.funds.map((f) => [
        f.name,
        f.strategy ?? "",
        f.marketValue.toFixed(2),
        f.marketPct.toFixed(4),
        f.weightPct.toFixed(4),
        f.annVolPct?.toFixed(4) ?? "",
        f.corrToPort?.toFixed(4) ?? "",
        f.riskContribPct?.toFixed(4) ?? "",
        f.varContrib?.toFixed(2) ?? "",
        f.obsCount,
        f.status === "ok" ? (f.fillNote || "已纳入") : "未纳入",
      ].join(",")),
      "",
      `组合下一净值日VaR(${result.confidence}%),${result.nextPeriodVar.toFixed(2)}`,
      `折算1日VaR,${result.oneDayVar.toFixed(2)}`,
      `组合年化波动率%,${result.portfolioAnnVolPct.toFixed(4)}`,
      `观察期,${result.dateFrom ?? ""} ~ ${result.dateTo ?? ""}`,
      `方法,${result.method === "historical" ? "历史模拟" : "参数法"}`,
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_波动分析_${fromDate ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function setGapAction(key: string, action: FofGapAction) {
    setGapChoiceMade(true)
    setOverrides((prev) => ({ ...prev, [key]: action }))
  }

  function applyAllIgnore() {
    setGapChoiceMade(true)
    setOverrides(Object.fromEntries(gaps.map((g) => [g.key, { kind: "ignore" as const }])))
  }

  function applyAllProxy() {
    setGapChoiceMade(true)
    setOverrides(Object.fromEntries(gaps.map((g) => {
      const proxy = g.suggestedProxies[0]
      return [g.key, proxy
        ? { kind: "proxy" as const, proxyKey: proxy.key, proxyName: proxy.name }
        : { kind: "ignore" as const }]
    })))
  }

  function applyAllAssume() {
    setGapChoiceMade(true)
    const annVolPct = Number(assumeVolDraft) || defaultAssumeVol
    const corr = Number(assumeCorrDraft)
    setOverrides(Object.fromEntries(gaps.map((g) => [g.key, {
      kind: "assume" as const,
      annVolPct: Number.isFinite(annVolPct) ? annVolPct : 10,
      corr: Number.isFinite(corr) ? corr : 0.3,
    }])))
  }

  const rangeLabel = fromDate && toDate ? `${fromDate} ~ ${toDate}` : null
  const navVarPct = result && netAssetValue && netAssetValue > 0
    ? (result.nextPeriodVar / netAssetValue) * 100
    : null
  const chartHeight = Math.max(260, okFunds.length * 22 + 56)
  const productNav = useMemo(
    () => navRows
      .map((row) => {
        const nav = getNavFieldValue(row, navType)
        const date = row.price_date?.slice(0, 10)
        if (!date || !Number.isFinite(nav) || nav <= 0) return null
        return { date, nav }
      })
      .filter((p): p is { date: string; nav: number } => p != null)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [navRows, navType],
  )

  return (
    <>
    <FofStockHedgeChart
      fundHoldings={fundHoldings}
      otherHoldings={otherHoldings}
      netAssetValue={netAssetValue}
      strategyTrend={strategyTrend}
      weightStorageKey={weightStorageKey}
    />
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-red-500 font-semibold text-sm">波动分析</div>
            <ChartCalcHelpButton
              heading="波动分析 · 计算说明"
              blocks={[
                {
                  title: "下一净值日 VaR",
                  paragraphs: [
                    "用底层基金共同窗口收益与当前市值权重估计组合波动 σ_p。参数法假设正态；历史模拟取经验分位。金额按纳入基金市值计。",
                  ],
                  formula: "参数法：VaR = z × σ_p × 纳入基金市值\n历史模拟：VaR = −分位_{1−c}(组合收益) × 纳入基金市值\n占净值% = VaR / 资产净值；占基金市值% = VaR / 纳入基金市值",
                },
                {
                  title: "共同窗口",
                  paragraphs: [
                    "近期回溯（默认）：从各基金最近净值日往回铺周/月网格。日频与周频都映射到同一网格；中间缺口按净值插值，两端缺口用该基金平均收益填补。不要求每只基金在每一天都有原始点，以便尽量纳入持仓。",
                    "最长历史：优先拉长真实重叠样本，可能把起始较晚的基金排除出协方差。",
                  ],
                },
                {
                  title: "折算 1 日 VaR",
                  paragraphs: [
                    "按底层净值中位间隔天数 √缩放：1日 VaR = 下一净值日 VaR / √gapDays。",
                  ],
                },
                {
                  title: "组合年化波动",
                  paragraphs: [
                    "σ_p 按观察频率年化（周频 ×√52，日频 ×√252 等），再 ×100。",
                  ],
                },
                {
                  title: "分散化比率",
                  formula: "分散化比率 = Σ w_i σ_i / σ_p",
                  paragraphs: [
                    "大于 1 表示相关不满 1、分散化有效。分母越小或分子越大，比率越高。",
                  ],
                },
                {
                  title: "风险贡献柱",
                  paragraphs: [
                    "欧拉分解 CRC_i = w_i (Σw)_i / σ_p²，合计 100%。贡献 VaR = CRC_i × 下一净值日 VaR。红色表示 CRC 高于分析权重。",
                  ],
                },
              ]}
            />
          </div>
          {rangeLabel && (
            <div className="text-xs text-zinc-400 mt-1 tabular-nums">统计区间: {rangeLabel}</div>
          )}
          {result?.dateFrom && result.dateTo && (
            <div className="text-xs text-zinc-400 mt-0.5 tabular-nums">
              共同窗口: {result.dateFrom} ~ {result.dateTo}
              {result.obsCount > 0 ? ` · ${result.obsCount} 期` : ""}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
            {WINDOW_METHODS.map(({ key, label }, idx) => (
              <button
                key={key}
                type="button"
                onClick={() => setWindowMethod(key)}
                className={[
                  "px-2.5 py-1 transition-colors",
                  windowMethod === key
                    ? "bg-red-50 text-red-500 font-medium"
                    : "text-zinc-600 hover:bg-zinc-50",
                  idx > 0 ? "border-l border-zinc-200" : "",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
            {([95, 99] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setConfidence(c)}
                className={[
                  "px-2.5 py-1 transition-colors",
                  confidence === c
                    ? "bg-red-50 text-red-500 font-medium"
                    : "text-zinc-600 hover:bg-zinc-50",
                  c === 99 ? "border-l border-zinc-200" : "",
                ].join(" ")}
              >
                {c}%
              </button>
            ))}
          </div>
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
            {([
              ["parametric", "参数法"],
              ["historical", "历史模拟"],
            ] as const).map(([key, label], idx) => (
              <button
                key={key}
                type="button"
                onClick={() => setMethod(key)}
                className={[
                  "px-2.5 py-1 transition-colors",
                  method === key
                    ? "bg-red-50 text-red-500 font-medium"
                    : "text-zinc-600 hover:bg-zinc-50",
                  idx > 0 ? "border-l border-zinc-200" : "",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={!result}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>
      </div>

      {gaps.length > 0 && !busy && (
        <GapFillPanel
          gaps={gaps}
          overrides={overrides}
          assumeVolDraft={assumeVolDraft}
          assumeCorrDraft={assumeCorrDraft}
          defaultAssumeVol={defaultAssumeVol}
          portfolioProxies={portfolioProxies}
          proxyLoadingKeys={derivedProxyLoadingKeys}
          proxyReadyKeys={proxyReadyKeys}
          parentBeian={weightStorageKey}
          onAssumeVolDraft={setAssumeVolDraft}
          onAssumeCorrDraft={setAssumeCorrDraft}
          onChange={setGapAction}
          onIgnoreAll={applyAllIgnore}
          onProxyAll={applyAllProxy}
          onAssumeAll={applyAllAssume}
          onApplyPreset={(preset) => {
            setAssumeVolDraft(String(preset.assumeVolPct))
            setAssumeCorrDraft(String(preset.assumeCorr))
            setOverrides(preset.overrides)
            setGapChoiceMade(true)
          }}
        />
      )}

      {busy && (!result || result.includedCount === 0) ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-zinc-400">
          加载底层净值…
        </div>
      ) : !result || result.includedCount === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-zinc-400 px-4 text-center">
          {holdings.length === 0
            ? "暂无基金持仓，无法计算组合波动"
            : gapChoiceMade && gaps.length > 0
              ? "已按所选方式处理净值不足基金，但剩余样本仍不足以估计组合 VaR。请改用同类基金代替，或假设波动率。"
            : gaps.length > 0
              ? "上表基金净值不足。可忽略、用同类基金代替，或假设波动率后再计算 VaR。"
              : activeSeries.length === 0
                ? "暂无底层基金净值数据"
                : "底层净值样本不足，无法估计组合 VaR"}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 pb-3">
            <MetricCard
              label={`下一净值日 VaR(${result.confidence}%)`}
              value={fmtMoney(result.nextPeriodVar)}
              hint={
                navVarPct != null
                  ? `占资产净值 ${navVarPct.toFixed(2)}% · 占基金市值 ${result.nextPeriodVarPct.toFixed(2)}%`
                  : `占基金市值 ${result.nextPeriodVarPct.toFixed(2)}%`
              }
            />
            <MetricCard
              label="折算 1 日 VaR"
              value={fmtMoney(result.oneDayVar)}
              hint={`按中位间隔 ${result.medianGapDays} 日缩放 · ${result.oneDayVarPct.toFixed(2)}%`}
            />
            <MetricCard
              label="组合年化波动率"
              value={fmtPct(result.portfolioAnnVolPct)}
              hint={`${result.freqLabel}收益 · ${result.obsCount} 个观察点`}
            />
            <MetricCard
              label="分散化比率"
              value={result.diversificationRatio != null ? result.diversificationRatio.toFixed(2) : "—"}
              hint={
                result.excludedCount > 0
                  ? `纳入 ${result.includedCount} 只，${result.excludedCount} 只未纳入`
                  : `纳入 ${result.includedCount} 只底层基金`
              }
            />
          </div>

          <div className="px-2 pb-2">
            {okFunds.length > 0 ? (
              <ReactECharts option={chartOption} style={{ height: chartHeight }} notMerge />
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-zinc-400">
                暂无足够净值数据计算风险贡献
              </div>
            )}
          </div>

          <div className="overflow-x-auto border-t border-zinc-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">基金名称</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">基金策略</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">市值占比</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">年化波动</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">与组合相关</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">风险贡献</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">
                    贡献VaR({result.confidence}%)
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.funds.map((f, i) => {
                  const over = f.overContribPct ?? 0
                  const rcCls = f.status !== "ok"
                    ? "text-zinc-400"
                    : over > 0.5
                      ? "text-red-500"
                      : over < -0.5
                        ? "text-emerald-600"
                        : "text-zinc-800"
                  return (
                    <tr key={`${f.name}-${i}`} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                      <td className="px-3 py-2 text-zinc-800 whitespace-nowrap max-w-[220px] truncate" title={f.name}>
                        {f.name}
                        {f.fillNote && (
                          <span className="ml-1 text-[10px] text-amber-600 font-normal">{f.fillNote}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{f.strategy ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{fmtPct(f.marketPct, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-800">{fmtPct(f.annVolPct)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{fmtCorr(f.corrToPort)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${rcCls}`}>
                        {f.status === "ok" ? fmtPct(f.riskContribPct) : "未纳入"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-800">
                        {f.varContrib != null ? fmtMoney(f.varContrib) : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="px-4 py-2.5 text-[11px] leading-5 text-zinc-400">
            {method === "parametric"
              ? `参数法假设收益近似正态，下一净值日 VaR = z(${result.confidence}%) × σ_p × 基金市值，z=${result.zScore}。`
              : `历史模拟取当前权重下组合收益的 ${(100 - result.confidence).toFixed(0)}% 分位损失。`}
            {" "}风险贡献按协方差欧拉分解，合计为 100%，对冲品种可为负；红色表示风险贡献高于分析权重。
            {result.excludedCount > 0 ? ` ${result.excludedCount} 只基金因净值样本不足、缺少近期净值或共同窗口过短未纳入协方差。` : ""}
            {result.coveredMv < result.totalMv * 0.999
              ? ` 覆盖基金市值 ${fmtMoney(result.coveredMv)} / ${fmtMoney(result.totalMv)}。`
              : ""}
          </p>
        </>
      )}
    </div>
    <FofVolControlCharts result={result} productNav={productNav} />
    </>
  )
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50/70 px-3 py-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400 leading-4">{hint}</div>
    </div>
  )
}

function GapFillPanel({
  gaps,
  overrides,
  assumeVolDraft,
  assumeCorrDraft,
  defaultAssumeVol,
  portfolioProxies,
  proxyLoadingKeys,
  proxyReadyKeys,
  onAssumeVolDraft,
  onAssumeCorrDraft,
  onChange,
  onIgnoreAll,
  onProxyAll,
  onAssumeAll,
  parentBeian,
  onApplyPreset,
}: {
  gaps: FofNavGap[]
  overrides: Record<string, FofGapAction>
  assumeVolDraft: string
  assumeCorrDraft: string
  defaultAssumeVol: number
  portfolioProxies: FofProxyOption[]
  proxyLoadingKeys: string[]
  proxyReadyKeys: Set<string>
  onAssumeVolDraft: (v: string) => void
  onAssumeCorrDraft: (v: string) => void
  onChange: (key: string, action: FofGapAction) => void
  onIgnoreAll: () => void
  onProxyAll: () => void
  onAssumeAll: () => void
  parentBeian?: string
  onApplyPreset: (preset: { assumeVolPct: number; assumeCorr: number; overrides: Record<string, FofGapAction> }) => void
}) {
  const missingMv = gaps.reduce((s, g) => s + g.marketPct, 0)
  return (
    <div className="mx-4 mb-3 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-amber-800">
            {gaps.length} 只基金净值不足
          </div>
          <div className="text-[11px] text-amber-700/80 mt-0.5">
            合计市值占比 {missingMv.toFixed(2)}%。可忽略、用同类基金收益代替，或假设年化波动后纳入 VaR。
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button type="button" onClick={onIgnoreAll} className="px-2 py-1 rounded border border-amber-300 text-amber-800 hover:bg-amber-100">
            全部忽略
          </button>
          <button type="button" onClick={onProxyAll} className="px-2 py-1 rounded border border-amber-300 text-amber-800 hover:bg-amber-100">
            全部用同类基金
          </button>
          <span className="inline-flex items-center gap-1 text-amber-800">
            假设
            <input
              type="number"
              min={0}
              step={0.5}
              value={assumeVolDraft}
              onChange={(e) => onAssumeVolDraft(e.target.value)}
              className="w-14 h-6 rounded border border-amber-300 bg-white px-1 text-right tabular-nums"
              placeholder={String(defaultAssumeVol)}
            />
            %
            <input
              type="number"
              min={-0.95}
              max={0.95}
              step={0.05}
              value={assumeCorrDraft}
              onChange={(e) => onAssumeCorrDraft(e.target.value)}
              className="w-14 h-6 rounded border border-amber-300 bg-white px-1 text-right tabular-nums"
              title="与已有组合收益的相关系数"
            />
            相关
          </span>
          <button type="button" onClick={onAssumeAll} className="px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700">
            全部假设波动
          </button>
        </div>
      </div>

      <VarGapPresetBar
        parentBeian={parentBeian}
        assumeVolDraft={assumeVolDraft}
        assumeCorrDraft={assumeCorrDraft}
        overrides={overrides}
        onApply={onApplyPreset}
      />

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-amber-900/70">
              <th className="py-1.5 pr-2 text-left font-medium">基金</th>
              <th className="py-1.5 px-2 text-left font-medium">原因</th>
              <th className="py-1.5 px-2 text-right font-medium">净值点</th>
              <th className="py-1.5 px-2 text-right font-medium">市值占比</th>
              <th className="py-1.5 pl-2 text-left font-medium">处理方式</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((gap) => {
              const action = overrides[gap.key] ?? { kind: "ignore" as const }
              const selectedProxy = action.kind === "proxy"
                ? {
                    key: action.proxyKey,
                    name: action.proxyName
                      || gap.suggestedProxies.find((p) => p.key === action.proxyKey)?.name
                      || portfolioProxies.find((p) => p.key === action.proxyKey)?.name
                      || action.proxyKey,
                  }
                : gap.suggestedProxies[0]
                  ? { key: gap.suggestedProxies[0].key, name: gap.suggestedProxies[0].name }
                  : null
              const vol = action.kind === "assume" ? String(action.annVolPct) : assumeVolDraft
              const corr = action.kind === "assume" ? String(action.corr) : assumeCorrDraft
              return (
                <tr key={gap.key} className="border-t border-amber-100">
                  <td className="py-1.5 pr-2 text-zinc-800">
                    <div className="max-w-[220px] truncate" title={gap.name}>{gap.name}</div>
                    {gap.strategy && <div className="text-zinc-400 truncate max-w-[220px]">{gap.strategy}</div>}
                  </td>
                  <td className="py-1.5 px-2 text-amber-800 whitespace-nowrap">{gapReasonLabel(gap.reason)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-zinc-600">{gap.obsCount}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-zinc-600">{gap.marketPct.toFixed(2)}%</td>
                  <td className="py-1.5 pl-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`gap-${gap.key}`}
                          checked={action.kind === "ignore"}
                          onChange={() => onChange(gap.key, { kind: "ignore" })}
                        />
                        忽略
                      </label>
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`gap-${gap.key}`}
                          checked={action.kind === "proxy"}
                          onChange={() => {
                            if (!selectedProxy) return
                            onChange(gap.key, {
                              kind: "proxy",
                              proxyKey: selectedProxy.key,
                              proxyName: selectedProxy.name,
                            })
                          }}
                        />
                        用
                      </label>
                      <ProxyFundPicker
                        gapKey={gap.key}
                        selected={action.kind === "proxy" ? selectedProxy : null}
                        portfolioProxies={portfolioProxies.filter((p) => p.key !== gap.key)}
                        loading={Boolean(selectedProxy && proxyLoadingKeys.some((k) => k.toUpperCase() === selectedProxy.key.toUpperCase()))}
                        ready={selectedProxy
                          ? proxyReadyKeys.has(selectedProxy.key.toUpperCase())
                            || portfolioProxies.some((p) => p.key === selectedProxy.key)
                          : false}
                        onPick={(opt) => onChange(gap.key, {
                          kind: "proxy",
                          proxyKey: opt.key,
                          proxyName: opt.name,
                        })}
                      />
                      <span>代替</span>
                      <label className="inline-flex items-center gap-1 cursor-pointer ml-1">
                        <input
                          type="radio"
                          name={`gap-${gap.key}`}
                          checked={action.kind === "assume"}
                          onChange={() => onChange(gap.key, {
                            kind: "assume",
                            annVolPct: Number(vol) || defaultAssumeVol,
                            corr: Number(corr) || 0.3,
                          })}
                        />
                        假设
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={vol}
                        onChange={(e) => onChange(gap.key, {
                          kind: "assume",
                          annVolPct: Number(e.target.value) || 0,
                          corr: Number(corr) || 0.3,
                        })}
                        className="w-14 h-6 rounded border border-amber-300 bg-white px-1 text-right tabular-nums"
                      />
                      <span>%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type VarGapScope = "team" | "mine"

type VarGapPreset = {
  id: string
  scope: VarGapScope
  name: string
  assumeVolPct: number
  assumeCorr: number
  overrides: Record<string, FofGapAction>
  createdByName?: string
}

function readCurrentUser(): { id: string; name: string } | null {
  try {
    const raw = window.localStorage.getItem("currentUser")
    const user = raw ? JSON.parse(raw) as { id?: string; name?: string; email?: string } : null
    const id = String(user?.id ?? "").trim()
    if (!id) return null
    return { id, name: String(user?.name || user?.email || "").trim() }
  } catch {
    return null
  }
}

function authHeaders(): HeadersInit {
  const user = readCurrentUser()
  return user ? { "x-market-user-id": user.id } : {}
}

function parseGapAction(raw: unknown): FofGapAction | null {
  if (!raw || typeof raw !== "object") return null
  const v = raw as Record<string, unknown>
  if (v.kind === "ignore") return { kind: "ignore" }
  if (v.kind === "proxy") {
    const proxyKey = String(v.proxyKey ?? "").trim()
    if (!proxyKey) return null
    return {
      kind: "proxy",
      proxyKey,
      proxyName: typeof v.proxyName === "string" ? v.proxyName : undefined,
    }
  }
  if (v.kind === "assume") {
    const vol = Number(v.annVolPct)
    const corr = Number(v.corr)
    return {
      kind: "assume",
      annVolPct: Number.isFinite(vol) && vol >= 0 ? vol : 10,
      corr: Number.isFinite(corr) ? corr : 0.3,
    }
  }
  return null
}

function parseVarGapPresets(raw: unknown): VarGapPreset[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): VarGapPreset | null => {
      if (!item || typeof item !== "object") return null
      const row = item as Record<string, unknown>
      const id = String(row.id ?? "").trim()
      const name = String(row.name ?? "").trim()
      if (!id || !name) return null
      const overrides: Record<string, FofGapAction> = {}
      if (row.overrides && typeof row.overrides === "object") {
        for (const [key, value] of Object.entries(row.overrides as Record<string, unknown>)) {
          const action = parseGapAction(value)
          if (action) overrides[key] = action
        }
      }
      const vol = Number(row.assumeVolPct)
      const corr = Number(row.assumeCorr)
      return {
        id,
        scope: row.scope === "mine" ? "mine" : "team",
        name,
        assumeVolPct: Number.isFinite(vol) && vol >= 0 ? vol : 10,
        assumeCorr: Number.isFinite(corr) ? corr : 0.3,
        overrides,
        createdByName: typeof row.createdByName === "string" ? row.createdByName : "",
      }
    })
    .filter((item): item is VarGapPreset => item != null)
}

function VarGapPresetBar({
  parentBeian,
  assumeVolDraft,
  assumeCorrDraft,
  overrides,
  onApply,
}: {
  parentBeian?: string
  assumeVolDraft: string
  assumeCorrDraft: string
  overrides: Record<string, FofGapAction>
  onApply: (preset: { assumeVolPct: number; assumeCorr: number; overrides: Record<string, FofGapAction> }) => void
}) {
  const [presetScope, setPresetScope] = useState<VarGapScope>("team")
  const [teamPresets, setTeamPresets] = useState<VarGapPreset[]>([])
  const [minePresets, setMinePresets] = useState<VarGapPreset[]>([])
  const [presetName, setPresetName] = useState("")
  const [selectedPresetId, setSelectedPresetId] = useState("")
  const [presetStatus, setPresetStatus] = useState("")
  const [presetBusy, setPresetBusy] = useState(false)
  const presets = presetScope === "team" ? teamPresets : minePresets

  useEffect(() => {
    if (!presetStatus) return
    const timer = window.setTimeout(() => setPresetStatus(""), 2400)
    return () => window.clearTimeout(timer)
  }, [presetStatus])

  useEffect(() => {
    if (!parentBeian) return
    const beian = parentBeian
    let cancelled = false
    void fetch(
      `/ma/api/private-funds/${encodeURIComponent(beian)}/valuation/var-gap-presets`,
      { headers: authHeaders(), cache: "no-store" },
    )
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !json?.ok) {
          setPresetStatus(json?.error || "无法读取已保存方案，请先登录")
          return
        }
        setTeamPresets(parseVarGapPresets(json.team))
        setMinePresets(parseVarGapPresets(json.mine))
      })
      .catch(() => {
        if (!cancelled) setPresetStatus("无法读取已保存方案")
      })
    return () => {
      cancelled = true
    }
  }, [parentBeian])

  async function handleSave() {
    const name = presetName.trim() || `方案 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
    if (!parentBeian) {
      setPresetStatus("当前页面无法保存方案")
      return
    }
    if (!readCurrentUser()) {
      setPresetStatus("请先登录后再保存")
      return
    }
    setPresetBusy(true)
    try {
      const res = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(parentBeian)}/valuation/var-gap-presets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            scope: presetScope,
            name,
            assumeVolPct: Number(assumeVolDraft),
            assumeCorr: Number(assumeCorrDraft),
            overrides,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setPresetStatus(json?.error || "保存失败")
        return
      }
      setTeamPresets(parseVarGapPresets(json.team))
      setMinePresets(parseVarGapPresets(json.mine))
      setPresetName(name)
      if (json.preset?.id) setSelectedPresetId(String(json.preset.id))
      setPresetStatus(`已保存到${presetScope === "team" ? "团队" : "我的"}「${name}」`)
    } catch {
      setPresetStatus("保存失败")
    } finally {
      setPresetBusy(false)
    }
  }

  function handleLoad() {
    const preset = presets.find((p) => p.id === selectedPresetId)
      || presets.find((p) => p.name === presetName.trim())
    if (!preset) {
      setPresetStatus(presets.length ? "请先选择要载入的方案" : `还没有${presetScope === "team" ? "团队" : "我的"}方案`)
      return
    }
    onApply({
      assumeVolPct: preset.assumeVolPct,
      assumeCorr: preset.assumeCorr,
      overrides: preset.overrides,
    })
    setPresetName(preset.name)
    setSelectedPresetId(preset.id)
    setPresetStatus(`已载入${preset.scope === "team" ? "团队" : "我的"}「${preset.name}」`)
  }

  async function handleDelete() {
    const preset = presets.find((p) => p.id === selectedPresetId)
      || presets.find((p) => p.name === presetName.trim())
    if (!parentBeian || !preset) {
      setPresetStatus("请先选择要删除的方案")
      return
    }
    if (!readCurrentUser()) {
      setPresetStatus("请先登录后再删除")
      return
    }
    setPresetBusy(true)
    try {
      const res = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(parentBeian)}/valuation/var-gap-presets?id=${encodeURIComponent(preset.id)}`,
        { method: "DELETE", headers: authHeaders() },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setPresetStatus(json?.error || "删除失败")
        return
      }
      setTeamPresets(parseVarGapPresets(json.team))
      setMinePresets(parseVarGapPresets(json.mine))
      if (selectedPresetId === preset.id) setSelectedPresetId("")
      if (presetName.trim() === preset.name) setPresetName("")
      setPresetStatus(`已删除「${preset.name}」`)
    } catch {
      setPresetStatus("删除失败")
    } finally {
      setPresetBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded border border-amber-300 overflow-hidden text-[11px]">
        {([
          ["team", "团队"],
          ["mine", "我的"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setPresetScope(key)
              setSelectedPresetId("")
            }}
            className={[
              "px-2.5 h-7 transition-colors",
              presetScope === key
                ? "bg-amber-600 text-white font-medium"
                : "bg-white text-amber-800 hover:bg-amber-100",
              key === "mine" ? "border-l border-amber-300" : "",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={presetName}
        onChange={(e) => setPresetName(e.target.value)}
        placeholder="方案名称"
        className="h-7 w-36 rounded border border-amber-300 bg-white px-2 text-xs text-amber-900 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={presetBusy}
        className="inline-flex h-7 items-center gap-1 rounded border border-amber-300 bg-white px-2 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-40"
      >
        <Save className="h-3 w-3" />
        保存到{presetScope === "team" ? "团队" : "我的"}
      </button>
      <select
        value={selectedPresetId}
        onChange={(e) => {
          const id = e.target.value
          setSelectedPresetId(id)
          const hit = presets.find((p) => p.id === id)
          if (hit) setPresetName(hit.name)
        }}
        className="h-7 min-w-[9rem] rounded border border-amber-300 bg-white px-2 text-xs text-amber-900 focus:outline-none"
      >
        <option value="">{presetScope === "team" ? "团队方案" : "我的方案"}</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.scope === "team" && preset.createdByName
              ? `${preset.name}（${preset.createdByName}）`
              : preset.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleLoad}
        disabled={presets.length === 0 || presetBusy}
        className="inline-flex h-7 items-center gap-1 rounded border border-amber-300 bg-white px-2 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-30"
      >
        <FolderOpen className="h-3 w-3" />
        载入
      </button>
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={presets.length === 0 || presetBusy}
        className="inline-flex h-7 items-center gap-1 rounded border border-amber-300 bg-white px-2 text-[11px] text-amber-800 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
      >
        <Trash2 className="h-3 w-3" />
        删除
      </button>
      {presetStatus && (
        <span className="text-[11px] text-amber-800">{presetStatus}</span>
      )}
    </div>
  )
}

type FundSearchHit = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one?: string | null
}

function ProxyFundPicker({
  gapKey,
  selected,
  portfolioProxies,
  loading,
  ready,
  onPick,
}: {
  gapKey: string
  selected: { key: string; name: string } | null
  portfolioProxies: FofProxyOption[]
  loading: boolean
  ready: boolean
  onPick: (opt: { key: string; name: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<FundSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setHits([])
      setSearching(false)
      abortRef.current?.abort()
      return
    }
    const q = query.trim()
    if (q.length < 1) {
      setHits([])
      setSearching(false)
      abortRef.current?.abort()
      return
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setSearching(true)
      try {
        const res = await fetch(
          `/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}&format=picker`,
          { signal: controller.signal },
        )
        const json = await res.json()
        if (controller.signal.aborted) return
        setHits(Array.isArray(json) ? json : [])
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        setHits([])
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, query])

  const q = query.trim().toLowerCase()
  const localMatches = q
    ? portfolioProxies.filter((p) =>
      p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
    )
    : portfolioProxies
  const localKeys = new Set(localMatches.map((p) => p.key.toUpperCase()))
  const remoteHits = hits.filter((h) => {
    const key = (h.beian_hao || "").trim().toUpperCase()
    return key && !localKeys.has(key)
  })

  function pickLocal(opt: FofProxyOption) {
    onPick({ key: opt.key, name: opt.name })
    setOpen(false)
  }

  function pickRemote(hit: FundSearchHit) {
    const key = hit.beian_hao.trim().toUpperCase()
    const local = portfolioProxies.find((p) => p.key === key)
    onPick({
      key: local?.key ?? key,
      name: local?.name ?? (hit.short_name?.trim() || hit.product_name),
    })
    setOpen(false)
  }

  const hint = loading
    ? "加载净值…"
    : selected && !ready
      ? "该基金净值不足"
      : null

  return (
    <span className="inline-flex items-center gap-1">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 max-w-[180px] items-center gap-1 rounded border border-amber-300 bg-white px-1.5 text-left text-[11px] text-zinc-700 hover:bg-amber-50"
          title={selected?.name}
        >
          <span className="min-w-0 truncate">
            {selected?.name || "搜索基金"}
          </span>
          {loading ? (
            <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-amber-500 border-t-transparent" />
          ) : (
            <Search className="h-3 w-3 shrink-0 text-amber-700/70" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索任意基金名称或备案号"
          className="h-7 w-full rounded border border-zinc-200 px-2 text-xs outline-none focus:border-amber-400"
        />
        <div className="mt-1.5 max-h-56 overflow-y-auto">
          {localMatches.length > 0 && (
            <div className="px-1.5 pb-1 text-[10px] text-zinc-400">本组合底层</div>
          )}
          {localMatches.map((p) => (
            <button
              key={`${gapKey}-local-${p.key}`}
              type="button"
              onClick={() => pickLocal(p)}
              className={[
                "block w-full rounded px-1.5 py-1 text-left hover:bg-amber-50",
                selected?.key === p.key ? "bg-amber-50" : "",
              ].join(" ")}
            >
              <div className="truncate text-xs text-zinc-800">{p.name}</div>
              {p.strategy && <div className="truncate text-[10px] text-zinc-400">{p.strategy}</div>}
            </button>
          ))}
          {q.length > 0 && (
            <>
              {remoteHits.length > 0 && (
                <div className="px-1.5 pt-1.5 pb-1 text-[10px] text-zinc-400">全部基金</div>
              )}
              {searching && hits.length === 0 && (
                <div className="px-1.5 py-2 text-xs text-zinc-400">搜索中…</div>
              )}
              {!searching && localMatches.length === 0 && remoteHits.length === 0 && (
                <div className="px-1.5 py-2 text-xs text-zinc-400">未找到匹配基金</div>
              )}
              {remoteHits.map((hit) => (
                <button
                  key={`${gapKey}-remote-${hit.beian_hao}`}
                  type="button"
                  onClick={() => pickRemote(hit)}
                  className="block w-full rounded px-1.5 py-1 text-left hover:bg-amber-50"
                >
                  <div className="truncate text-xs text-zinc-800">
                    {hit.short_name?.trim() || hit.product_name}
                  </div>
                  <div className="truncate text-[10px] text-zinc-400">
                    {[hit.product_name !== hit.short_name ? hit.product_name : null, hit.beian_hao, hit.strategy_one]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </button>
              ))}
            </>
          )}
          {q.length === 0 && localMatches.length === 0 && (
            <div className="px-1.5 py-2 text-xs text-zinc-400">输入关键字搜索全部基金</div>
          )}
        </div>
      </PopoverContent>
      </Popover>
      {hint && <span className="text-[10px] text-amber-700/80 whitespace-nowrap">{hint}</span>}
    </span>
  )
}
