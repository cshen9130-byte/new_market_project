"use client"

import { useMemo } from "react"

import { KlineProChart } from "@/components/ma/kline-pro-chart"
import { useSymbolKline } from "@/hooks/use-symbol-kline"
import { SLEEVE_COLORS, SLEEVE_KEYS, SLEEVE_LABELS, type SleeveKey } from "@/lib/all-weather/universe"
import {
  marksFromAllWeatherTrades,
  marksFromPositions,
  mergeOrderMarks,
} from "@/lib/client/chart-order-marks"
import type { CtpCandle, CtpTick } from "@/lib/client/ctp-market"
import {
  ALL_WEATHER_PORTFOLIO_ID,
  priceDigits,
  sideLabel,
  sleeveLeadPositions,
} from "@/lib/client/paper-trading"
import type { TimeframeId } from "@/lib/client/timeframes"
import type { PaperTradingApi } from "@/hooks/use-paper-trading"
import { cn } from "@/lib/utils"

function SleeveMiniChart({
  sleeve,
  symbol,
  label,
  lots,
  side,
  interval,
  live1m,
  quote,
  paper,
  selected,
  onSelect,
}: {
  sleeve: SleeveKey
  symbol: string | null
  label?: string
  lots?: number
  side?: "long" | "short"
  interval: TimeframeId
  live1m: CtpCandle[]
  quote?: CtpTick
  paper: PaperTradingApi
  selected: boolean
  onSelect: (symbol: string) => void
}) {
  const { candles } = useSymbolKline(symbol, interval, live1m, quote)
  const marks = useMemo(() => {
    if (!symbol) return []
    const fromPaper = marksFromPositions(paper.state.positions, symbol, paper.selectedPortfolioId)
    const fromAw =
      paper.selectedPortfolioId === ALL_WEATHER_PORTFOLIO_ID
        ? marksFromAllWeatherTrades(paper.awMeta?.trades, symbol)
        : []
    return mergeOrderMarks(fromAw, fromPaper)
  }, [symbol, paper.state.positions, paper.selectedPortfolioId, paper.awMeta?.trades])
  const last = candles.at(-1)?.close ?? quote?.last ?? null
  const digits = symbol ? priceDigits(symbol) ?? 1 : 1

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col border-[#2a2e39] bg-[#131722]",
        selected ? "ring-1 ring-inset ring-[#4c84ff]" : "",
      )}
    >
      <button
        type="button"
        onClick={() => {
          if (symbol) onSelect(symbol)
        }}
        className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[#2a2e39] px-2 py-1 text-left hover:bg-[#1a2030]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="font-medium" style={{ color: SLEEVE_COLORS[sleeve] }}>
              {SLEEVE_LABELS[sleeve]}
            </span>
            <span className="truncate font-mono text-white">{symbol || "--"}</span>
          </div>
          <div className="truncate text-[10px] text-[#787b86]">
            {label || "该袖套暂无持仓"}
            {lots != null && side ? ` · ${sideLabel(side)} ${lots}` : ""}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[12px] text-[#d1d4dc]">
          {last == null ? "--" : last.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}
        </span>
      </button>
      <div className="min-h-0 flex-1">
        {symbol ? (
          <KlineProChart symbol={symbol} interval={interval} candles={candles} marks={marks} compact />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-[#787b86]">加载策略后显示最大持仓品种</div>
        )}
      </div>
    </div>
  )
}

export function SleeveKlineGrid({
  paper,
  quotes,
  candles,
  interval,
  selectedSymbol,
  onSelectSymbol,
}: {
  paper: PaperTradingApi
  quotes: Record<string, CtpTick>
  candles: Record<string, CtpCandle[]>
  interval: TimeframeId
  selectedSymbol: string
  onSelectSymbol: (symbol: string) => void
}) {
  const leads = useMemo(
    () =>
      sleeveLeadPositions(paper.openPositions, {
        snapshotFallback: paper.selectedPortfolioId === ALL_WEATHER_PORTFOLIO_ID,
      }),
    [paper.openPositions, paper.selectedPortfolioId],
  )

  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-2 [&>*]:border-r [&>*]:border-b [&>*:nth-child(2n)]:border-r-0 [&>*:nth-last-child(-n+2)]:border-b-0">
      {SLEEVE_KEYS.map((sleeve) => {
        const lead = leads[sleeve]
        const symbol = lead?.position.symbol || null
        const quote = symbol ? quotes[symbol] || quotes[symbol.toUpperCase()] : undefined
        return (
          <SleeveMiniChart
            key={sleeve}
            sleeve={sleeve}
            symbol={symbol}
            label={lead?.position.label}
            lots={lead?.position.lots}
            side={lead?.position.side}
            interval={interval}
            live1m={symbol ? candles[symbol] || candles[symbol.toUpperCase()] || [] : []}
            quote={quote}
            paper={paper}
            selected={!!symbol && symbol === selectedSymbol}
            onSelect={onSelectSymbol}
          />
        )
      })}
    </div>
  )
}

