/**
 * Intraday near-month ATM implied vol for CFFEX index options (HO / IO / MO).
 * Official optbbs QVIX minute CSVs for index underlyings are often blank (#NAME?),
 * so this rebuilds a 1-minute line from Eastmoney CFFEX option trends + index spot.
 */

import type { OverlayPoint } from "@/lib/client/realtime-overlay"
import { chinaWallToUnix, SINA_UA, sinaGet } from "@/lib/server/sina-fetch"

const EM_LIST_URL = "https://futsseapi.eastmoney.com/list/option/221"
const EM_TOKEN = "58b2fa8f54638b60b87d69b31969089c"
const EM_TREND_URL = "https://push2.eastmoney.com/api/qt/stock/trends2/get"
const EM_UT = "f057cbcbce2a86e2866ab8877db1d059"
const RATE = 0.018
const CACHE_MS = 15_000
const EM_MARKET = 221

type IndexKey = "50index" | "300index" | "1000index"

const INDEX: Record<
  IndexKey,
  { prefix: string; underlying: string; step: number }
> = {
  "50index": { prefix: "HO", underlying: "sh000016", step: 50 },
  "300index": { prefix: "IO", underlying: "sh000300", step: 50 },
  "1000index": { prefix: "MO", underlying: "sh000852", step: 100 },
}

type Side = "call" | "put"
type MinutePx = { hhmm: string; price: number; volume: number }
type EmOption = { dm: string; sc: number; strike: number; side: Side; last: number; dte: number }

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

function hhmmOf(stamp: string) {
  const m = stamp.match(/(\d{2}:\d{2})(?::\d{2})?$/)
  return m?.[1] ?? null
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
  let lo = 1e-4
  let hi = 5
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    const model = bsPrice(spot, strike, t, mid, side)
    if (model > price) hi = mid
    else lo = mid
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100
}

async function emGet(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent": SINA_UA,
      Referer: "https://quote.eastmoney.com/",
    },
  })
  if (!res.ok) throw new Error(`em ${res.status}`)
  return res.text()
}

function parseOptionDm(dm: string): { prefix: string; month: string; side: Side; strike: number } | null {
  const m = dm.trim().toUpperCase().match(/^(HO|IO|MO)(\d{4})-(C|P)-(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const strike = num(m[4])
  if (strike == null || !(strike > 0)) return null
  return { prefix: m[1], month: `${m[1]}${m[2]}`, side: m[3] === "C" ? "call" : "put", strike }
}

async function listCffexOptions(prefix: string): Promise<EmOption[]> {
  const out: EmOption[] = []
  for (let page = 0; page < 8; page += 1) {
    const url =
      `${EM_LIST_URL}?` +
      new URLSearchParams({
        orderBy: "dm",
        sort: "asc",
        pageSize: "200",
        pageIndex: String(page),
        token: EM_TOKEN,
        field: "dm,sc,name,p,zsjd,zde,zdf,f152,vol,cje,ccl,xqj,syr,rz,zjsj,o",
      }).toString()
    const json = JSON.parse(await emGet(url)) as {
      list?: Array<Record<string, unknown>>
      total?: number
    }
    const chunk = json.list || []
    for (const row of chunk) {
      const dm = String(row.dm || "")
      const parsed = parseOptionDm(dm)
      if (!parsed || parsed.prefix !== prefix) continue
      const last = num(row.p)
      const dte = num(row.syr)
      if (last == null || !(last > 0) || dte == null) continue
      out.push({
        dm,
        sc: num(row.sc) ?? EM_MARKET,
        strike: parsed.strike,
        side: parsed.side,
        last,
        dte,
      })
    }
    if (chunk.length < 200) break
    if (typeof json.total === "number" && out.length >= json.total && page > 0) break
  }
  return out
}

function pickMonth(rows: EmOption[], monthCode?: string | null) {
  const want = (monthCode || "").trim().toUpperCase()
  if (want) {
    const list = rows.filter((row) => row.dm.split("-")[0]?.toUpperCase() === want)
    if (!list.length) return null
    const dtes = list.map((r) => r.dte).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
    const mid = dtes[Math.floor(dtes.length / 2)] ?? -1
    return { month: want, list, dte: mid }
  }
  return pickFrontMonth(rows)
}

function pickFrontMonth(rows: EmOption[]) {
  const byMonth = new Map<string, EmOption[]>()
  for (const row of rows) {
    const month = row.dm.split("-")[0]?.toUpperCase()
    if (!month) continue
    const list = byMonth.get(month) || []
    list.push(row)
    byMonth.set(month, list)
  }
  const ranked = [...byMonth.entries()]
    .map(([month, list]) => {
      const dtes = list.map((r) => r.dte).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
      const mid = dtes[Math.floor(dtes.length / 2)] ?? -1
      return { month, list, dte: mid }
    })
    .filter((item) => item.dte >= 0)
  const preferred = ranked.filter((item) => item.dte >= 7).sort((a, b) => a.dte - b.dte)
  const pool = preferred.length ? preferred : ranked.sort((a, b) => a.dte - b.dte)
  return pool[0] || null
}

function pickAtm(rows: EmOption[], spot: number) {
  const byStrike = new Map<number, { call?: EmOption; put?: EmOption }>()
  for (const row of rows) {
    const pair = byStrike.get(row.strike) || {}
    pair[row.side] = row
    byStrike.set(row.strike, pair)
  }
  let best: { strike: number; call: EmOption; put: EmOption; dist: number; dte: number } | null = null
  for (const [strike, pair] of byStrike) {
    if (!pair.call || !pair.put) continue
    const dist = Math.abs(strike - spot)
    if (!best || dist < best.dist) {
      best = { strike, call: pair.call, put: pair.put, dist, dte: pair.call.dte }
    }
  }
  return best
}

async function optionTrends(dm: string, sc: number): Promise<{ date: string | null; points: MinutePx[] }> {
  const secid = `${sc || EM_MARKET}.${dm}`
  const url =
    `${EM_TREND_URL}?` +
    new URLSearchParams({
      secid,
      fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f17",
      fields2: "f51,f53,f54,f55,f56,f57,f58",
      iscr: "0",
      ndays: "1",
      ut: EM_UT,
    }).toString()
  const json = JSON.parse(await emGet(url)) as {
    data?: { trends?: string[]; name?: string }
  }
  const trends = json.data?.trends || []
  let date: string | null = null
  const points: MinutePx[] = []
  for (const item of trends) {
    const parts = item.split(",")
    const stamp = parts[0] || ""
    const price = num(parts[1])
    // Eastmoney trends2: time, close, high, low, volume, amount, avg
    const volume = num(parts[4]) ?? 0
    const day = stamp.slice(0, 10)
    const hhmm = hhmmOf(stamp)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) date = day
    if (!hhmm || price == null || !(price > 0)) continue
    points.push({ hhmm, price, volume })
  }
  return { date, points }
}

async function sinaGbk(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": SINA_UA, Referer: "https://finance.sina.com.cn/" },
  })
  if (!res.ok) throw new Error(`sina ${res.status}`)
  const buf = await res.arrayBuffer()
  try {
    return new TextDecoder("gbk").decode(buf)
  } catch {
    return new TextDecoder().decode(buf)
  }
}

async function underlyingSpot(symbol: string) {
  const text = await sinaGbk(`https://hq.sinajs.cn/list=${symbol}`)
  const quoted = text.match(/="([^"]*)"/)?.[1] || ""
  const last = num(quoted.split(",")[3])
  return last != null && last > 0 ? last : null
}

async function underlyingMinutes(symbol: string) {
  try {
    const text = await sinaGet(
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

function addDaysShanghai(day: string, days: number) {
  const [y, m, d] = day.split("-").map(Number)
  const utc = Date.UTC(y, m - 1, d) + days * 86400_000
  const dt = new Date(utc)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

function yearFraction(barUnix: number, expireDay: string) {
  const expiry = chinaWallToUnix(`${expireDay} 15:00:00`)
  if (expiry == null) return 7 / 365
  return Math.max(expiry - barUnix, 30 * 60) / (365 * 24 * 3600)
}

/** Drop open/auction IV spikes that disagree with neighbors. */
function filterNeighborOutliers(bars: OverlayPoint[], maxRel = 0.06): OverlayPoint[] {
  if (bars.length < 3) return bars
  const keep: OverlayPoint[] = []
  for (let i = 0; i < bars.length; i += 1) {
    const prev = bars[i - 1]
    const cur = bars[i]
    const next = bars[i + 1]
    if (!prev && next) {
      // Illiquid first print: drop if it cliffs into the next liquid bar.
      if (next.close > 0 && Math.abs(cur.close - next.close) / next.close > maxRel) continue
    } else if (prev && next) {
      const mid = (prev.close + next.close) / 2
      if (mid > 0) {
        const neighborGap = Math.abs(prev.close - next.close) / mid
        const spike = Math.abs(cur.close - mid) / mid
        // V-shape: neighbors agree, current diverges.
        if (neighborGap < maxRel * 0.5 && spike > maxRel) continue
      }
    }
    keep.push(cur)
  }
  return keep
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
  const callPx = new Map(call.map((row) => [row.hhmm, row]))
  const putPx = new Map(put.map((row) => [row.hhmm, row]))
  // Require both C and P prints for the minute (no single-sided IV).
  const stamps = [...callPx.keys()].filter((hhmm) => putPx.has(hhmm)).sort()
  let spot = fallbackSpot
  const bars: OverlayPoint[] = []
  for (const hhmm of stamps) {
    const callBar = callPx.get(hhmm)!
    const putBar = putPx.get(hhmm)!
    // Drop illiquid first/auction bars: zero volume on either side is not a real trade.
    if (callBar.volume <= 0 || putBar.volume <= 0) continue
    const quotedSpot = spotByMinute.get(hhmm)
    if (quotedSpot != null) spot = quotedSpot
    const time = chinaWallToUnix(`${date} ${hhmm}:00`)
    if (time == null || !(spot > 0)) continue
    const t = yearFraction(time, expireDay)
    const callIv = impliedVolPercent(callBar.price, spot, strike, t, "call")
    const putIv = impliedVolPercent(putBar.price, spot, strike, t, "put")
    if (callIv == null || putIv == null) continue
    const iv = Math.round(((callIv + putIv) / 2) * 100) / 100
    bars.push({ time, close: iv })
  }
  return filterNeighborOutliers(bars)
}

export async function fetchCffexAtmIvMinutes(key: string, monthCode?: string | null): Promise<OverlayPoint[] | null> {
  if (!(key in INDEX)) return null
  const today = todayShanghai()
  const cacheKey = monthCode ? `${key}:${String(monthCode).trim().toUpperCase()}` : key
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS && hit.bars.length) {
    const last = hit.bars[hit.bars.length - 1]
    const start = chinaWallToUnix(`${today} 00:00:00`)
    if (start != null && last.time >= start) return hit.bars
  }
  try {
    const cfg = INDEX[key as IndexKey]
    const [options, spotQuote] = await Promise.all([listCffexOptions(cfg.prefix), underlyingSpot(cfg.underlying)])
    const month = pickMonth(options, monthCode)
    if (!month) return hit?.bars ?? null
    const spot0 = spotQuote
    if (spot0 == null) return hit?.bars ?? null
    const atm = pickAtm(month.list, spot0)
    if (!atm) return hit?.bars ?? null
    const expireDay = addDaysShanghai(today, Math.max(Math.round(atm.dte), 1))
    const [callMin, putMin, spotMin] = await Promise.all([
      optionTrends(atm.call.dm, atm.call.sc),
      optionTrends(atm.put.dm, atm.put.sc),
      underlyingMinutes(cfg.underlying),
    ])
    const date = callMin.date || putMin.date
    if (date !== today) return hit?.bars?.length ? hit.bars : null
    const bars = buildBars(callMin.points, putMin.points, spotMin, spot0, atm.strike, expireDay, date)
    if (bars.length < 8) return hit?.bars ?? null
    cache.set(cacheKey, { at: Date.now(), bars })
    return bars
  } catch {
    return hit?.bars ?? null
  }
}
