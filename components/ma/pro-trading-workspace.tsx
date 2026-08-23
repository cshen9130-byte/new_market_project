"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Bot, Maximize2, Minimize2 } from "lucide-react"

import { IndexBasisRateChart } from "@/components/ma/index-basis-rate-chart"
import { IndexIvChart } from "@/components/ma/index-iv-chart"
import { KlineProChart } from "@/components/ma/kline-pro-chart"
import {
  PaperPortfolioPanel,
  PaperPositionsBar,
  PaperStrategyBuilder,
} from "@/components/ma/paper-trading-panels"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { usePaperTrading } from "@/hooks/use-paper-trading"
import {
  INDEX_FUTURES,
  type CtpCandle,
  type CtpTick,
  pickMostActiveContract,
} from "@/lib/client/ctp-market"
import { TimeframeSelect } from "@/components/ma/timeframe-select"
import { useSymbolKline } from "@/hooks/use-symbol-kline"
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
}: Props) {
  const [symbol, setSymbol] = useState(initialSymbol || "")
  const [query, setQuery] = useState(initialSymbol || "")
  const [tool, setTool] = useState("cross")
  const [interval, setInterval] = useState<TimeframeId>("1m")
  const [layout, setLayout] = useState<ProTradingLayout>(initialLayout)
  const [mounted, setMounted] = useState(false)
  const paper = usePaperTrading(quotes, candles)
  const awBootRef = useRef(false)

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
    if (!initialSymbol) return
    setSymbol(initialSymbol)
    setQuery(initialSymbol)
  }, [open, initialSymbol, initialLayout])

  useEffect(() => {
    if (!open || layout !== "paper") {
      if (!open) awBootRef.current = false
      return
    }
    if (awBootRef.current) return
    awBootRef.current = true
    void paper.loadAllWeather().then((sym) => {
      if (sym) {
        setSymbol(sym)
        setQuery(sym)
      }
    })
  }, [open, layout, paper.loadAllWeather])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const product = productOfSymbol(symbol)
  const quote = quotes[symbol]
  const live1m = candles[symbol] || []
  const { candles: tfCandles } = useSymbolKline(symbol || null, interval, live1m, quote)
  const meta = INDEX_FUTURES.find((item) => item.product === product)
  const last = quote?.last ?? paper.extraMarks[symbol] ?? candles[symbol]?.at(-1)?.close ?? null
  const base = quote?.pre_settlement || quote?.pre_close || null
  const diff = last != null && base ? last - base : null
  const pct = diff != null && base ? (diff / base) * 100 : null

  const listedSymbols = useMemo(() => {
    const extra = paper.state.products.map((p) => p.symbol)
    return [...new Set([...symbols, ...extra])]
  }, [symbols, paper.state.products])

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

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#131722] text-[#d1d4dc]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#2a2e39] px-3">
        <div className="relative min-w-[220px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(query)
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
                if (picked) commit(picked)
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
                <KlineProChart symbol={symbol} interval={interval} candles={tfCandles} activeTool={tool} onTool={setTool} />
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
              <ResizablePanelGroup direction="horizontal">
                <ResizablePanel defaultSize={22} minSize={16}>
                  <PaperStrategyBuilder
                    paper={paper}
                    symbols={listedSymbols}
                    quotes={quotes}
                    chartSymbol={symbol}
                    lastPrice={last}
                    onSelectSymbol={commit}
                  />
                </ResizablePanel>
                <ResizableHandle className="w-1 bg-[#2a2e39]" />
                <ResizablePanel defaultSize={53} minSize={32}>
                  {symbol ? (
                    <KlineProChart symbol={symbol} interval={interval} candles={tfCandles} activeTool={tool} onTool={setTool} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[#787b86]">输入或选择一个合约</div>
                  )}
                </ResizablePanel>
                <ResizableHandle className="w-1 bg-[#2a2e39]" />
                <ResizablePanel defaultSize={25} minSize={16}>
                  <PaperPortfolioPanel
                    paper={paper}
                    symbols={listedSymbols}
                    quotes={quotes}
                    chartSymbol={symbol}
                    onSelectSymbol={commit}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle className="h-1 bg-[#2a2e39]" />
            <ResizablePanel defaultSize={24} minSize={12}>
              <PaperPositionsBar paper={paper} chartSymbol={symbol} onSelectSymbol={commit} />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
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
