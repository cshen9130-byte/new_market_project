"use client"

import { useMemo, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import FomcCpiMarkedChart from "@/components/charts/fomc-cpi-marked-chart"
import FomcCpiMomChart from "@/components/charts/fomc-cpi-mom-chart"
import {
  ACTION_LABEL,
  AUG_CPI_PARTS,
  CORE_MOM_2026,
  CORE_PCE_YOY,
  CORE_YOY,
  CIVPART,
  ERA_LABEL,
  FEDWATCH_RANGE_LABEL,
  HIST_FOMC,
  MEETINGS,
  MONTHLY,
  NFP_2026,
  RANGE_LABEL,
  SAHM,
  SEP_HIKE_ODDS,
  U6RATE,
  UNRATE,
  fedwatchRangeStart,
  fedwatchTimestamp,
  fmtBps,
  fmtFunds,
  fmtPct,
  monthName,
  monthlyFromMap,
  rangeStart,
  surprise,
  surpriseLabel,
  type ChartRange,
  type Era,
  type FedwatchRange,
} from "@/lib/ma/fomc-cpi"

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="flex items-center gap-3 scroll-mt-4">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      <div className="flex-1 border-t border-border" />
    </div>
  )
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
}

function toneClass(tone: "hot" | "cold" | "inline" | "pending" | "neutral") {
  if (tone === "hot") return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
  if (tone === "cold") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
  if (tone === "pending") return "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
  return ""
}

export default function GlobalFomcSection() {
  const [era, setEra] = useState<Era>("all")
  const [chartRange, setChartRange] = useState<ChartRange>("since22")
  const [fedwatchRange, setFedwatchRange] = useState<FedwatchRange>("meeting")

  const ymStart = rangeStart(chartRange)
  const longAxis = chartRange === "from2000" || chartRange === "since10"
  const monthly = useMemo(() => MONTHLY.filter((d) => d.ym >= ymStart), [ymStart])
  const chartMeetings = useMemo(
    () =>
      [...HIST_FOMC, ...MEETINGS].filter((m) => {
        if (m.decision < `${ymStart}-01`) return false
        if (longAxis) return m.action !== "Hold"
        return true
      }),
    [ymStart, longAxis],
  )

  const yMin = chartRange === "recent" ? 2 : chartRange === "since22" ? 0 : -2.5
  const yMax = chartRange === "recent" ? 4.5 : 10
  const cpi2026 = useMemo(() => MONTHLY.filter((d) => d.released.startsWith("2026.")), [])

  const rows = useMemo(() => MEETINGS.filter((m) => era === "all" || m.era === era), [era])
  const decided = rows.filter((m) => m.action !== "Pending")
  const surprises = decided.map(surprise)
  const avgSurprise = surprises.reduce((a, b) => a + b, 0) / Math.max(surprises.length, 1)
  const hot = decided.filter((m) => surprise(m) > 0).length
  const cold = decided.filter((m) => surprise(m) < 0).length
  const inline = decided.filter((m) => surprise(m) === 0).length

  const cross = useMemo(() => {
    const buckets = [
      { action: "Hike" as const, hot: 0, inline: 0, cold: 0 },
      { action: "Hold" as const, hot: 0, inline: 0, cold: 0 },
      { action: "Cut" as const, hot: 0, inline: 0, cold: 0 },
    ]
    for (const m of MEETINGS) {
      if (m.action === "Pending") continue
      const bucket = buckets.find((c) => c.action === m.action)
      if (!bucket) continue
      const s = surprise(m)
      if (s > 0) bucket.hot += 1
      else if (s < 0) bucket.cold += 1
      else bucket.inline += 1
    }
    return buckets
  }, [])

  const hikeOdds = useMemo(() => {
    const start = fedwatchRangeStart(fedwatchRange)
    return SEP_HIKE_ODDS.filter((d) => d.date >= start)
  }, [fedwatchRange])

  const hikeOddsOption = useMemo(() => {
    const longView = fedwatchRange === "since25" || fedwatchRange === "since22" || fedwatchRange === "ytd"
    const dense = hikeOdds.length > 10
    const yMin = fedwatchRange === "month" ? 30 : fedwatchRange === "meeting" ? 20 : 0
    return {
      backgroundColor: "transparent",
      grid: { left: 40, right: 16, top: 24, bottom: longView || dense ? 44 : 28 },
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { dataIndex: number }[]) => {
          const row = hikeOdds[params[0]?.dataIndex ?? 0]
          if (!row) return ""
          return `${row.label}<br/>加息 ${row.hike}%<br/>${row.note}`
        },
      },
      xAxis: longView
        ? {
            type: "time" as const,
            axisLabel: { fontSize: 10, hideOverlap: true },
          }
        : {
            type: "category" as const,
            data: hikeOdds.map((d) => d.label),
            axisLabel: { fontSize: 10, rotate: dense ? 40 : 0 },
          },
      yAxis: { type: "value" as const, min: yMin, max: 100, axisLabel: { formatter: "{value}%" } },
      series: [
        {
          name: "加息概率",
          type: "line" as const,
          data: longView
            ? hikeOdds.map((d) => [fedwatchTimestamp(d), d.hike] as [number, number])
            : hikeOdds.map((d) => d.hike),
          smooth: false,
          showSymbol: true,
          symbolSize: dense ? 6 : 8,
          label: { show: !dense, formatter: "{c}%", fontSize: 10 },
          lineStyle: { width: 2, color: "#C44E52" },
          itemStyle: { color: "#C44E52" },
        },
      ],
    }
  }, [hikeOdds, fedwatchRange])

  const coreMomOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 40, right: 12, top: 16, bottom: 28 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(1)}%` },
      xAxis: { type: "category", data: CORE_MOM_2026.map((d) => d.m) },
      yAxis: { type: "value", min: -0.1, max: 0.5, axisLabel: { formatter: "{value}%" } },
      series: [
        {
          name: "核心 CPI 环比",
          type: "bar",
          data: CORE_MOM_2026.map((d) => d.actual),
          itemStyle: { color: "#C44E52" },
          label: { show: true, position: "top", formatter: "{c}%", fontSize: 10 },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 0.2, label: { formatter: "2% 年化", fontSize: 10 }, lineStyle: { type: "dashed" } }],
          },
        },
      ],
    }),
    [],
  )

  const augPartsOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 110, right: 28, top: 8, bottom: 16 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(1)}%` },
      xAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
      yAxis: { type: "category", data: AUG_CPI_PARTS.map((d) => d.name).reverse(), axisLabel: { fontSize: 11 } },
      series: [
        {
          name: "8 月环比",
          type: "bar",
          data: [...AUG_CPI_PARTS].reverse().map((d) => d.v),
          itemStyle: { color: "#DD8452" },
          label: { show: true, position: "right", formatter: "{c}%", fontSize: 10 },
        },
      ],
    }),
    [],
  )

  const nfpOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 44, right: 12, top: 16, bottom: 28 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: NFP_2026.map((d) => d.m) },
      yAxis: { type: "value", name: "千人" },
      series: [
        {
          name: "非农新增 (千)",
          type: "bar",
          data: NFP_2026.map((d) => d.k),
          itemStyle: { color: "#4C72B0" },
          label: { show: true, position: "top", fontSize: 10 },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 31, label: { formatter: "12 月均值 31k", fontSize: 10 }, lineStyle: { type: "dashed" } }],
          },
        },
      ],
    }),
    [],
  )

  const labor2026 = useMemo(
    () =>
      NFP_2026.map((d, i) => {
        const ym = `2026-${String(i + 1).padStart(2, "0")}`
        return { m: d.m, k: d.k, rate: UNRATE[ym], u6: U6RATE[ym], part: CIVPART[ym] }
      }),
    [],
  )

  const unrate2026Option = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 44, right: 12, top: 16, bottom: 28 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(1)}%` },
      xAxis: { type: "category", data: labor2026.map((d) => d.m) },
      yAxis: { type: "value", min: 4, max: 4.5, axisLabel: { formatter: "{value}%" } },
      series: [
        {
          name: "失业率",
          type: "line",
          data: labor2026.map((d) => d.rate),
          showSymbol: true,
          symbolSize: 8,
          label: { show: true, formatter: "{c}%", fontSize: 10 },
          lineStyle: { width: 2, color: "#4C72B0" },
          itemStyle: { color: "#4C72B0" },
        },
      ],
    }),
    [labor2026],
  )

  const nfpUnrateOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 48, right: 48, top: 28, bottom: 28 },
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      xAxis: { type: "category", data: labor2026.map((d) => d.m) },
      yAxis: [
        { type: "value", name: "千人", splitLine: { lineStyle: { color: "#eee" } } },
        { type: "value", name: "失业率", min: 4, max: 4.5, axisLabel: { formatter: "{value}%" }, splitLine: { show: false } },
      ],
      series: [
        {
          name: "非农新增",
          type: "bar",
          data: labor2026.map((d) => d.k),
          itemStyle: { color: "#4C72B0" },
        },
        {
          name: "失业率",
          type: "line",
          yAxisIndex: 1,
          data: labor2026.map((d) => d.rate),
          showSymbol: true,
          symbolSize: 8,
          lineStyle: { width: 2, color: "#C44E52" },
          itemStyle: { color: "#C44E52" },
        },
      ],
    }),
    [labor2026],
  )

  const unrateMonthly = useMemo(() => monthlyFromMap(monthly, UNRATE), [monthly])
  const u6Monthly = useMemo(() => monthlyFromMap(monthly, U6RATE), [monthly])
  const sahmMonthly = useMemo(() => monthlyFromMap(monthly, SAHM), [monthly])
  const partMonthly = useMemo(() => monthlyFromMap(monthly, CIVPART), [monthly])

  const unrateY =
    chartRange === "recent" ? ([3.9, 4.7] as const) : chartRange === "since22" ? ([3.2, 4.8] as const) : ([3, 15] as const)
  const u6Y =
    chartRange === "recent" ? ([3.8, 9] as const) : chartRange === "since22" ? ([3.2, 9.2] as const) : ([3, 24] as const)
  const sahmY =
    chartRange === "recent" ? ([-0.2, 0.55] as const) : chartRange === "since22" ? ([-0.35, 0.7] as const) : ([-0.5, 10] as const)
  const partY =
    chartRange === "recent" ? ([61.2, 62.8] as const) : chartRange === "since22" ? ([61.2, 63.2] as const) : ([59.8, 67.6] as const)

  const meetingCpiOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 40, right: 16, top: 28, bottom: 40 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(1)}%` },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      xAxis: { type: "category", data: rows.map((m) => m.label), axisLabel: { fontSize: 10, rotate: 40 } },
      yAxis: {
        type: "value",
        min: era === "now" ? 2 : era === "ease" ? 2 : 0,
        max: era === "now" ? 5 : era === "ease" ? 6 : 10,
        axisLabel: { formatter: "{value}%" },
      },
      series: [
        {
          name: "CPI 实际同比",
          type: "line",
          data: rows.map((m) => m.actual),
          showSymbol: true,
          lineStyle: { color: "#C44E52" },
          itemStyle: { color: "#C44E52" },
        },
        {
          name: "一致预期",
          type: "line",
          data: rows.map((m) => m.forecast),
          showSymbol: true,
          lineStyle: { type: "dashed", color: "#4C72B0" },
          itemStyle: { color: "#4C72B0" },
        },
        {
          type: "line",
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 2, label: { formatter: "Fed 2%", fontSize: 10 }, lineStyle: { type: "dashed" } }],
          },
          data: [],
        },
      ],
    }),
    [rows, era],
  )

  const surpriseOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}pp` },
      xAxis: { type: "category", data: rows.map((m) => m.label), axisLabel: { fontSize: 10, rotate: 40 } },
      yAxis: { type: "value", name: "百分点" },
      series: [
        {
          name: "实际 − 预期",
          type: "bar",
          data: rows.map((m) => surprise(m)),
          itemStyle: {
            color: (p: { data: number }) => (p.data > 0 ? "#C44E52" : p.data < 0 ? "#55A868" : "#8C8C8C"),
          },
        },
      ],
    }),
    [rows],
  )

  const fundsOption = useMemo(() => {
    const decidedRows = rows.filter((m) => m.fundsHi != null)
    return {
      backgroundColor: "transparent",
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}%` },
      xAxis: { type: "category", data: decidedRows.map((m) => m.label), axisLabel: { fontSize: 10, rotate: 40 } },
      yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
      series: [
        {
          name: "联邦基金上限",
          type: "line",
          data: decidedRows.map((m) => m.fundsHi as number),
          areaStyle: { color: "rgba(76,114,176,0.12)" },
          lineStyle: { color: "#4C72B0" },
          itemStyle: { color: "#4C72B0" },
        },
      ],
    }
  }, [rows])

  const crossOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 40, right: 16, top: 28, bottom: 28 },
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      xAxis: { type: "category", data: ["加息", "按兵不动", "降息"] },
      yAxis: { type: "value", name: "次数" },
      series: [
        { name: "偏热 CPI", type: "bar", data: cross.map((c) => c.hot), itemStyle: { color: "#C44E52" } },
        { name: "符合预期", type: "bar", data: cross.map((c) => c.inline), itemStyle: { color: "#8C8C8C" } },
        { name: "偏冷 CPI", type: "bar", data: cross.map((c) => c.cold), itemStyle: { color: "#55A868" } },
      ],
    }),
    [cross],
  )

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle id="fomc-cpi-section">FOMC / CPI 每日跟踪</SectionTitle>
      <p className="text-sm text-muted-foreground -mt-3">
        按日跟踪下次 FOMC 定价与委员会手里已有的通胀、就业读数。每次决议配对当日最新 CPI（实际 vs
        一致预期），并对照 CME FedWatch。数据截至 2026-09-14。
      </p>

      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="font-medium">盯盘要点</div>
          <div className="text-xs text-muted-foreground">截至 2026-09-14 · 下次决议 9/16</div>
        </div>
        <p className="mt-1 text-muted-foreground">
          最新 CPI（8 月，9.11 公布）头条符合预期；核心同比 2.4%，为 2021 年 3 月以来最低。7 月核心 PCE 仍是 3.3%。CME
          FedWatch 将 9 月 16 日加息 25bp 的概率从 69% 抬到 87%。当前定价看分项构成与当周数据，而不是同比水平。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value="69% → 87%" label="FedWatch 加息概率（最新）" tone="hot" />
        <StatCard value="+0.3% vs 0.2%" label="核心环比 vs 预期" tone="hot" />
        <StatCard value="162k vs ~55k" label="最新非农 vs 预期" tone="pending" />
        <StatCard value="+0.5%" label="超级核心环比（服务除住房）" tone="hot" />
      </div>

      <Card id="fedwatch-section" className="scroll-mt-4">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">下次 FOMC 加息概率 — CME FedWatch</CardTitle>
              <CardDescription>
                跟踪下次决议 +25bp 的隐含概率。可选今年、2025 以来或 2022 加息周期以来。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(FEDWATCH_RANGE_LABEL) as FedwatchRange[]).map((id) => (
                <Pill key={id} active={fedwatchRange === id} onClick={() => setFedwatchRange(id)}>
                  {FEDWATCH_RANGE_LABEL[id]}
                </Pill>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ReactECharts option={hikeOddsOption} style={{ height: fedwatchRange === "since22" || fedwatchRange === "since25" ? 320 : 280 }} notMerge />
          <p className="mt-2 text-xs text-muted-foreground">
            来源：CME FedWatch 快照（Gate / StockCram / Haver / InvestLin / CNBC / Forbes / HousingWire）。每次 FOMC 之后序列切换到下一场会议。2022–25 年为会前快照，按兵不动 ≈ 100 − 加息。
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2026 核心 CPI 环比 — 委员会实际看的序列</CardTitle>
            <CardDescription>
              季调环比。虚线 0.2% 约等于 2% 年化。6 月会议看到 5 月 +0.2% 后 12–0 按兵不动；7 月看到 6 月 0.0% 后 9–3
              按兵不动。本周看到 8 月 +0.3% vs 0.2%。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={coreMomOption} style={{ height: 240 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">来源：BLS Table A · 8 月一致预期 0.2%（DJ/WSJ）</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">8 月分项 — 头条掩盖了热度</CardTitle>
            <CardDescription>
              环比 %。能源 +2.1%（汽油 +3.9%）贡献头条 0.4% 的三分之一以上。超级核心 +0.5%，住房从 0.1% 再加速到 0.3%。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={augPartsOption} style={{ height: 260 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">来源：BLS / Haver 2026-09-11</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">同一美联储，三次会议 — 为何 6 月按兵不动、9 月定价加息</CardTitle>
          <CardDescription>头条和核心同比都更低了，委员会真正争论的列翻转了。</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">决议时已有数据</th>
                <th className="py-2 px-3 font-medium text-right">6/17 按兵不动 12–0</th>
                <th className="py-2 px-3 font-medium text-right">7/29 按兵不动 9–3</th>
                <th className="py-2 pl-3 font-medium text-right">9/16（本周）</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["CPI 月份", "5 月", "6 月", "8 月（2026.9.11）"],
                ["头条同比", "4.2%（高）", "3.5% vs 3.8%", "3.4% vs 3.4%"],
                ["核心同比", "2.9%", "2.6%", "2.4%（周期低点）"],
                ["核心环比", "+0.2%（低于 0.3%）", "0.0%", "+0.3% vs 0.2%"],
                ["能源", "中东冲击，看穿", "回落（头条 −0.4%）", "+2.1% 环比；同比 16.3%"],
                ["就业", "降温", "偏弱（7 月初值 −23k）", "162k vs ~55k；失业率 4.1%"],
                ["委员会", "一致按兵不动", "Hammack / Kashkari / Logan 主张 +25", "上述 3 人 + 若数据偏热则 Waller/Barr"],
              ].map((row, i) => (
                <tr key={row[0]} className={cn("border-b last:border-0", i === 3 || i === 5 ? "bg-amber-50/60 dark:bg-amber-950/20" : "")}>
                  <td className="py-2 pr-3 text-muted-foreground">{row[0]}</td>
                  {row.slice(1).map((cell) => (
                    <td key={cell} className="py-2 px-3 text-right">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">非农 — 9.4 已先把概率抬上去</CardTitle>
            <CardDescription>
              千人。虚线为前 12 个月均值（31k）。8 月 162k 是五个月来最多，约为 ~55k 预期的 3 倍。6、7 月合计上修 55k。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={nfpOption} style={{ height: 240 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">来源：BLS CES，2026-09-04 就业形势报告</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2026 失业率 — 新增波动、失业率仍缓降</CardTitle>
            <CardDescription>
              季调 U-3。8 月持平 4.1%。5–7 月非农偏弱时失业率仍从 4.3% 降到 4.1%，劳动参与率 7 月 61.4% 后 8 月回升至 61.6%。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={unrate2026Option} style={{ height: 240 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">来源：FRED UNRATE（BLS CPS）</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">非农 vs 失业率 — 2026 同一份就业报告的两面</CardTitle>
          <CardDescription>
            左轴新增（千人），右轴失业率。2 月非农 −156k 时失业率反而升到 4.4%；之后新增回暖、失业率缓慢回落，8 月两者同时转强。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReactECharts option={nfpUnrateOption} style={{ height: 260 }} notMerge />
        </CardContent>
      </Card>

      <SectionTitle id="unrate-section">失业率分析</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGE_LABEL) as ChartRange[]).map((id) => (
          <Pill key={id} active={chartRange === id} onClick={() => setChartRange(id)}>
            {RANGE_LABEL[id]}
          </Pill>
        ))}
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        与下方通胀图共用时间窗口。三角向上 = 加息，方块 = 按兵不动，三角向下 = 降息。长区间隐藏按兵不动标记以免过密。
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value="4.1%" label="8 月失业率 U-3" />
        <StatCard value="7.7%" label="8 月 U-6 广义失业" tone="pending" />
        <StatCard value="61.6%" label="劳动参与率（7 月 61.4%）" />
        <StatCard value="−0.07" label="Sahm 规则（阈值 0.50）" tone="cold" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">美国失业率 U-3 — 叠加 FOMC</CardTitle>
          <CardDescription>
            最新 2026 年 8 月 4.1%。虚线 4.2% 约为近年 SEP 长期失业率。当前读数不支持「就业恶化迫使按兵不动」。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FomcCpiMarkedChart
            monthly={unrateMonthly}
            meetings={chartMeetings}
            yMin={unrateY[0]}
            yMax={unrateY[1]}
            valueLabel="失业率 (%)"
            showForecast={false}
            seriesName="失业率"
            lineColor="#4C72B0"
            referenceLines={[{ value: 4.2, label: "SEP 长期 4.2%" }]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            来源：FRED UNRATE · 2000-01 至 2026-08 · 2025-10 缺失 · 横轴用对应 CPI 公布日，便于与 FOMC 标记对齐
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">U-3 vs U-6 — 广义失业有没有一起下来</CardTitle>
          <CardDescription>
            U-6 含失业、边际附着者和非自愿兼职。8 月 U-6 7.7%，为 2025 年末以来新低，说明宽松不只发生在头条失业率。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FomcCpiMarkedChart
            monthly={unrateMonthly}
            meetings={chartMeetings}
            yMin={u6Y[0]}
            yMax={u6Y[1]}
            valueLabel="%"
            showForecast={false}
            seriesName="U-3"
            lineColor="#4C72B0"
            overlays={[{ name: "U-6", color: "#C44E52", monthly: u6Monthly }]}
          />
          <p className="mt-2 text-xs text-muted-foreground">来源：FRED UNRATE / U6RATE</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sahm 规则 — 是否逼近衰退阈值</CardTitle>
            <CardDescription>
              三月均值相对过去 12 个月低点的升幅。0.50 为实时衰退信号。8 月 −0.07，失业率是在回落而不是攀升。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FomcCpiMarkedChart
              monthly={sahmMonthly}
              meetings={chartMeetings}
              yMin={sahmY[0]}
              yMax={sahmY[1]}
              valueLabel="百分点"
              height={280}
              showForecast={false}
              seriesName="Sahm"
              lineColor="#DD8452"
              referenceLines={[{ value: 0.5, label: "阈值 0.50" }]}
            />
            <p className="mt-2 text-xs text-muted-foreground">来源：FRED SAHMREALTIME</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">劳动参与率 — 就业改善是否靠人退出</CardTitle>
            <CardDescription>
              2026 年从 62.1% 降到 7 月 61.4%，8 月回升至 61.6%。失业率下降并不完全是参与率收缩的假象。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FomcCpiMarkedChart
              monthly={partMonthly}
              meetings={chartMeetings}
              yMin={partY[0]}
              yMax={partY[1]}
              valueLabel="%"
              height={280}
              showForecast={false}
              seriesName="参与率"
              lineColor="#55A868"
            />
            <p className="mt-2 text-xs text-muted-foreground">来源：FRED CIVPART</p>
          </CardContent>
        </Card>
      </div>

      <SectionTitle id="cpi-yoy-section">通胀同比与 FOMC 标记</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGE_LABEL) as ChartRange[]).map((id) => (
          <Pill key={id} active={chartRange === id} onClick={() => setChartRange(id)}>
            {RANGE_LABEL[id]}
          </Pill>
        ))}
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        实线 = CPI 实际；虚线 = 一致预期。三角向上 = 加息，方块 = 按兵不动，三角向下 = 降息。长区间隐藏按兵不动标记以免过密。
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">美国 CPI 同比 — 实际 vs 预测，叠加 FOMC</CardTitle>
          <CardDescription>最新点 2026.9.11（3.4% vs 3.4%）。下次决议 2026.9.16（待定）。</CardDescription>
        </CardHeader>
        <CardContent>
          <FomcCpiMarkedChart
            monthly={monthly}
            meetings={chartMeetings}
            yMin={yMin}
            yMax={yMax}
            valueLabel="CPI 同比 (%)"
            referenceLines={[{ value: 2, label: "Fed 2%" }]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            来源：FRED CPIAUCNS（BLS）· 2000-01 至 2026-08 · FOMC 变息日 DFEDTAR / DFEDTARU
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">美国核心 CPI 同比 — 剔除食品能源，叠加 FOMC</CardTitle>
          <CardDescription>
            峰值 2022 年 9 月 6.6%。最新 2026.9.11（8 月）为 2.4%。仅官方实际值，无预测叠加。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FomcCpiMarkedChart
            monthly={monthly
              .filter((d) => CORE_YOY[d.ym] !== undefined)
              .map((d) => ({ ...d, actual: CORE_YOY[d.ym], forecast: null }))}
            meetings={chartMeetings}
            yMin={chartRange === "recent" ? 2.2 : 0.4}
            yMax={chartRange === "recent" ? 3.4 : 7}
            valueLabel="核心 CPI 同比 (%)"
            showForecast={false}
            referenceLines={[{ value: 2, label: "Fed 2%" }]}
          />
          <p className="mt-2 text-xs text-muted-foreground">来源：FRED CPILFENS · 2025-10 缺失</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">美国核心 PCE 同比 — 美联储目标指标，叠加 FOMC</CardTitle>
          <CardDescription>
            峰值 2022 年 2–3 月 5.6%。最新为 2026 年 7 月 3.3%（5 月曾见 3.5%）。8 月 PCE 尚未公布。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FomcCpiMarkedChart
            monthly={monthly
              .filter((d) => CORE_PCE_YOY[d.ym] !== undefined)
              .map((d) => ({ ...d, actual: CORE_PCE_YOY[d.ym], forecast: null }))}
            meetings={chartMeetings}
            yMin={chartRange === "recent" ? 2.4 : 0.4}
            yMax={chartRange === "recent" ? 3.8 : 6}
            valueLabel="核心 PCE 同比 (%)"
            showForecast={false}
            referenceLines={[{ value: 2, label: "Fed 2%" }]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            来源：FRED PCEPILFE（BEA）· 横轴用对应 CPI 公布日，便于与上图 FOMC 标记对齐
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">美国 CPI 环比 — 季调月率，叠加 FOMC</CardTitle>
          <CardDescription>
            蓝 = 头条环比，红 = 核心环比。虚线 0.2% 对应 2% 年化。2026.9.11：头条 +0.4%（符合预期），核心 +0.3%（偏热）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FomcCpiMomChart monthly={monthly} meetings={chartMeetings} />
          <p className="mt-2 text-xs text-muted-foreground">来源：FRED CPIAUCSL / CPILFESL 环比 · 2025-10 缺失</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2026 年 CPI 公布一览</CardTitle>
          <CardDescription>截至 2026.9.11。意外 = 实际 − 预期。</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["公布日", "CPI 月份", "同比实际", "同比预期", "核心同比", "核心 PCE", "环比", "核心环比"].map((h) => (
                  <th key={h} className="py-2 px-2 font-medium first:pl-0 last:pr-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cpi2026.map((d) => {
                const s = Number((d.actual - (d.forecast ?? d.actual)).toFixed(1))
                const tone = d.released === "2026.9.11" ? "pending" : s > 0 ? "hot" : s < 0 ? "cold" : "inline"
                return (
                  <tr key={d.ym} className={cn("border-b last:border-0", toneClass(tone))}>
                    <td className="py-1.5 px-2 first:pl-0">{d.released}</td>
                    <td className="py-1.5 px-2">{d.ym === "2025-12" ? "2025 年 12 月" : monthName(d.ym)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtPct(d.actual)}</td>
                    <td className="py-1.5 px-2 text-right">{d.forecast != null ? fmtPct(d.forecast) : "—"}</td>
                    <td className="py-1.5 px-2 text-right">{CORE_YOY[d.ym] != null ? fmtPct(CORE_YOY[d.ym]) : "—"}</td>
                    <td className="py-1.5 px-2 text-right">{CORE_PCE_YOY[d.ym] != null ? fmtPct(CORE_PCE_YOY[d.ym]) : "—"}</td>
                    <td className="py-1.5 px-2 text-right">{d.mom != null ? `${d.mom > 0 ? "+" : ""}${d.mom.toFixed(1)}%` : "—"}</td>
                    <td className="py-1.5 px-2 text-right last:pr-0">{d.core != null ? `${d.core > 0 ? "+" : ""}${d.core.toFixed(1)}%` : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <SectionTitle id="fomc-meetings-section">每次会议手里的 CPI</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value="3.4% / 2.4%" label="9.11 头条 / 核心同比" />
        <StatCard value="3.50–3.75%" label="会前联邦基金区间" />
        <StatCard
          value={`${avgSurprise >= 0 ? "+" : ""}${avgSurprise.toFixed(2)} pp`}
          label={`平均意外 · ${ERA_LABEL[era]}`}
          tone={avgSurprise > 0.05 ? "hot" : avgSurprise < -0.05 ? "cold" : "inline"}
        />
        <StatCard value={`${hot} / ${inline} / ${cold}`} label="偏热 / 符合 / 偏冷" />
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(ERA_LABEL) as Era[]).map((id) => (
          <Pill key={id} active={era === id} onClick={() => setEra(id)}>
            {ERA_LABEL[id]}
          </Pill>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">每次 FOMC 手里的 CPI 同比</CardTitle>
          <CardDescription>实际 vs 经济学家一致预期。Fed 2% 目标已标出。</CardDescription>
        </CardHeader>
        <CardContent>
          <ReactECharts option={meetingCpiOption} style={{ height: 260 }} notMerge />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">会议时的 CPI 意外</CardTitle>
            <CardDescription>百分点。正值 = 高于预期（偏鹰），负值 = 低于预期。</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={surpriseOption} style={{ height: 240 }} notMerge />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">决议后政策利率</CardTitle>
            <CardDescription>联邦基金目标区间上限（%）。待决议的 9 月会议未计入。</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={fundsOption} style={{ height: 240 }} notMerge />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">每场 FOMC 与当时看到的 CPI</CardTitle>
          <CardDescription>
            本视图 {rows.length} 场会议。行色：红 = 偏热，绿 = 偏冷，黄 = 待决议。
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["FOMC", "行动", "bp", "会后利率", "CPI 月份", "公布日", "实际", "预期", "意外", "读法", "备注"].map((h) => (
                  <th key={h} className="py-2 px-2 font-medium whitespace-nowrap first:pl-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const s = surprise(m)
                const tone = m.action === "Pending" ? "pending" : s > 0 ? "hot" : s < 0 ? "cold" : "inline"
                return (
                  <tr key={m.decision} className={cn("border-b last:border-0", toneClass(tone))}>
                    <td className="py-1.5 px-2 whitespace-nowrap first:pl-0">{m.decision.slice(0, 10)}</td>
                    <td className="py-1.5 px-2">{ACTION_LABEL[m.action]}</td>
                    <td className="py-1.5 px-2 text-right">{fmtBps(m.bps)}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{fmtFunds(m.fundsHi)}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{m.cpiMonth}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{m.cpiRelease}</td>
                    <td className="py-1.5 px-2 text-right">{fmtPct(m.actual)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtPct(m.forecast)}</td>
                    <td className="py-1.5 px-2 text-right">{`${s > 0 ? "+" : ""}${s.toFixed(1)}`}</td>
                    <td className="py-1.5 px-2">{m.action === "Pending" ? "待决议" : surpriseLabel(s)}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{m.note ?? ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CPI 意外能否预测决议？</CardTitle>
          <CardDescription>
            样本内 37 场已完成会议。美联储不会因为 CPI 偏热就机械加息，也不会因为偏冷就机械降息。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReactECharts option={crossOption} style={{ height: 220 }} notMerge />
          <table className="mt-4 w-full max-w-md text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1.5 text-left font-medium">决议</th>
                <th className="py-1.5 text-right font-medium">偏热</th>
                <th className="py-1.5 text-right font-medium">符合</th>
                <th className="py-1.5 text-right font-medium">偏冷</th>
                <th className="py-1.5 text-right font-medium">合计</th>
              </tr>
            </thead>
            <tbody>
              {cross.map((c) => (
                <tr key={c.action} className="border-b last:border-0">
                  <td className="py-1.5">{ACTION_LABEL[c.action]}</td>
                  <td className="py-1.5 text-right">{c.hot}</td>
                  <td className="py-1.5 text-right">{c.inline}</td>
                  <td className="py-1.5 text-right">{c.cold}</td>
                  <td className="py-1.5 text-right">{c.hot + c.inline + c.cold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        实际值：BLS CPI-U 12 个月未季调同比。预期：Investing.com / Trading Economics / Forex Fundamentals
        经济学家中位数（个别月份可能差 0.1–0.2pp）。配对规则：声明日当日或之前的最后一次 CPI。利率区间来自美联储 FOMC 声明。
      </p>
    </div>
  )
}

function StatCard({
  value,
  label,
  tone,
}: {
  value: string
  label: string
  tone?: "hot" | "cold" | "pending" | "inline"
}) {
  return (
    <div className={cn("rounded-lg border px-4 py-3", tone ? toneClass(tone) : "bg-card")}>
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
