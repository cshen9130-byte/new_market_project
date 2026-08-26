"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download } from "lucide-react"
import { isValuationCashHoldingName, stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"
import {
  computeFofPortfolioVar,
  gapReasonLabel,
  normalizeFofDisplayName,
  type FofGapAction,
  type FofNavGap,
  type FofVarConfidence,
  type FofVarMethod,
} from "@/lib/fof-portfolio-var"
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
}: Props) {
  const [confidence, setConfidence] = useState<FofVarConfidence>(95)
  const [method, setMethod] = useState<FofVarMethod>("parametric")
  const [fetchedSeries, setFetchedSeries] = useState<ReturnCurveSeries[]>([])
  const [fetchLoading, setFetchLoading] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, FofGapAction>>({})
  const [assumeVolDraft, setAssumeVolDraft] = useState("10")
  const [assumeCorrDraft, setAssumeCorrDraft] = useState("0.30")
  const [gapChoiceMade, setGapChoiceMade] = useState(false)

  const holdings = useMemo(
    () => fundHoldings.filter((r) => !isStockRow(r) && !isCashOrNonFundRow(r) && r.marketValue > 0),
    [fundHoldings],
  )

  useEffect(() => {
    setOverrides({})
    setGapChoiceMade(false)
  }, [fromDate, toDate])

  useEffect(() => {
    if (holdings.length === 0 || !seriesLooksThin(series, holdings.length)) {
      setFetchedSeries([])
      setFetchLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setFetchLoading(true)

    const queue = [...holdings]
    const collected: ReturnCurveSeries[] = []

    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const holding = queue.shift()
        if (!holding) break
        const id = holding.beianHao || holding.valuationCode || holding.fundName
        try {
          const r = await fetch(`/ma/api/private-funds/${encodeURIComponent(id)}`, {
            signal: controller.signal,
          })
          if (!r.ok) continue
          const d = await r.json() as { nav_series?: FundNavRow[] }
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
        } catch {
          if (controller.signal.aborted) return
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(6, holdings.length) }, () => worker()))
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

  const activeSeries = useMemo(() => {
    if (!seriesLooksThin(series, holdings.length)) return series
    const parentRich = series.filter((s) => (s.points?.length ?? 0) >= 9).length
    const fetchedRich = fetchedSeries.filter((s) => (s.points?.length ?? 0) >= 9).length
    if (fetchedRich > parentRich) return fetchedSeries
    return series
  }, [series, fetchedSeries, holdings.length])

  const diagnosed = useMemo(
    () => computeFofPortfolioVar({
      holdings,
      series: activeSeries,
      fromDate,
      toDate,
      confidence,
      method,
    }),
    [holdings, activeSeries, fromDate, toDate, confidence, method],
  )

  const result = useMemo(
    () => computeFofPortfolioVar({
      holdings,
      series: activeSeries,
      fromDate,
      toDate,
      confidence,
      method,
      overrides,
    }),
    [holdings, activeSeries, fromDate, toDate, confidence, method, overrides],
  )
  const busy = fetchLoading || (Boolean(loading) && seriesLooksThin(series, holdings.length) && (result?.includedCount ?? 0) === 0)
  const gaps = diagnosed?.gaps ?? []
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
      const proxyKey = g.suggestedProxies[0]?.key
      return [g.key, proxyKey ? { kind: "proxy" as const, proxyKey } : { kind: "ignore" as const }]
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          onAssumeVolDraft={setAssumeVolDraft}
          onAssumeCorrDraft={setAssumeCorrDraft}
          onChange={setGapAction}
          onIgnoreAll={applyAllIgnore}
          onProxyAll={applyAllProxy}
          onAssumeAll={applyAllAssume}
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
            {result.excludedCount > 0 ? ` ${result.excludedCount} 只基金因净值样本不足或起始过晚未纳入协方差。` : ""}
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
  onAssumeVolDraft,
  onAssumeCorrDraft,
  onChange,
  onIgnoreAll,
  onProxyAll,
  onAssumeAll,
}: {
  gaps: FofNavGap[]
  overrides: Record<string, FofGapAction>
  assumeVolDraft: string
  assumeCorrDraft: string
  defaultAssumeVol: number
  onAssumeVolDraft: (v: string) => void
  onAssumeCorrDraft: (v: string) => void
  onChange: (key: string, action: FofGapAction) => void
  onIgnoreAll: () => void
  onProxyAll: () => void
  onAssumeAll: () => void
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
              const proxyKey = action.kind === "proxy"
                ? action.proxyKey
                : gap.suggestedProxies[0]?.key ?? ""
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
                          disabled={gap.suggestedProxies.length === 0}
                          onChange={() => {
                            if (!proxyKey) return
                            onChange(gap.key, { kind: "proxy", proxyKey })
                          }}
                        />
                        用
                      </label>
                      <select
                        value={action.kind === "proxy" ? action.proxyKey : proxyKey}
                        disabled={gap.suggestedProxies.length === 0}
                        onChange={(e) => onChange(gap.key, { kind: "proxy", proxyKey: e.target.value })}
                        className="h-6 max-w-[140px] rounded border border-amber-300 bg-white px-1 disabled:opacity-40"
                      >
                        {gap.suggestedProxies.length === 0 && <option value="">无同类基金</option>}
                        {gap.suggestedProxies.map((p) => (
                          <option key={p.key} value={p.key}>{p.name}</option>
                        ))}
                      </select>
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
