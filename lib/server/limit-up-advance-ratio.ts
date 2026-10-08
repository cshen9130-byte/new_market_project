/**
 * Share of yesterday's limit-up stocks that are up today.
 *
 * Basket: East Money BK0815 (昨日涨停, already without yesterday's 一字板),
 * then drop names that opened at the limit this morning (盘前一字).
 * 上涨 means the minute price is above the previous close.
 * 09:30 on 2026-10-08 is 25/47 = 53.19%.
 *
 * Minute bars come from Sina. The board membership list comes from East Money,
 * with a same-day file cache because that host drops connections.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { curlGbk, curlJson } from "@/lib/server/quote-http"

const BOARD_URL =
  "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1" +
  "&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f12&fs=b:BK0815&fields=f12,f14"

const MEMBER_CACHE = path.join(process.cwd(), "data", "runtime", "limit-up-board.json")
const CACHE_MS = 20_000

export type LimitUpAdvancePoint = {
  time: string
  ratio: number
}

export type LimitUpAdvancePayload = {
  asOf: string | null
  asOfTime: string | null
  count: number
  points: LimitUpAdvancePoint[]
}

type Member = { code: string; name: string }
type Spot = { open: number; pre: number }
type Bar = { pre: number; yizi: boolean; prices: Map<string, number> }

let cache: { at: number; data: LimitUpAdvancePayload } | null = null

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function sinaSymbol(code: string): string {
  if (code.startsWith("6")) return `sh${code}`
  if (code.startsWith("8") || code.startsWith("4") || code.startsWith("92")) return `bj${code}`
  return `sz${code}`
}

function limitRatio(code: string, name: string): number {
  if (name.toUpperCase().includes("ST")) return 0.05
  if (code.startsWith("300") || code.startsWith("301") || code.startsWith("688") || code.startsWith("689")) return 0.2
  if (code.startsWith("8") || code.startsWith("4") || code.startsWith("92")) return 0.3
  return 0.1
}

function readMemberCache(today: string): Member[] | null {
  try {
    const json = JSON.parse(readFileSync(MEMBER_CACHE, "utf8")) as { date?: string; members?: Member[] }
    if (json.date === today && Array.isArray(json.members) && json.members.length) return json.members
  } catch {
    return null
  }
  return null
}

function writeMemberCache(today: string, members: Member[]) {
  mkdirSync(path.dirname(MEMBER_CACHE), { recursive: true })
  writeFileSync(MEMBER_CACHE, JSON.stringify({ date: today, members }))
}

async function loadMembers(today: string): Promise<Member[]> {
  try {
    const json = (await curlJson(BOARD_URL, "https://quote.eastmoney.com/")) as {
      data?: { diff?: Array<{ f12?: string; f14?: string }> }
    }
    const members = (json.data?.diff ?? [])
      .map((row) => ({ code: String(row.f12 ?? ""), name: String(row.f14 ?? "") }))
      .filter((row) => row.code)
    if (members.length) {
      writeMemberCache(today, members)
      return members
    }
  } catch {
    // East Money often resets the socket. The same-day cache covers that.
  }
  const cached = readMemberCache(today)
  if (cached) return cached
  throw new Error("行情源请求失败")
}

async function loadSpots(members: Member[]): Promise<Map<string, Spot>> {
  const list = members.map((member) => sinaSymbol(member.code)).join(",")
  const text = await curlGbk(`https://hq.sinajs.cn/list=${list}`, "https://finance.sina.com.cn/")
  const spots = new Map<string, Spot>()
  for (const line of text.split(";")) {
    const eq = line.indexOf("=")
    if (eq < 0 || !line.includes("hq_str_")) continue
    const symbol = line.slice(0, eq).trim().split("_").pop() ?? ""
    const code = symbol.slice(2)
    const body = line.slice(eq + 1).trim().replace(/^"/, "").replace(/"$/, "")
    const parts = body.split(",")
    const open = Number(parts[1])
    const pre = Number(parts[2])
    if (!code || !Number.isFinite(open) || !Number.isFinite(pre) || pre <= 0) continue
    spots.set(code, { open, pre })
  }
  return spots
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

function buildPayload(today: string, bars: Bar[]): LimitUpAdvancePayload {
  const tradable = bars.filter((bar) => !bar.yizi)
  const times = new Set<string>()
  for (const bar of tradable) {
    for (const time of bar.prices.keys()) times.add(time)
  }
  const ordered = [...times].sort()
  const lastPrice = new Map<Bar, number>()
  const points: LimitUpAdvancePoint[] = []
  for (const time of ordered) {
    let up = 0
    let total = 0
    for (const bar of tradable) {
      const price = bar.prices.get(time)
      if (price != null) lastPrice.set(bar, price)
      const carried = lastPrice.get(bar)
      if (carried == null) continue
      total += 1
      if (carried > bar.pre) up += 1
    }
    if (!total) continue
    points.push({ time, ratio: Math.round((up / total) * 10000) / 100 })
  }
  const last = points[points.length - 1]
  return {
    asOf: points.length ? today : null,
    asOfTime: last?.time ?? null,
    count: tradable.length,
    points,
  }
}

export async function loadLimitUpAdvanceRatio(): Promise<LimitUpAdvancePayload> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.data
  const today = shanghaiToday()

  try {
    const members = await loadMembers(today)
    const spots = await loadSpots(members)
    const minutes = await mapPool(members, 6, async (member) => {
      try {
        return await loadMinutes(member.code, today)
      } catch {
        return new Map<string, number>()
      }
    })
    const bars: Bar[] = []
    members.forEach((member, index) => {
      const spot = spots.get(member.code)
      if (!spot) return
      const prices = minutes[index] ?? new Map<string, number>()
      prices.set("09:30", spot.open)
      const limitPx = Math.round(spot.pre * (1 + limitRatio(member.code, member.name)) * 100) / 100
      bars.push({
        pre: spot.pre,
        yizi: spot.open >= limitPx - 0.005,
        prices,
      })
    })
    if (bars.length < Math.ceil(members.length * 0.8)) {
      throw new Error("涨停个股分时不完整")
    }
    const data = buildPayload(today, bars)
    cache = { at: now, data }
    return data
  } catch (err) {
    if (cache) return cache.data
    const message = err instanceof Error ? err.message : "加载上涨占比失败"
    throw new Error(message.includes("行情源") || message.includes("分时") ? message : "加载上涨占比失败")
  }
}
