"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"
import { buildAshareCrowdingSentimentOption } from "@/components/charts/ashare-crowding-sentiment-chart"
import { cn } from "@/lib/utils"

type ChartView = "sentiment" | "crowding"

type SeriesPoint = {
  date: string
  crowding_pct: number | null
  hhi: number | null
  top3_share: number | null
  top10_share: number | null
  top5pct_share: number | null
  top_board: string | null
  top_board_share: number | null
}

type BoardItem = { name: string; share: number }
type TopStock = { ts_code: string; name: string | null; amount: number | null; share: number | null }
type HotSectorType = "industry" | "concept"
type HotSectorItem = {
  name: string
  change_pct: number | null
  amount: number | null
  lead_stock: string | null
  lead_change_pct: number | null
  rank: number | null
}
type HotSectorsPayload = {
  trade_date: string | null
  fetched_at: string | null
  industry: HotSectorItem[]
  concept: HotSectorItem[]
}
type HotHistoryBoard = {
  name: string
  hot_days: number
  hot_share: number
  max_streak: number
  current_streak: number
  avg_rank: number | null
  best_rank: number | null
  avg_change_pct: number | null
  ranks: Array<number | null>
  hot_flags: number[]
}
type HotHistoryPayload = {
  board_type: HotSectorType
  days: number
  top_n: number
  start_date: string | null
  end_date: string | null
  session_count: number
  dates: string[]
  boards: HotHistoryBoard[]
  coverage_note: string | null
}
type HotHistoryMetric = "hot_days" | "max_streak" | "current_streak"
type SectorCrowdingBoard = { type: HotSectorType; name: string; group: string }
type SectorCrowdingPoint = {
  date: string
  amount_share: number | null
  crowding_pct: number | null
  amount: number | null
  total_amount: number | null
  change_pct: number | null
  rank: number | null
  is_hot: boolean
}
type SectorCrowdingPayload = {
  board: SectorCrowdingBoard
  days: number
  hot_top_n: number
  start_date: string | null
  end_date: string | null
  latest: {
    trade_date: string | null
    amount_share: number | null
    crowding_pct: number | null
    amount: number | null
    total_amount: number | null
    change_pct: number | null
    is_hot: boolean
  }
  series: SectorCrowdingPoint[]
  boards: SectorCrowdingBoard[]
  note: string | null
}
type SectorFundFlowBoard = {
  name: string
  latest_net: number | null
  cum_net: number | null
  latest_share_pct: number | null
  latest_roll5: number | null
  latest_roll20: number | null
  hot_days_inflow: number
  series: Array<number | null>
  daily_net: Array<number | null>
  share_pct: Array<number | null>
  roll5: Array<number | null>
  roll20: Array<number | null>
}
type SectorFundFlowPayload = {
  board_type: HotSectorType
  days: number
  unit: "yi"
  start_date: string | null
  end_date: string | null
  dates: string[]
  boards: SectorFundFlowBoard[]
  latest_bars: Array<{ name: string; net_flow: number; change_pct: number | null }>
  crowding: Array<number | null>
  focus: string | null
  note: string | null
  preset: string
}
type SectorOverviewItem = {
  name: string
  change_pct: number | null
  period_return: number | null
  net_flow: number | null
  period_net: number | null
  amount: number | null
  rank: number | null
  period_rank: number | null
}
type SectorOverviewPayload = {
  board_type: HotSectorType
  days: number
  sort: string
  trade_date: string | null
  start_date: string | null
  session_count: number
  available_dates: string[]
  prev_date: string | null
  next_date: string | null
  breadth: { up: number; down: number; flat: number; total: number }
  period_breadth: { up: number; down: number; flat: number; total: number }
  boards: SectorOverviewItem[]
  note: string | null
}
type OverviewSort = "change" | "period_return" | "net_flow" | "period_net"

type CrowdingPayload = {
  series: SeriesPoint[]
  index_series?: Array<{ date: string; all_a_index: number | null }>
  latest: {
    trade_date: string
    crowding_pct: number | null
    hhi: number | null
    top3_share: number | null
    top10_share: number | null
    top5pct_share: number | null
    top_board: string | null
    top_board_share: number | null
    total_amount: number | null
    boards: BoardItem[]
    top_stocks: TopStock[]
  }
}

function crowdingLabel(pct: number | null | undefined) {
  if (pct == null) return "—"
  if (pct >= 70) return "高拥挤"
  if (pct >= 40) return "中性"
  return "低拥挤"
}

function formatAmountYi(v: number | null | undefined) {
  if (v == null) return "—"
  return `${(v / 1e8).toFixed(0)}亿`
}

function formatTradeDate(d: string | null | undefined) {
  if (!d) return null
  return d.slice(0, 10)
}

function sma(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null
    const slice = values.slice(i - window + 1, i + 1).filter((v): v is number => v != null)
    if (slice.length < window) return null
    return slice.reduce((s, x) => s + x, 0) / window
  })
}

function expandingMean(values: (number | null)[]): (number | null)[] {
  const mean: (number | null)[] = []
  const buf: number[] = []
  for (const v of values) {
    if (v == null) {
      mean.push(null)
      continue
    }
    buf.push(v)
    mean.push(buf.reduce((s, x) => s + x, 0) / buf.length)
  }
  return mean
}

export default function AshareCrowdingChart() {
  const [payload, setPayload] = useState<CrowdingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showTop5Help, setShowTop5Help] = useState(false)
  const [chartView, setChartView] = useState<ChartView>("sentiment")
  const [hotSectors, setHotSectors] = useState<HotSectorsPayload | null>(null)
  const [hotLoading, setHotLoading] = useState(true)
  const [hotError, setHotError] = useState<string | null>(null)
  const [hotSectorType, setHotSectorType] = useState<HotSectorType>("industry")
  const [hotHistory, setHotHistory] = useState<HotHistoryPayload | null>(null)
  const [hotHistLoading, setHotHistLoading] = useState(true)
  const [hotHistError, setHotHistError] = useState<string | null>(null)
  const [hotHistDays, setHotHistDays] = useState<10 | 20 | 60>(20)
  const [hotHistTopN, setHotHistTopN] = useState<5 | 10 | 15>(10)
  const [hotHistMetric, setHotHistMetric] = useState<HotHistoryMetric>("hot_days")
  const [sectorCrowding, setSectorCrowding] = useState<SectorCrowdingPayload | null>(null)
  const [sectorLoading, setSectorLoading] = useState(true)
  const [sectorError, setSectorError] = useState<string | null>(null)
  const [sectorBoardKey, setSectorBoardKey] = useState("concept:人工智能")
  const [sectorDays, setSectorDays] = useState<120 | 250 | 365>(365)
  const [fundFlow, setFundFlow] = useState<SectorFundFlowPayload | null>(null)
  const [fundFlowLoading, setFundFlowLoading] = useState(true)
  const [fundFlowError, setFundFlowError] = useState<string | null>(null)
  const [fundFlowType, setFundFlowType] = useState<HotSectorType>("industry")
  const [fundFlowDays, setFundFlowDays] = useState<60 | 120 | 250>(120)
  const [fundFlowPreset, setFundFlowPreset] = useState<"top" | "ai">("ai")
  const [fundFlowFocus, setFundFlowFocus] = useState<string>("")
  const [sectorOverview, setSectorOverview] = useState<SectorOverviewPayload | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [overviewType, setOverviewType] = useState<HotSectorType>("industry")
  const [overviewDays, setOverviewDays] = useState<1 | 5 | 20>(1)
  const [overviewSort, setOverviewSort] = useState<OverviewSort>("change")
  const [overviewDate, setOverviewDate] = useState<string>("")

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/stock/crowding?days=365&ts=${Date.now()}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok || !json.series) throw new Error(json.error || "failed")
      setPayload(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  const loadHotSectors = useCallback(async (showLoading: boolean) => {
    if (showLoading) setHotLoading(true)
    setHotError(null)
    try {
      const res = await fetch(`/ma/api/stock/hot-sectors?top=15&ts=${Date.now()}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok || (!json.industry?.length && !json.concept?.length)) {
        throw new Error(json.error || "failed")
      }
      setHotSectors(json)
    } catch (e: unknown) {
      setHotError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setHotLoading(false)
    }
  }, [])

  const loadHotHistory = useCallback(async (showLoading: boolean) => {
    if (showLoading) setHotHistLoading(true)
    setHotHistError(null)
    try {
      const qs = new URLSearchParams({
        type: hotSectorType,
        days: String(hotHistDays),
        top_n: String(hotHistTopN),
        limit: "15",
        ts: String(Date.now()),
      })
      const res = await fetch(`/ma/api/stock/hot-sectors/history?${qs}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || !json.boards?.length) {
        throw new Error(json.error || json.coverage_note || "failed")
      }
      setHotHistory(json)
    } catch (e: unknown) {
      setHotHistory(null)
      setHotHistError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setHotHistLoading(false)
    }
  }, [hotSectorType, hotHistDays, hotHistTopN])

  const loadSectorCrowding = useCallback(async (showLoading: boolean) => {
    if (showLoading) setSectorLoading(true)
    setSectorError(null)
    try {
      const [type, ...rest] = sectorBoardKey.split(":")
      const board = rest.join(":")
      const qs = new URLSearchParams({
        type: type || "concept",
        board: board || "人工智能",
        days: String(sectorDays),
        top_n: "10",
        ts: String(Date.now()),
      })
      const res = await fetch(`/ma/api/stock/sector-crowding?${qs}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || !json.series?.length) {
        throw new Error(json.error || json.note || "failed")
      }
      setSectorCrowding(json)
      if (Array.isArray(json.boards) && json.boards.length && !json.boards.some(
        (b: SectorCrowdingBoard) => `${b.type}:${b.name}` === sectorBoardKey,
      )) {
        // keep selection
      }
    } catch (e: unknown) {
      setSectorCrowding(null)
      setSectorError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setSectorLoading(false)
    }
  }, [sectorBoardKey, sectorDays])

  const loadFundFlow = useCallback(async (showLoading: boolean) => {
    if (showLoading) setFundFlowLoading(true)
    setFundFlowError(null)
    try {
      const qs = new URLSearchParams({
        type: fundFlowType,
        days: String(fundFlowDays),
        limit: "8",
        preset: fundFlowPreset,
        ts: String(Date.now()),
      })
      const res = await fetch(`/ma/api/stock/sector-fund-flow?${qs}`, { cache: "no-store" })
      const json = await res.json() as SectorFundFlowPayload & { error?: string }
      if (!res.ok || !json.boards?.length) {
        throw new Error(json.error || json.note || "failed")
      }
      setFundFlow(json)
      const names = json.boards.map((b) => b.name)
      setFundFlowFocus((prev) =>
        prev && names.includes(prev) ? prev : (json.focus || names[0] || ""),
      )
    } catch (e: unknown) {
      setFundFlow(null)
      setFundFlowError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setFundFlowLoading(false)
    }
  }, [fundFlowType, fundFlowDays, fundFlowPreset])

  const loadSectorOverview = useCallback(async (showLoading: boolean) => {
    if (showLoading) setOverviewLoading(true)
    setOverviewError(null)
    try {
      const qs = new URLSearchParams({
        type: overviewType,
        days: String(overviewDays),
        sort: overviewSort,
        ts: String(Date.now()),
      })
      if (overviewDate) qs.set("date", overviewDate)
      const res = await fetch(`/ma/api/stock/sector-overview?${qs}`, { cache: "no-store" })
      const json = await res.json() as SectorOverviewPayload & { error?: string }
      if (!res.ok || !json.boards?.length) {
        throw new Error(json.error || json.note || "failed")
      }
      setSectorOverview(json)
      setOverviewDate((prev) => {
        if (!json.trade_date) return prev
        if (!prev || prev !== json.trade_date) return json.trade_date
        return prev
      })
    } catch (e: unknown) {
      setSectorOverview(null)
      setOverviewError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setOverviewLoading(false)
    }
  }, [overviewType, overviewDays, overviewSort, overviewDate])

  useChartAutoRefresh(load, [])
  useChartAutoRefresh(loadHotSectors, [], 5 * 60_000)
  useChartAutoRefresh(loadHotHistory, [hotSectorType, hotHistDays, hotHistTopN], 10 * 60_000)
  useChartAutoRefresh(loadSectorCrowding, [sectorBoardKey, sectorDays], 10 * 60_000)
  useChartAutoRefresh(loadFundFlow, [fundFlowType, fundFlowDays, fundFlowPreset], 10 * 60_000)
  useChartAutoRefresh(loadSectorOverview, [overviewType, overviewDays, overviewSort, overviewDate], 10 * 60_000)

  const latest = payload?.latest
  const series = payload?.series ?? []
  const indexSeries = payload?.index_series ?? []

  const lineOption = useMemo(() => {
    if (!series.length) return {}
    const dates = series.map((d) => d.date)
    const crowding = series.map((d) => d.crowding_pct)
    const top3 = series.map((d) => d.top3_share)

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number }>) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map(
            (p) => `${p.seriesName}: ${p.value != null ? p.value.toFixed(2) : "—"}${p.seriesName.includes("占比") ? "%" : ""}`,
          )
          return [date, ...lines].join("<br/>")
        },
      },
      legend: { data: ["拥挤度指数", "Top3成交额占比"], bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 48, right: 48, top: 24, bottom: 48 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: [
        {
          type: "value",
          name: "拥挤度 (%)",
          min: 0,
          max: 100,
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { opacity: 0.2 } },
        },
        {
          type: "value",
          name: "Top3占比 (%)",
          min: 0,
          axisLabel: { fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "拥挤度指数",
          type: "line",
          data: crowding,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed", opacity: 0.5 },
            data: [{ yAxis: 70, label: { formatter: "高拥挤 70" } }, { yAxis: 40, label: { formatter: "低拥挤 40" } }],
          },
        },
        {
          name: "Top3成交额占比",
          type: "line",
          yAxisIndex: 1,
          data: top3,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5, type: "dashed" },
        },
      ],
    }
  }, [series])

  const sentimentOption = useMemo(
    () => buildAshareCrowdingSentimentOption(series, indexSeries, latest?.trade_date),
    [series, indexSeries, latest?.trade_date],
  )

  const mainChartOption = chartView === "sentiment" ? sentimentOption : lineOption
  const mainChartHeight = chartView === "sentiment" ? 420 : 360

  const boardOption = useMemo(() => {
    const boards = latest?.boards ?? []
    if (!boards.length) return {}
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: Array<{ name: string; value: number }>) =>
          `${p[0]?.name}<br/>成交额占比: ${p[0]?.value?.toFixed(2)}%`,
      },
      grid: { left: 80, right: 52, top: 8, bottom: 28 },
      xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%", fontSize: 10 } },
      yAxis: {
        type: "category",
        data: boards.map((b) => b.name),
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: boards.map((b) => b.share),
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: "right",
          formatter: (p: { value?: number }) =>
            p.value != null ? `${Number(p.value).toFixed(1)}%` : "",
          fontSize: 10,
        },
      }],
    }
  }, [latest])

  const stockOption = useMemo(() => {
    const stocks = latest?.top_stocks ?? []
    if (!stocks.length) return {}
    const labels = stocks.map((s) => s.name || s.ts_code)
    const shares = stocks.map((s) => s.share ?? 0)
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: Array<{ name: string; value: number; dataIndex?: number }>) => {
          const idx = p[0]?.dataIndex ?? 0
          const stock = stocks[idx]
          const label = stock?.name || stock?.ts_code || p[0]?.name || ""
          const code = stock?.ts_code ? `<br/>${stock.ts_code}` : ""
          return `${label}${code}<br/>成交额占比: ${p[0]?.value?.toFixed(2)}%`
        },
      },
      grid: { left: 112, right: 40, top: 8, bottom: 8 },
      xAxis: { type: "value", axisLabel: { formatter: "{value}%", fontSize: 10 } },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: shares,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      }],
    }
  }, [latest])

  const hotSectorItems = useMemo(() => {
    if (!hotSectors) return []
    return hotSectorType === "industry" ? hotSectors.industry : hotSectors.concept
  }, [hotSectors, hotSectorType])

  const hotSectorOption = useMemo(() => {
    const items = hotSectorItems
    if (!items.length) return {}
    const labels = items.map((s) => s.name)
    const values = items.map((s) => s.change_pct ?? 0)
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: Array<{ name: string; value: number; dataIndex?: number }>) => {
          const idx = p[0]?.dataIndex ?? 0
          const item = items[idx]
          const lead = item?.lead_stock
            ? `<br/>领涨: ${item.lead_stock}${
                item.lead_change_pct != null ? ` ${item.lead_change_pct >= 0 ? "+" : ""}${item.lead_change_pct.toFixed(2)}%` : ""
              }`
            : ""
          const amt =
            item?.amount != null
              ? `<br/>成交额: ${formatAmountYi(item.amount)}`
              : ""
          const chg = p[0]?.value
          return `${item?.name || p[0]?.name || ""}<br/>涨跌幅: ${
            chg != null ? `${chg >= 0 ? "+" : ""}${Number(chg).toFixed(2)}%` : "—"
          }${lead}${amt}`
        },
      },
      grid: { left: 104, right: 48, top: 8, bottom: 8 },
      xAxis: {
        type: "value",
        axisLabel: {
          fontSize: 10,
          formatter: (v: number) => `${v > 0 ? "+" : ""}${v}%`,
        },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: values.map((v) => ({
          value: v,
          itemStyle: {
            color: v >= 0 ? "rgba(220, 38, 38, 0.75)" : "rgba(22, 163, 74, 0.75)",
            borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
          label: {
            show: true,
            position: v >= 0 ? "right" : "left",
            formatter: `${v >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`,
            fontSize: 10,
          },
        })),
      }],
    }
  }, [hotSectorItems])

  const hotHistoryMetricLabel =
    hotHistMetric === "hot_days" ? "上榜天数" : hotHistMetric === "max_streak" ? "最长连热" : "当前连热"

  const hotHistoryBarOption = useMemo(() => {
    const boards = hotHistory?.boards ?? []
    if (!boards.length) return {}
    const labels = boards.map((b) => b.name)
    const values = boards.map((b) =>
      hotHistMetric === "hot_days"
        ? b.hot_days
        : hotHistMetric === "max_streak"
          ? b.max_streak
          : b.current_streak,
    )
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: Array<{ name: string; value: number; dataIndex?: number }>) => {
          const idx = p[0]?.dataIndex ?? 0
          const b = boards[idx]
          if (!b) return ""
          return [
            b.name,
            `上榜天数: ${b.hot_days} / ${hotHistory?.session_count ?? "—"} (${(b.hot_share * 100).toFixed(0)}%)`,
            `最长连热: ${b.max_streak} 日`,
            `当前连热: ${b.current_streak} 日`,
            `最佳排名: ${b.best_rank ?? "—"}`,
            `平均排名: ${b.avg_rank != null ? b.avg_rank.toFixed(1) : "—"}`,
            `上榜日均涨跌: ${
              b.avg_change_pct != null
                ? `${b.avg_change_pct >= 0 ? "+" : ""}${b.avg_change_pct.toFixed(2)}%`
                : "—"
            }`,
          ].join("<br/>")
        },
      },
      grid: { left: 104, right: 40, top: 8, bottom: 8 },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: values,
        itemStyle: {
          color: "rgba(37, 99, 235, 0.75)",
          borderRadius: [0, 4, 4, 0],
        },
        label: {
          show: true,
          position: "right",
          formatter: (p: { value?: number }) => (p.value != null ? String(p.value) : ""),
          fontSize: 10,
        },
      }],
    }
  }, [hotHistory, hotHistMetric])

  const sectorCrowdingOption = useMemo(() => {
    const series = sectorCrowding?.series ?? []
    if (!series.length) return {}
    const dates = series.map((d) => d.date)
    const share = series.map((d) => d.amount_share)
    const crowding = series.map((d) => d.crowding_pct)
    const boardName = sectorCrowding?.board.name ?? "板块"
    const hotMarks = series
      .map((d, i) =>
        d.is_hot && d.amount_share != null
          ? { coord: [dates[i], d.amount_share], value: d.rank ?? d.change_pct ?? 0 }
          : null,
      )
      .filter(Boolean)

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number | null; dataIndex?: number }>) => {
          const date = params[0]?.axisValue ?? ""
          const idx = params[0]?.dataIndex ?? 0
          const pt = series[idx]
          const lines = params.map((p) => {
            if (p.value == null) return `${p.seriesName}: —`
            if (p.seriesName.includes("拥挤")) return `${p.seriesName}: ${Number(p.value).toFixed(1)}`
            return `${p.seriesName}: ${Number(p.value).toFixed(2)}%`
          })
          if (pt?.is_hot) {
            lines.push(
              pt.rank != null
                ? `热点日：排名 #${pt.rank}`
                : `热点日：涨跌 ${pt.change_pct != null ? `${pt.change_pct >= 0 ? "+" : ""}${pt.change_pct.toFixed(2)}%` : "—"}`,
            )
          }
          if (pt?.amount != null) lines.push(`板块成交额: ${formatAmountYi(pt.amount)}`)
          if (pt?.total_amount != null) lines.push(`全A成交额: ${formatAmountYi(pt.total_amount)}`)
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        data: [`${boardName}成交额占比`, "全A拥挤度", "热点日"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 52, right: 52, top: 28, bottom: 48 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: [
        {
          type: "value",
          name: "成交额占比 (%)",
          axisLabel: { fontSize: 10, formatter: "{value}%" },
          splitLine: { lineStyle: { opacity: 0.2 } },
        },
        {
          type: "value",
          name: "拥挤度",
          min: 0,
          max: 100,
          axisLabel: { fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: `${boardName}成交额占比`,
          type: "line",
          data: share,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: "#dc2626" },
          itemStyle: { color: "#dc2626" },
          markPoint: hotMarks.length
            ? {
                symbol: "circle",
                symbolSize: 8,
                itemStyle: { color: "rgba(244,114,182,0.9)", borderColor: "#be185d", borderWidth: 1 },
                data: hotMarks as Array<{ coord: [string, number]; value: number }>,
                label: { show: false },
              }
            : undefined,
        },
        {
          name: "全A拥挤度",
          type: "line",
          yAxisIndex: 1,
          data: crowding,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed", opacity: 0.45 },
            data: [
              { yAxis: 70, label: { formatter: "高拥挤 70", fontSize: 10 } },
              { yAxis: 40, label: { formatter: "低拥挤 40", fontSize: 10 } },
            ],
          },
        },
        {
          // Legend-only proxy for hot-day markers
          name: "热点日",
          type: "scatter",
          data: [],
          symbolSize: 8,
          itemStyle: { color: "rgba(244,114,182,0.9)" },
        },
      ],
    }
  }, [sectorCrowding])

  const fundFlowCumOption = useMemo(() => {
    const boards = fundFlow?.boards ?? []
    const dates = fundFlow?.dates ?? []
    if (!boards.length || !dates.length) return {}
    const colors = [
      "#dc2626", "#2563eb", "#d97706", "#059669", "#7c3aed",
      "#db2777", "#0891b2", "#65a30d",
    ]
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number | null; color?: string }>) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map((p) => {
            const v = p.value
            return `<span style="color:${p.color}">●</span> ${p.seriesName}: ${
              v != null ? `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}亿` : "—"
            }`
          })
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        data: boards.map((b) => b.name),
        bottom: 0,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 56, right: 24, top: 24, bottom: 56 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: {
        type: "value",
        name: "累计净流入(亿)",
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: boards.map((b, i) => ({
        name: b.name,
        type: "line",
        data: b.series,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: colors[i % colors.length] },
        itemStyle: { color: colors[i % colors.length] },
      })),
    }
  }, [fundFlow])

  const fundFlowBarOption = useMemo(() => {
    const bars = fundFlow?.latest_bars ?? []
    if (!bars.length) return {}
    const labels = bars.map((b) => b.name)
    const values = bars.map((b) => b.net_flow)
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: Array<{ name: string; value: number; dataIndex?: number }>) => {
          const idx = p[0]?.dataIndex ?? 0
          const item = bars[idx]
          const chg =
            item?.change_pct != null
              ? `<br/>涨跌幅: ${item.change_pct >= 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`
              : ""
          return `${item?.name || p[0]?.name}<br/>当日净流入: ${
            p[0]?.value != null ? `${p[0].value >= 0 ? "+" : ""}${Number(p[0].value).toFixed(2)}亿` : "—"
          }${chg}`
        },
      },
      grid: { left: 104, right: 48, top: 8, bottom: 8 },
      xAxis: {
        type: "value",
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v}亿` },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: "bar",
        data: values.map((v) => ({
          value: v,
          itemStyle: {
            color: v >= 0 ? "rgba(220, 38, 38, 0.75)" : "rgba(22, 163, 74, 0.75)",
            borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
          label: {
            show: true,
            position: v >= 0 ? "right" : "left",
            formatter: `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}`,
            fontSize: 10,
          },
        })),
      }],
    }
  }, [fundFlow])

  const fundFlowColors = [
    "#dc2626", "#2563eb", "#d97706", "#059669", "#7c3aed",
    "#db2777", "#0891b2", "#65a30d",
  ]

  const fundFlowShareOption = useMemo(() => {
    const boards = fundFlow?.boards ?? []
    const dates = fundFlow?.dates ?? []
    if (!boards.length || !dates.length) return {}
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number | null; color?: string }>) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map((p) =>
            `<span style="color:${p.color}">●</span> ${p.seriesName}: ${
              p.value != null ? `${Number(p.value).toFixed(2)}%` : "—"
            }`,
          )
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        data: boards.map((b) => b.name),
        bottom: 0,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 52, right: 24, top: 24, bottom: 56 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: {
        type: "value",
        name: "净流入占比 (%)",
        axisLabel: { fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: boards.map((b, i) => ({
        name: b.name,
        type: "line",
        data: b.share_pct ?? [],
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1.8, color: fundFlowColors[i % fundFlowColors.length] },
        itemStyle: { color: fundFlowColors[i % fundFlowColors.length] },
      })),
    }
  }, [fundFlow])

  const fundFlowFocusBoard = useMemo(() => {
    const boards = fundFlow?.boards ?? []
    if (!boards.length) return null
    return boards.find((b) => b.name === fundFlowFocus) || boards[0]
  }, [fundFlow, fundFlowFocus])

  const fundFlowRollOption = useMemo(() => {
    const board = fundFlowFocusBoard
    const dates = fundFlow?.dates ?? []
    if (!board || !dates.length) return {}
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number | null }>) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map((p) =>
            `${p.seriesName}: ${
              p.value != null ? `${p.value >= 0 ? "+" : ""}${Number(p.value).toFixed(1)}亿` : "—"
            }`,
          )
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        data: ["当日净流入", "5日滚动", "20日滚动"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 56, right: 24, top: 24, bottom: 48 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: {
        type: "value",
        name: "净流入(亿)",
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: [
        {
          name: "当日净流入",
          type: "bar",
          data: (board.daily_net ?? []).map((v) => ({
            value: v,
            itemStyle: {
              color: v != null && v >= 0 ? "rgba(220,38,38,0.35)" : "rgba(22,163,74,0.35)",
            },
          })),
          barMaxWidth: 6,
        },
        {
          name: "5日滚动",
          type: "line",
          data: board.roll5 ?? [],
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: "#dc2626" },
          itemStyle: { color: "#dc2626" },
        },
        {
          name: "20日滚动",
          type: "line",
          data: board.roll20 ?? [],
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
        },
      ],
    }
  }, [fundFlow, fundFlowFocusBoard])

  const fundFlowCrowdingOption = useMemo(() => {
    const board = fundFlowFocusBoard
    const dates = fundFlow?.dates ?? []
    const crowding = fundFlow?.crowding ?? []
    if (!board || !dates.length) return {}
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number | null }>) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map((p) => {
            if (p.value == null) return `${p.seriesName}: —`
            if (p.seriesName.includes("拥挤")) return `${p.seriesName}: ${Number(p.value).toFixed(1)}`
            return `${p.seriesName}: ${Number(p.value) >= 0 ? "+" : ""}${Number(p.value).toFixed(1)}亿`
          })
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        data: [`${board.name}存量资金`, "全A拥挤度"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 56, right: 52, top: 28, bottom: 48 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: [
        {
          type: "value",
          name: "累计净流入(亿)",
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { opacity: 0.2 } },
        },
        {
          type: "value",
          name: "拥挤度",
          min: 0,
          max: 100,
          axisLabel: { fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: `${board.name}存量资金`,
          type: "line",
          data: board.series,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2.2, color: "#dc2626" },
          itemStyle: { color: "#dc2626" },
          areaStyle: { color: "rgba(220,38,38,0.08)" },
        },
        {
          name: "全A拥挤度",
          type: "line",
          yAxisIndex: 1,
          data: crowding,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.8, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed", opacity: 0.45 },
            data: [
              { yAxis: 70, label: { formatter: "高拥挤 70", fontSize: 10 } },
              { yAxis: 40, label: { formatter: "低拥挤 40", fontSize: 10 } },
            ],
          },
        },
      ],
    }
  }, [fundFlow, fundFlowFocusBoard])

  const overviewMetric = useCallback(
    (b: SectorOverviewItem): number | null => {
      if (overviewSort === "period_return") return b.period_return
      if (overviewSort === "net_flow") return b.net_flow
      if (overviewSort === "period_net") return b.period_net
      return overviewDays <= 1 ? b.change_pct : b.period_return ?? b.change_pct
    },
    [overviewSort, overviewDays],
  )

  const overviewMetricLabel =
    overviewSort === "net_flow"
      ? "当日净流入"
      : overviewSort === "period_net"
        ? `${overviewDays}日累计净流入`
        : overviewDays <= 1
          ? "当日涨跌幅"
          : `${overviewDays}日涨跌幅`

  const overviewBarHeight = Math.min(
    720,
    Math.max(380, (sectorOverview?.boards.length ?? 0) * 12 + 48),
  )

  const overviewBarOption = useMemo(() => {
    const boards = sectorOverview?.boards ?? []
    if (!boards.length) return {}
    // Show full universe, strongest at top.
    const items = [...boards].reverse()
    const labels = items.map((b) => b.name)
    const values = items.map((b) => overviewMetric(b) ?? 0)
    const isPct = overviewSort === "change" || overviewSort === "period_return"
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: Array<{ name: string; value: number; dataIndex?: number }>) => {
          const idx = p[0]?.dataIndex ?? 0
          const b = items[idx]
          if (!b) return ""
          const ret = overviewDays <= 1 ? b.change_pct : b.period_return
          return [
            b.name,
            `涨跌幅: ${ret != null ? `${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%` : "—"}`,
            `净流入: ${b.net_flow != null ? `${b.net_flow >= 0 ? "+" : ""}${b.net_flow.toFixed(1)}亿` : "—"}`,
            overviewDays > 1
              ? `区间净流入: ${b.period_net != null ? `${b.period_net >= 0 ? "+" : ""}${b.period_net.toFixed(1)}亿` : "—"}`
              : "",
          ]
            .filter(Boolean)
            .join("<br/>")
        },
      },
      grid: { left: 110, right: 48, top: 8, bottom: boards.length > 40 ? 28 : 8 },
      dataZoom:
        boards.length > 45
          ? [
              { type: "slider", yAxisIndex: 0, right: 4, width: 14, start: 65, end: 100 },
              { type: "inside", yAxisIndex: 0 },
            ]
          : undefined,
      xAxis: {
        type: "value",
        axisLabel: {
          fontSize: 10,
          formatter: (v: number) => (isPct ? `${v}%` : `${v}亿`),
        },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLabel: { fontSize: 10 },
      },
      series: [{
        type: "bar",
        data: values.map((v) => ({
          value: v,
          itemStyle: {
            color: v >= 0 ? "rgba(220, 38, 38, 0.72)" : "rgba(22, 163, 74, 0.72)",
            borderRadius: v >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
          },
        })),
        barMaxWidth: 12,
      }],
    }
  }, [sectorOverview, overviewMetric, overviewSort, overviewDays])

  const overviewScatterOption = useMemo(() => {
    const boards = sectorOverview?.boards ?? []
    if (!boards.length) return {}
    const data = boards
      .filter((b) => b.change_pct != null || b.period_return != null)
      .map((b) => {
        const x = (overviewDays <= 1 ? b.change_pct : b.period_return) ?? 0
        const y = (overviewDays <= 1 ? b.net_flow : b.period_net) ?? 0
        return {
          value: [x, y, b.name],
          name: b.name,
          itemStyle: {
            color: x >= 0 ? "rgba(220,38,38,0.75)" : "rgba(22,163,74,0.75)",
          },
        }
      })
    return {
      backgroundColor: "transparent",
      tooltip: {
        formatter: (p: { value?: [number, number, string] }) => {
          const [x, y, name] = p.value ?? [0, 0, ""]
          return [
            name,
            `涨跌幅: ${x >= 0 ? "+" : ""}${Number(x).toFixed(2)}%`,
            `净流入: ${y >= 0 ? "+" : ""}${Number(y).toFixed(1)}亿`,
          ].join("<br/>")
        },
      },
      grid: { left: 56, right: 24, top: 28, bottom: 40 },
      xAxis: {
        type: "value",
        name: overviewDays <= 1 ? "涨跌幅 (%)" : `${overviewDays}日涨跌 (%)`,
        axisLabel: { fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "value",
        name: overviewDays <= 1 ? "净流入 (亿)" : `${overviewDays}日净流入 (亿)`,
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: [{
        type: "scatter",
        symbolSize: 9,
        data,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", opacity: 0.35 },
          data: [{ xAxis: 0 }, { yAxis: 0 }],
        },
      }],
    }
  }, [sectorOverview, overviewDays])

  const hotHistoryHeatOption = useMemo(() => {
    const boards = hotHistory?.boards ?? []
    const dates = hotHistory?.dates ?? []
    if (!boards.length || !dates.length) return {}
    const yLabels = boards.map((b) => b.name)
    const data: Array<[number, number, number]> = []
    boards.forEach((b, yi) => {
      b.hot_flags.forEach((flag, xi) => {
        data.push([xi, yi, flag])
      })
    })
    const shortDates = dates.map((d) => d.slice(5))
    return {
      backgroundColor: "transparent",
      tooltip: {
        formatter: (p: { value?: [number, number, number] }) => {
          const [xi, yi] = p.value ?? [-1, -1, 0]
          const name = yLabels[yi] ?? ""
          const date = dates[xi] ?? ""
          const rank = boards[yi]?.ranks[xi]
          return `${name}<br/>${date}<br/>${rank != null ? `排名 #${rank}` : "未上榜"}`
        },
      },
      grid: { left: 104, right: 16, top: 8, bottom: 40 },
      xAxis: {
        type: "category",
        data: shortDates,
        axisLabel: { fontSize: 9, rotate: dates.length > 25 ? 45 : 0 },
      },
      yAxis: {
        type: "category",
        data: yLabels,
        inverse: true,
        axisLabel: { fontSize: 11 },
      },
      visualMap: {
        show: false,
        min: 0,
        max: 1,
        inRange: { color: ["rgba(148,163,184,0.12)", "rgba(220,38,38,0.85)"] },
      },
      series: [{
        type: "heatmap",
        data,
        itemStyle: { borderWidth: 1, borderColor: "rgba(255,255,255,0.6)" },
      }],
    }
  }, [hotHistory])

  const top5pctStats = useMemo(() => {
    const values = series.map((d) => d.top5pct_share)
    const ma20 = sma(values, 20)
    const mean = expandingMean(values)
    const latestVal = values[values.length - 1]
    const latestMa20 = ma20[ma20.length - 1]
    const diffMa20 =
      latestVal != null && latestMa20 != null ? latestVal - latestMa20 : null
    return { values, ma20, mean, latestVal, latestMa20, diffMa20 }
  }, [series])

  const top5pctOption = useMemo(() => {
    if (!series.length) return {}
    const dates = series.map((d) => d.date)
    const { values, ma20, mean } = top5pctStats

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number | null }>) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map(
            (p) =>
              `${p.seriesName}: ${p.value != null ? p.value.toFixed(2) : "—"}%`,
          )
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        data: ["Top 5%成交额占比", "20日均线", "窗口均值"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 48, right: 24, top: 24, bottom: 48 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: {
        type: "value",
        name: "占比 (%)",
        axisLabel: { fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: [
        {
          name: "Top 5%成交额占比",
          type: "line",
          data: values,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
        },
        {
          name: "20日均线",
          type: "line",
          data: ma20,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5, type: "dashed" },
        },
        {
          name: "窗口均值",
          type: "line",
          data: mean,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1, type: "dotted", opacity: 0.6 },
        },
      ],
    }
  }, [series, top5pctStats])

  return (
    <div className="space-y-6">
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-xl p-5 max-w-xl w-full mx-4 text-sm max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base">
                {chartView === "sentiment" ? "全A拥挤度 vs 全A走势：图表说明" : "A股拥挤度指标：计算方法"}
              </h3>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>
            {chartView === "sentiment" ? (
              <div className="space-y-4 text-muted-foreground leading-relaxed">
                <p className="text-xs">
                  下图每条线均基于图表窗口内数据（默认近 365 个交易日）计算；拥挤度本身由夜间 ETL 在全历史上先算好再取子集展示。
                </p>

                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">① 全A拥挤度指标（深蓝实线，左轴）</p>
                  <p>先算当日全 A 成交额加权换手率，再与过去 250 个交易日比较得到分位数，最后做 20 日平滑：</p>
                  <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                    <div>Turn<sub>d</sub> = Σ<sub>i</sub>(Amount<sub>i,d</sub> × Turnover<sub>i,d</sub>) / Σ<sub>i</sub> Amount<sub>i,d</sub></div>
                    <div>Pct<sub>d</sub> = |&#123;k ∈ W<sub>d</sub> : Turn<sub>k</sub> ≤ Turn<sub>d</sub>&#125;| / |W<sub>d</sub>| × 100%</div>
                    <div>W<sub>d</sub> = 最近 min(d, 250) 个交易日</div>
                    <div>C<sub>d</sub> = (1/20) Σ<sub>j=d−19</sub><sup>d</sup> Pct<sub>j</sub></div>
                  </div>
                  <p className="text-xs">图表取 <code className="bg-muted px-1 rounded">crowding_smooth</code>（即 C<sub>d</sub>）。</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">② 均值（灰色虚线，左轴）</p>
                  <p>对图表窗口内的拥挤度序列 C<sub>t</sub> 做<strong className="text-foreground">扩展窗口</strong>均值（从窗口首日至当日累计）：</p>
                  <div className="bg-muted rounded px-3 py-2 font-mono text-xs">
                    μ<sub>t</sub> = (1/t) Σ<sub>k=1</sub><sup>t</sup> C<sub>k</sub>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">③ 均值 ± 1 倍标准差（浅灰虚线，左轴）</p>
                  <p>同一扩展窗口下的样本标准差（总体标准差，除以 t 而非 t−1）：</p>
                  <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                    <div>σ<sub>t</sub> = √[ (1/t) Σ<sub>k=1</sub><sup>t</sup> (C<sub>k</sub> − μ<sub>t</sub>)² ]</div>
                    <div>上沿<sub>t</sub> = μ<sub>t</sub> + σ<sub>t</sub></div>
                    <div>下沿<sub>t</sub> = μ<sub>t</sub> − σ<sub>t</sub></div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">④ 均值 ± 1.5 倍标准差（浅蓝虚线，左轴）</p>
                  <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                    <div>上沿<sub>t</sub> = μ<sub>t</sub> + 1.5 × σ<sub>t</sub></div>
                    <div>下沿<sub>t</sub> = μ<sub>t</sub> − 1.5 × σ<sub>t</sub></div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">⑤ 全A（红色实线，右轴）</p>
                  <p>优先取基准指数（默认沪深300，<code className="bg-muted px-1 rounded">000300.SH</code>）收盘价；若无指数数据，则链式合成全 A 价格指数：</p>
                  <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                    <div>MktPx<sub>d</sub> = Σ<sub>i</sub>(Close<sub>i,d</sub> × Amount<sub>i,d</sub>) / Σ<sub>i</sub> Amount<sub>i,d</sub></div>
                    <div>R<sub>d</sub> = MktPx<sub>d</sub> / MktPx<sub>d−1</sub></div>
                    <div>AllA<sub>d</sub> = 5000 × exp( Σ<sub>k</sub> ln(R<sub>k</sub>) )</div>
                  </div>
                  <p className="text-xs">首有效交易日归一化为 5000，之后按连乘收益累积；右轴自动缩放（scale）。</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">⑥ 情绪底部（粉色圆点，左轴）</p>
                  <p>在图表窗口内，当日同时满足局部低点且跌破 1.5σ 下沿时标记：</p>
                  <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                    <div>C<sub>d</sub> ≤ C<sub>d−1</sub> 且 C<sub>d</sub> ≤ C<sub>d+1</sub></div>
                    <div>C<sub>d</sub> ≤ μ<sub>d</sub> − 1.5 × σ<sub>d</sub></div>
                  </div>
                  <p className="text-xs">
                    若最新交易日满足 C<sub>T</sub> ≤ μ<sub>T</sub> − 1.5σ<sub>T</sub>，图表顶部显示「全A拥挤度指标再度提示短期情绪底部」。
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-muted-foreground leading-relaxed">
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">数据来源</p>
                <p>
                  每日通过 AkShare（默认）或 Choice <code className="text-xs bg-muted px-1 rounded">c.csd()</code> 拉取
                  全部 A 股（约 5,500 只）的开盘价、收盘价、成交量、成交额、换手率，写入
                  <code className="text-xs bg-muted px-1 rounded">raw_ashare_daily</code>。
                  夜间 ETL 默认使用 AkShare；设置 <code className="text-xs bg-muted px-1 rounded">ASHARE_DATA_SOURCE=choice</code> 可切回 Choice。
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第一步：计算个股成交额占比</p>
                <p>对每个交易日，先汇总全市场总成交额，再计算每只股票占比：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>TotalAmount<sub>d</sub> = Σ<sub>i</sub> Amount<sub>i,d</sub></div>
                  <div>Share<sub>i,d</sub> = Amount<sub>i,d</sub> / TotalAmount<sub>d</sub></div>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第二步：全市场成交额加权换手率</p>
                <p>衡量当日全 A 交易活跃程度（与参考研报口径一致）：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs">
                  Turn<sub>d</sub> = Σ(Amount<sub>i,d</sub> × Turnover<sub>i,d</sub>) / Σ Amount<sub>i,d</sub>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第三步：拥挤度指数（250 日分位 + 20 日平滑）</p>
                <p>将当日换手率与过去 250 个交易日比较，得到历史分位数，再取 20 日移动平均用于作图：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs">
                  拥挤度<sub>d</sub> = SMA<sub>20</sub>( Percentile<sub>250</sub>(Turn<sub>d</sub>) )
                </div>
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>≥ 70% → <strong className="text-foreground">高拥挤</strong>（交易情绪过热）</li>
                  <li>40%–70% → <strong className="text-foreground">中性</strong></li>
                  <li>&lt; 40% → <strong className="text-foreground">低拥挤</strong>（情绪偏冷，关注底部信号）</li>
                </ul>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">辅助指标（HHI 集中度）</p>
                <p>个股成交额赫芬达尔指数 HHI = Σ Share²，以及 Top3 / Top10 成交额占比，用于解释板块与个股抱团结构。</p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">板块成交额占比</p>
                <p>按股票代码前缀将个股归入板块，再汇总各板块成交额占比：</p>
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>600/601/603/605 → 上证主板</li>
                  <li>000/001/002/003 → 深证主板</li>
                  <li>300/301 → 创业板</li>
                  <li>688/689 → 科创板</li>
                  <li>920/.BJ 等 → 北交所</li>
                </ul>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs">
                  BoardShare<sub>b,d</sub> = Σ<sub>i∈b</sub> Amount<sub>i,d</sub> / TotalAmount<sub>d</sub> × 100%
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">个股 Top15</p>
                <p>取最新交易日成交额最大的 15 只股票，展示各自占全市场成交额的比例（同 Share<sub>i,d</sub> 公式）。</p>
              </div>

              <p className="text-xs border-t border-border pt-3">
                指标结果存储于 <code className="bg-muted px-1 rounded">derived_ashare_crowding_daily</code>，
                由夜间 ETL 步骤 <code className="bg-muted px-1 rounded">ashare_crowding</code> 在原始数据更新后自动计算。
              </p>
            </div>
            )}
          </div>
        </div>
      )}

      {showTop5Help && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowTop5Help(false)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-xl p-5 max-w-xl w-full mx-4 text-sm max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base">Top 5% 成交额占比：计算方法</h3>
              <button
                type="button"
                onClick={() => setShowTop5Help(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p className="text-xs">
                衡量全 A 成交额向头部个股集中的程度。按<strong className="text-foreground">股票数量</strong>取前 5%（非按成交额阈值），
                统计这些个股合计占当日全市场成交额的比例。数值越高，说明资金越集中在少数活跃个股。
              </p>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">数据来源</p>
                <p>
                  每日全部 A 股（约 5,500 只）成交额来自
                  <code className="text-xs bg-muted px-1 rounded">raw_ashare_daily</code>，
                  由夜间 ETL 步骤 <code className="text-xs bg-muted px-1 rounded">ashare_crowding</code> 汇总计算，
                  结果写入 <code className="text-xs bg-muted px-1 rounded">derived_ashare_crowding_daily.top5pct_share</code>。
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第一步：确定 Top 5% 股票数量</p>
                <p>对每个交易日，统计当日有成交的全部 A 股数量 N，向上取整得到前 5% 的股票数：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>N<sub>d</sub> = |&#123;i : Amount<sub>i,d</sub> &gt; 0&#125;|</div>
                  <div>K<sub>d</sub> = max(1, ⌈N<sub>d</sub> × 5%⌉)</div>
                </div>
                <p className="text-xs">例如 N = 5,500 时，K = 275 只；至少取 1 只。</p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第二步：计算 Top 5% 成交额占比</p>
                <p>按当日成交额降序排列，取前 K 只股票的成交额之和，除以全市场总成交额：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>TotalAmount<sub>d</sub> = Σ<sub>i</sub> Amount<sub>i,d</sub></div>
                  <div>Top5%Share<sub>d</sub> = ( Σ<sub>rank≤K</sub> Amount<sub>i,d</sub> ) / TotalAmount<sub>d</sub> × 100%</div>
                </div>
                <p className="text-xs">
                  与 Top3 / Top10 占比（固定取前 3 / 10 只）不同，Top 5% 随市场扩容自动调整样本规模。
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">图表线条说明</p>
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li><strong className="text-foreground">Top 5% 成交额占比</strong>（实线）：上述 ETL 每日计算值</li>
                  <li><strong className="text-foreground">20 日均线</strong>（虚线）：对占比序列取 20 交易日简单移动平均，平滑短期波动</li>
                  <li><strong className="text-foreground">窗口均值</strong>（点线）：对图表窗口内（默认近 365 日）数据做扩展窗口均值，从窗口首日至当日的累计平均</li>
                </ul>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>MA20<sub>d</sub> = (1/20) Σ<sub>j=d−19</sub><sup>d</sup> Top5%Share<sub>j</sub></div>
                  <div>μ<sub>t</sub> = (1/t) Σ<sub>k=1</sub><sup>t</sup> Top5%Share<sub>k</sub></div>
                </div>
                <p className="text-xs">20 日均线与窗口均值在前端基于 API 返回的序列实时计算，不写入数据库。</p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">解读参考</p>
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>占比持续上升 → 资金向头部个股集中，市场抱团加强</li>
                  <li>占比持续下降 → 成交更分散，广度改善</li>
                  <li>可与 Top3 占比、HHI 等指标交叉验证集中度结构</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>
              {chartView === "sentiment" ? "全A拥挤度 vs 全A走势" : "A股拥挤度指标"}
            </CardTitle>
            <CardDescription>
              {chartView === "sentiment"
                ? "拥挤度（左轴，250 日换手率分位 + 20 日平滑）叠加均值与标准差通道；红色为全 A 价格指数（首日=5000，链式收益合成）；粉色标记为拥挤度跌破均值-1.5σ的局部低点"
                : `全 A 成交额加权换手率的历史分位数（250 日窗口、20 日平滑），反映市场交易情绪${
                    latest
                      ? ` · 最新 ${latest.trade_date}：${crowdingLabel(latest.crowding_pct)}（${latest.crowding_pct?.toFixed(1) ?? "—"}%）`
                      : ""
                  }${latest?.total_amount != null ? ` · 全市场成交额 ${formatAmountYi(latest.total_amount)}` : ""}`}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-start gap-2 mt-0.5">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setChartView("sentiment")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  chartView === "sentiment"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                全A走势
              </button>
              <button
                type="button"
                onClick={() => setChartView("crowding")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  chartView === "crowding"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                拥挤度指标
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground text-xs leading-none flex items-center justify-center flex-shrink-0"
              title="图表说明"
            >
              ?
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div
              className="flex items-center justify-center text-sm text-muted-foreground"
              style={{ height: mainChartHeight }}
            >
              加载中...
            </div>
          ) : error ? (
            <div
              className="flex items-center justify-center text-sm text-destructive"
              style={{ height: mainChartHeight }}
            >
              {error}
            </div>
          ) : !series.length ? (
            <div
              className="flex items-center justify-center text-sm text-muted-foreground"
              style={{ height: mainChartHeight }}
            >
              暂无数据
            </div>
          ) : (
            <ReactECharts
              option={mainChartOption}
              style={{ height: mainChartHeight, width: "100%" }}
              notMerge={chartView === "sentiment"}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Top 5% 成交额占比</CardTitle>
            <CardDescription>
              {latest?.trade_date ? `截至 ${formatTradeDate(latest.trade_date)} · ` : ""}
              按股票数量取前 5% 个股的成交额占全 A 比例
              {top5pctStats.latestVal != null ? ` · 最新 ${top5pctStats.latestVal.toFixed(1)}%` : ""}
              {top5pctStats.diffMa20 != null
                ? ` · 较20日均 ${top5pctStats.diffMa20 >= 0 ? "+" : ""}${top5pctStats.diffMa20.toFixed(1)}pp`
                : ""}
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => setShowTop5Help(true)}
            className="w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground text-xs leading-none flex items-center justify-center flex-shrink-0 mt-0.5"
            title="计算方法说明"
          >
            ?
          </button>
        </CardHeader>
        <CardContent>
          {loading || error || !series.length || top5pctStats.values.every((v) => v == null) ? (
            <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
              {error || (loading ? "加载中..." : "暂无数据（需运行 ETL 回填 top5pct_share）")}
            </div>
          ) : (
            <ReactECharts option={top5pctOption} style={{ height: "300px", width: "100%" }} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5 min-w-0">
            <CardTitle>主题成交额占比 vs 全A拥挤度</CardTitle>
            <CardDescription>
              {sectorCrowding?.latest.trade_date
                ? `截至 ${formatTradeDate(sectorCrowding.latest.trade_date)} · `
                : ""}
              {sectorCrowding?.board.name ?? "主题"}资金占全A成交额比例（左轴）叠加市场拥挤度（右轴）
              {sectorCrowding?.latest.amount_share != null
                ? ` · 占比 ${sectorCrowding.latest.amount_share.toFixed(2)}%`
                : ""}
              {sectorCrowding?.latest.crowding_pct != null
                ? ` · 拥挤度 ${sectorCrowding.latest.crowding_pct.toFixed(1)}`
                : ""}
              {sectorCrowding?.latest.is_hot ? " · 当日热点" : ""}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 mt-0.5 shrink-0">
            <select
              value={sectorBoardKey}
              onChange={(e) => setSectorBoardKey(e.target.value)}
              className="h-7 max-w-[200px] rounded border border-border bg-background px-2 text-xs"
            >
              {(sectorCrowding?.boards?.length
                ? sectorCrowding.boards
                : [
                    { type: "concept" as const, name: "人工智能", group: "AI主题" },
                    { type: "industry" as const, name: "半导体", group: "相关行业" },
                  ]
              ).map((b) => (
                <option key={`${b.type}:${b.name}`} value={`${b.type}:${b.name}`}>
                  {b.group} · {b.name}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              {([120, 250, 365] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSectorDays(d)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                    sectorDays === d
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d}日
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {sectorCrowding?.note ? (
            <p className="text-xs text-muted-foreground">{sectorCrowding.note}</p>
          ) : null}
          {sectorLoading ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              加载中（首次选择板块可能需回填同花顺成交额历史）…
            </div>
          ) : sectorError || !sectorCrowding?.series.some((s) => s.amount_share != null) ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
              {sectorError || "暂无数据"}
            </div>
          ) : (
            <ReactECharts
              option={sectorCrowdingOption}
              style={{ height: "360px", width: "100%" }}
              notMerge
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5 min-w-0">
            <CardTitle>板块资金流向 · 存量资金</CardTitle>
            <CardDescription>
              {fundFlow?.start_date && fundFlow?.end_date
                ? `${formatTradeDate(fundFlow.start_date)} → ${formatTradeDate(fundFlow.end_date)} · `
                : ""}
              每日净流入累计（亿元）；左图看谁在吸金，右图看当日净流入 Top15
              {fundFlow?.boards[0]?.cum_net != null
                ? ` · 窗口累计领先 ${fundFlow.boards[0].name} ${
                    fundFlow.boards[0].cum_net >= 0 ? "+" : ""
                  }${fundFlow.boards[0].cum_net.toFixed(0)}亿`
                : ""}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 mt-0.5 shrink-0">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setFundFlowType("industry")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  fundFlowType === "industry"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                行业
              </button>
              <button
                type="button"
                onClick={() => setFundFlowType("concept")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  fundFlowType === "concept"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                概念
              </button>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setFundFlowPreset("ai")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  fundFlowPreset === "ai"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                AI篮子
              </button>
              <button
                type="button"
                onClick={() => setFundFlowPreset("top")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  fundFlowPreset === "top"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                累计Top
              </button>
            </div>
            <div className="flex gap-1">
              {([60, 120, 250] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFundFlowDays(d)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                    fundFlowDays === d
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d}日
                </button>
              ))}
            </div>
            {fundFlow?.boards?.length ? (
              <select
                value={fundFlowFocus || fundFlow.focus || fundFlow.boards[0]?.name || ""}
                onChange={(e) => setFundFlowFocus(e.target.value)}
                className="h-7 max-w-[180px] rounded border border-border bg-background px-2 text-xs"
                title="聚焦板块（滚动净流入 / 存量vs拥挤度）"
              >
                {fundFlow.boards.map((b) => (
                  <option key={b.name} value={b.name}>
                    聚焦 · {b.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {fundFlow?.note ? (
            <p className="text-xs text-muted-foreground">{fundFlow.note}</p>
          ) : null}
          {fundFlowLoading ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              加载资金流向中（首次会拉取即时净额并回填历史代理）…
            </div>
          ) : fundFlowError || !fundFlow?.boards.length ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
              {fundFlowError || "暂无数据"}
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    存量资金（窗口内累计净流入）
                  </p>
                  <ReactECharts
                    option={fundFlowCumOption}
                    style={{ height: "320px", width: "100%" }}
                    notMerge
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    最新一日净流入 Top15
                  </p>
                  <ReactECharts
                    option={fundFlowBarOption}
                    style={{ height: "320px", width: "100%" }}
                    notMerge
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    净流入占比时序（板块净流入 / Σ|同口径全市场净流入|）
                    {fundFlowFocusBoard?.latest_share_pct != null
                      ? ` · ${fundFlowFocusBoard.name} 最新 ${fundFlowFocusBoard.latest_share_pct.toFixed(1)}%`
                      : ""}
                  </p>
                  <ReactECharts
                    option={fundFlowShareOption}
                    style={{ height: "320px", width: "100%" }}
                    notMerge
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    滚动净流入（{fundFlowFocusBoard?.name ?? "聚焦板块"}）
                    {fundFlowFocusBoard?.latest_roll5 != null
                      ? ` · 5日 ${fundFlowFocusBoard.latest_roll5 >= 0 ? "+" : ""}${fundFlowFocusBoard.latest_roll5.toFixed(0)}亿`
                      : ""}
                    {fundFlowFocusBoard?.latest_roll20 != null
                      ? ` · 20日 ${fundFlowFocusBoard.latest_roll20 >= 0 ? "+" : ""}${fundFlowFocusBoard.latest_roll20.toFixed(0)}亿`
                      : ""}
                  </p>
                  <ReactECharts
                    option={fundFlowRollOption}
                    style={{ height: "320px", width: "100%" }}
                    notMerge
                  />
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  存量资金 vs 全A拥挤度（{fundFlowFocusBoard?.name ?? "聚焦板块"}）
                  {fundFlowFocusBoard?.cum_net != null
                    ? ` · 累计 ${fundFlowFocusBoard.cum_net >= 0 ? "+" : ""}${fundFlowFocusBoard.cum_net.toFixed(0)}亿`
                    : ""}
                </p>
                <ReactECharts
                  option={fundFlowCrowdingOption}
                  style={{ height: "340px", width: "100%" }}
                  notMerge
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>板块成交额占比</CardTitle>
            <CardDescription>
              {latest?.trade_date ? `截至 ${formatTradeDate(latest.trade_date)} · ` : ""}
              上证/深证/创业板/科创板/北交所
              {latest?.top_board ? ` · 主线 ${latest.top_board} ${latest.top_board_share?.toFixed(1)}%` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading || error || !latest?.boards?.length ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
                {error || "暂无数据"}
              </div>
            ) : (
              <ReactECharts option={boardOption} style={{ height: "280px", width: "100%" }} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>个股成交额 Top15</CardTitle>
            <CardDescription>
              {latest?.trade_date ? `截至 ${formatTradeDate(latest.trade_date)} · ` : ""}
              成交额占比最高的个股
              {latest?.top3_share != null ? ` · Top3合计 ${latest.top3_share.toFixed(1)}%` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading || error || !latest?.top_stocks?.length ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
                {error || "暂无数据"}
              </div>
            ) : (
              <ReactECharts option={stockOption} style={{ height: "280px", width: "100%" }} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5 min-w-0">
            <CardTitle>全市场板块表现</CardTitle>
            <CardDescription>
              {sectorOverview?.trade_date
                ? `截面 ${formatTradeDate(sectorOverview.trade_date)} · `
                : ""}
              全部{overviewType === "industry" ? "行业" : "概念"}（非仅热点）
              {sectorOverview
                ? ` · ${sectorOverview.boards.length} 个板块 · 上涨 ${sectorOverview.breadth.up} / 下跌 ${sectorOverview.breadth.down}`
                : ""}
              {overviewDays > 1 && sectorOverview
                ? ` · 回溯${overviewDays}日（自 ${formatTradeDate(sectorOverview.start_date)}）· 区间上涨 ${sectorOverview.period_breadth.up}`
                : ""}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 mt-0.5 shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!sectorOverview?.prev_date}
                onClick={() => sectorOverview?.prev_date && setOverviewDate(sectorOverview.prev_date)}
                className="px-2 py-0.5 rounded text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                title="上一交易日"
              >
                ‹
              </button>
              <label className="relative inline-flex items-center">
                <input
                  type="date"
                  value={overviewDate || sectorOverview?.trade_date || ""}
                  min={
                    sectorOverview?.available_dates?.length
                      ? sectorOverview.available_dates[sectorOverview.available_dates.length - 1]
                      : undefined
                  }
                  max={sectorOverview?.available_dates?.[0]}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) setOverviewDate(v)
                  }}
                  className="h-7 rounded border border-border bg-background px-2 pr-1 text-xs"
                  title="选择截面日期"
                />
              </label>
              <button
                type="button"
                disabled={!sectorOverview?.next_date}
                onClick={() => sectorOverview?.next_date && setOverviewDate(sectorOverview.next_date)}
                className="px-2 py-0.5 rounded text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                title="下一交易日"
              >
                ›
              </button>
              <button
                type="button"
                disabled={!sectorOverview?.available_dates?.[0] || overviewDate === sectorOverview?.available_dates?.[0]}
                onClick={() => {
                  const latest = sectorOverview?.available_dates?.[0]
                  if (latest) setOverviewDate(latest)
                }}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  overviewDate && sectorOverview?.available_dates?.[0] === overviewDate
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
                title="回到最新交易日"
              >
                最新
              </button>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setOverviewType("industry")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  overviewType === "industry"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                行业
              </button>
              <button
                type="button"
                onClick={() => setOverviewType("concept")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  overviewType === "concept"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                概念
              </button>
            </div>
            <div className="flex gap-1">
              {([1, 5, 20] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setOverviewDays(d)
                    setOverviewSort(d <= 1 ? "change" : "period_return")
                  }}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                    overviewDays === d
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d === 1 ? "当日" : `${d}日`}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setOverviewSort(overviewDays <= 1 ? "change" : "period_return")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  overviewSort === "change" || overviewSort === "period_return"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                按涨跌
              </button>
              <button
                type="button"
                onClick={() => setOverviewSort(overviewDays <= 1 ? "net_flow" : "period_net")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  overviewSort === "net_flow" || overviewSort === "period_net"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                按净流入
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {sectorOverview?.note ? (
            <p className="text-xs text-muted-foreground">{sectorOverview.note}</p>
          ) : null}
          {overviewLoading ? (
            <div className="h-[380px] flex items-center justify-center text-sm text-muted-foreground">
              加载全市场板块中...
            </div>
          ) : overviewError || !sectorOverview?.boards.length ? (
            <div className="h-[380px] flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
              {overviewError || "暂无数据"}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  全板块排名（{overviewMetricLabel}，可滚动）
                </p>
                <ReactECharts
                  option={overviewBarOption}
                  style={{ height: overviewBarHeight, width: "100%" }}
                  notMerge
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  涨跌幅 vs 净流入散点（右上=涨且吸金，左下=跌且流出）
                </p>
                <ReactECharts
                  option={overviewScatterOption}
                  style={{ height: overviewBarHeight, width: "100%" }}
                  notMerge
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>热点板块 Top15</CardTitle>
            <CardDescription>
              {hotSectors?.trade_date ? `截至 ${formatTradeDate(hotSectors.trade_date)} · ` : ""}
              按涨跌幅排序的{hotSectorType === "industry" ? "行业" : "概念"}板块（仅头部热点）
              {hotSectorItems[0]?.name
                ? ` · 领涨 ${hotSectorItems[0].name}${
                    hotSectorItems[0].change_pct != null
                      ? ` ${hotSectorItems[0].change_pct >= 0 ? "+" : ""}${hotSectorItems[0].change_pct.toFixed(2)}%`
                      : ""
                  }`
                : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1 mt-0.5">
            <button
              type="button"
              onClick={() => setHotSectorType("industry")}
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                hotSectorType === "industry"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              行业
            </button>
            <button
              type="button"
              onClick={() => setHotSectorType("concept")}
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                hotSectorType === "concept"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              概念
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {hotLoading ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : hotError || !hotSectorItems.length ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              {hotError || "暂无数据"}
            </div>
          ) : (
            <ReactECharts option={hotSectorOption} style={{ height: "360px", width: "100%" }} notMerge />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>热点持续性</CardTitle>
            <CardDescription>
              {hotHistory?.start_date && hotHistory?.end_date
                ? `${formatTradeDate(hotHistory.start_date)} → ${formatTradeDate(hotHistory.end_date)} · `
                : ""}
              近 {hotHistDays} 日{hotSectorType === "industry" ? "行业" : "概念"}进入涨跌幅 Top{hotHistTopN} 的频率与连热
              {hotHistory?.boards[0]
                ? ` · 最持续 ${hotHistory.boards[0].name}（上榜 ${hotHistory.boards[0].hot_days} 日 / 最长连热 ${hotHistory.boards[0].max_streak}）`
                : ""}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 mt-0.5">
            <div className="flex gap-1">
              {([10, 20, 60] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setHotHistDays(d)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                    hotHistDays === d
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d}日
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {([5, 10, 15] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHotHistTopN(n)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                    hotHistTopN === n
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  Top{n}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(
                [
                  ["hot_days", "上榜天数"],
                  ["max_streak", "最长连热"],
                  ["current_streak", "当前连热"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setHotHistMetric(key)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                    hotHistMetric === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {hotHistLoading ? (
            <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
              加载历史热点中（首次可能需回填同花顺行业指数）…
            </div>
          ) : hotHistError || !hotHistory?.boards.length ? (
            <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
              {hotHistError || "暂无历史数据"}
            </div>
          ) : (
            <>
              {hotHistory.coverage_note ? (
                <p className="text-xs text-muted-foreground">{hotHistory.coverage_note}</p>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    按{hotHistoryMetricLabel}排序（窗口 {hotHistory.session_count} 个交易日）
                  </p>
                  <ReactECharts
                    option={hotHistoryBarOption}
                    style={{ height: "360px", width: "100%" }}
                    notMerge
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    上榜轨迹（红色=当日进入涨跌幅 Top{hotHistTopN}）
                  </p>
                  <ReactECharts
                    option={hotHistoryHeatOption}
                    style={{ height: "360px", width: "100%" }}
                    notMerge
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
