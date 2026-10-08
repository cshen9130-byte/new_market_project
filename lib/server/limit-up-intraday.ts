/**
 * Intraday performance of yesterday's limit-up stocks vs the Shanghai Composite.
 *
 * East Money board BK0815 is 昨日涨停, which leaves out 一字板.
 * BK1050 is the sibling that includes them (昨日涨停_含一字).
 * The published board index is the cap-weighted performance of that basket,
 * plotted as percent change from the previous close, same as the index minute line.
 *
 * push2his often resets the socket from this host. When it does, the index line
 * comes from Tencent's minute feed and the board line is the float-cap-weighted
 * return of the same BK0815 members, using Sina minute bars.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { curlGbk, curlJson } from "@/lib/server/quote-http"

const LIMIT_UP_SECID = "90.BK0815"
const INDEX_SECID = "1.000001"
const CACHE_MS = 15_000
const MEMBER_CACHE = path.join(process.cwd(), "data", "runtime", "limit-up-board.json")
const QUICK = { timeoutSec: 8, attempts: 1 }

export type LimitUpIntradayPoint = {
  time: string
  limitUp: number
  index: number
}

export type LimitUpIntradayPayload = {
  asOf: string | null
  asOfTime: string | null
  points: LimitUpIntradayPoint[]
}

type ParsedTrend = {
  date: string
  points: Array<{ time: string; pct: number }>
}

type Member = { code: string; name: string }
type Quote = { pre: number; open: number; cap: number }

type CacheEntry = { at: number; data: LimitUpIntradayPayload }
let cache: CacheEntry | null = null

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function sinaSymbol(code: string): string {
  if (code.startsWith("6")) return `sh${code}`
  if (code.startsWith("8") || code.startsWith("4") || code.startsWith("92")) return `bj${code}`
  return `sz${code}`
}

function trendsUrl(secid: string): string {
  return (
    "https://push2his.eastmoney.com/api/qt/stock/trends2/get" +
    "?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13" +
    "&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1&secid=" +
    encodeURIComponent(secid)
  )
}

function parseTrends(json: unknown): ParsedTrend | null {
  const data = (json as { data?: { preClose?: number; trends?: unknown } | null } | null)?.data
  if (!data || !Array.isArray(data.trends) || data.trends.length === 0) return null
  const pre = Number(data.preClose)
  if (!Number.isFinite(pre) || pre === 0) return null

  const points: ParsedTrend["points"] = []
  let date = ""
  for (const row of data.trends) {
    const parts = String(row).split(",")
    if (parts.length < 3) continue
    const stamp = parts[0] ?? ""
    const space = stamp.indexOf(" ")
    if (space < 0) continue
    const close = Number(parts[2])
    if (!Number.isFinite(close)) continue
    date = stamp.slice(0, space)
    const time = stamp.slice(space + 1, space + 6)
    if (!/^\d{2}:\d{2}$/.test(time)) continue
    points.push({ time, pct: round2(((close - pre) / pre) * 100) })
  }
  if (!points.length || !date) return null
  return { date, points }
}

async function fetchTrends(secid: string): Promise<ParsedTrend | null> {
  try {
    const json = await curlJson(trendsUrl(secid), "https://quote.eastmoney.com/", QUICK)
    return parseTrends(json)
  } catch {
    return null
  }
}

function readMembers(today: string): Member[] {
  try {
    const json = JSON.parse(readFileSync(MEMBER_CACHE, "utf8")) as { date?: string; members?: Member[] }
    if (json.date === today && Array.isArray(json.members)) {
      return json.members.filter((row) => row.code)
    }
  } catch {
    return []
  }
  return []
}

function parseTencentQuotes(text: string): Map<string, Quote> {
  const out = new Map<string, Quote>()
  for (const line of text.split(";")) {
    const eq = line.indexOf("=")
    if (eq < 0 || !line.includes("~")) continue
    const body = line.slice(eq + 1).trim().replace(/^"/, "").replace(/"$/, "")
    const parts = body.split("~")
    const code = parts[2] ?? ""
    const pre = Number(parts[4])
    const open = Number(parts[5])
    const cap = Number(parts[44])
    if (!code || !Number.isFinite(pre) || pre <= 0) continue
    out.set(code, {
      pre,
      open: Number.isFinite(open) ? open : pre,
      cap: Number.isFinite(cap) && cap > 0 ? cap : 0,
    })
  }
  return out
}

async function loadShanghai(): Promise<ParsedTrend | null> {
  const [minuteJson, quoteText] = await Promise.all([
    curlJson(
      "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query?code=sh000001",
      "https://gu.qq.com/",
    ),
    curlGbk("https://qt.gtimg.cn/q=sh000001", "https://gu.qq.com/"),
  ])
  const pre = parseTencentQuotes(quoteText).get("000001")?.pre
  const rows = (
    minuteJson as { data?: { sh000001?: { data?: { data?: unknown } } } }
  ).data?.sh000001?.data?.data
  if (!pre || !Array.isArray(rows)) return null
  const points: ParsedTrend["points"] = []
  for (const row of rows) {
    const parts = String(row).trim().split(/\s+/)
    if (parts.length < 2 || !/^\d{4}$/.test(parts[0] ?? "")) continue
    const price = Number(parts[1])
    if (!Number.isFinite(price)) continue
    const hhmm = parts[0] ?? ""
    points.push({
      time: `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`,
      pct: round2(((price - pre) / pre) * 100),
    })
  }
  if (!points.length) return null
  return { date: shanghaiToday(), points }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

async function loadMinutes(code: string, today: string): Promise<Map<string, number>> {
  const json = (await curlJson(
    `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sinaSymbol(code)}&scale=1&ma=no&datalen=240`,
    "https://finance.sina.com.cn/",
  )) as Array<{ day?: string; close?: string }>
  const prices = new Map<string, number>()
  if (!Array.isArray(json)) return prices
  const prefix = `${today} `
  for (const row of json) {
    const day = String(row.day ?? "")
    if (!day.startsWith(prefix)) continue
    const close = Number(row.close)
    if (!Number.isFinite(close)) continue
    prices.set(day.slice(11, 16), close)
  }
  return prices
}

async function loadBoard(): Promise<ParsedTrend | null> {
  const today = shanghaiToday()
  const members = readMembers(today)
  if (members.length < 10) return null
  const symbols = members.map((member) => sinaSymbol(member.code)).join(",")
  const quotes = parseTencentQuotes(await curlGbk(`https://qt.gtimg.cn/q=${symbols}`, "https://gu.qq.com/"))
  const minutes = await mapPool(members, 6, async (member) => {
    try {
      return await loadMinutes(member.code, today)
    } catch {
      return new Map<string, number>()
    }
  })

  const holdings: Array<{ pre: number; cap: number; prices: Map<string, number> }> = []
  members.forEach((member, index) => {
    const quote = quotes.get(member.code)
    if (!quote) return
    const prices = minutes[index] ?? new Map<string, number>()
    if (quote.open > 0) prices.set("09:30", quote.open)
    holdings.push({ pre: quote.pre, cap: quote.cap, prices })
  })
  if (holdings.length < Math.ceil(members.length * 0.8)) return null

  const times = new Set<string>()
  for (const holding of holdings) {
    for (const time of holding.prices.keys()) times.add(time)
  }
  const lastPrice = new Map<(typeof holdings)[number], number>()
  const points: ParsedTrend["points"] = []
  for (const time of [...times].sort()) {
    let weighted = 0
    let weight = 0
    for (const holding of holdings) {
      const price = holding.prices.get(time)
      if (price != null) lastPrice.set(holding, price)
      const carried = lastPrice.get(holding)
      if (carried == null) continue
      const w = holding.cap > 0 ? holding.cap : 1
      weighted += w * ((carried - holding.pre) / holding.pre)
      weight += w
    }
    if (!weight) continue
    points.push({ time, pct: round2((weighted / weight) * 100) })
  }
  if (!points.length) return null
  return { date: today, points }
}

function merge(limitUp: ParsedTrend, index: ParsedTrend): LimitUpIntradayPayload {
  const indexByTime = new Map(index.points.map((p) => [p.time, p.pct]))
  const points: LimitUpIntradayPoint[] = []
  for (const point of limitUp.points) {
    const indexPct = indexByTime.get(point.time)
    if (indexPct == null) continue
    points.push({ time: point.time, limitUp: point.pct, index: indexPct })
  }
  const last = points[points.length - 1]
  return {
    asOf: limitUp.date || index.date || null,
    asOfTime: last?.time ?? null,
    points,
  }
}

export async function loadLimitUpIntraday(): Promise<LimitUpIntradayPayload> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.data

  try {
    const [limitUpEm, indexEm] = await Promise.all([fetchTrends(LIMIT_UP_SECID), fetchTrends(INDEX_SECID)])
    const [limitUp, index] = await Promise.all([
      limitUpEm ? Promise.resolve(limitUpEm) : loadBoard(),
      indexEm ? Promise.resolve(indexEm) : loadShanghai(),
    ])
    if (!limitUp || !index) throw new Error("行情源请求失败")
    const data = merge(limitUp, index)
    if (!data.points.length) throw new Error("行情源请求失败")
    cache = { at: now, data }
    return data
  } catch (err) {
    if (cache) return cache.data
    const message = err instanceof Error ? err.message : "加载涨停表现失败"
    throw new Error(message.includes("行情源") ? message : "加载涨停表现失败")
  }
}
