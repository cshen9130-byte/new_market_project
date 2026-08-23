"use client"

import { useEffect, useMemo, useState } from "react"

import { IndexBasisContractsTable } from "@/components/ma/index-basis-contracts-table"
import { IndexBasisDiffChart } from "@/components/ma/index-basis-diff-chart"
import { IndexBasisRateChart } from "@/components/ma/index-basis-rate-chart"
import { AshareTurnoverConcentrationChart } from "@/components/ma/ashare-turnover-concentration-chart"
import { ScaleIndexBeatRatioChart } from "@/components/ma/scale-index-beat-ratio-chart"
import { ScaleIndexCrossVolChart } from "@/components/ma/scale-index-cross-vol-chart"
import { ScaleIndexVolChart } from "@/components/ma/scale-index-vol-chart"
import { IndexFuturesCandleChart, type ChartZoomRange } from "@/components/ma/index-futures-candle-chart"
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react"
import { IndexIvChart } from "@/components/ma/index-iv-chart"
import { TimeframeSelect } from "@/components/ma/timeframe-select"
import {
  PaperTradingEnterButton,
  ProTradingEnterButton,
  ProTradingWorkspace,
  type ProTradingLayout,
} from "@/components/ma/pro-trading-workspace"
import { useCffexIndexRealtimeFeed } from "@/hooks/use-cffex-index-realtime-feed"
import { useCffexListedQuotes } from "@/hooks/use-cffex-listed-quotes"
import { useCtpIndexFuturesFeed } from "@/hooks/use-ctp-index-futures-feed"
import { useRealtimeOverlayFeed } from "@/hooks/use-realtime-overlay-feed"
import {
  allListedCffexIndexContracts,
  CFFEX_CONTRACT_ROLES,
  cffexContractForRole,
  type CffexContractRole,
} from "@/lib/client/cffex-expiry"
import {
  INDEX_FUTURES,
  type CtpCandle,
  type CtpTick,
  contractsForProduct,
  mergeCandleSeries,
  pickMostActiveContract,
} from "@/lib/client/ctp-market"
import { isCffexProduct, isCffexSession } from "@/lib/client/market-hours"
import { type TimeframeId } from "@/lib/client/timeframes"
import { cn } from "@/lib/utils"

export default function RealtimeQuotesPage() {
  const ctp = useCtpIndexFuturesFeed()
  const cffex = useCffexIndexRealtimeFeed()
  const listed = useCffexListedQuotes()
  const overlay = useRealtimeOverlayFeed()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [manual, setManual] = useState<Record<string, true>>({})
  const [proOpen, setProOpen] = useState(false)
  const [proLayout, setProLayout] = useState<ProTradingLayout>("market")
  const [klineInterval, setKlineInterval] = useState<TimeframeId>("1m")
  const [klineRole, setKlineRole] = useState<CffexContractRole>("near")
  const [klineZoom, setKlineZoom] = useState<ChartZoomRange>({ start: 0, end: 100 })

  function setKlineIntervalAndReset(id: TimeframeId) {
    setKlineInterval(id)
    setKlineZoom({ start: 0, end: 100 })
  }

  function setKlineRoleAndReset(role: CffexContractRole) {
    setKlineRole(role)
    setKlineZoom({ start: 0, end: 100 })
  }

  function zoomKline(direction: "in" | "out") {
    setKlineZoom((prev) => {
      const span = Math.max(1, prev.end - prev.start)
      const nextSpan = direction === "in" ? Math.max(8, span * 0.7) : Math.min(100, span / 0.7)
      let end = prev.end
      let start = end - nextSpan
      if (start < 0) {
        start = 0
        end = Math.min(100, nextSpan)
      }
      return { start, end }
    })
  }
  const [basisInterval, setBasisInterval] = useState<TimeframeId>("1d")
  const [basisRole, setBasisRole] = useState<CffexContractRole>("near")
  const [basisZoom, setBasisZoom] = useState<ChartZoomRange>({ start: 0, end: 100 })

  function setBasisIntervalAndReset(id: TimeframeId) {
    setBasisInterval(id)
    setBasisZoom({ start: 0, end: 100 })
  }

  function setBasisRoleAndReset(role: CffexContractRole) {
    setBasisRole(role)
    setBasisZoom({ start: 0, end: 100 })
  }

  function zoomBasis(direction: "in" | "out") {
    setBasisZoom((prev) => {
      const span = Math.max(1, prev.end - prev.start)
      const nextSpan = direction === "in" ? Math.max(8, span * 0.7) : Math.min(100, span / 0.7)
      let end = prev.end
      let start = end - nextSpan
      if (start < 0) {
        start = 0
        end = Math.min(100, nextSpan)
      }
      return { start, end }
    })
  }

  const quotes = useMemo(() => {
    const next: Record<string, CtpTick> = {}
    for (const src of [listed.quotes, cffex.quotes, ctp.quotes]) {
      for (const [symbol, tick] of Object.entries(src)) {
        const key = symbol.toUpperCase()
        const prev = next[key]
        if (!prev) {
          next[key] = { ...tick, symbol: key }
          continue
        }
        const incomingLast = tick.last != null && tick.last > 0 ? tick.last : null
        const prevLast = prev.last != null && prev.last > 0 ? prev.last : null
        const cffexClosed = isCffexProduct(key) && !isCffexSession()
        next[key] = {
          ...prev,
          ...tick,
          symbol: key,
          last: cffexClosed ? prevLast ?? incomingLast : incomingLast ?? prevLast,
          pre_settlement: tick.pre_settlement ?? prev.pre_settlement,
          pre_close: tick.pre_close ?? prev.pre_close,
        }
      }
    }
    return next
  }, [ctp.quotes, cffex.quotes, listed.quotes])

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
      ...allListedCffexIndexContracts(),
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
          <ProTradingEnterButton
            onClick={() => {
              setProLayout("market")
              setProOpen(true)
            }}
          />
          <PaperTradingEnterButton
            onClick={() => {
              setProLayout("paper")
              setProOpen(true)
            }}
          />
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

      <div>
        <h2 className="text-lg font-semibold tracking-tight">K 线</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          四张 K 线共用下方周期、合约月份与缩放，与年化基差率筛选独立。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">周期</span>
            <TimeframeSelect value={klineInterval} onChange={setKlineIntervalAndReset} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">合约</span>
            <div className="flex flex-wrap gap-0.5">
              {CFFEX_CONTRACT_ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setKlineRoleAndReset(role.id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px]",
                    klineRole === role.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {role.label}
                </button>
              ))}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {INDEX_FUTURES.map((item) => cffexContractForRole(item.product, klineRole)).join(" · ")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">缩放</span>
            <button
              type="button"
              title="放大"
              onClick={() => zoomKline("in")}
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ZoomIn className="h-3.5 w-3.5" />
              放大
            </button>
            <button
              type="button"
              title="缩小"
              onClick={() => zoomKline("out")}
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ZoomOut className="h-3.5 w-3.5" />
              缩小
            </button>
            <button
              type="button"
              title="复位"
              onClick={() => setKlineZoom({ start: 0, end: 100 })}
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              复位
            </button>
          </div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => {
          const symbol = cffexContractForRole(item.product, klineRole)
          return (
            <IndexFuturesCandleChart
              key={item.product}
              title={item.name}
              product={item.product}
              symbol={symbol}
              symbols={contractsForProduct(indexSymbols, item.product)}
              candles={candles[symbol] || []}
              quote={quotes[symbol]}
              interval={klineInterval}
              hideTimeframe
              hideSymbolSelect
              zoom={klineZoom}
              onZoomChange={setKlineZoom}
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
          四张图共用下方周期、合约月份与缩放。近月 / 远月 / 当季 / 下季对应中金所当月、次月、当季、下季合约。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">周期</span>
            <TimeframeSelect value={basisInterval} onChange={setBasisIntervalAndReset} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">合约</span>
            <div className="flex flex-wrap gap-0.5">
              {CFFEX_CONTRACT_ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setBasisRoleAndReset(role.id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px]",
                    basisRole === role.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {role.label}
                </button>
              ))}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {INDEX_FUTURES.map((item) => cffexContractForRole(item.product, basisRole)).join(" · ")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">缩放</span>
            <button
              type="button"
              title="放大"
              onClick={() => zoomBasis("in")}
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ZoomIn className="h-3.5 w-3.5" />
              放大
            </button>
            <button
              type="button"
              title="缩小"
              onClick={() => zoomBasis("out")}
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ZoomOut className="h-3.5 w-3.5" />
              缩小
            </button>
            <button
              type="button"
              title="复位"
              onClick={() => setBasisZoom({ start: 0, end: 100 })}
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              复位
            </button>
          </div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {INDEX_FUTURES.map((item) => {
          const symbol = cffexContractForRole(item.product, basisRole)
          return (
            <IndexBasisRateChart
              key={`basis-${item.product}`}
              title={item.name}
              product={item.product}
              symbol={symbol}
              candles={candles[symbol] || []}
              quote={quotes[symbol]}
              spot={overlay.spots[item.product]}
              interval={basisInterval}
              hideTimeframe
              zoom={basisZoom}
              onZoomChange={setBasisZoom}
            />
          )
        })}
      </div>

      <IndexBasisContractsTable
        quotes={quotes}
        listedQuotes={listed.quotes}
        asOf={listed.asOf}
        spots={overlay.spots}
        selectedRole={basisRole}
        onSelectRole={setBasisRole}
      />

      <IndexBasisDiffChart role={basisRole} quotes={quotes} spots={overlay.spots} />

      <ScaleIndexVolChart />

      <ScaleIndexCrossVolChart />

      <ScaleIndexBeatRatioChart />

      <AshareTurnoverConcentrationChart />

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
        initialLayout={proLayout}
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
