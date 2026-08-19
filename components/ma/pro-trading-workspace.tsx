"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Maximize2, Minimize2 } from "lucide-react"

import { IndexBasisRateChart } from "@/components/ma/index-basis-rate-chart"
import { IndexIvChart } from "@/components/ma/index-iv-chart"
import { KlineProChart } from "@/components/ma/kline-pro-chart"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
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

type Props = {
  open: boolean
  onClose: () => void
  symbols: string[]
  quotes: Record<string, CtpTick>
  candles: Record<string, CtpCandle[]>
  spots: Record<string, SpotSnapshot>
  iv: Record<string, IvSnapshot>
  initialSymbol: string | null
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
}: Props) {
  const [symbol, setSymbol] = useState(initialSymbol || "")
  const [query, setQuery] = useState(initialSymbol || "")
  const [tool, setTool] = useState("cross")
  const [interval, setInterval] = useState<TimeframeId>("1m")
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const next = initialSymbol || ""
    setSymbol(next)
    setQuery(next)
  }, [open, initialSymbol])

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
  const { candles: tfCandles } = useSymbolKline(symbol || null, interval, candles[symbol] || [], quote)
  const meta = INDEX_FUTURES.find((item) => item.product === product)
  const last = quote?.last ?? candles[symbol]?.at(-1)?.close ?? null
  const base = quote?.pre_settlement || quote?.pre_close || null
  const diff = last != null && base ? last - base : null
  const pct = diff != null && base ? (diff / base) * 100 : null

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return symbols.slice(0, 12)
    return symbols.filter((s) => s.toUpperCase().includes(q)).slice(0, 12)
  }, [query, symbols])

  function commit(raw: string) {
    const resolved = resolveSymbolInput(raw, symbols, quotes)
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
        <Button size="sm" variant="outline" className="border-[#2a2e39] bg-[#1e222d] text-[#d1d4dc] hover:bg-[#2a2e39]" onClick={onClose}>
          <Minimize2 className="size-3.5" />
          退出专业交易
        </Button>
      </header>
      <div className="min-h-0 flex-1">
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
                    candles={candles[symbol] || []}
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
