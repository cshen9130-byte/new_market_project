"use client"

import { IndexFuturesCandleChart } from "@/components/ma/index-futures-candle-chart"
import { useCffexIndexRealtimeFeed } from "@/hooks/use-cffex-index-realtime-feed"
import { INDEX_FUTURES } from "@/lib/client/ctp-market"
import { cn } from "@/lib/utils"

export default function RealtimeQuotesPage() {
  const { error, source, updatedAt, quotes, candles, productSymbol } = useCffexIndexRealtimeFeed()
  const live = !error && Object.keys(candles).length > 0

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">实时行情</h1>
          <p className="mt-2 text-muted-foreground">
            股指期货主力连续 1 分钟 K 线（IH / IF / IC / IM）。OpenCTP 7×24 回放尚未到股指日盘，因此这里用新浪实时行情驱动图表。
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
              : live
                ? `已连接 · ${source === "sina" ? "新浪主力连续" : source}${updatedAt ? ` · ${updatedAt}` : ""}`
                : "连接中…"}
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => {
          const symbol = productSymbol[item.product] || `${item.product}0`
          return (
            <IndexFuturesCandleChart
              key={item.product}
              title={item.name}
              product={item.product}
              symbol={symbol}
              symbols={[symbol]}
              candles={candles[symbol] || []}
              quote={quotes[symbol]}
              onSymbolChange={() => {}}
            />
          )
        })}
      </div>
    </div>
  )
}
