/**
 * Daily at-the-money IV from Sina option closes.
 * Sina still lists a contract for a while after expiry, so the rolling front
 * month can be rebuilt for those months. Older expired months are gone.
 */

import { query } from "@/lib/db"
import type { IndexProduct } from "@/lib/client/ctp-market"
import type { OverlayPoint } from "@/lib/client/realtime-overlay"
import { INDEX_IV } from "@/lib/client/realtime-overlay"
import { buildAtmDailyBars, sseEtfExpiryDay, type AtmDailyPoint, type AtmMonthBook, type DayClose } from "@/lib/etf-atm-daily"
import { mapLimit } from "@/lib/server/option-minute-types"
import { chinaWallToUnix, SINA_UA } from "@/lib/server/sina-fetch"

const OPTION_API = "https://stock.finance.sina.com.cn/futures/api/openapi.php"
const OPTION_REFERER = "https://stock.finance.sina.com.cn/option/quotes.html"
const DAYLINE = "https://stock.finance.sina.com.cn/futures/api/jsonp_v2.php/cb/StockOptionDaylineService.getSymbolInfo"

const ETF = {
  "50etf": { cate: "50ETF", listed: "510050", spot: "sh510050" },
  "300etf": { cate: "300ETF", listed: "510300", spot: "sh510300" },
  "500etf": { cate: "500ETF", listed: "510500", spot: "sh510500" },
} as const

type EtfKey = keyof typeof ETF

export type AtmDailyMonth = { id: string; label: string; expireDay: string }

export type AtmDailySeries = {
  bars: OverlayPoint[]
  months: AtmDailyMonth[]
  contract: string | null
  source: string | null
  month: string | null
}

type Book = {
  at: number
  spot: DayClose[]
  months: AtmMonthBook[]
  listed: string
}

const bookCache = new Map<string, Book>()
const dayCache = new Map<string, { at: number; rows: DayClose[] }>()
const BOOK_TTL_MS = 15 * 60_000
const DAY_TTL_MS = 15 * 60_000

function num(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

async function getText(url: string, referer: string) {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": SINA_UA, Referer: referer },
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

function prevYymm(yymm: string) {
  let year = 2000 + Number(yymm.slice(0, 2))
  let month = Number(yymm.slice(2)) - 1
  if (month < 1) {
    month = 12
    year -= 1
  }
  return `${String(year).slice(2)}${String(month).padStart(2, "0")}`
}

function monthLabel(yymm: string) {
  return `${Number(yymm.slice(2))}月 ${yymm}`
}

async function listedYymms(cate: string) {
  const text = await getText(
    `${OPTION_API}/StockOptionService.getStockName?exchange=null&cate=${encodeURIComponent(cate)}`,
    OPTION_REFERER,
  )
  const months = ((JSON.parse(text) as { result?: { data?: { contractMonth?: string[] } } }).result?.data?.contractMonth || [])
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .map((month) => month.replace("-", "").slice(2))
  return [...new Set(months)].sort()
}

async function hasChain(listed: string, yymm: string) {
  const text = await getText(`https://hq.sinajs.cn/list=OP_UP_${listed}${yymm}`, OPTION_REFERER)
  return optionCodes(text).length > 0
}

/** Current months, plus recently expired ones Sina has not dropped yet. */
async function monthCodes(cate: string, listed: string) {
  const current = await listedYymms(cate)
  const found = new Set(current)
  const front = current[0]
  if (!front) return []
  let cursor = prevYymm(front)
  let misses = 0
  for (let i = 0; i < 8 && misses < 2; i += 1) {
    if (found.has(cursor)) {
      cursor = prevYymm(cursor)
      continue
    }
    const ok = await hasChain(listed, cursor).catch(() => false)
    if (ok) {
      found.add(cursor)
      misses = 0
    } else {
      misses += 1
    }
    cursor = prevYymm(cursor)
  }
  return [...found].sort()
}

async function strikeCodes(listed: string, yymm: string, side: "UP" | "DOWN") {
  const text = await getText(`https://hq.sinajs.cn/list=OP_${side}_${listed}${yymm}`, OPTION_REFERER)
  const codes = optionCodes(text)
  const strikes = new Map<string, number>()
  for (let i = 0; i < codes.length; i += 40) {
    const batch = codes.slice(i, i + 40)
    const book = await getText(`https://hq.sinajs.cn/list=${batch.map((code) => `CON_OP_${code}`).join(",")}`, OPTION_REFERER)
    for (const line of book.split(";")) {
      const codeMatch = line.match(/CON_OP_(\d+)/)
      if (!codeMatch) continue
      const strike = num(quoted(line).split(",")[7])
      if (strike != null && strike > 0) strikes.set(codeMatch[1], strike)
    }
  }
  return strikes
}

async function dayline(code: string): Promise<DayClose[]> {
  const hit = dayCache.get(code)
  if (hit && Date.now() - hit.at < DAY_TTL_MS) return hit.rows
  const text = await getText(`${DAYLINE}?symbol=CON_OP_${code}`, OPTION_REFERER)
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start < 0 || end < start) return []
  const rows = JSON.parse(text.slice(start, end + 1)) as Array<{ d?: string; c?: string }>
  const out: DayClose[] = []
  for (const row of rows) {
    const date = String(row.d || "")
    const close = num(row.c)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null || !(close > 0)) continue
    out.push({ date, close })
  }
  if (out.length) dayCache.set(code, { at: Date.now(), rows: out })
  return out
}

async function spotDaily(symbol: string): Promise<DayClose[]> {
  const text = await getText(
    `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=400`,
    "https://finance.sina.com.cn/",
  )
  if (!text || text === "null") return []
  const rows = JSON.parse(text) as Array<{ day?: string; close?: string }>
  const out: DayClose[] = []
  for (const row of rows) {
    const date = String(row.day || "").slice(0, 10)
    const close = num(row.close)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null || !(close > 0)) continue
    out.push({ date, close })
  }
  return out
}

function inBand(strike: number, lo: number, hi: number) {
  return strike >= lo && strike <= hi
}

async function loadBook(key: EtfKey): Promise<Book> {
  const hit = bookCache.get(key)
  if (hit && Date.now() - hit.at < BOOK_TTL_MS) return hit
  const cfg = ETF[key]
  const [yymms, spot] = await Promise.all([monthCodes(cfg.cate, cfg.listed), spotDaily(cfg.spot)])
  const recent = spot.slice(-120)
  const lo = recent.length ? Math.min(...recent.map((row) => row.close)) * 0.92 : 0
  const hi = recent.length ? Math.max(...recent.map((row) => row.close)) * 1.08 : Infinity
  const months: AtmMonthBook[] = []
  for (const yymm of yymms) {
    const expireDay = sseEtfExpiryDay(yymm)
    if (!expireDay) continue
    const [calls, puts] = await Promise.all([
      strikeCodes(cfg.listed, yymm, "UP").catch(() => new Map<string, number>()),
      strikeCodes(cfg.listed, yymm, "DOWN").catch(() => new Map<string, number>()),
    ])
    const byStrike = new Map<number, { call?: string; put?: string }>()
    for (const [code, strike] of calls) {
      if (!inBand(strike, lo, hi)) continue
      const pair = byStrike.get(strike) || {}
      pair.call = code
      byStrike.set(strike, pair)
    }
    for (const [code, strike] of puts) {
      if (!inBand(strike, lo, hi)) continue
      const pair = byStrike.get(strike) || {}
      pair.put = code
      byStrike.set(strike, pair)
    }
    const center = recent.length
      ? (Math.min(...recent.map((row) => row.close)) + Math.max(...recent.map((row) => row.close))) / 2
      : 0
    const pairs = [...byStrike.entries()]
      .filter((entry) => entry[1].call && entry[1].put)
      .sort((a, b) => Math.abs(a[0] - center) - Math.abs(b[0] - center))
      .slice(0, 24)
    const loaded = await mapLimit(pairs, 6, async ([strike, pair]) => {
      const [call, put] = await Promise.all([
        dayline(pair.call!).catch(() => [] as DayClose[]),
        dayline(pair.put!).catch(() => [] as DayClose[]),
      ])
      return { strike, call, put }
    })
    months.push({
      yymm,
      expireDay,
      strikes: loaded.filter((item) => item.call.length > 0 && item.put.length > 0),
    })
  }
  const book: Book = { at: Date.now(), spot, months: months.filter((item) => item.strikes.length > 0), listed: cfg.listed }
  bookCache.set(key, book)
  return book
}

async function choiceAtm(listed: string): Promise<AtmDailyPoint[]> {
  const rows = await query<{ trade_date: string; yymm: string | null; strike: string | null; close: string }>(
    `SELECT trade_date::text AS trade_date, yymm, strike::float8::text AS strike, close::float8::text AS close
     FROM public.raw_etf_atm_iv_daily
     WHERE underlying = $1
     ORDER BY trade_date`,
    [listed],
  )
  const points: AtmDailyPoint[] = []
  for (const row of rows) {
    const close = Number(row.close)
    const strike = Number(row.strike)
    const date = String(row.trade_date).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0) || !(strike > 0) || !row.yymm) continue
    points.push({ date, close, yymm: row.yymm, strike })
  }
  return points
}

function formatStrike(strike: number) {
  return strike.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function shanghaiNow(now = Date.now()) {
  const shifted = new Date(now + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    dow: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

async function spotLast(symbol: string) {
  const text = await getText(`https://hq.sinajs.cn/list=${symbol}`, "https://finance.sina.com.cn/")
  return num(quoted(text).split(",")[3])
}

/** Latest trade of each strike. Field 2 is the last price on a CON_OP quote. */
async function liveStrikePx(listed: string, yymm: string, side: "UP" | "DOWN") {
  const text = await getText(`https://hq.sinajs.cn/list=OP_${side}_${listed}${yymm}`, OPTION_REFERER)
  const codes = optionCodes(text)
  const lasts = new Map<number, number>()
  for (let i = 0; i < codes.length; i += 40) {
    const batch = codes.slice(i, i + 40)
    const book = await getText(`https://hq.sinajs.cn/list=${batch.map((code) => `CON_OP_${code}`).join(",")}`, OPTION_REFERER)
    for (const line of book.split(";")) {
      const fields = quoted(line).split(",")
      const strike = num(fields[7])
      const last = num(fields[2])
      if (strike != null && strike > 0 && last != null && last > 0) lasts.set(strike, last)
    }
  }
  return lasts
}

/**
 * OpenVlab's daily line ends on the live session, not yesterday's close.
 * Append today's last prices when the daily files have not caught up yet.
 */
async function overlayLiveToday(book: Book, spotSymbol: string, month: string | null, today: string) {
  const active = book.months
    .filter((item) => item.expireDay >= today && (month == null || item.yymm === month))
    .sort((a, b) => a.expireDay.localeCompare(b.expireDay) || a.yymm.localeCompare(b.yymm))[0]
  if (!active) return null
  const [px, calls, puts] = await Promise.all([
    spotLast(spotSymbol),
    liveStrikePx(book.listed, active.yymm, "UP"),
    liveStrikePx(book.listed, active.yymm, "DOWN"),
  ])
  if (px == null || !(px > 0) || calls.size === 0 || puts.size === 0) return null
  return {
    spot: [...book.spot.filter((row) => row.date !== today), { date: today, close: px }],
    months: book.months.map((item) => {
      if (item.yymm !== active.yymm) return item
      return {
        ...item,
        strikes: item.strikes.map((strike) => {
          const call = calls.get(strike.strike)
          const put = puts.get(strike.strike)
          if (call == null || put == null) return strike
          return {
            ...strike,
            call: [...strike.call.filter((row) => row.date !== today), { date: today, close: call }],
            put: [...strike.put.filter((row) => row.date !== today), { date: today, close: put }],
          }
        }),
      }
    }),
  }
}

export async function fetchIndexAtmDaily(product: IndexProduct, atmMonth: string | null): Promise<AtmDailySeries> {
  const key = INDEX_IV[product].key
  if (!(key in ETF)) {
    return { bars: [], months: [], contract: null, source: null, month: null }
  }
  const month = atmMonth && /^\d{4}$/.test(atmMonth) ? atmMonth : null
  const book = await loadBook(key as EtfKey)
  const clock = shanghaiNow()
  let spot = book.spot
  let monthsBook = book.months
  const lastDate = [...spot].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date || ""
  if (clock.dow !== 0 && clock.dow !== 6 && clock.minutes >= 9 * 60 + 30 && lastDate < clock.date) {
    const cfg = ETF[key as EtfKey]
    const live = await overlayLiveToday(book, cfg.spot, month, clock.date).catch(() => null)
    if (live) {
      spot = live.spot
      monthsBook = live.months
    }
  }
  let points = buildAtmDailyBars({ spot, months: monthsBook, month })
  let usedChoice = false
  if (month == null) {
    const choice = await choiceAtm(ETF[key as EtfKey].listed).catch(() => [])
    if (choice.length) {
      const byDate = new Map(points.map((point) => [point.date, point]))
      for (const point of choice) byDate.set(point.date, point)
      points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
      usedChoice = true
    }
  }
  const months: AtmDailyMonth[] = book.months
    .map((item) => ({ id: item.yymm, label: monthLabel(item.yymm), expireDay: item.expireDay }))
    .sort((a, b) => a.expireDay.localeCompare(b.expireDay))
  const last = points.at(-1)
  const contract = last
    ? `${book.listed}购${last.yymm}-${formatStrike(last.strike)} / ${book.listed}沽${last.yymm}-${formatStrike(last.strike)}`
    : null
  return {
    bars: points.flatMap((point) => {
      const time = chinaWallToUnix(`${point.date} 15:00:00`)
      return time == null ? [] : [{ time, close: point.close }]
    }),
    months,
    contract,
    source: usedChoice ? `emquant-atm:${key}` : `sina-atm-daily:${key}`,
    month,
  }
}
