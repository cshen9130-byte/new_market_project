"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { assetFromContract, displayListedName, loadStrategySnapshot } from "@/lib/all-weather/universe"
import { INDEX_FUTURES, type CtpBookLevel, type CtpTick, levelsFromTick } from "@/lib/client/ctp-market"
import { priceDigits } from "@/lib/client/paper-trading"
import { cn } from "@/lib/utils"

type TapeRow = {
  id: number
  time: string
  price: number
  volume: number
  openLots: number
  closeLots: number
  nature: string
  dir: "up" | "down" | "flat"
}

const ASK_LABELS = ["卖五", "卖四", "卖三", "卖二", "卖一"]
const BID_LABELS = ["买一", "买二", "买三", "买四", "买五"]

function chgClass(n: number | null | undefined) {
  if (n == null || n === 0) return "text-[#787b86]"
  return n > 0 ? "text-[#ef5350]" : "text-[#26a69a]"
}

function fmtPx(n: number | null | undefined, symbol?: string) {
  if (n == null || Number.isNaN(n)) return "--"
  const d = (symbol && priceDigits(symbol)) ?? (Math.abs(n) < 200 ? 3 : Math.abs(n) < 5000 ? 1 : 1)
  return n.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtInt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  return Math.round(n).toLocaleString("zh-CN")
}

function fmtVol(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  const abs = Math.abs(n)
  if (abs >= 10_000) return `${(n / 10_000).toFixed(abs >= 100_000 ? 1 : 2)}万`
  return Math.round(n).toLocaleString("zh-CN")
}

function signed(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "--"
  const body = n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (n > 0) return `+${body}`
  return body
}

function quoteTitle(symbol: string) {
  const asset = assetFromContract(symbol)
  if (!asset) return symbol
  if (asset === "IM") return displayListedName("中证1000 IM", symbol)
  const pos = loadStrategySnapshot().positions.find((item) => item.asset === asset)
  if (pos?.label) return displayListedName(pos.label, symbol)
  const fromIndex = INDEX_FUTURES.find((item) => item.product === asset)
  if (fromIndex) return `${fromIndex.name} ${symbol}`
  return symbol
}

function padLevels(levels: CtpBookLevel[] | undefined, count = 5): CtpBookLevel[] {
  const src = (levels || []).slice(0, count)
  while (src.length < count) src.push({ price: null, volume: null })
  return src
}

function inferNature(dVol: number, dOi: number, dir: TapeRow["dir"]) {
  if (dVol <= 0) return dir === "down" ? "空换" : "多换"
  if (dOi > 0 && dOi >= dVol) return "双开"
  if (dOi < 0 && -dOi >= dVol) return "双平"
  if (dOi > 0) return dir === "down" ? "空开" : "多开"
  if (dOi < 0) return dir === "down" ? "多平" : "空平"
  return dir === "down" ? "空换" : "多换"
}

function useTape(symbol: string, quote?: CtpTick) {
  const [rows, setRows] = useState<TapeRow[]>([])
  const [flow, setFlow] = useState({ outer: 0, inner: 0 })
  const prev = useRef<CtpTick | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    prev.current = null
    setRows([])
    setFlow({ outer: 0, inner: 0 })
    seq.current = 0
  }, [symbol])

  useEffect(() => {
    if (!quote) return
    const last = prev.current
    prev.current = quote
    if (!last || quote.last == null) return
    const dVol = (quote.volume ?? 0) - (last.volume ?? 0)
    const dOi = (quote.open_interest ?? 0) - (last.open_interest ?? 0)
    const sameStamp =
      quote.update_time === last.update_time && quote.update_millis === last.update_millis && quote.last === last.last
    if (sameStamp && dVol === 0) return
    if (dVol <= 0 && quote.last === last.last) return
    const dir: TapeRow["dir"] =
      last.last == null || quote.last === last.last ? "flat" : quote.last > last.last ? "up" : "down"
    const volume = dVol > 0 ? dVol : 1
    const openLots = Math.max(0, Math.round(dOi))
    const closeLots = Math.max(0, Math.round(-dOi))
    const time = quote.update_time || "--"
    if (dVol > 0) {
      if (quote.ask != null && quote.last >= quote.ask) setFlow((f) => ({ ...f, outer: f.outer + dVol }))
      else if (quote.bid != null && quote.last <= quote.bid) setFlow((f) => ({ ...f, inner: f.inner + dVol }))
    }
    setRows((cur) => {
      const next: TapeRow = {
        id: ++seq.current,
        time: time.length > 5 ? time.slice(0, 5) : time,
        price: quote.last!,
        volume,
        openLots,
        closeLots,
        nature: inferNature(volume, dOi, dir),
        dir,
      }
      return [next, ...cur].slice(0, 40)
    })
  }, [quote])

  return { rows, flow }
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#787b86]">{label}</span>
      <span className={cn("font-mono tabular-nums", color || "text-[#d1d4dc]")}>{value}</span>
    </div>
  )
}

export function QuoteBoard({
  symbol,
  quote,
  lastPrice,
}: {
  symbol: string
  quote?: CtpTick
  lastPrice: number | null
}) {
  const last = lastPrice ?? quote?.last ?? null
  const base = quote?.pre_settlement || quote?.pre_close || null
  const diff = last != null && base ? last - base : null
  const pct = diff != null && base ? (diff / base) * 100 : null
  const amp =
    quote?.high != null && quote.low != null && base
      ? ((quote.high - quote.low) / base) * 100
      : null
  const oiChg =
    quote?.open_interest != null && quote.pre_open_interest != null
      ? quote.open_interest - quote.pre_open_interest
      : null
  const asks = useMemo(() => padLevels(levelsFromTick(quote, "ask")).reverse(), [quote])
  const bids = useMemo(() => padLevels(levelsFromTick(quote, "bid")), [quote])
  const { rows: tape, flow } = useTape(symbol, quote)
  const lastTape = tape[0]
  const title = symbol ? quoteTitle(symbol) : "--"

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1e222d] text-[11px]">
      <div className="shrink-0 border-b border-[#2a2e39] px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-white">{title}</div>
            <div className="font-mono text-[10px] text-[#787b86]">{symbol || "--"}</div>
          </div>
          <div className="text-right">
            <div className={cn("font-mono text-lg font-semibold leading-none", chgClass(diff))}>{fmtPx(last, symbol)}</div>
            <div className={cn("mt-1 font-mono text-[10px]", chgClass(diff))}>
              {signed(diff, priceDigits(symbol) ?? 2)} {signed(pct, 2)}
              {pct != null ? "%" : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-[#2a2e39] px-3 py-1.5">
        <div className="mb-1 grid grid-cols-[36px_1fr_40px] text-[10px] text-[#787b86]">
          <span />
          <span className="text-right">价格</span>
          <span className="text-right">量</span>
        </div>
        {asks.map((row, i) => (
          <div key={`ask-${i}`} className="grid grid-cols-[36px_1fr_40px] py-0.5">
            <span className="text-[#26a69a]">{ASK_LABELS[i]}</span>
            <span className="text-right font-mono text-[#26a69a]">{fmtPx(row.price, symbol)}</span>
            <span className="text-right font-mono text-[#adb3bd]">{row.volume ? fmtInt(row.volume) : "--"}</span>
          </div>
        ))}
        <div className="my-1 border-t border-[#2a2e39]" />
        {bids.map((row, i) => (
          <div key={`bid-${i}`} className="grid grid-cols-[36px_1fr_40px] py-0.5">
            <span className="text-[#ef5350]">{BID_LABELS[i]}</span>
            <span className="text-right font-mono text-[#ef5350]">{fmtPx(row.price, symbol)}</span>
            <span className="text-right font-mono text-[#adb3bd]">{row.volume ? fmtInt(row.volume) : "--"}</span>
          </div>
        ))}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 border-b border-[#2a2e39] px-3 py-2">
        <Stat label="最新" value={fmtPx(last, symbol)} color={chgClass(diff)} />
        <Stat label="均价" value={fmtPx(quote?.average, symbol)} color={chgClass(diff)} />
        <Stat label="涨跌" value={signed(diff, priceDigits(symbol) ?? 2)} color={chgClass(diff)} />
        <Stat label="振幅" value={amp == null ? "--" : `${amp.toFixed(2)}%`} />
        <Stat label="涨幅" value={pct == null ? "--" : `${signed(pct, 2)}%`} color={chgClass(pct)} />
        <Stat label="今开" value={fmtPx(quote?.open, symbol)} color={chgClass(quote?.open != null && base ? quote.open - base : null)} />
        <Stat label="总手" value={fmtVol(quote?.volume)} />
        <Stat label="最高" value={fmtPx(quote?.high, symbol)} color={chgClass(1)} />
        <Stat label="现手" value={lastTape ? fmtInt(lastTape.volume) : "--"} />
        <Stat label="最低" value={fmtPx(quote?.low, symbol)} color={chgClass(-1)} />
        <Stat label="外盘" value={fmtVol(flow.outer || null)} color="text-[#ef5350]" />
        <Stat label="内盘" value={fmtVol(flow.inner || null)} color="text-[#26a69a]" />
        <Stat label="持仓" value={fmtInt(quote?.open_interest)} />
        <Stat label="结算" value="--" />
        <Stat label="增仓" value={signed(oiChg, 0)} color={chgClass(oiChg)} />
        <Stat label="前结" value={fmtPx(quote?.pre_settlement || quote?.pre_close, symbol)} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 grid grid-cols-[44px_1fr_36px_32px_32px_36px] bg-[#1e222d] px-3 py-1 text-[10px] text-[#787b86]">
          <span>时间</span>
          <span className="text-right">价格</span>
          <span className="text-right">现</span>
          <span className="text-right">开</span>
          <span className="text-right">平</span>
          <span className="text-right">性质</span>
        </div>
        {tape.length === 0 ? (
          <p className="px-3 py-4 text-center text-[#787b86]">等待成交明细</p>
        ) : (
          tape.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[44px_1fr_36px_32px_32px_36px] px-3 py-0.5 font-mono text-[10px]"
            >
              <span className="text-[#adb3bd]">{row.time}</span>
              <span className={cn("text-right", chgClass(row.dir === "up" ? 1 : row.dir === "down" ? -1 : 0))}>
                {row.dir === "up" ? "↑" : row.dir === "down" ? "↓" : ""}
                {fmtPx(row.price, symbol)}
              </span>
              <span className="text-right text-[#d1d4dc]">{fmtInt(row.volume)}</span>
              <span className="text-right text-[#adb3bd]">{row.openLots || ""}</span>
              <span className="text-right text-[#adb3bd]">{row.closeLots || ""}</span>
              <span className={cn("text-right", /开|多/.test(row.nature) && !row.nature.includes("平") ? "text-[#ef5350]" : "text-[#26a69a]")}>
                {row.nature}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
