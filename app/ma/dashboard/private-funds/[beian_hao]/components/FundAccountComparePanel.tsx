"use client"

import { memo, useEffect, useMemo, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { computeFundNavMetrics, isPlausibleRiskRatio, type FundNavMetrics } from "@/lib/fund-nav-metrics"
import {
  buildAccountCompareAnalysis,
  type AccountCompareAnalysis,
  type CompareNavPoint,
  type OverlayPoint,
} from "@/lib/ma/fund-account-compare"
import { authService } from "@/lib/auth"
import { canModifyCompareAccount } from "@/lib/permissions"
import { RED, getNavFieldValue, type NavRow } from "./shared"
import { dateToUtcTs, echartsTimeXAxis, formatIsoDateFromTs, toGappedLinePoints } from "./performanceChartUtils"

function userFetchHeaders(): Record<string, string> {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

const ACCOUNT_BLUE = "#2563eb"
const EXCESS_PURPLE = "#7c3aed"

type AccountCompareResponse = {
  ok: boolean
  account: string | null
  defaultAccount: string | null
  linkedAccounts: Array<{ account: string; note?: string }>
  availableAccounts: string[]
  advisor: { advisor_name: string | null; company: string | null; sector: string | null } | null
  series: Array<{ date: string; nav: number; dailyReturn: number; pnl: number; equity: number }>
  message?: string | null
  error?: string
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${(v * 100).toFixed(digits)}%`
}

function fmtSignedPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—"
  const pct = v * 100
  return `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`
}

function fmtRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || !isPlausibleRiskRatio(v)) return "—"
  return v.toFixed(2)
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return String(Math.round(v))
}

function signedClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "text-zinc-700"
  return v > 0 ? "text-red-500" : "text-emerald-600"
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-100 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/80">
        <div className="text-sm font-medium text-zinc-800">{title}</div>
        {hint && <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function overlayOption(
  overlay: OverlayPoint[],
  fundLabel: string,
  accountLabel: string,
  mode: "return" | "drawdown" | "excess",
) {
  const dates = overlay.map((p) => p.date)
  const showDots = overlay.length <= 40
  const fundY = (p: OverlayPoint) => (mode === "drawdown" ? p.fundDd : mode === "excess" ? p.excessPct : p.fundPct)
  const accY = (p: OverlayPoint) => (mode === "drawdown" ? p.accountDd : p.accountPct)

  const fundPoints = toGappedLinePoints(
    overlay.map((p) => ({ ts: dateToUtcTs(p.date), y: fundY(p), date: p.date })),
    showDots,
  )
  const accPoints = mode === "excess"
    ? []
    : toGappedLinePoints(
        overlay.map((p) => ({ ts: dateToUtcTs(p.date), y: accY(p), date: p.date })),
        showDots,
      )

  const series: Array<Record<string, unknown>> = []
  if (mode !== "excess") {
    series.push({
      name: accountLabel,
      type: "line",
      showSymbol: true,
      symbol: "circle",
      symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
      connectNulls: false,
      lineStyle: { width: 1.75, color: ACCOUNT_BLUE, type: mode === "return" ? "dashed" : "solid" },
      itemStyle: { color: ACCOUNT_BLUE },
      data: accPoints,
    })
    series.push({
      name: fundLabel,
      type: "line",
      showSymbol: true,
      symbol: "circle",
      symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
      connectNulls: false,
      lineStyle: { width: 2, color: RED },
      itemStyle: { color: RED },
      data: fundPoints,
    })
  } else {
    series.push({
      name: "超额收益",
      type: "line",
      showSymbol: true,
      symbol: "circle",
      symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
      connectNulls: false,
      lineStyle: { width: 2, color: EXCESS_PURPLE },
      itemStyle: { color: EXCESS_PURPLE },
      areaStyle: {
        color: {
          type: "linear",
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(124,58,237,0.16)" },
            { offset: 1, color: "rgba(124,58,237,0.01)" },
          ],
        },
      },
      data: fundPoints,
    })
  }

  return {
    backgroundColor: "transparent",
    animation: false,
    useUTC: true,
    tooltip: {
      trigger: "axis" as const,
      axisPointer: { type: "line" as const, snap: true },
      formatter: (raw: unknown) => {
        const params = Array.isArray(raw) ? raw : [raw]
        const first = params[0] as { data?: { date?: string }; axisValue?: number } | undefined
        const date = first?.data?.date
          ?? (typeof first?.axisValue === "number" ? formatIsoDateFromTs(first.axisValue) : "")
        const lines = [date]
        for (const item of params as Array<{ seriesName?: string; value?: [number, number | null] }>) {
          const y = Array.isArray(item.value) ? item.value[1] : null
          if (typeof y !== "number" || !Number.isFinite(y)) continue
          lines.push(`${item.seriesName}: ${y >= 0 ? "+" : ""}${y.toFixed(2)}%`)
        }
        return lines.join("<br/>")
      },
    },
    legend: {
      top: 0,
      right: 8,
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: "#52525b" },
    },
    grid: { left: 52, right: 20, top: 28, bottom: 28 },
    xAxis: echartsTimeXAxis(dates),
    yAxis: {
      type: "value" as const,
      axisLabel: {
        fontSize: 11,
        color: "#71717a",
        formatter: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f0f0f2", type: "dashed" as const } },
    },
    series,
  }
}

function monthlyBarOption(monthly: AccountCompareAnalysis["monthly"], fundLabel: string, accountLabel: string) {
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis" as const,
      axisPointer: { type: "shadow" as const },
      formatter: (raw: unknown) => {
        const params = Array.isArray(raw) ? raw : [raw]
        const first = params[0] as { axisValue?: string } | undefined
        const lines = [String(first?.axisValue ?? "")]
        for (const item of params as Array<{ seriesName?: string; value?: number }>) {
          if (typeof item.value !== "number") continue
          lines.push(`${item.seriesName}: ${item.value >= 0 ? "+" : ""}${item.value.toFixed(2)}%`)
        }
        return lines.join("<br/>")
      },
    },
    legend: {
      top: 0,
      right: 8,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: "#52525b" },
    },
    grid: { left: 48, right: 16, top: 28, bottom: 36 },
    xAxis: {
      type: "category" as const,
      data: monthly.map((r) => r.ym),
      axisLabel: { fontSize: 10, color: "#71717a", rotate: monthly.length > 10 ? 40 : 0 },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: {
        fontSize: 11,
        color: "#71717a",
        formatter: (v: number) => `${v}%`,
      },
      splitLine: { lineStyle: { color: "#f0f0f2", type: "dashed" as const } },
    },
    series: [
      {
        name: fundLabel,
        type: "bar",
        barMaxWidth: 10,
        itemStyle: { color: RED },
        data: monthly.map((r) => +(r.fundRet * 100).toFixed(2)),
      },
      {
        name: accountLabel,
        type: "bar",
        barMaxWidth: 10,
        itemStyle: { color: ACCOUNT_BLUE },
        data: monthly.map((r) => +(r.accountRet * 100).toFixed(2)),
      },
      {
        name: "超额",
        type: "bar",
        barMaxWidth: 10,
        itemStyle: { color: EXCESS_PURPLE },
        data: monthly.map((r) => +(r.excess * 100).toFixed(2)),
      },
    ],
  }
}

const METRIC_ROWS: Array<{
  key: keyof FundNavMetrics
  label: string
  format: (v: number | null | undefined) => string
  signed?: boolean
}> = [
  { key: "periodRet", label: "区间收益", format: fmtSignedPct, signed: true },
  { key: "annVol", label: "年化波动", format: fmtPct },
  { key: "maxDD", label: "最大回撤", format: (v) => fmtPct(v == null ? v : -Math.abs(v)) },
  { key: "sharpe", label: "夏普比率", format: fmtRatio },
  { key: "calmar", label: "卡玛比率", format: fmtRatio },
  { key: "sortino", label: "索提诺比率", format: fmtRatio },
  { key: "downsideRisk", label: "下行风险", format: fmtPct },
  { key: "ddRecoveryDays", label: "回撤修复(天)", format: fmtInt },
]

export const FundAccountComparePanel = memo(function FundAccountComparePanel({
  beian_hao,
  productName,
  dateFrom,
  dateTo,
  rows,
  navType,
}: {
  beian_hao: string
  productName: string
  dateFrom: string
  dateTo: string
  rows: NavRow[]
  navType: string
}) {
  const [account, setAccount] = useState("")
  const [userPicked, setUserPicked] = useState(false)
  const [payload, setPayload] = useState<AccountCompareResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canPickAccount, setCanPickAccount] = useState(() => canModifyCompareAccount(authService.getCurrentUser()))
  const fetchAccount = canPickAccount && userPicked ? account : ""

  useEffect(() => {
    authService.refreshCurrentUser().then((user) => {
      if (user) setCanPickAccount(canModifyCompareAccount(user))
    })
  }, [])

  useEffect(() => {
    setAccount("")
    setUserPicked(false)
    setPayload(null)
  }, [beian_hao])

  useEffect(() => {
    if (!beian_hao) {
      setPayload(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({
      product_name: productName,
    })
    if (fetchAccount) qs.set("account", fetchAccount)
    if (dateFrom) qs.set("from", dateFrom)
    if (dateTo) qs.set("to", dateTo)
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/account-compare?${qs}`, {
      headers: userFetchHeaders(),
    })
      .then((r) => r.json() as Promise<AccountCompareResponse>)
      .then((json) => {
        if (cancelled) return
        if (!json.ok && json.error) {
          setError(json.error)
          setPayload(null)
          return
        }
        setPayload(json)
        if (!userPicked) {
          const resolved = json.account || json.defaultAccount || ""
          if (resolved) setAccount(resolved)
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [beian_hao, dateFrom, dateTo, productName, fetchAccount, userPicked])

  const fundPoints = useMemo<CompareNavPoint[]>(() => {
    return rows
      .map((row) => ({ d: row.price_date.slice(0, 10), v: getNavFieldValue(row, navType) }))
      .filter((p) => Number.isFinite(p.v) && p.v > 0)
  }, [rows, navType])

  const accountPoints = useMemo<CompareNavPoint[]>(() => {
    return (payload?.series ?? [])
      .filter((p) => (!dateFrom || p.date >= dateFrom) && (!dateTo || p.date <= dateTo))
      .map((p) => ({ d: p.date, v: p.nav }))
      .filter((p) => Number.isFinite(p.v) && p.v > 0)
  }, [payload?.series, dateFrom, dateTo])

  const analysis = useMemo(
    () => (fundPoints.length >= 2 && accountPoints.length >= 2
      ? buildAccountCompareAnalysis(fundPoints, accountPoints)
      : null),
    [fundPoints, accountPoints],
  )

  const accountLabel = `MOM ${payload?.account ?? account ?? ""}`.trim()
  const availableAccounts = payload?.availableAccounts?.length
    ? payload.availableAccounts
    : (account ? [account] : [])

  const overlapMetrics = analysis?.difference
  const nativeFundMetrics = fundPoints.length >= 2
    ? computeFundNavMetrics({ dates: fundPoints.map((p) => p.d), values: fundPoints.map((p) => p.v) })
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-600">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">对比账户</span>
          <select
            value={account}
            disabled={!canPickAccount}
            onChange={(e) => {
              if (!canPickAccount) return
              setUserPicked(true)
              setAccount(e.target.value)
            }}
            title={canPickAccount ? undefined : "无权限修改对比账户"}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none min-w-[120px] disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {!account && <option value="">请选择账户</option>}
            {availableAccounts.map((acc) => (
              <option key={acc} value={acc}>{acc}</option>
            ))}
          </select>
        </div>
        {payload?.advisor?.advisor_name && (
          <span>投顾：<span className="font-medium text-zinc-800">{payload.advisor.advisor_name}</span></span>
        )}
        {payload?.advisor?.company && (
          <span>公司：<span className="font-medium text-zinc-800">{payload.advisor.company}</span></span>
        )}
        {dateFrom && dateTo && (
          <span>重叠统计：{analysis?.difference
            ? `${analysis.difference.overlapStart} ~ ${analysis.difference.overlapEnd}`
            : `${dateFrom} ~ ${dateTo}`}</span>
        )}
      </div>
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        产品线用{navType}；账户线用 MOM 结算日报按日复利（当日盈亏−手续费+权利金净额）/ 上日结存，起点归一后对比。
        相关性和跟踪误差只在产品净值披露日上配对，避免把周频产品当成日频。
      </p>

      {loading && <div className="min-h-[240px] text-sm text-zinc-400 py-16 text-center">加载账户净值…</div>}
      {error && <div className="min-h-[160px] text-sm text-red-500 py-10 text-center">{error}</div>}
      {!loading && !error && !account && (
        <div className="min-h-[160px] text-sm text-zinc-400 py-10 text-center">请选择要对比的 MOM 账户</div>
      )}
      {!loading && !error && account && payload?.message && !payload.series.length && (
        <div className="min-h-[160px] text-sm text-zinc-400 py-10 text-center">{payload.message}</div>
      )}
      {!loading && !error && account && payload && payload.series.length > 0 && fundPoints.length < 2 && (
        <div className="min-h-[160px] text-sm text-zinc-400 py-10 text-center">产品净值不足，无法对比</div>
      )}
      {!loading && !error && analysis && analysis.overlay.length < 2 && (
        <div className="min-h-[160px] text-sm text-zinc-400 py-10 text-center">所选区间内产品与账户没有重叠日期</div>
      )}

      {!loading && !error && analysis && analysis.overlay.length >= 2 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi
              label="产品区间收益"
              value={fmtSignedPct(analysis.fundMetrics?.periodRet)}
              className={signedClass(analysis.fundMetrics?.periodRet)}
            />
            <Kpi
              label="账户区间收益"
              value={fmtSignedPct(analysis.accountMetrics?.periodRet)}
              className={signedClass(analysis.accountMetrics?.periodRet)}
            />
            <Kpi
              label="超额收益"
              value={fmtSignedPct(
                analysis.fundMetrics && analysis.accountMetrics
                  ? analysis.fundMetrics.periodRet - analysis.accountMetrics.periodRet
                  : null,
              )}
              className={signedClass(
                analysis.fundMetrics && analysis.accountMetrics
                  ? analysis.fundMetrics.periodRet - analysis.accountMetrics.periodRet
                  : null,
              )}
            />
            <Kpi label="收益相关性" value={fmtRatio(overlapMetrics?.correlation)} />
            <Kpi
              label="跟踪误差"
              value={overlapMetrics?.trackingError != null ? fmtPct(overlapMetrics.trackingError) : "—"}
            />
          </div>

          <ChartCard title="累计收益对比" hint="重叠起点归一为 0%">
            <div className="h-[360px] px-2 py-2">
              <ReactECharts
                option={overlayOption(analysis.overlay, productName, accountLabel, "return")}
                style={{ height: "100%", width: "100%" }}
                notMerge
              />
            </div>
          </ChartCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="回撤对比">
              <div className="h-[280px] px-2 py-2">
                <ReactECharts
                  option={overlayOption(analysis.overlay, productName, accountLabel, "drawdown")}
                  style={{ height: "100%", width: "100%" }}
                  notMerge
                />
              </div>
            </ChartCard>
            <ChartCard title="累计超额" hint="产品 − 账户">
              <div className="h-[280px] px-2 py-2">
                <ReactECharts
                  option={overlayOption(analysis.overlay, productName, accountLabel, "excess")}
                  style={{ height: "100%", width: "100%" }}
                  notMerge
                />
              </div>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="重叠区间指标">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-100 text-zinc-500">
                    <th className="text-left font-medium px-4 py-2">指标</th>
                    <th className="text-right font-medium px-4 py-2">{productName}</th>
                    <th className="text-right font-medium px-4 py-2">{accountLabel}</th>
                    <th className="text-right font-medium px-4 py-2">差额</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => {
                    const fv = analysis.fundMetrics?.[row.key] as number | null | undefined
                    const av = analysis.accountMetrics?.[row.key] as number | null | undefined
                    const diff = fv != null && av != null && Number.isFinite(fv) && Number.isFinite(av)
                      ? fv - av
                      : null
                    return (
                      <tr key={row.key} className="border-b border-zinc-50">
                        <td className="px-4 py-2 text-zinc-600">{row.label}</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${row.signed ? signedClass(fv) : "text-zinc-800"}`}>
                          {row.format(fv)}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${row.signed ? signedClass(av) : "text-zinc-800"}`}>
                          {row.format(av)}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${signedClass(diff)}`}>
                          {row.key === "periodRet" || row.key === "annVol" || row.key === "maxDD" || row.key === "downsideRisk"
                            ? fmtSignedPct(diff)
                            : row.key === "ddRecoveryDays"
                              ? (diff == null ? "—" : String(Math.round(diff)))
                              : fmtRatio(diff)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ChartCard>

            <ChartCard title="差异分析" hint="按产品净值披露日配对">
              <div className="grid grid-cols-2 gap-px bg-zinc-100">
                <Stat label="配对点数" value={overlapMetrics ? String(overlapMetrics.pairCount) : "—"} />
                <Stat label="跑赢占比" value={overlapMetrics?.hitRate != null ? fmtPct(overlapMetrics.hitRate) : "—"} />
                <Stat
                  label="平均超额"
                  value={fmtSignedPct(overlapMetrics?.avgDailyExcess)}
                  className={signedClass(overlapMetrics?.avgDailyExcess)}
                />
                <Stat label="信息比率" value={fmtRatio(overlapMetrics?.informationRatio)} />
                <Stat
                  label="最大单期超额"
                  value={fmtSignedPct(overlapMetrics?.maxDailyExcess)}
                  className={signedClass(overlapMetrics?.maxDailyExcess)}
                />
                <Stat
                  label="最大单期落后"
                  value={fmtSignedPct(overlapMetrics?.minDailyExcess)}
                  className={signedClass(overlapMetrics?.minDailyExcess)}
                />
                <Stat
                  label="产品最大回撤"
                  value={fmtPct(analysis.fundMetrics ? -Math.abs(analysis.fundMetrics.maxDD) : null)}
                />
                <Stat
                  label="账户最大回撤"
                  value={fmtPct(analysis.accountMetrics ? -Math.abs(analysis.accountMetrics.maxDD) : null)}
                />
              </div>
              {nativeFundMetrics && analysis.fundMetrics && (
                <div className="px-4 py-2 text-[11px] text-zinc-400">
                  上表均在重叠区间内计算，与产品页「成立以来」指标可能不同。
                </div>
              )}
            </ChartCard>
          </div>

          {analysis.monthly.length > 0 && (
            <ChartCard title="月度收益对比">
              <div className="h-[280px] px-2 py-2">
                <ReactECharts
                  option={monthlyBarOption(analysis.monthly, productName, accountLabel)}
                  style={{ height: "100%", width: "100%" }}
                  notMerge
                />
              </div>
            </ChartCard>
          )}
        </>
      )}
    </div>
  )
})

function Kpi({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-zinc-100 px-3 py-2.5">
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${className ?? "text-zinc-800"}`}>{value}</div>
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className={`mt-1 text-sm font-medium tabular-nums ${className ?? "text-zinc-800"}`}>{value}</div>
    </div>
  )
}
