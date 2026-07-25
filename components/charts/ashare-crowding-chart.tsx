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
    </div>
  )
}
