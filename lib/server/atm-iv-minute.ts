import type { OverlayPoint } from "@/lib/client/realtime-overlay"
import { chinaWallToUnix, SINA_UA } from "@/lib/server/sina-fetch"

/**
 * Intraday near-month ATM implied vol from Sina ETF option minute prices.
 * Official QVIX minute files are often blank; this rebuilds a 1-minute line
 * from the live call and put closest to the ETF price.
 */

const OPTION_API = "https://stock.finance.sina.com.cn/futures/api/openapi.php"
const OPTION_REFERER = "https://stock.finance.sina.com.cn/option/quotes.html"
const RATE = 0.018
const CACHE_MS = 15_000

const ETF = {
  "50etf": { cate: "50ETF", underlying: "sh510050", listed: "510050" },
  "300etf": { cate: "300ETF", underlying: "sh510300", listed: "510300" },
  "500etf": { cate: "500ETF", underlying: "sh510500", listed: "510500" },
} as const

type EtfKey = keyof typeof ETF
type Side = "call" | "put"

type MinutePx = { hhmm: string; price: number }

const cache = new Map<string, { at: number; bars: OverlayPoint[] }>()

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x)
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}

function bsPrice(spot: number, strike: number, t: number, sigma: number, side: Side) {
  if (!(t > 0) || !(sigma > 0) || !(spot > 0) || !(strike > 0)) {
    return side === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0)
  }
  const sqrtT = Math.sqrt(t)
  const d1 = (Math.log(spot / strike) + (RATE + 0.5 * sigma * sigma) * t) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const df = Math.exp(-RATE * t)
  if (side === "call") return spot * normCdf(d1) - strike * df * normCdf(d2)
  return strike * df * normCdf(-d2) - spot * normCdf(-d1)
}

function impliedVolPercent(price: number, spot: number, strike: number, t: number, side: Side) {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(t > 0)) return null
  const intrinsic = side === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0)
  if (price < intrinsic * 0.99) return null
  const gap = (sigma: number) => bsPrice(spot, strike, t, sigma, side) - price
  let lo = 1e-4
  let hi = 5
  if (gap(lo) * gap(hi) > 0) return null
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    if (gap(mid) > 0) hi = mid
    else lo = mid
  }
  const pct = ((lo + hi) / 2) * 100
  if (pct < 1 || pct > 150) return null
  return Math.round(pct * 100) / 100
}

async function jsonGet(url: string, referer: string) {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": SINA_UA, Referer: referer },
  })
  if (!res.ok) throw new Error(`sina ${res.status}`)
  return res.text()
}

async function sinaGbk(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": SINA_UA, Referer: "https://stock.finance.sina.com.cn/" },
  })
  if (!res.ok) throw new Error(`sina ${res.status}`)
  const buf = await res.arrayBuffer()
  try {
    return new TextDecoder("gbk").decode(buf)
  } catch {
    return new TextDecoder().decode(buf)
  }
}

function quoted(line: string) {
  const start = line.indexOf('"')
  const end = line.lastIndexOf('"')
  if (start < 0 || end <= start) return ""
  return line.slice(start + 1, end)
}

function optionCodes(text: string) {
  const codes: string[] = []
  for (const part of text.split(",")) {
    const at = part.indexOf("CON_OP_")
    if (at < 0) continue
    const code = part.slice(at + 7).replace(/\D.*$/, "")
    if (code) codes.push(code)
  }
  return codes
}

function hhmmOf(stamp: string) {
  const match = stamp.match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  return `${match[1].padStart(2, "0")}:${match[2]}`
}

async function frontMonth(cate: string) {
  const text = await jsonGet(
    `${OPTION_API}/StockOptionService.getStockName?exchange=null&cate=${encodeURIComponent(cate)}`,
    OPTION_REFERER,
  )
  const months = [
    ...new Set(
      ((JSON.parse(text) as { result?: { data?: { contractMonth?: string[] } } }).result?.data?.contractMonth ||
        []
      ).filter((month) => /^\d{4}-\d{2}$/.test(month)),
    ),
  ]
  let fallback: { yymm: string; expireDay: string } | null = null
  for (const month of months.slice(0, 3)) {
    const remText = await jsonGet(
      `${OPTION_API}/StockOptionService.getRemainderDay?exchange=null&cate=${encodeURIComponent(cate)}&date=${month}`,
      OPTION_REFERER,
    )
    const data = (JSON.parse(remText) as { result?: { data?: { remainderDays?: number; expireDay?: string } } })
      .result?.data
    const days = Number(data?.remainderDays)
    const expireDay = String(data?.expireDay || "")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expireDay) || !Number.isFinite(days) || days < 0) continue
    const picked = { yymm: month.replace("-", "").slice(2), expireDay }
    if (!fallback || days > 0) fallback = picked
    if (days >= 7) return picked
  }
  return fallback
}

async function chainQuotes(listed: string, yymm: string) {
  const [upText, downText] = await Promise.all([
    sinaGbk(`https://hq.sinajs.cn/list=OP_UP_${listed}${yymm}`),
    sinaGbk(`https://hq.sinajs.cn/list=OP_DOWN_${listed}${yymm}`),
  ])
  const calls = optionCodes(upText)
  const puts = optionCodes(downText)
  const ids = [...calls.map((code) => `CON_OP_${code}`), ...puts.map((code) => `CON_OP_${code}`)]
  if (!ids.length) return []
  const book = await sinaGbk(`https://hq.sinajs.cn/list=${ids.join(",")}`)
  const callSet = new Set(calls)
  const rows: Array<{ code: string; side: Side; strike: number; last: number }> = []
  for (const line of book.split(";")) {
    const codeMatch = line.match(/CON_OP_(\d+)/)
    if (!codeMatch) continue
    const fields = quoted(line).split(",")
    const strike = num(fields[7])
    const last = num(fields[2])
    if (strike == null || last == null || !(strike > 0) || !(last > 0)) continue
    rows.push({
      code: codeMatch[1],
      side: callSet.has(codeMatch[1]) ? "call" : "put",
      strike,
      last,
    })
  }
  return rows
}

async function underlyingSpot(symbol: string) {
  const text = await sinaGbk(`https://hq.sinajs.cn/list=${symbol}`)
  const last = num(quoted(text).split(",")[3])
  return last != null && last > 0 ? last : null
}

async function optionMinutes(code: string): Promise<{ date: string | null; points: MinutePx[] }> {
  const text = await jsonGet(
    `${OPTION_API}/StockOptionDaylineService.getOptionMinline?symbol=CON_OP_${code}`,
    OPTION_REFERER,
  )
  const rows =
    (JSON.parse(text) as { result?: { data?: Array<{ i?: string; p?: string; d?: string }> } }).result?.data || []
  let date: string | null = null
  const points: MinutePx[] = []
  for (const row of rows) {
    if (row.d && /^\d{4}-\d{2}-\d{2}$/.test(row.d)) date = row.d
    const hhmm = hhmmOf(String(row.i || ""))
    const price = num(row.p)
    if (!hhmm || price == null || !(price > 0)) continue
    points.push({ hhmm, price })
  }
  return { date, points }
}

async function underlyingMinutes(symbol: string) {
  try {
    const text = await jsonGet(
      `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=1&ma=no&datalen=240`,
      "https://finance.sina.com.cn/",
    )
    if (!text || text === "null") return new Map<string, number>()
    const rows = JSON.parse(text) as Array<{ day?: string; close?: string }>
    const map = new Map<string, number>()
    for (const row of rows) {
      const hhmm = hhmmOf(String(row.day || ""))
      const close = num(row.close)
      if (!hhmm || close == null || !(close > 0)) continue
      map.set(hhmm, close)
    }
    return map
  } catch {
    return new Map<string, number>()
  }
}

function yearFraction(barUnix: number, expireDay: string) {
  const expiry = chinaWallToUnix(`${expireDay} 15:00:00`)
  if (expiry == null) return 7 / 365
  return Math.max(expiry - barUnix, 30 * 60) / (365 * 24 * 3600)
}

function buildBars(
  call: MinutePx[],
  put: MinutePx[],
  spotByMinute: Map<string, number>,
  fallbackSpot: number,
  strike: number,
  expireDay: string,
  date: string,
) {
  const callPx = new Map(call.map((row) => [row.hhmm, row.price]))
  const putPx = new Map(put.map((row) => [row.hhmm, row.price]))
  const stamps = [...new Set([...callPx.keys(), ...putPx.keys()])].sort()
  let spot = fallbackSpot
  const bars: OverlayPoint[] = []
  for (const hhmm of stamps) {
    const quotedSpot = spotByMinute.get(hhmm)
    if (quotedSpot != null) spot = quotedSpot
    const time = chinaWallToUnix(`${date} ${hhmm}:00`)
    if (time == null || !(spot > 0)) continue
    const t = yearFraction(time, expireDay)
    const callIv = callPx.has(hhmm) ? impliedVolPercent(callPx.get(hhmm)!, spot, strike, t, "call") : null
    const putIv = putPx.has(hhmm) ? impliedVolPercent(putPx.get(hhmm)!, spot, strike, t, "put") : null
    const iv =
      callIv != null && putIv != null ? Math.round(((callIv + putIv) / 2) * 100) / 100 : callIv ?? putIv
    if (iv == null) continue
    bars.push({ time, close: iv })
  }
  return bars
}

export async function fetchEtfAtmIvMinutes(key: string): Promise<OverlayPoint[] | null> {
  if (!(key in ETF)) return null
  const today = todayShanghai()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS && hit.bars.length) {
    const last = hit.bars[hit.bars.length - 1]
    const start = chinaWallToUnix(`${today} 00:00:00`)
    if (start != null && last.time >= start) return hit.bars
  }
  try {
    const cfg = ETF[key as EtfKey]
    const month = await frontMonth(cfg.cate)
    if (!month) return hit?.bars ?? null
    const [quotes, spotQuote] = await Promise.all([
      chainQuotes(cfg.listed, month.yymm),
      underlyingSpot(cfg.underlying),
    ])
    const spot0 = spotQuote ?? quotes.find((row) => row.side === "call")?.strike ?? null
    if (spot0 == null) return hit?.bars ?? null
    let best: { strike: number; call: string; put: string; dist: number } | null = null
    const byStrike = new Map<number, { call?: string; put?: string }>()
    for (const row of quotes) {
      const pair = byStrike.get(row.strike) || {}
      pair[row.side] = row.code
      byStrike.set(row.strike, pair)
    }
    for (const [strike, pair] of byStrike) {
      if (!pair.call || !pair.put) continue
      const dist = Math.abs(strike - spot0)
      if (!best || dist < best.dist) best = { strike, call: pair.call, put: pair.put, dist }
    }
    if (!best) return hit?.bars ?? null
    const [callMin, putMin, spotMin] = await Promise.all([
      optionMinutes(best.call),
      optionMinutes(best.put),
      underlyingMinutes(cfg.underlying),
    ])
    const date = callMin.date || putMin.date
    if (date !== today) return hit?.bars?.length ? hit.bars : null
    const bars = buildBars(callMin.points, putMin.points, spotMin, spot0, best.strike, month.expireDay, date)
    if (bars.length < 8) return hit?.bars ?? null
    cache.set(key, { at: Date.now(), bars })
    return bars
  } catch {
    return hit?.bars ?? null
  }
}
