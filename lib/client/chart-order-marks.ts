import type { CtpCandle } from "@/lib/client/ctp-market"
import type { PaperPosition, PaperSide } from "@/lib/client/paper-trading"
import { shanghaiWallUnix, type TimeframeId } from "@/lib/client/timeframes"

export type AllWeatherTradeInput = {
  contract: string
  date: string
  side: string
  price: number
}

export type ChartOrderKind = "open" | "close" | "add" | "cut" | "roll"

export type ChartOrderMark = {
  id: string
  time: number
  price: number
  kind: ChartOrderKind
  side: PaperSide
  text: string
}

const KIND_TEXT: Record<ChartOrderKind, string> = {
  open: "开",
  close: "平",
  add: "加",
  cut: "减",
  roll: "移",
}

const AW_SIDE_KIND: Record<string, ChartOrderKind> = {
  开仓: "open",
  加仓: "add",
  减仓: "cut",
  平仓: "close",
  移仓: "roll",
}

export function ymdToChartUnix(ymd: string, hour = 9, minute = 0) {
  const [y, m, d] = String(ymd || "").split("-").map(Number)
  if (!y || !m || !d) return shanghaiWallUnix()
  return Math.floor(Date.UTC(y, m - 1, d, hour, minute, 0) / 1000)
}

export function isBuyMark(mark: ChartOrderMark) {
  return mark.side === "long" ? mark.kind !== "close" && mark.kind !== "cut" : mark.kind === "close" || mark.kind === "cut"
}

function snapToCandle(time: number, candles: CtpCandle[]) {
  if (!candles.length) return time
  let best = candles[0]
  let bestDist = Math.abs(candles[0].time - time)
  for (const bar of candles) {
    const dist = Math.abs(bar.time - time)
    if (dist < bestDist) {
      best = bar
      bestDist = dist
    }
  }
  return best.time
}

export function snapOrderMarks(marks: ChartOrderMark[], candles: CtpCandle[], _interval?: TimeframeId) {
  return marks
    .filter((mark) => mark.price > 0 && mark.time > 0)
    .map((mark) => ({ ...mark, time: snapToCandle(mark.time, candles) }))
}

function markKey(mark: ChartOrderMark) {
  return `${mark.kind}:${mark.side}:${Math.round(mark.price * 100)}:${Math.floor(mark.time / 3600)}`
}

export function marksFromPositions(positions: PaperPosition[], symbol: string, portfolioId?: string): ChartOrderMark[] {
  const out: ChartOrderMark[] = []
  for (const pos of positions) {
    if (pos.symbol.toUpperCase() !== symbol.toUpperCase()) continue
    if (portfolioId && pos.portfolioId !== portfolioId) continue
    out.push({
      id: `${pos.id}-open`,
      time: shanghaiWallUnix(new Date(pos.entryTime)),
      price: pos.entryPrice,
      kind: "open",
      side: pos.side,
      text: KIND_TEXT.open,
    })
    if (pos.status === "closed" && pos.exitTime && pos.exitPrice) {
      out.push({
        id: `${pos.id}-close`,
        time: shanghaiWallUnix(new Date(pos.exitTime)),
        price: pos.exitPrice,
        kind: "close",
        side: pos.side,
        text: KIND_TEXT.close,
      })
    }
  }
  return out
}

export function marksFromAllWeatherTrades(trades: AllWeatherTradeInput[] | undefined, symbol: string): ChartOrderMark[] {
  const out: ChartOrderMark[] = []
  for (const [index, trade] of (trades || []).entries()) {
    if (trade.contract.toUpperCase() !== symbol.toUpperCase()) continue
    const kind = AW_SIDE_KIND[trade.side] || "open"
    out.push({
      id: `aw-${trade.contract}-${trade.date}-${trade.side}-${index}`,
      time: ymdToChartUnix(trade.date),
      price: trade.price,
      kind,
      side: "long",
      text: KIND_TEXT[kind],
    })
  }
  return out
}

export function mergeOrderMarks(...groups: ChartOrderMark[][]) {
  const seen = new Set<string>()
  const out: ChartOrderMark[] = []
  for (const group of groups) {
    for (const mark of group) {
      const key = markKey(mark)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(mark)
    }
  }
  return out
}
