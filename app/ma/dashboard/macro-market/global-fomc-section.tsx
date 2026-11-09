"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import FomcCpiMarkedChart from "@/components/charts/fomc-cpi-marked-chart"
import FomcCpiMomChart from "@/components/charts/fomc-cpi-mom-chart"
import bundledMacro from "@/lib/ma/fomc-cpi-data.json"
import {
  ACTION_LABEL,
  ERA_LABEL,
  FEDWATCH_RANGE_LABEL,
  RANGE_LABEL,
  buildMacroView,
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
  type UsMacroBundle,
} from "@/lib/ma/fomc-cpi"

const BUNDLED_MACRO = bundledMacro as UsMacroBundle

function useUsMacroData(): UsMacroBundle | null {
  const [data, setData] = useState<UsMacroBundle | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/ma/api/macro/us-fomc?ts=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json() as Promise<UsMacroBundle>
      })
      .then((body) => {
        if (!cancelled && body?.MONTHLY && body?.MEETINGS) setData(body)
      })
      .catch(() => {
        if (!cancelled) setData(BUNDLED_MACRO)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return data
}

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

export type FomcChartPart =
  | "fedwatch"
  | "core-mom"
  | "aug-parts"
  | "nfp"
  | "unrate-2026"
  | "nfp-unrate"
  | "unrate"
  | "u6"
  | "sahm"
  | "participation"
  | "cpi-yoy"
  | "core-cpi"
  | "core-pce"
  | "cpi-mom"
  | "meeting-cpi"
  | "surprise"
  | "funds"
  | "cross"

export default function GlobalFomcSection({ part }: { part?: FomcChartPart } = {}) {
  const remote = useUsMacroData()
  const bundle = remote ?? BUNDLED_MACRO
  const {
    MEETINGS,
    MONTHLY,
    HIST_FOMC,
    CORE_YOY,
    CORE_PCE_YOY,
    SEP_HIKE_ODDS,
    CORE_MOM_2026,
    NFP_2026,
    UNRATE,
    U6RATE,
    CIVPART,
    SAHM,
  } = bundle
  const [era, setEra] = useState<Era>("all")
  const [chartRange, setChartRange] = useState<ChartRange>("since22")
  const [fedwatchRange, setFedwatchRange] = useState<FedwatchRange>("meeting")
  const view = useMemo(() => buildMacroView(bundle), [bundle])

  const ymStart = rangeStart(chartRange)
  const longAxis = chartRange === "from2000" || chartRange === "since10"
  const monthly = useMemo(() => MONTHLY.filter((d) => d.actual != null && d.ym >= ymStart), [MONTHLY, ymStart])
  const chartMeetings = useMemo(
    () =>
      [...HIST_FOMC, ...MEETINGS].filter((m) => {
        if (m.decision < `${ymStart}-01`) return false
        if (longAxis) return m.action !== "Hold"
        return true
      }),
    [HIST_FOMC, MEETINGS, ymStart, longAxis],
  )

  const yMin = chartRange === "recent" ? 2 : chartRange === "since22" ? 0 : -2.5
  const yMax = chartRange === "recent" ? 4.5 : 10
  const cpiYearRows = useMemo(
    () => MONTHLY.filter((d) => d.actual != null && (d.ym.startsWith(view.year) || d.released.replace(/\./g, "-").startsWith(view.year))),
    [MONTHLY, view.year],
  )

  const rows = useMemo(() => MEETINGS.filter((m) => era === "all" || m.era === era), [MEETINGS, era])
  const decided = rows.filter((m) => m.action !== "Pending")
  const surprises = decided.map(surprise).filter((value): value is number => value != null)
  const avgSurprise = surprises.reduce((sum, value) => sum + value, 0) / Math.max(surprises.length, 1)
  const hot = decided.filter((m) => (surprise(m) ?? 0) > 0).length
  const cold = decided.filter((m) => (surprise(m) ?? 0) < 0).length
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
      if (s == null) continue
      if (s > 0) bucket.hot += 1
      else if (s < 0) bucket.cold += 1
      else bucket.inline += 1
    }
    return buckets
  }, [MEETINGS])

  const hikeOdds = useMemo(() => {
    const anchor = SEP_HIKE_ODDS[SEP_HIKE_ODDS.length - 1]?.date ?? "2026-01-01"
    const previous = [...MEETINGS].reverse().find((m) => m.action !== "Pending")?.decision
    const start = fedwatchRangeStart(fedwatchRange, anchor, previous)
    const filtered = SEP_HIKE_ODDS.filter((d) => d.date >= start)
    return filtered.length >= 2 ? filtered : SEP_HIKE_ODDS.slice(-8)
  }, [SEP_HIKE_ODDS, MEETINGS, fedwatchRange])

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
    [CORE_MOM_2026],
  )

  const augPartsOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 110, right: 28, top: 8, bottom: 16 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(1)}%` },
      xAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
      yAxis: { type: "category", data: view.parts.map((d) => d.name).reverse(), axisLabel: { fontSize: 11 } },
      series: [
        {
          name: "环比",
          type: "bar",
          data: [...view.parts].reverse().map((d) => d.v),
          itemStyle: { color: "#DD8452" },
          label: { show: true, position: "right", formatter: "{c}%", fontSize: 10 },
        },
      ],
    }),
    [view.parts],
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
            data: [{ yAxis: view.nfpTrail, label: { formatter: `12 月均值 ${view.nfpTrail}k`, fontSize: 10 }, lineStyle: { type: "dashed" } }],
          },
        },
      ],
    }),
    [NFP_2026, view.nfpTrail],
  )

  const labor2026 = useMemo(
    () =>
      NFP_2026.map((d, i) => {
        const ym = d.ym ?? `2026-${String(i + 1).padStart(2, "0")}`
        return { m: d.m, k: d.k, rate: UNRATE[ym], u6: U6RATE[ym], part: CIVPART[ym] }
      }),
    [NFP_2026, UNRATE, U6RATE, CIVPART],
  )

  const laborRatePad = useMemo(() => {
    const rates = labor2026.map((row) => row.rate).filter((value): value is number => typeof value === "number")
    if (!rates.length) return [3.5, 5] as const
    const lo = Math.floor((Math.min(...rates) - 0.25) * 10) / 10
    const hi = Math.ceil((Math.max(...rates) + 0.25) * 10) / 10
    return [lo, Math.max(hi, lo + 0.4)] as const
  }, [labor2026])

  const unrate2026Option = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 44, right: 12, top: 16, bottom: 28 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(1)}%` },
      xAxis: { type: "category", data: labor2026.map((d) => d.m) },
      yAxis: {
        type: "value",
        min: laborRatePad[0],
        max: laborRatePad[1],
        axisLabel: { formatter: "{value}%" },
      },
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
        { type: "value", name: "失业率", min: laborRatePad[0], max: laborRatePad[1], axisLabel: { formatter: "{value}%" }, splitLine: { show: false } },
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

  const unrateMonthly = useMemo(() => monthlyFromMap(monthly, UNRATE), [monthly, UNRATE])
  const u6Monthly = useMemo(() => monthlyFromMap(monthly, U6RATE), [monthly, U6RATE])
  const sahmMonthly = useMemo(() => monthlyFromMap(monthly, SAHM), [monthly, SAHM])
  const partMonthly = useMemo(() => monthlyFromMap(monthly, CIVPART), [monthly, CIVPART])

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

  if (!remote) {
    return <p className="text-sm text-muted-foreground">正在读取美国宏观数据…</p>
  }

  const show = (id: FomcChartPart) => !part || part === id
  const rangePart =
    part === "unrate" ||
    part === "u6" ||
    part === "sahm" ||
    part === "participation" ||
    part === "cpi-yoy" ||
    part === "core-cpi" ||
    part === "core-pce" ||
    part === "cpi-mom"
  const eraPart = part === "meeting-cpi" || part === "surprise" || part === "funds" || part === "cross"

  return (
    <div className="flex flex-col gap-6">
      {rangePart && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(RANGE_LABEL) as ChartRange[]).map((id) => (
            <Pill key={id} active={chartRange === id} onClick={() => setChartRange(id)}>
              {RANGE_LABEL[id]}
            </Pill>
          ))}
        </div>
      )}
      {eraPart && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ERA_LABEL) as Era[]).map((id) => (
            <Pill key={id} active={era === id} onClick={() => setEra(id)}>
              {ERA_LABEL[id]}
            </Pill>
          ))}
        </div>
      )}
      {!part && <SectionTitle id="fomc-cpi-section">FOMC / CPI 每日跟踪</SectionTitle>}
      {!part && <p className="text-sm text-muted-foreground -mt-3">{view.lede}</p>}

      {!part && <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="font-medium">盯盘要点</div>
          <div className="text-xs text-muted-foreground">截至 {view.asOf}</div>
        </div>
        <p className="mt-1 text-muted-foreground">{view.watch}</p>
      </div>}

      {!part && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.cards.map((card) => (
          <StatCard key={card.label} value={card.value} label={card.label} tone={card.tone} />
        ))}
      </div>}

      {show("fedwatch") && <Card id="fedwatch-section" className="scroll-mt-4">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">
                {bundle.meta?.fedwatch === "cme" ? "下次 FOMC 加息概率 — CME FedWatch" : "下次 FOMC 加息概率"}
              </CardTitle>
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
            {view.oddsNote} 2022–25 年为会前快照，按兵不动约等于 100 减去加息概率。
          </p>
        </CardContent>
      </Card>}

      {(show("core-mom") || show("aug-parts")) && <div className={part ? "contents" : "grid gap-6 md:grid-cols-2"}>
        {show("core-mom") && <Card>
          <CardHeader>
            <CardTitle className="text-base">{view.year} 核心 CPI 环比</CardTitle>
            <CardDescription>{view.coreMomDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={coreMomOption} style={{ height: 240 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">{view.coreMomSource}</p>
          </CardContent>
        </Card>}
        {show("aug-parts") && <Card>
          <CardHeader>
            <CardTitle className="text-base">{view.partsTitle}</CardTitle>
            <CardDescription>{view.partsDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={augPartsOption} style={{ height: 260 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">{view.partsSource}</p>
          </CardContent>
        </Card>}
      </div>}

      {!part && <Card>
        <CardHeader>
          <CardTitle className="text-base">最近三次会议手里的通胀</CardTitle>
          <CardDescription>每次决议配对当时已经公布的 CPI。数字随每日 ETL 更新。</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">决议时已有数据</th>
                {view.compareHeaders.map((header) => (
                  <th key={header} className="py-2 px-3 font-medium text-right">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.compareRows.map((row) => (
                <tr key={row[0]} className="border-b last:border-0">
                  <td className="py-2 pr-3 text-muted-foreground">{row[0]}</td>
                  {row.slice(1).map((cell, index) => (
                    <td key={`${row[0]}-${index}`} className="py-2 px-3 text-right">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>}

      {(show("nfp") || show("unrate-2026")) && <div className={part ? "contents" : "grid gap-6 md:grid-cols-2"}>
        {show("nfp") && <Card>
          <CardHeader>
            <CardTitle className="text-base">{view.year} 非农</CardTitle>
            <CardDescription>{view.nfpDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={nfpOption} style={{ height: 240 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">{view.nfpSource}</p>
          </CardContent>
        </Card>}
        {show("unrate-2026") && <Card>
          <CardHeader>
            <CardTitle className="text-base">{view.year} 失业率</CardTitle>
            <CardDescription>{view.unrateYearDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={unrate2026Option} style={{ height: 240 }} notMerge />
            <p className="mt-2 text-xs text-muted-foreground">来源：FRED UNRATE（BLS CPS）</p>
          </CardContent>
        </Card>}
      </div>}

      {show("nfp-unrate") && <Card>
        <CardHeader>
          <CardTitle className="text-base">非农 vs 失业率 — {view.year}</CardTitle>
          <CardDescription>{view.nfpUnrateDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <ReactECharts option={nfpUnrateOption} style={{ height: 260 }} notMerge />
        </CardContent>
      </Card>}

      {!part && <SectionTitle id="unrate-section">失业率分析</SectionTitle>}
      {!part && <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGE_LABEL) as ChartRange[]).map((id) => (
          <Pill key={id} active={chartRange === id} onClick={() => setChartRange(id)}>
            {RANGE_LABEL[id]}
          </Pill>
        ))}
      </div>}
      {!part && <p className="text-xs text-muted-foreground -mt-3">
        与下方通胀图共用时间窗口。三角向上 = 加息，方块 = 按兵不动，三角向下 = 降息。长区间隐藏按兵不动标记以免过密。
      </p>}

      {!part && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.laborCards.map((card) => (
          <StatCard key={card.label} value={card.value} label={card.label} tone={card.tone} />
        ))}
      </div>}

      {show("unrate") && <Card>
        <CardHeader>
          <CardTitle className="text-base">美国失业率 U-3 — 叠加 FOMC</CardTitle>
          <CardDescription>
            {view.unrateDesc}
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
            {view.unrateFoot}。横轴用对应 CPI 公布日，便于与 FOMC 标记对齐。
          </p>
        </CardContent>
      </Card>}

      {show("u6") && <Card>
        <CardHeader>
          <CardTitle className="text-base">U-3 vs U-6 — 广义失业有没有一起下来</CardTitle>
          <CardDescription>
            {view.u6Desc}
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
      </Card>}

      {(show("sahm") || show("participation")) && <div className={part ? "contents" : "grid gap-6 md:grid-cols-2"}>
        {show("sahm") && <Card>
          <CardHeader>
            <CardTitle className="text-base">Sahm 规则 — 是否逼近衰退阈值</CardTitle>
            <CardDescription>
              {view.sahmDesc}
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
        </Card>}
        {show("participation") && <Card>
          <CardHeader>
            <CardTitle className="text-base">劳动参与率 — 就业改善是否靠人退出</CardTitle>
            <CardDescription>
              {view.partDesc}
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
        </Card>}
      </div>}

      {!part && <SectionTitle id="cpi-yoy-section">通胀同比与 FOMC 标记</SectionTitle>}
      {!part && <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGE_LABEL) as ChartRange[]).map((id) => (
          <Pill key={id} active={chartRange === id} onClick={() => setChartRange(id)}>
            {RANGE_LABEL[id]}
          </Pill>
        ))}
      </div>}
      {!part && <p className="text-xs text-muted-foreground -mt-3">
        实线 = CPI 实际；虚线 = 一致预期。三角向上 = 加息，方块 = 按兵不动，三角向下 = 降息。长区间隐藏按兵不动标记以免过密。
      </p>}

      {show("cpi-yoy") && <Card>
        <CardHeader>
          <CardTitle className="text-base">美国 CPI 同比 — 实际 vs 预测，叠加 FOMC</CardTitle>
          <CardDescription>{view.cpiYoyDesc}</CardDescription>
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
            {view.cpiYoyFoot}
          </p>
        </CardContent>
      </Card>}

      {show("core-cpi") && <Card>
        <CardHeader>
          <CardTitle className="text-base">美国核心 CPI 同比 — 剔除食品能源，叠加 FOMC</CardTitle>
          <CardDescription>
            {view.coreCpiDesc}
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
          <p className="mt-2 text-xs text-muted-foreground">来源：东方财富核心 CPI 同比 · 2025-10 官方空缺仍保留</p>
        </CardContent>
      </Card>}

      {show("core-pce") && <Card>
        <CardHeader>
          <CardTitle className="text-base">美国核心 PCE 同比 — 美联储目标指标，叠加 FOMC</CardTitle>
          <CardDescription>
            {view.corePceDesc}
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
      </Card>}

      {show("cpi-mom") && <Card>
        <CardHeader>
          <CardTitle className="text-base">美国 CPI 环比 — 季调月率，叠加 FOMC</CardTitle>
          <CardDescription>
            {view.cpiMomDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FomcCpiMomChart monthly={monthly} meetings={chartMeetings} />
          <p className="mt-2 text-xs text-muted-foreground">来源：东方财富 CPI / 核心 CPI 季调环比 · 2025-10 官方空缺仍保留</p>
        </CardContent>
      </Card>}

      {!part && <Card>
        <CardHeader>
          <CardTitle className="text-base">{view.cpiTableTitle}</CardTitle>
          <CardDescription>{view.cpiTableDesc}</CardDescription>
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
              {cpiYearRows.map((d) => {
                const s = d.forecast == null ? 0 : Number((d.actual - d.forecast).toFixed(1))
                const tone = d.ym === view.latestCpiYm ? "pending" : d.forecast == null ? "inline" : s > 0 ? "hot" : s < 0 ? "cold" : "inline"
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
      </Card>}

      {!part && <SectionTitle id="fomc-meetings-section">每次会议手里的 CPI</SectionTitle>}
      {!part && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={view.headlineCore} label={view.headlineCoreLabel} />
        <StatCard value={view.fundsNow} label="当前联邦基金区间" />
        <StatCard
          value={`${avgSurprise >= 0 ? "+" : ""}${avgSurprise.toFixed(2)} pp`}
          label={`平均意外 · ${ERA_LABEL[era]}`}
          tone={avgSurprise > 0.05 ? "hot" : avgSurprise < -0.05 ? "cold" : "inline"}
        />
        <StatCard value={`${hot} / ${inline} / ${cold}`} label="偏热 / 符合 / 偏冷" />
      </div>}

      {!part && <div className="flex flex-wrap gap-2">
        {(Object.keys(ERA_LABEL) as Era[]).map((id) => (
          <Pill key={id} active={era === id} onClick={() => setEra(id)}>
            {ERA_LABEL[id]}
          </Pill>
        ))}
      </div>}

      {show("meeting-cpi") && <Card>
        <CardHeader>
          <CardTitle className="text-base">每次 FOMC 手里的 CPI 同比</CardTitle>
          <CardDescription>实际 vs 经济学家一致预期。Fed 2% 目标已标出。</CardDescription>
        </CardHeader>
        <CardContent>
          <ReactECharts option={meetingCpiOption} style={{ height: 260 }} notMerge />
        </CardContent>
      </Card>}

      {(show("surprise") || show("funds")) && <div className={part ? "contents" : "grid gap-6 md:grid-cols-2"}>
        {show("surprise") && <Card>
          <CardHeader>
            <CardTitle className="text-base">会议时的 CPI 意外</CardTitle>
            <CardDescription>百分点。正值 = 高于预期（偏鹰），负值 = 低于预期。</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={surpriseOption} style={{ height: 240 }} notMerge />
          </CardContent>
        </Card>}
        {show("funds") && <Card>
          <CardHeader>
            <CardTitle className="text-base">决议后政策利率</CardTitle>
            <CardDescription>{view.fundsDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={fundsOption} style={{ height: 240 }} notMerge />
          </CardContent>
        </Card>}
      </div>}

      {!part && <Card>
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
                const tone = m.action === "Pending" ? "pending" : s == null ? "inline" : s > 0 ? "hot" : s < 0 ? "cold" : "inline"
                return (
                  <tr key={m.decision} className={cn("border-b last:border-0", toneClass(tone))}>
                    <td className="py-1.5 px-2 whitespace-nowrap first:pl-0">{m.decision.slice(0, 10)}</td>
                    <td className="py-1.5 px-2">{ACTION_LABEL[m.action]}</td>
                    <td className="py-1.5 px-2 text-right">{fmtBps(m.bps)}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{fmtFunds(m.fundsHi)}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{m.cpiMonth}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{m.cpiRelease}</td>
                    <td className="py-1.5 px-2 text-right">{fmtPct(m.actual)}</td>
                    <td className="py-1.5 px-2 text-right">{m.forecast == null ? "—" : fmtPct(m.forecast)}</td>
                    <td className="py-1.5 px-2 text-right">{s == null ? "—" : `${s > 0 ? "+" : ""}${s.toFixed(1)}`}</td>
                    <td className="py-1.5 px-2">{m.action === "Pending" ? "待决议" : s == null ? "—" : surpriseLabel(s)}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{m.note ?? ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>}

      {show("cross") && <Card>
        <CardHeader>
          <CardTitle className="text-base">CPI 意外能否预测决议？</CardTitle>
          <CardDescription>
            {view.crossDesc} 美联储不会因为 CPI 偏热就机械加息，也不会因为偏冷就机械降息。
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
      </Card>}

      {!part && <p className="text-xs text-muted-foreground">
        实际值来自东方财富美国宏观序列（BLS / 美联储目标利率）。一致预期来自华尔街见闻日历。配对规则：声明日当日或之前的最后一次 CPI。FedWatch 在 CME 期货行情可达时按日追加。
      </p>}
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
