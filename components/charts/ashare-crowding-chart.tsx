"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"
import AshareCrowdingSentimentChart from "@/components/charts/ashare-crowding-sentiment-chart"

type SeriesPoint = {
  date: string
  crowding_pct: number | null
  hhi: number | null
  top3_share: number | null
  top10_share: number | null
  top_board: string | null
  top_board_share: number | null
}

type BoardItem = { name: string; share: number }
type TopStock = { ts_code: string; amount: number | null; share: number | null }

type CrowdingPayload = {
  series: SeriesPoint[]
  index_series?: Array<{ date: string; all_a_index: number | null }>
  latest: {
    trade_date: string
    crowding_pct: number | null
    hhi: number | null
    top3_share: number | null
    top10_share: number | null
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

export default function AshareCrowdingChart() {
  const [payload, setPayload] = useState<CrowdingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

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

  useChartAutoRefresh(load, [])

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
      grid: { left: 80, right: 16, top: 8, bottom: 8 },
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
        label: { show: true, position: "right", formatter: "{c}%", fontSize: 10 },
      }],
    }
  }, [latest])

  const stockOption = useMemo(() => {
    const stocks = latest?.top_stocks ?? []
    if (!stocks.length) return {}
    const labels = stocks.map((s) => s.ts_code)
    const shares = stocks.map((s) => s.share ?? 0)
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: Array<{ name: string; value: number }>) =>
          `${p[0]?.name}<br/>成交额占比: ${p[0]?.value?.toFixed(2)}%`,
      },
      grid: { left: 88, right: 40, top: 8, bottom: 8 },
      xAxis: { type: "value", axisLabel: { formatter: "{value}%", fontSize: 10 } },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLabel: { fontSize: 10 },
      },
      series: [{
        type: "bar",
        data: shares,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      }],
    }
  }, [latest])

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
              <h3 className="font-semibold text-base">A股拥挤度指标：计算方法</h3>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>
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
                  <li>300 → 创业板</li>
                  <li>688 → 科创板</li>
                  <li>920 或 .BJ → 北交所</li>
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
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>A股拥挤度指标</CardTitle>
            <CardDescription>
              全 A 成交额加权换手率的历史分位数（250 日窗口、20 日平滑），反映市场交易情绪
              {latest
                ? ` · 最新 ${latest.trade_date}：${crowdingLabel(latest.crowding_pct)}（${latest.crowding_pct?.toFixed(1) ?? "—"}%）`
                : ""}
              {latest?.total_amount != null ? ` · 全市场成交额 ${formatAmountYi(latest.total_amount)}` : ""}
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground text-xs leading-none flex items-center justify-center flex-shrink-0 mt-0.5"
            title="计算方法说明"
          >
            ?
          </button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-destructive">{error}</div>
          ) : !series.length ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">暂无数据</div>
          ) : (
            <ReactECharts option={lineOption} style={{ height: "360px", width: "100%" }} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>板块成交额占比</CardTitle>
            <CardDescription>
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
              最新交易日成交额占比最高的个股
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

      <AshareCrowdingSentimentChart
        series={series}
        indexSeries={indexSeries}
        latestDate={latest?.trade_date}
        loading={loading}
        error={error}
      />
    </div>
  )
}
