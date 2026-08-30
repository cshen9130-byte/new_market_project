"use client"

import { useMemo, useState } from "react"
import { LineChart } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart as RcLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { PaperTradingApi } from "@/hooks/use-paper-trading"
import { useSymbolsKline } from "@/hooks/use-symbols-kline"
import {
  assetFromContract,
  isSleeveKey,
  SLEEVE_COLORS,
  SLEEVE_KEYS,
  SLEEVE_LABELS,
  sleeveFromContract,
  type SleeveKey,
} from "@/lib/all-weather/universe"
import type { CtpCandle, CtpTick } from "@/lib/client/ctp-market"
import {
  isAllWeatherAccount,
  fmtNav,
  fmtPct,
  paperNavCurve,
  paperProductNavCurve,
  paperSleeveNavCurve,
} from "@/lib/client/paper-trading"
import { getTimeframe, isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"
import { cn } from "@/lib/utils"

type ChartMode = "nav" | "return"
type ChartScope = "portfolio" | "sleeves" | "products"

const PRODUCT_PALETTE = [
  "#60a5fa",
  "#fbbf24",
  "#34d399",
  "#f87171",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#4ade80",
  "#818cf8",
  "#e879f9",
  "#38bdf8",
  "#f97316",
  "#14b8a6",
  "#facc15",
  "#c084fc",
  "#2dd4bf",
  "#fb923c",
  "#86efac",
  "#93c5fd",
  "#f472b6",
]

function yuanWan(v: number) {
  return `${Math.round(v / 10_000)}万`
}

function pctTick(v: number) {
  return `${(v * 100).toFixed(2)}%`
}

function productColor(asset: string, keys: string[]) {
  const i = Math.max(0, keys.indexOf(asset))
  return PRODUCT_PALETTE[i % PRODUCT_PALETTE.length]
}

function positionSleeve(pos: { sleeve?: string; symbol: string }): SleeveKey | null {
  if (pos.sleeve && isSleeveKey(pos.sleeve)) return pos.sleeve
  return sleeveFromContract(pos.symbol)
}

export function PaperNavChart({
  paper,
  interval,
  quotes,
  candles,
  onClose,
}: {
  paper: PaperTradingApi
  interval: TimeframeId
  quotes: Record<string, CtpTick>
  candles: Record<string, CtpCandle[]>
  onClose: () => void
}) {
  const aw = isAllWeatherAccount(paper.selectedPortfolioId)
  const startedAt = aw && paper.awMeta?.startedAt ? Date.parse(`${paper.awMeta.startedAt}T09:00:00+08:00`) : paper.selectedPortfolio?.createdAt
  const positions = useMemo(
    () => paper.state.positions.filter((p) => !paper.selectedPortfolio || p.portfolioId === paper.selectedPortfolio.id),
    [paper.selectedPortfolio, paper.state.positions],
  )
  const symbols = useMemo(
    () =>
      [
        ...new Set(
          positions
            .filter((p) => p.status === "open" || (p.status === "closed" && p.exitTime))
            .map((p) => p.symbol.toUpperCase()),
        ),
      ].sort(),
    [positions],
  )
  const wantIntraday = isIntradayTimeframe(interval)
  const { candles: klines, loading } = useSymbolsKline(symbols, interval, candles, quotes, wantIntraday)
  const data = useMemo(
    () =>
      paperNavCurve({
        initialCapital: paper.summary.initialCapital,
        liveNav: paper.summary.nav,
        startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
        positions,
        daily: aw ? paper.awMeta?.daily : undefined,
        interval,
        marksBySymbol: wantIntraday ? klines : undefined,
        prevMarks: aw ? paper.awMeta?.prevMarks : undefined,
        bookEquity: aw ? paper.awMeta?.equity : undefined,
        bookDailyPnl: aw ? paper.awMeta?.dailyPnl : undefined,
      }),
    [
      aw,
      interval,
      klines,
      paper.awMeta?.daily,
      paper.awMeta?.dailyPnl,
      paper.awMeta?.equity,
      paper.awMeta?.prevMarks,
      paper.summary.initialCapital,
      paper.summary.nav,
      positions,
      startedAt,
      wantIntraday,
    ],
  )
  const liveSleeveNav = useMemo(() => {
    const sleeveCapital = paper.summary.initialCapital / SLEEVE_KEYS.length
    return Object.fromEntries(
      SLEEVE_KEYS.map((key) => [key, sleeveCapital + (paper.sleevePnl[key]?.cum ?? 0)]),
    ) as Record<SleeveKey, number>
  }, [paper.sleevePnl, paper.summary.initialCapital])
  const sleeveData = useMemo(
    () =>
      aw
        ? paperSleeveNavCurve({
            initialCapital: paper.summary.initialCapital,
            liveSleeveNav,
            startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
            positions,
            daily: paper.awMeta?.daily,
            interval,
            marksBySymbol: wantIntraday ? klines : undefined,
            prevMarks: paper.awMeta?.prevMarks,
          })
        : [],
    [
      aw,
      interval,
      klines,
      liveSleeveNav,
      paper.awMeta?.daily,
      paper.awMeta?.prevMarks,
      paper.summary.initialCapital,
      positions,
      startedAt,
      wantIntraday,
    ],
  )
  const [mode, setMode] = useState<ChartMode>("nav")
  const [scope, setScope] = useState<ChartScope>("portfolio")
  const [productSleeve, setProductSleeve] = useState<SleeveKey>("Equity")
  const first = data[0]?.nav
  const last = data.at(-1)?.nav
  const ret = first && first > 0 && last != null ? (last - first) / first : null
  const chartData = useMemo(() => {
    const base = data[0]?.nav
    if (!(base > 0)) return data.map((p) => ({ ...p, ret: 0 }))
    return data.map((p) => ({ ...p, ret: (p.nav - base) / base }))
  }, [data])
  const sleeveCapital = paper.summary.initialCapital / SLEEVE_KEYS.length
  const sleeveChartData = useMemo(() => {
    if (scope !== "sleeves" || mode !== "return" || !(sleeveCapital > 0)) return sleeveData
    return sleeveData.map((row) => {
      const next = { date: row.date } as { date: string } & Record<SleeveKey, number>
      for (const key of SLEEVE_KEYS) next[key] = (row[key] - sleeveCapital) / sleeveCapital
      return next
    })
  }, [mode, scope, sleeveCapital, sleeveData])
  const productKeys = useMemo(() => {
    if (!aw) return []
    const set = new Set<string>()
    for (const row of paper.awMeta?.daily || []) {
      for (const asset of Object.keys(row.productPnl || {})) {
        if (sleeveFromContract(asset) === productSleeve) set.add(asset)
      }
    }
    for (const pos of positions) {
      if (positionSleeve(pos) !== productSleeve) continue
      const asset = assetFromContract(pos.symbol)
      if (asset) set.add(asset)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [aw, paper.awMeta?.daily, positions, productSleeve])
  const productCapital = productKeys.length > 0 ? sleeveCapital / productKeys.length : sleeveCapital
  const liveProductNav = useMemo(() => {
    const running: Record<string, number> = {}
    for (const row of paper.awMeta?.daily || []) {
      for (const key of productKeys) running[key] = (running[key] ?? 0) + (Number(row.productPnl?.[key]) || 0)
    }
    const fromPositions: Record<string, number> = {}
    for (const row of paper.openPositions) {
      if (positionSleeve(row.position) !== productSleeve) continue
      const asset = assetFromContract(row.position.symbol)
      if (!asset || row.cumPnl == null) continue
      fromPositions[asset] = (fromPositions[asset] ?? 0) + row.cumPnl
    }
    return Object.fromEntries(
      productKeys.map((key) => [key, productCapital + (fromPositions[key] ?? running[key] ?? 0)]),
    )
  }, [paper.awMeta?.daily, paper.openPositions, productCapital, productKeys, productSleeve])
  const productData = useMemo(
    () =>
      aw && productKeys.length > 0
        ? paperProductNavCurve({
            keys: productKeys,
            capitalOf: () => productCapital,
            liveNav: liveProductNav,
            startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
            positions,
            daily: paper.awMeta?.daily,
            interval,
            marksBySymbol: wantIntraday ? klines : undefined,
            prevMarks: paper.awMeta?.prevMarks,
          })
        : [],
    [
      aw,
      interval,
      klines,
      liveProductNav,
      paper.awMeta?.daily,
      paper.awMeta?.prevMarks,
      positions,
      productCapital,
      productKeys,
      startedAt,
      wantIntraday,
    ],
  )
  const productChartData = useMemo(() => {
    if (scope !== "products" || mode !== "return" || !(productCapital > 0)) return productData
    return productData.map((row) => {
      const next: { date: string } & Record<string, number> = { date: row.date }
      for (const key of productKeys) next[key] = ((row[key] ?? productCapital) - productCapital) / productCapital
      return next
    })
  }, [mode, productCapital, productData, productKeys, scope])
  const empty =
    scope === "products"
      ? productKeys.length === 0 || productData.length < 2
      : scope === "sleeves"
        ? sleeveData.length < 2
        : data.length < 2
  const tfLabel = getTimeframe(interval).label
  const intraFallback = wantIntraday && !loading && data.length > 0 && !data.some((p) => p.date.includes(" "))
  const showReturn = mode === "return"
  const axisTick = showReturn ? pctTick : yuanWan
  const lineKeys = scope === "products" ? productKeys : SLEEVE_KEYS
  const lineData = scope === "products" ? productChartData : sleeveChartData
  const showLines = aw && scope !== "portfolio"

  function toggleScope(next: ChartScope) {
    setScope((cur) => (cur === next ? "portfolio" : next))
  }

  function selectProductSleeve(key: SleeveKey) {
    setProductSleeve(key)
    setScope("products")
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#131722]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#2a2e39] bg-[#1e222d] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <LineChart className="size-3.5 text-[#4c84ff]" />
          <div className="inline-flex shrink-0 overflow-hidden rounded border border-[#2a2e39]">
            {(
              [
                ["nav", "净值"],
                ["return", "收益率"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={cn(
                  "px-2 py-0.5 text-[11px]",
                  mode === id ? "bg-[#4c84ff] text-white" : "bg-[#1e222d] text-[#adb3bd] hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {aw ? (
            <>
              <button
                type="button"
                title={scope === "sleeves" ? "返回组合净值" : "显示各袖套净值"}
                onClick={() => toggleScope("sleeves")}
                className={cn(
                  "rounded border px-2 py-0.5 text-[11px]",
                  scope === "sleeves"
                    ? "border-[#4c84ff] bg-[#4c84ff] text-white"
                    : "border-[#2a2e39] bg-[#1e222d] text-[#adb3bd] hover:text-white",
                )}
              >
                袖套
              </button>
              <button
                type="button"
                title={scope === "products" ? "返回组合净值" : "显示所选袖套内各品种净值"}
                onClick={() => toggleScope("products")}
                className={cn(
                  "rounded border px-2 py-0.5 text-[11px]",
                  scope === "products"
                    ? "border-[#4c84ff] bg-[#4c84ff] text-white"
                    : "border-[#2a2e39] bg-[#1e222d] text-[#adb3bd] hover:text-white",
                )}
              >
                品种
              </button>
            </>
          ) : null}
          {aw && scope === "products" ? (
            <div className="inline-flex shrink-0 overflow-hidden rounded border border-[#2a2e39]">
              {SLEEVE_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectProductSleeve(key)}
                  className={cn(
                    "px-2 py-0.5 text-[11px]",
                    productSleeve === key ? "text-white" : "bg-[#1e222d] hover:text-white",
                  )}
                  style={
                    productSleeve === key
                      ? { background: SLEEVE_COLORS[key] }
                      : { color: SLEEVE_COLORS[key] }
                  }
                >
                  {SLEEVE_LABELS[key]}
                </button>
              ))}
            </div>
          ) : null}
          <span className="rounded bg-[#2a2e39] px-1.5 py-0.5 text-[10px] text-[#adb3bd]">{tfLabel}</span>
          <span className="truncate text-[11px] text-[#787b86]">{paper.selectedPortfolio?.name || "--"}</span>
          <span className="font-mono text-[11px] text-[#d1d4dc]">{fmtNav(paper.summary.nav)}</span>
          <span className={cn("font-mono text-[11px]", ret == null ? "text-[#787b86]" : ret >= 0 ? "text-[#ef5350]" : "text-[#26a69a]")}>
            {fmtPct(ret)}
          </span>
          {wantIntraday && loading ? <span className="text-[10px] text-[#787b86]">加载{tfLabel}净值…</span> : null}
          {intraFallback ? <span className="text-[10px] text-[#787b86]">暂无{tfLabel}行情，仍显示日净值</span> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-[11px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
        >
          返回K线
        </button>
      </div>
      <div className="min-h-0 flex-1 px-2 py-2">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-[#787b86]">
            {aw
              ? scope === "products"
                ? `该袖套暂无品种净值。可先点袖套图例，或切换权益 / 债券 / 黄金 / 商品。`
                : "跟踪刚开始，次日刷新后会画出净值曲线。"
              : "暂无净值历史。平仓或同步全天候后将生成曲线。"}
          </div>
        ) : showLines ? (
          <ResponsiveContainer width="100%" height="100%">
            <RcLineChart
              key={`${interval}-${mode}-${scope}-${productSleeve}`}
              data={lineData}
              margin={{ top: 28, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e222d" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#787b86" }}
                axisLine={{ stroke: "#2a2e39" }}
                tickLine={false}
                minTickGap={32}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#787b86" }}
                axisLine={{ stroke: "#2a2e39" }}
                tickLine={false}
                width={showReturn ? 58 : 52}
                tickFormatter={axisTick}
                domain={["auto", "auto"]}
              />
              {showReturn ? <ReferenceLine y={0} stroke="#2a2e39" /> : null}
              <Tooltip
                contentStyle={{ background: "#1e222d", border: "1px solid #2a2e39", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#adb3bd" }}
                formatter={(value, name) => [
                  showReturn ? fmtPct(Number(value)) : fmtNav(Number(value)),
                  scope === "sleeves" ? SLEEVE_LABELS[name as SleeveKey] || String(name) : String(name),
                ]}
              />
              <Legend
                verticalAlign="top"
                iconType="plainline"
                wrapperStyle={{ fontSize: 11, color: "#adb3bd", cursor: scope === "sleeves" ? "pointer" : undefined }}
                formatter={(value) => (scope === "sleeves" ? SLEEVE_LABELS[value as SleeveKey] || value : value)}
                onClick={(item) => {
                  const key = String(item.dataKey ?? item.value ?? "")
                  if (isSleeveKey(key)) selectProductSleeve(key)
                }}
              />
              {lineKeys.map((key) => (
                <Line
                  key={key}
                  type="linear"
                  dataKey={key}
                  name={key}
                  stroke={scope === "products" ? productColor(key, productKeys) : SLEEVE_COLORS[key as SleeveKey]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  style={scope === "sleeves" ? { cursor: "pointer" } : undefined}
                  onClick={() => {
                    if (isSleeveKey(key)) selectProductSleeve(key)
                  }}
                />
              ))}
            </RcLineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart key={`${interval}-${mode}`} data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="paperNavFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4c84ff" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#4c84ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e222d" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#787b86" }}
                axisLine={{ stroke: "#2a2e39" }}
                tickLine={false}
                minTickGap={32}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#787b86" }}
                axisLine={{ stroke: "#2a2e39" }}
                tickLine={false}
                width={showReturn ? 58 : 52}
                tickFormatter={axisTick}
                domain={["auto", "auto"]}
              />
              {showReturn ? <ReferenceLine y={0} stroke="#2a2e39" /> : null}
              <Tooltip
                contentStyle={{ background: "#1e222d", border: "1px solid #2a2e39", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#adb3bd" }}
                formatter={(value) =>
                  showReturn ? [fmtPct(Number(value)), "收益率"] : [fmtNav(Number(value)), "净值"]
                }
              />
              <Area
                type="linear"
                dataKey={showReturn ? "ret" : "nav"}
                stroke="#4c84ff"
                fill="url(#paperNavFill)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
