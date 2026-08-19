"use client"

import { useEffect, useMemo, useState } from "react"

import { IndexBasisRateChart } from "@/components/ma/index-basis-rate-chart"
import { IndexFuturesCandleChart } from "@/components/ma/index-futures-candle-chart"
import { IndexIvChart } from "@/components/ma/index-iv-chart"
import { ProTradingEnterButton, ProTradingWorkspace } from "@/components/ma/pro-trading-workspace"
import { useCtpIndexFuturesFeed } from "@/hooks/use-ctp-index-futures-feed"
import { useRealtimeOverlayFeed } from "@/hooks/use-realtime-overlay-feed"
import {
  INDEX_FUTURES,
  contractsForProduct,
  pickMostActiveContract,
} from "@/lib/client/ctp-market"
import { cn } from "@/lib/utils"

export default function RealtimeQuotesPage() {
  const { status, error, symbols, quotes, candles } = useCtpIndexFuturesFeed()
  const overlay = useRealtimeOverlayFeed()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [manual, setManual] = useState<Record<string, true>>({})
  const [proOpen, setProOpen] = useState(false)

  const indexSymbols = useMemo(() => {
    const fromStatus = status?.index_symbols || []
    const merged = new Set([...fromStatus, ...symbols, ...Object.keys(candles), ...Object.keys(quotes)])
    return [...merged]
  }, [status?.index_symbols, symbols, candles, quotes])

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

  const live = !!status?.logged_in && !error

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">实时行情</h1>
          <p className="mt-2 text-muted-foreground">
            股指期货 1 分钟 K 线、年化基差率、隐含波动率（IH / IF / IC / IM）。期货来自服务端
            SimNow CTP，现货与 QVIX 为实时行情。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProTradingEnterButton onClick={() => setProOpen(true)} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                live ? "bg-emerald-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500",
              )}
            />
            <span className="max-w-xl text-right">
              {error
                ? error
                : status?.logged_in
                  ? `已连接 · ${status.profile || "ctp"} · ${status.message || "live"}`
                  : status?.message || "连接中…"}
              {status?.tick_count != null ? ` · ${status.tick_count} ticks` : ""}
              {overlay.error ? ` · 现货/IV: ${overlay.error}` : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => {
          const symbol = selected[item.product] || null
          return (
            <IndexFuturesCandleChart
              key={item.product}
              title={item.name}
              product={item.product}
              symbol={symbol}
              symbols={contractsForProduct(indexSymbols, item.product)}
              candles={symbol ? candles[symbol] || [] : []}
              quote={symbol ? quotes[symbol] : undefined}
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
          所选期货合约最新价对现货指数，按中金所第三周五到期日历年化。1 分钟序列由 CTP K 线与指数分钟线对齐。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => {
          const symbol = selected[item.product] || null
          return (
            <IndexBasisRateChart
              key={`basis-${item.product}`}
              title={item.name}
              product={item.product}
              symbol={symbol}
              candles={symbol ? candles[symbol] || [] : []}
              quote={symbol ? quotes[symbol] : undefined}
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
