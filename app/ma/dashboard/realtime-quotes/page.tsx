"use client"

import { useEffect, useMemo, useState } from "react"

import { IndexFuturesCandleChart } from "@/components/ma/index-futures-candle-chart"
import { useCtpIndexFuturesFeed } from "@/hooks/use-ctp-index-futures-feed"
import {
  INDEX_FUTURES,
  contractsForProduct,
  pickMostActiveContract,
} from "@/lib/client/ctp-market"
import { cn } from "@/lib/utils"

export default function RealtimeQuotesPage() {
  const { status, error, symbols, quotes, candles } = useCtpIndexFuturesFeed()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [manual, setManual] = useState<Record<string, true>>({})

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
            股指期货 1 分钟 K 线（IH / IF / IC / IM），数据来自服务端 SimNow CTP。
          </p>
        </div>
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
          </span>
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
    </div>
  )
}
