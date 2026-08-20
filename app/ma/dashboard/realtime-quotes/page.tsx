"use client"

import { useEffect, useMemo, useState } from "react"

import { IndexBasisRateChart } from "@/components/ma/index-basis-rate-chart"
import { IndexFuturesCandleChart } from "@/components/ma/index-futures-candle-chart"
import { IndexIvChart } from "@/components/ma/index-iv-chart"
import { ProTradingEnterButton, ProTradingWorkspace } from "@/components/ma/pro-trading-workspace"
import { useCffexIndexRealtimeFeed } from "@/hooks/use-cffex-index-realtime-feed"
import { useCtpIndexFuturesFeed } from "@/hooks/use-ctp-index-futures-feed"
import { useRealtimeOverlayFeed } from "@/hooks/use-realtime-overlay-feed"
import {
  INDEX_FUTURES,
  type CtpCandle,
  type CtpTick,
  contractsForProduct,
  mergeCandleSeries,
  pickMostActiveContract,
} from "@/lib/client/ctp-market"
import { cn } from "@/lib/utils"

export default function RealtimeQuotesPage() {
  const ctp = useCtpIndexFuturesFeed()
  const cffex = useCffexIndexRealtimeFeed()
  const overlay = useRealtimeOverlayFeed()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [manual, setManual] = useState<Record<string, true>>({})
  const [proOpen, setProOpen] = useState(false)

  const quotes = useMemo(() => {
    const next: Record<string, CtpTick> = { ...cffex.quotes }
    for (const [symbol, tick] of Object.entries(ctp.quotes)) next[symbol] = tick
    return next
  }, [ctp.quotes, cffex.quotes])

  const candles = useMemo(() => {
    const next: Record<string, CtpCandle[]> = { ...cffex.candles }
    for (const [symbol, rows] of Object.entries(ctp.candles)) {
      next[symbol] = mergeCandleSeries(next[symbol], rows)
    }
    return next
  }, [ctp.candles, cffex.candles])

  const indexSymbols = useMemo(() => {
    const fromStatus = ctp.status?.index_symbols || []
    const merged = new Set([
      ...fromStatus,
      ...ctp.symbols,
      ...cffex.symbols,
      ...Object.keys(candles),
      ...Object.keys(quotes),
    ])
    return [...merged]
  }, [ctp.status?.index_symbols, ctp.symbols, cffex.symbols, candles, quotes])

  useEffect(() => {
    setSelected((prev) => {
      const next = { ...prev }
      let changed = false
      for (const item of INDEX_FUTURES) {
        if (manual[item.product] && next[item.product] && indexSymbols.includes(next[item.product])) continue
        const picked = pickMostActiveContract(indexSymbols, item.product, quotes)
        if (picked && next[item.product] !== picked) {
          next[item.product] = picked
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [indexSymbols, quotes, manual])

  const ctpLive = !!ctp.status?.logged_in && !ctp.error
  const sinaReady = !cffex.error && cffex.symbols.length > 0
  const usingSina = !ctpLive && sinaReady

  function quoteFor(product: string, symbol: string | null) {
    if (symbol && quotes[symbol]) return quotes[symbol]
    const fallback = cffex.productSymbol[product]
    return fallback ? quotes[fallback] : undefined
  }

  function candlesFor(product: string, symbol: string | null) {
    if (symbol && (candles[symbol]?.length || 0) > 0) return candles[symbol]
    const fallback = cffex.productSymbol[product]
    if (fallback && (candles[fallback]?.length || 0) > 0) return candles[fallback]
    return []
  }

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">实时行情</h1>
          <p className="mt-2 text-muted-foreground">
            股指期货 1 分钟 K 线、年化基差率、隐含波动率（IH / IF / IC / IM）。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProTradingEnterButton onClick={() => setProOpen(true)} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                ctpLive
                  ? "bg-emerald-500 shadow-[0_0_8px_#22c55e]"
                  : usingSina
                    ? "bg-amber-500"
                    : "bg-red-500",
              )}
            />
            <span className="max-w-xl text-right">
              {ctpLive
                ? `已连接 · ${ctp.status?.profile || "ctp"} · ${ctp.status?.message || "live"}`
                : usingSina
                  ? "CTP 未连接 · 图表为新浪分钟线"
                  : ctp.error || cffex.error || ctp.status?.message || "连接中…"}
              {ctp.status?.tick_count != null ? ` · ${ctp.status.tick_count} ticks` : ""}
              {overlay.error ? ` · 现货/IV: ${overlay.error}` : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => {
          const symbol = selected[item.product] || cffex.productSymbol[item.product] || null
          return (
            <IndexFuturesCandleChart
              key={item.product}
              title={item.name}
              product={item.product}
              symbol={symbol}
              symbols={contractsForProduct(indexSymbols, item.product)}
              candles={candlesFor(item.product, symbol)}
              quote={quoteFor(item.product, symbol)}
              onSymbolChange={(value) => {
                setManual((prev) => ({ ...prev, [item.product]: true }))
                setSelected((prev) => ({ ...prev, [item.product]: value }))
              }}
            />
          )
        })}
      </div>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">年化基差率</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          所选期货合约对现货指数的年化基差。连续合约按主力到期日（到期周切换下月），避免临近到期把年化放大到几百。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => {
          const symbol = selected[item.product] || cffex.productSymbol[item.product] || null
          return (
            <IndexBasisRateChart
              key={`basis-${item.product}`}
              title={item.name}
              product={item.product}
              symbol={symbol}
              candles={candlesFor(item.product, symbol)}
              quote={quoteFor(item.product, symbol)}
              spot={overlay.spots[item.product]}
            />
          )
        })}
      </div>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">隐含波动率</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          HO / IO / 500ETF / MO 对应 QVIX（近月 ATM 隐含波动率指数）1 分钟走势。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => (
          <IndexIvChart
            key={`iv-${item.product}`}
            title={item.name}
            product={item.product}
            iv={overlay.iv[item.product]}
          />
        ))}
      </div>

      <ProTradingWorkspace
        open={proOpen}
        onClose={() => setProOpen(false)}
        symbols={indexSymbols}
        quotes={quotes}
        candles={candles}
        spots={overlay.spots}
        iv={overlay.iv}
        initialSymbol={
          selected.IF ||
          selected.IH ||
          selected.IC ||
          selected.IM ||
          pickMostActiveContract(indexSymbols, "IF", quotes) ||
          indexSymbols[0] ||
          null
        }
      />
    </div>
  )
}
