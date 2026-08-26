"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Bot, LayoutGrid, LineChart, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"

import { IndexBasisRateChart } from "@/components/ma/index-basis-rate-chart"
import { IndexIvChart } from "@/components/ma/index-iv-chart"
import { KlineProChart, type KlineChartHandle } from "@/components/ma/kline-pro-chart"
import { PaperNavChart } from "@/components/ma/paper-nav-chart"
import {
  PaperAllWeatherOrderDialog,
  PaperPortfolioPanel,
  PaperPositionsBar,
  PaperStrategyBuilder,
} from "@/components/ma/paper-trading-panels"
import { QuoteBoard } from "@/components/ma/quote-board"
import { SleeveKlineGrid } from "@/components/ma/sleeve-kline-grid"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useAllWeatherCtpWatch } from "@/hooks/use-all-weather-ctp-watch"
import { usePaperTrading } from "@/hooks/use-paper-trading"
import {
  INDEX_FUTURES,
  type CtpCandle,
  type CtpTick,
  pickMostActiveContract,
} from "@/lib/client/ctp-market"
import { TimeframeSelect } from "@/components/ma/timeframe-select"
import { useSymbolKline } from "@/hooks/use-symbol-kline"
import {
  marksFromAllWeatherTrades,
  marksFromPositions,
  mergeOrderMarks,
} from "@/lib/client/chart-order-marks"
import { ALL_WEATHER_PORTFOLIO_ID, markPrice } from "@/lib/client/paper-trading"
import { overlaySinaQuote } from "@/lib/client/market-hours"
import { productOfSymbol, resolveSymbolInput } from "@/lib/client/pro-trading"
import type { IvSnapshot, SpotSnapshot } from "@/lib/client/realtime-overlay"
import type { TimeframeId } from "@/lib/client/timeframes"
import { cn } from "@/lib/utils"

export type ProTradingLayout = "market" | "paper"

type Props = {
  open: boolean
  onClose: () => void
  symbols: string[]
  quotes: Record<string, CtpTick>
  candles: Record<string, CtpCandle[]>
  spots: Record<string, SpotSnapshot>
  iv: Record<string, IvSnapshot>
  initialSymbol: string | null
  initialLayout?: ProTradingLayout
  onWatchSymbols?: (symbols: string[]) => void
}

function fmt(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "--"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function ProTradingWorkspace({
  open,
  onClose,
  symbols,
  quotes,
  candles,
  spots,
  iv,
  initialSymbol,
  initialLayout = "market",
  onWatchSymbols,
}: Props) {
  const [symbol, setSymbol] = useState(initialSymbol || "")
  const [query, setQuery] = useState(initialSymbol || "")
  const [tool, setTool] = useState("cross")
  const [interval, setInterval] = useState<TimeframeId>("1m")
  const [layout, setLayout] = useState<ProTradingLayout>(initialLayout)
  const [chartMode, setChartMode] = useState<"sleeves" | "single">("sleeves")
  const [showNavChart, setShowNavChart] = useState(false)
  const [mounted, setMounted] = useState(false)
  const klineRef = useRef<KlineChartHandle>(null)
  const paper = usePaperTrading(quotes, candles)
  const awBootRef = useRef(false)
  const awSymbols = paper.state.products
    .filter((item) => item.portfolioId === ALL_WEATHER_PORTFOLIO_ID)
    .map((item) => item.symbol)
  useAllWeatherCtpWatch(open && paper.selectedPortfolioId === ALL_WEATHER_PORTFOLIO_ID, awSymbols)

  useEffect(() => setMounted(true), [])

  const openedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      openedRef.current = false
      return
    }
    if (openedRef.current) return
    openedRef.current = true
    setLayout(initialLayout)
    setChartMode("sleeves")
    setShowNavChart(false)
    if (!initialSymbol) return
    setSymbol(initialSymbol)
    setQuery(initialSymbol)
  }, [open, initialSymbol, initialLayout])

  useEffect(() => {
    if (layout !== "paper") setShowNavChart(false)
  }, [layout])

  useEffect(() => {
    if (!open || layout !== "paper") {
      if (!open) awBootRef.current = false
      return
    }
    if (awBootRef.current) return
    awBootRef.current = true
    void paper.loadAllWeather(false).then((sym) => {
      if (sym) {
        setSymbol(sym)
        setQuery(sym)
      }
    })
  }, [open, layout, paper.loadAllWeather])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (paper.awConfirm) {
        paper.dismissAwConfirm()
        return
      }
      if (showNavChart) {
        setShowNavChart(false)
        return
      }
      onClose()
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, paper.awConfirm, paper.dismissAwConfirm, showNavChart])

  const watchKeyRef = useRef("")
  useEffect(() => {
    if (!onWatchSymbols) return
    if (!open) {
      if (watchKeyRef.current) {
        watchKeyRef.current = ""
        onWatchSymbols([])
      }
      return
    }
    const next = [
      ...paper.state.products.map((item) => item.symbol),
      ...paper.state.positions.filter((item) => item.status === "open").map((item) => item.symbol),
      symbol,
    ]
      .map((item) => String(item || "").toUpperCase())
      .filter((item) => /^[A-Z]{1,3}\d{3,4}$/.test(item))
    const unique = [...new Set(next)]
    const key = unique.slice().sort().join(",")
    if (key === watchKeyRef.current) return
    watchKeyRef.current = key
    onWatchSymbols(unique)
  }, [open, onWatchSymbols, paper.state.products, paper.state.positions, symbol])

  const product = productOfSymbol(symbol)
  const live1m = candles[symbol] || []
  const { candles: tfCandles, quote: klineQuote } = useSymbolKline(symbol || null, interval, live1m, quotes[symbol])
  const quote = klineQuote || quotes[symbol]
  const meta = INDEX_FUTURES.find((item) => item.product === product)
  const quotesForMark = useMemo(() => {
    if (!symbol || !klineQuote) return quotes
    const overlaid = overlaySinaQuote(symbol, quotes[symbol], klineQuote)
    if (!overlaid || overlaid === quotes[symbol]) return quotes
    return { ...quotes, [symbol]: overlaid }
  }, [symbol, quotes, klineQuote])
  const last = markPrice(symbol, quotesForMark, candles, paper.extraMarks)
  const base = quote?.pre_settlement || quote?.pre_close || null
  const diff = last != null && base ? last - base : null
  const pct = diff != null && base ? (diff / base) * 100 : null

  const listedSymbols = useMemo(() => {
    const extra = paper.state.products.map((p) => p.symbol)
    return [...new Set([...symbols, ...extra])]
  }, [symbols, paper.state.products])

  const orderMarks = useMemo(() => {
    if (!symbol) return []
    const fromPaper = marksFromPositions(paper.state.positions, symbol, paper.selectedPortfolioId)
    const fromAw =
      paper.selectedPortfolioId === ALL_WEATHER_PORTFOLIO_ID
        ? marksFromAllWeatherTrades(paper.awMeta?.trades, symbol)
        : []
    return mergeOrderMarks(fromAw, fromPaper)
  }, [symbol, paper.state.positions, paper.selectedPortfolioId, paper.awMeta?.trades])

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return listedSymbols.slice(0, 16)
    return listedSymbols.filter((s) => s.toUpperCase().includes(q)).slice(0, 16)
  }, [query, listedSymbols])

  function commit(raw: string) {
    const resolved = resolveSymbolInput(raw, listedSymbols, quotes)
    if (!resolved) return
    setSymbol(resolved)
    setQuery(resolved)
  }

  function focusChart(raw: string) {
    commit(raw)
    setChartMode("single")
  }

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#131722] text-[#d1d4dc]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#2a2e39] px-3">
        <div className="relative min-w-[220px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              if (layout === "paper") focusChart(query)
              else commit(query)
            }}
            placeholder="输入合约 IH2609 / IF / 上证50"
            list="pro-trading-symbols"
            className="h-8 w-full rounded border border-[#2a2e39] bg-[#1e222d] px-2 font-mono text-sm text-white outline-none focus:border-[#4c84ff]"
          />
          <datalist id="pro-trading-symbols">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="flex gap-1">
          {INDEX_FUTURES.map((item) => (
            <button
              key={item.product}
              type="button"
              onClick={() => {
                const picked = pickMostActiveContract(symbols, item.product, quotes)
                if (picked) {
                  if (layout === "paper") focusChart(picked)
                  else commit(picked)
                }
              }}
              className={cn(
                "rounded px-2 py-1 text-xs",
                product === item.product ? "bg-[#4c84ff] text-white" : "bg-[#1e222d] text-[#adb3bd] hover:text-white",
              )}
            >
              {item.product}
            </button>
          ))}
        </div>
        <TimeframeSelect value={interval} onChange={setInterval} dark className="max-w-[420px]" />
        <div className="flex shrink-0 items-center overflow-hidden rounded border border-[#2a2e39]">
          <button
            type="button"
            title="放大"
            onClick={() => klineRef.current?.zoomIn()}
            className="inline-flex h-7 items-center gap-1 px-2 text-[11px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
          >
            <ZoomIn className="size-3.5" />
            放大
          </button>
          <button
            type="button"
            title="缩小"
            onClick={() => klineRef.current?.zoomOut()}
            className="inline-flex h-7 items-center gap-1 border-l border-[#2a2e39] px-2 text-[11px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
          >
            <ZoomOut className="size-3.5" />
            缩小
          </button>
          <button
            type="button"
            title="复位"
            onClick={() => klineRef.current?.resetZoom()}
            className="inline-flex h-7 items-center gap-1 border-l border-[#2a2e39] px-2 text-[11px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
          >
            <RotateCcw className="size-3.5" />
            复位
          </button>
        </div>
        {layout === "paper" ? (
          <>
          <button
            type="button"
            title={chartMode === "sleeves" ? "当前四图，点击品种可放大单图" : "返回袖套四图"}
            onClick={() => {
              if (showNavChart) {
                setShowNavChart(false)
                setChartMode("sleeves")
                return
              }
              setChartMode((mode) => (mode === "sleeves" ? "single" : "sleeves"))
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px]",
              chartMode === "sleeves" && !showNavChart
                ? "border-[#4c84ff] bg-[#4c84ff] text-white"
                : "border-[#2a2e39] bg-[#1e222d] text-[#adb3bd] hover:text-white",
            )}
          >
            <LayoutGrid className="size-3.5" />
            {chartMode === "sleeves" ? "四图" : "单图"}
          </button>
          <button
            type="button"
            title={showNavChart ? "返回K线" : "显示净值曲线"}
            onClick={() => setShowNavChart((open) => !open)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px]",
              showNavChart
                ? "border-[#4c84ff] bg-[#4c84ff] text-white"
                : "border-[#2a2e39] bg-[#1e222d] text-[#adb3bd] hover:text-white",
            )}
          >
            <LineChart className="size-3.5" />
            净值曲线
          </button>
          </>
        ) : null}
        <div className="min-w-0 flex-1 font-medium">
          <span className="font-mono text-white">{symbol || "--"}</span>
          {meta ? <span className="ml-2 text-xs text-[#787b86]">{meta.name}</span> : null}
        </div>
        <div className="text-right tabular-nums">
          <span className={cn("text-lg font-semibold", diff == null ? "text-[#787b86]" : diff >= 0 ? "text-[#ef5350]" : "text-[#26a69a]")}>
            {fmt(last)}
          </span>
          <span className={cn("ml-2 text-xs", diff == null ? "text-[#787b86]" : diff >= 0 ? "text-[#ef5350]" : "text-[#26a69a]")}>
            {diff == null ? "" : `${diff >= 0 ? "+" : ""}${fmt(diff)} ${pct != null ? `${pct >= 0 ? "+" : ""}${fmt(pct, 2)}%` : ""}`}
          </span>
        </div>
        <div className="flex shrink-0 rounded border border-[#2a2e39] p-0.5">
          {(
            [
              ["market", "行情分析"],
              ["paper", "策略模拟"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLayout(id)}
              className={cn(
                "rounded px-2.5 py-1 text-xs",
                layout === id ? "bg-[#4c84ff] text-white" : "text-[#adb3bd] hover:text-white",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="border-[#2a2e39] bg-[#1e222d] text-[#d1d4dc] hover:bg-[#2a2e39]" onClick={onClose}>
          <Minimize2 className="size-3.5" />
          退出专业交易
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {layout === "market" ? (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={74} minSize={48}>
              {symbol ? (
                <KlineProChart ref={klineRef} symbol={symbol} interval={interval} candles={tfCandles} marks={orderMarks} activeTool={tool} onTool={setTool} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[#787b86]">输入或选择一个合约</div>
              )}
            </ResizablePanel>
            <ResizableHandle className="w-1 bg-[#2a2e39]" />
            <ResizablePanel defaultSize={26} minSize={18}>
              <ResizablePanelGroup direction="vertical">
                <ResizablePanel defaultSize={50} minSize={22}>
                  {product ? (
                    <IndexBasisRateChart
                      variant="pro"
                      title={meta?.name || product}
                      product={product}
                      symbol={symbol}
                      candles={interval === "1m" ? tfCandles : live1m}
                      quote={quote}
                      spot={spots[product]}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[#787b86]">基差率</div>
                  )}
                </ResizablePanel>
                <ResizableHandle className="h-1 bg-[#2a2e39]" />
                <ResizablePanel defaultSize={50} minSize={22}>
                  {product ? (
                    <IndexIvChart variant="pro" title={meta?.name || product} product={product} iv={iv[product]} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[#787b86]">隐含波动率</div>
                  )}
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={76} minSize={48}>
              <ResizablePanelGroup direction="horizontal" autoSaveId="paper-charts-v2">
                <ResizablePanel defaultSize={16} minSize={12}>
                  <ResizablePanelGroup direction="vertical">
                    <ResizablePanel defaultSize={56} minSize={28}>
                      <QuoteBoard symbol={symbol} quote={quote} lastPrice={last} />
                    </ResizablePanel>
                    <ResizableHandle className="h-1 bg-[#2a2e39]" />
                    <ResizablePanel defaultSize={44} minSize={26}>
                      <PaperStrategyBuilder
                        paper={paper}
                        symbols={listedSymbols}
                        quotes={quotesForMark}
                        chartSymbol={symbol}
                        lastPrice={last}
                        onSelectSymbol={commit}
                      />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>
                <ResizableHandle className="w-1 bg-[#2a2e39]" />
                <ResizablePanel defaultSize={62} minSize={40}>
                  {showNavChart ? (
                    <PaperNavChart
                      paper={paper}
                      interval={interval}
                      quotes={quotesForMark}
                      candles={candles}
                      onClose={() => setShowNavChart(false)}
                    />
                  ) : chartMode === "single" && symbol ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="flex shrink-0 items-center justify-between border-b border-[#2a2e39] bg-[#1e222d] px-2 py-1">
                        <span className="font-mono text-[11px] text-white">{symbol}</span>
                        <button
                          type="button"
                          onClick={() => setChartMode("sleeves")}
                          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
                        >
                          <LayoutGrid className="size-3.5" />
                          返回四图
                        </button>
                      </div>
                      <div className="min-h-0 flex-1">
                        <KlineProChart
                          ref={klineRef}
                          symbol={symbol}
                          interval={interval}
                          candles={tfCandles}
                          marks={orderMarks}
                          activeTool={tool}
                          onTool={setTool}
                        />
                      </div>
                    </div>
                  ) : (
                    <SleeveKlineGrid
                      ref={klineRef}
                      paper={paper}
                        quotes={quotesForMark}
                      candles={candles}
                      interval={interval}
                      selectedSymbol={symbol}
                      onSelectSymbol={focusChart}
                    />
                  )}
                </ResizablePanel>
                <ResizableHandle className="w-1 bg-[#2a2e39]" />
                <ResizablePanel defaultSize={22} minSize={16}>
                  <PaperPortfolioPanel
                    paper={paper}
                    symbols={listedSymbols}
                        quotes={quotesForMark}
                    chartSymbol={symbol}
                    onSelectSymbol={focusChart}
                    showNavChart={showNavChart}
                    onToggleNavChart={() => setShowNavChart((open) => !open)}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle className="h-1 bg-[#2a2e39]" />
            <ResizablePanel defaultSize={24} minSize={12}>
              <PaperPositionsBar
                paper={paper}
                chartSymbol={symbol}
                onSelectSymbol={focusChart}
                showNavChart={showNavChart}
                onToggleNavChart={() => setShowNavChart((open) => !open)}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      <PaperAllWeatherOrderDialog paper={paper} />
    </div>,
    document.body,
  )
}

export function ProTradingEnterButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Maximize2 className="size-3.5" />
      专业交易模式
    </Button>
  )
}

export function PaperTradingEnterButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Bot className="size-3.5" />
      策略模拟
    </Button>
  )
}
