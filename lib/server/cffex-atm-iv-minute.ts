/**
 * Intraday near-month ATM implied vol for CFFEX index options (HO / IO / MO).
 * Official optbbs QVIX minute CSVs for index underlyings are often blank (#NAME?),
 * so this rebuilds a 1-minute line from Eastmoney CFFEX option trends + index spot.
 */

import type { OverlayPoint } from "@/lib/client/realtime-overlay"
import { publicQuery } from "@/lib/db"
import { chinaWallToUnix, SINA_UA, sinaGet } from "@/lib/server/sina-fetch"
import { curlJson } from "@/lib/server/quote-http"
import { inSessionMinute, mapLimit, type CaptureContract, type StoredMinute } from "@/lib/server/option-minute-types"

const EM_LIST_URL = "https://futsseapi.eastmoney.com/list/option/221"
const EM_TOKEN = "58b2fa8f54638b60b87d69b31969089c"
const EM_TREND_URL = "https://push2.eastmoney.com/api/qt/stock/trends2/get"
/** Live trends2 ignores ndays for options and returns only today. History does not. */
const EM_TREND_HIS_URL = "https://push2his.eastmoney.com/api/qt/stock/trends2/get"
const EM_UT = "f057cbcbce2a86e2866ab8877db1d059"
const RATE = 0.018
const CACHE_MS = 15_000
const EM_MARKET = 221
/** Keep using the same ATM strike until spot drifts this far (index points). */
const STRIKE_STICKY_BPS = 0.35

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
type MinutePx = { day: string; hhmm: string; price: number; volume: number }
type EmOption = { dm: string; sc: number; strike: number; side: Side; last: number; dte: number }

type AtmChoice = { month: string; strike: number; callDm: string; putDm: string; callSc: number; putSc: number; dte: number }

const cache: Map<string, { at: number; bars: OverlayPoint[]; atm: AtmChoice | null }> =
  (globalThis as { __cffexAtmMinuteCache?: Map<string, { at: number; bars: OverlayPoint[]; atm: AtmChoice | null }> }).__cffexAtmMinuteCache ??
  ((globalThis as { __cffexAtmMinuteCache?: Map<string, { at: number; bars: OverlayPoint[]; atm: AtmChoice | null }> }).__cffexAtmMinuteCache = new Map())

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
  try {
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
  } catch (err) {
    const host = (() => { try { return new URL(url).host } catch { return "em" } })()
    throw new Error(`${host}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function parseOptionDm(dm: string): { prefix: string; month: string; side: Side; strike: number } | null {
  const m = dm.trim().toUpperCase().match(/^(HO|IO|MO)(\d{4})-(C|P)-(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const strike = num(m[4])
  if (strike == null || !(strike > 0)) return null
  return { prefix: m[1], month: `${m[1]}${m[2]}`, side: m[3] === "C" ? "call" : "put", strike }
}

let cffexOptionBook: { at: number; rows: EmOption[] } | null = null
const OPTION_BOOK_MS = 3 * 60_000

/** The listed book changes slowly. ATM selection uses a fresh spot against this grid. */
async function listCffexOptions(prefix: string): Promise<EmOption[]> {
  const want = prefix.toUpperCase()
  if (cffexOptionBook && Date.now() - cffexOptionBook.at < OPTION_BOOK_MS) {
    return cffexOptionBook.rows.filter((row) => row.dm.toUpperCase().startsWith(want))
  }
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
      if (!parsed) continue
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
  cffexOptionBook = { at: Date.now(), rows: out }
  return out.filter((row) => row.dm.toUpperCase().startsWith(want))
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

/** Prefer previous ATM strike/contracts until spot drifts far enough to retarget. */
function resolveAtm(
  monthRows: EmOption[],
  spot: number,
  month: string,
  prev: AtmChoice | null,
  step: number,
): AtmChoice | null {
  if (prev && prev.month === month) {
    const call = monthRows.find((r) => r.dm === prev.callDm && r.side === "call")
    const put = monthRows.find((r) => r.dm === prev.putDm && r.side === "put")
    if (call && put && call.strike === prev.strike && put.strike === prev.strike) {
      const stickyLimit = Math.max(step * STRIKE_STICKY_BPS, step * 0.35)
      if (Math.abs(spot - prev.strike) <= stickyLimit + step * 0.5) {
        return {
          month,
          strike: prev.strike,
          callDm: call.dm,
          putDm: put.dm,
          callSc: call.sc,
          putSc: put.sc,
          dte: call.dte,
        }
      }
    }
  }
  const fresh = pickAtm(monthRows, spot)
  if (!fresh) return null
  return {
    month,
    strike: fresh.strike,
    callDm: fresh.call.dm,
    putDm: fresh.put.dm,
    callSc: fresh.call.sc,
    putSc: fresh.put.sc,
    dte: fresh.dte,
  }
}

function parseTrendRows(trends: string[]) {
  let date: string | null = null
  const points: MinutePx[] = []
  for (const item of trends) {
    const parts = item.split(",")
    const stamp = parts[0] || ""
    const price = num(parts[1])
    const volume = num(parts[4]) ?? 0
    const day = stamp.slice(0, 10)
    const hhmm = hhmmOf(stamp)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) date = day
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hhmm || price == null || !(price > 0)) continue
    points.push({ day, hhmm, price, volume })
  }
  return { date, points }
}

/** Today's minutes from futsseapi. push2 often resets the TLS handshake from this host. */
async function fetchRtdataTrends(secid: string): Promise<{ date: string | null; points: MinutePx[] }> {
  const [market, code] = secid.split(".")
  if (!market || !code) return { date: null, points: [] }
  const url = `https://futsseapi.eastmoney.com/static/rtdata/${market}_${code}`
  let payload: { data?: { trends?: string[] } }
  try {
    payload = JSON.parse(await emGet(url))
  } catch {
    payload = (await curlJson(url, "https://quote.eastmoney.com/", { timeoutSec: 12, attempts: 1 })) as {
      data?: { trends?: string[] }
    }
  }
  // rtdata columns: time, open, close, high, low, volume, amount, avg
  let date: string | null = null
  const points: MinutePx[] = []
  for (const item of payload.data?.trends || []) {
    const parts = item.split(",")
    const stamp = parts[0] || ""
    const day = stamp.slice(0, 10)
    const hhmm = hhmmOf(stamp)
    const price = num(parts[2])
    const volume = num(parts[5]) ?? 0
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) date = day
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hhmm || price == null || !(price > 0)) continue
    points.push({ day, hhmm, price, volume })
  }
  return { date, points }
}

async function fetchTrendOnce(base: string, secid: string, days: number) {
  const url =
    `${base}?` +
    new URLSearchParams({
      secid,
      fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f17",
      fields2: "f51,f53,f54,f55,f56,f57,f58",
      iscr: "0",
      ndays: String(days),
      ut: EM_UT,
    }).toString()
  try {
    // push2his often resets Node's TLS handshake; curl is the fallback.
    let payload: unknown
    if (base === EM_TREND_HIS_URL) {
      try {
        payload = JSON.parse(await emGet(url))
      } catch {
        payload = await curlJson(url, "https://quote.eastmoney.com/", { timeoutSec: 12, attempts: 1 })
      }
    } else {
      payload = JSON.parse(await emGet(url))
    }
    const json = payload as { data?: { trends?: string[] } }
    return parseTrendRows(json.data?.trends || [])
  } catch (err) {
    if (base !== EM_TREND_URL) throw err
    return fetchRtdataTrends(secid)
  }
}

/** East Money option minutes. ndays>1 reads push2his so the previous sessions are included. */
export async function fetchEmOptionTrends(secid: string, ndays = 1): Promise<{ date: string | null; points: MinutePx[] }> {
  const days = Math.min(Math.max(Math.round(ndays) || 1, 1), 10)
  if (days === 1) return fetchTrendOnce(EM_TREND_URL, secid, 1)
  const [hist, live] = await Promise.all([
    fetchTrendOnce(EM_TREND_HIS_URL, secid, days),
    fetchTrendOnce(EM_TREND_URL, secid, 1).catch(() => ({ date: null, points: [] as MinutePx[] })),
  ])
  const today = todayShanghai()
  const past = hist.points.filter((row) => row.day !== today)
  const points = live.points.length ? [...past, ...live.points] : hist.points
  const date = points.length ? points[points.length - 1]!.day : hist.date
  return { date, points }
}

async function optionTrends(dm: string, sc: number, ndays = 1): Promise<{ date: string | null; points: MinutePx[] }> {
  return fetchEmOptionTrends(`${sc || EM_MARKET}.${dm}`, ndays)
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

async function underlyingMinutes(symbol: string, ndays = 1, recentBars?: number) {
  try {
    const days = Math.min(Math.max(Math.round(ndays) || 1, 1), 10)
    const datalen = recentBars && recentBars > 0 ? recentBars : Math.min(240 * days, 1600)
    const text = await sinaGet(
      `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=1&ma=no&datalen=${datalen}`,
      "https://finance.sina.com.cn/",
    )
    if (!text || text === "null") return new Map<string, number>()
    const rows = JSON.parse(text) as Array<{ day?: string; close?: string }>
    const map = new Map<string, number>()
    for (const row of rows) {
      const stamp = String(row.day || "")
      const day = stamp.slice(0, 10)
      const hhmm = hhmmOf(stamp)
      const close = num(row.close)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hhmm || close == null || !(close > 0)) continue
      map.set(`${day} ${hhmm}`, close)
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
  if (keep.length >= 2) {
    const prev = keep[keep.length - 2]!
    const last = keep[keep.length - 1]!
    if (prev.close > 0 && Math.abs(last.close - prev.close) / prev.close > maxRel) keep.pop()
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
  requireVolume = true,
) {
  const stampKey = (row: MinutePx) => `${row.day} ${row.hhmm}`
  const callPx = new Map(call.map((row) => [stampKey(row), row]))
  const putPx = new Map(put.map((row) => [stampKey(row), row]))
  const stamps = [...callPx.keys()].filter((key) => putPx.has(key)).sort()
  let spot = fallbackSpot
  const bars: OverlayPoint[] = []
  for (const key of stamps) {
    const callBar = callPx.get(key)!
    const putBar = putPx.get(key)!
    if (requireVolume && (callBar.volume <= 0 || putBar.volume <= 0)) continue
    const quotedSpot = spotByMinute.get(key)
    if (quotedSpot != null) spot = quotedSpot
    const time = chinaWallToUnix(`${callBar.day} ${callBar.hhmm}:00`)
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

/**
 * Freeze settled minutes from the previous series; only let the newest 1–2
 * minutes (and brand-new timestamps) take values from a fresh rebuild.
 * Stops full-series flip-flops when Eastmoney revises prints / volume flags.
 */
function mergeSettledBars(prev: OverlayPoint[] | undefined, next: OverlayPoint[]): OverlayPoint[] {
  if (!prev?.length) return next
  if (!next.length) return prev
  const nextByTime = new Map(next.map((b) => [b.time, b]))
  const nextTimes = next.map((b) => b.time).sort((a, b) => a - b)
  const tipCutoff = nextTimes[Math.max(0, nextTimes.length - 2)]!
  const map = new Map<number, OverlayPoint>()
  for (const bar of prev) {
    if (bar.time >= tipCutoff && !nextByTime.has(bar.time)) continue
    map.set(bar.time, bar)
  }
  for (const bar of next) {
    if (!map.has(bar.time) || bar.time >= tipCutoff) map.set(bar.time, bar)
  }
  return [...map.values()].sort((a, b) => a.time - b.time)
}

function atmContractLabel(atm: AtmChoice) {
  return `${atm.callDm} / ${atm.putDm}`
}

export async function cffexAtmContractLabel(key: string, monthCode?: string | null): Promise<string | null> {
  if (!(key in INDEX)) return null
  const monthPart = monthCode ? String(monthCode).trim().toUpperCase() : ""
  const cacheKey = monthPart ? key + ":" + monthPart + ":d1" : key + ":d1"
  const hit = cache.get(cacheKey)
  if (hit?.atm && Date.now() - hit.at < 60_000) return atmContractLabel(hit.atm)
  try {
    const cfg = INDEX[key as IndexKey]
    const [options, spotQuote] = await Promise.all([listCffexOptions(cfg.prefix), underlyingSpot(cfg.underlying)])
    const month = pickMonth(options, monthCode)
    if (!month || spotQuote == null) return hit?.atm ? atmContractLabel(hit.atm) : null
    const atm = resolveAtm(month.list, spotQuote, month.month, hit?.atm ?? null, cfg.step)
    if (!atm) return hit?.atm ? atmContractLabel(hit.atm) : null
    cache.set(cacheKey, { at: hit?.bars.length ? hit.at : Date.now(), bars: hit?.bars ?? [], atm })
    return atmContractLabel(atm)
  } catch {
    return hit?.atm ? atmContractLabel(hit.atm) : null
  }
}

function pickExactStrike(rows: EmOption[], strike: number, month: string): AtmChoice | null {
  let call: EmOption | undefined
  let put: EmOption | undefined
  for (const row of rows) {
    if (Math.abs(row.strike - strike) > 1e-3) continue
    if (row.side === "call") call = row
    else put = row
  }
  if (!call || !put) return null
  return {
    month,
    strike: call.strike,
    callDm: call.dm,
    putDm: put.dm,
    callSc: call.sc,
    putSc: put.sc,
    dte: call.dte,
  }
}

const SINA_CFFEX_PRODUCT: Record<IndexKey, string> = {
  "50index": "ho",
  "300index": "io",
  "1000index": "mo",
}

type LiveTip = { time: number; close: number }
type SinaPair = { strike: number; call: number; put: number }

const liveTipStore: Map<string, LiveTip[]> =
  (globalThis as { __cffexSinaLiveTips?: Map<string, LiveTip[]> }).__cffexSinaLiveTips ??
  ((globalThis as { __cffexSinaLiveTips?: Map<string, LiveTip[]> }).__cffexSinaLiveTips = new Map())

let sinaChainCache: { at: number; key: string; rows: SinaPair[] } | null = null

function afterCashClose(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const weekday = parts.find((part) => part.type === "weekday")?.value
  if (weekday === "Sat" || weekday === "Sun") return true
  const hour = Number(parts.find((part) => part.type === "hour")?.value)
  const minute = Number(parts.find((part) => part.type === "minute")?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  return hour * 60 + minute > 15 * 60
}

function shanghaiSessionMinute(now = new Date()): number | null {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return null
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const n = hour * 60 + minute
  if (!((n >= 9 * 60 + 30 && n <= 11 * 60 + 30) || (n >= 13 * 60 && n <= 15 * 60))) return null
  const hh = String(hour).padStart(2, "0")
  const mm = String(minute).padStart(2, "0")
  return chinaWallToUnix(`${parts.year}-${parts.month}-${parts.day} ${hh}:${mm}:00`)
}

function quotePx(last: unknown, bid: unknown, ask: unknown) {
  const trade = num(last)
  if (trade != null && trade > 0) return trade
  const b = num(bid)
  const a = num(ask)
  if (b != null && a != null && b > 0 && a > 0) return (a + b) / 2
  return null
}

async function sinaOptionChain(product: string, pinzhong: string): Promise<SinaPair[]> {
  const cacheId = `${product}:${pinzhong}`
  if (sinaChainCache && sinaChainCache.key === cacheId && Date.now() - sinaChainCache.at < 5_000) {
    return sinaChainCache.rows
  }
  const url =
    "https://stock.finance.sina.com.cn/futures/api/openapi.php/OptionService.getOptionData?" +
    new URLSearchParams({ type: "futures", product, exchange: "cffex", pinzhong }).toString()
  const text = await sinaGet(url, "https://stock.finance.sina.com.cn/futures/view/optionsCffexDP.php")
  const body = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  const json = JSON.parse(body) as { result?: { data?: { up?: unknown[][]; down?: unknown[][] } } }
  const up = json.result?.data?.up || []
  const down = json.result?.data?.down || []
  const rows: SinaPair[] = []
  for (let i = 0; i < up.length; i += 1) {
    const call = up[i]
    const put = down[i]
    const strike = num(call?.[7])
    const callPx = quotePx(call?.[2], call?.[1], call?.[3])
    const putPx = quotePx(put?.[2], put?.[1], put?.[3])
    if (strike == null || callPx == null || putPx == null) continue
    rows.push({ strike, call: callPx, put: putPx })
  }
  sinaChainCache = { at: Date.now(), key: cacheId, rows }
  return rows
}

function publishCffexBars(
  key: string,
  days: number,
  atm: AtmChoice | null,
  bars: OverlayPoint[],
  contract: string,
) {
  if (days !== 1) return Promise.resolve({ bars, contract })
  return withSinaLiveTip(key, atm, bars).then((next) => ({ bars: next, contract }))
}

function tipId(key: string, strike: number) {
  return `${key}|${Math.round(strike)}`
}

function rememberLiveTip(key: string, strike: number, time: number, close: number) {
  const id = tipId(key, strike)
  const day = new Date(time * 1000).getUTCDate()
  const prev = (liveTipStore.get(id) || []).filter((row) => new Date(row.time * 1000).getUTCDate() === day && row.time !== time)
  prev.push({ time, close })
  prev.sort((a, b) => a.time - b.time)
  liveTipStore.set(id, prev)
}

let tipSchemaReady = false

/** The fast CFFEX snapshot, kept so a later read can fill the delayed minute file. */
async function persistLiveTip(key: string, strike: number, time: number, close: number) {
  if (!tipSchemaReady) {
    await publicQuery(`
      CREATE TABLE IF NOT EXISTS raw_option_iv_tip (
        underlying_key TEXT NOT NULL,
        strike         DOUBLE PRECISION NOT NULL,
        bar_time       TIMESTAMPTZ NOT NULL,
        iv             DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (underlying_key, strike, bar_time)
      )
    `)
    tipSchemaReady = true
  }
  await publicQuery(
    `INSERT INTO raw_option_iv_tip (underlying_key, strike, bar_time, iv)
     VALUES ($1, $2, to_timestamp($3), $4)
     ON CONFLICT (underlying_key, strike, bar_time) DO UPDATE SET iv = EXCLUDED.iv`,
    [key, strike, time, close],
  )
}

async function storedLiveTips(key: string, strike: number): Promise<LiveTip[]> {
  try {
    const res = await publicQuery(
      `SELECT EXTRACT(EPOCH FROM bar_time)::bigint AS t, iv
       FROM raw_option_iv_tip
       WHERE underlying_key = $1 AND strike = $2 AND bar_time > NOW() - INTERVAL '18 hours'`,
      [key, strike],
    )
    return (res.rows as Array<{ t: number | string; iv: number }>)
      .map((row) => ({ time: Number(row.t), close: Number(row.iv) }))
      .filter((row) => Number.isFinite(row.time) && row.close > 0)
  } catch {
    return []
  }
}

/** Live tips win their minute. After the bell, a delayed bar past the last tip is not part of the session. */
export function clipBarsAfterSession<T extends { time: number; close: number }>(
  bars: T[],
  tips: Array<{ time: number; close: number }>,
  sessionOpen: boolean,
): T[] {
  if (!tips.length) return bars
  const map = new Map(bars.map((bar) => [bar.time, bar]))
  for (const tip of tips) {
    const prev = map.get(tip.time)
    map.set(tip.time, prev ? { ...prev, close: tip.close } : ({ ...tip } as T))
  }
  const merged = [...map.values()].sort((a, b) => a.time - b.time)
  if (sessionOpen) return merged
  const lastTip = tips.reduce((max, tip) => Math.max(max, tip.time), 0)
  return merged.filter((bar) => bar.time <= lastTip)
}

async function mergeLiveTips(key: string, strike: number, bars: OverlayPoint[]) {
  const rounded = Math.round(strike)
  const byTime = new Map<number, LiveTip>()
  for (const tip of await storedLiveTips(key, rounded)) byTime.set(tip.time, tip)
  for (const tip of liveTipStore.get(tipId(key, strike)) || []) byTime.set(tip.time, tip)
  const tips = [...byTime.values()]
  if (!tips.length) return bars
  return clipBarsAfterSession(bars, tips, shanghaiSessionMinute() != null)
}

/**
 * East Money's CFFEX option minute file runs about 15 minutes behind.
 * Sina's option chain (the feed AkShare's option_cffex_*_spot_sina reads)
 * is current, but it is a snapshot, not a minute history. Each poll records
 * every strike on that chain, so a contract the user opens later is already live.
 */
async function withSinaLiveTip(key: string, atm: AtmChoice | null, bars: OverlayPoint[]) {
  if (!atm || !(key in INDEX)) return bars
  const minute = shanghaiSessionMinute()
  if (minute == null) return mergeLiveTips(key, atm.strike, bars)
  try {
    const cfg = INDEX[key as IndexKey]
    const [spot, chain] = await Promise.all([
      underlyingSpot(cfg.underlying),
      sinaOptionChain(SINA_CFFEX_PRODUCT[key as IndexKey], atm.month.toLowerCase()),
    ])
    if (spot != null && chain.length) {
      const expireDay = addDaysShanghai(todayShanghai(), Math.max(Math.round(atm.dte), 1))
      const t = yearFraction(minute, expireDay)
      for (const row of chain) {
        const callIv = impliedVolPercent(row.call, spot, row.strike, t, "call")
        const putIv = impliedVolPercent(row.put, spot, row.strike, t, "put")
        if (callIv == null || putIv == null) continue
        const mid = Math.round(((callIv + putIv) / 2) * 100) / 100
        if (mid > 1 && mid < 150) {
          rememberLiveTip(key, row.strike, minute, mid)
          if (key === "1000index" && Math.round(row.strike) === Math.round(atm.strike)) {
            void persistLiveTip(key, Math.round(atm.strike), minute, mid).catch(() => undefined)
          }
        }
      }
    }
  } catch {
    // The delayed minute file still draws. The next poll tries Sina again.
  }
  return mergeLiveTips(key, atm.strike, bars)
}

/**
 * Record the current 中证1000 ATM snapshot. The minute files are stored separately,
 * so this does not download them again.
 */
export async function recordCffexAtmTip(key: string) {
  if (!(key in INDEX)) return
  const cfg = INDEX[key as IndexKey]
  const [options, spot] = await Promise.all([listCffexOptions(cfg.prefix), underlyingSpot(cfg.underlying)])
  const month = pickMonth(options, null)
  if (!month || spot == null) return
  const atm = resolveAtm(month.list, spot, month.month, null, cfg.step)
  if (!atm) return
  await withSinaLiveTip(key, atm, [])
}

/** Live Sina ATM IV for one listed month, merged onto that month's delayed minutes. */
export async function appendCffexMonthLiveTip(key: string, monthCode: string, bars: OverlayPoint[]) {
  if (!(key in INDEX) || !monthCode) return bars
  const cfg = INDEX[key as IndexKey]
  try {
    const [options, spot] = await Promise.all([listCffexOptions(cfg.prefix), underlyingSpot(cfg.underlying)])
    const month = pickMonth(options, monthCode)
    if (!month || spot == null) return bars
    const atm = resolveAtm(month.list, spot, month.month, null, cfg.step)
    if (!atm) return bars
    return withSinaLiveTip(key, atm, bars)
  } catch {
    return bars
  }
}

/** Live Sina IV for one chosen strike, merged onto a delayed minute series. */
export async function appendCffexSinaTip(
  key: string,
  strike: number,
  bars: OverlayPoint[],
  monthCode?: string | null,
) {
  if (!(key in INDEX) || !(strike > 0)) return bars
  const cfg = INDEX[key as IndexKey]
  try {
    const options = await listCffexOptions(cfg.prefix)
    const month = pickMonth(options, monthCode)
    const call = month?.list.find((row) => row.side === "call" && Math.abs(row.strike - strike) < 0.5)
    if (!month || !call) return mergeLiveTips(key, strike, bars)
    return withSinaLiveTip(key, { month: month.month, strike: call.strike, dte: call.dte, callDm: call.dm, putDm: call.dm, callSc: call.sc, putSc: call.sc }, bars)
  } catch {
    return mergeLiveTips(key, strike, bars)
  }
}

export async function fetchCffexAtmIvMinutes(
  key: string,
  monthCode?: string | null,
  ndays = 1,
  strike?: number | null,
): Promise<{ bars: OverlayPoint[]; contract: string } | null> {
  if (!(key in INDEX)) return null
  const today = todayShanghai()
  const days = Math.min(Math.max(Math.round(ndays) || 1, 1), 10)
  const monthPart = monthCode ? String(monthCode).trim().toUpperCase() : ""
  const strikePart = strike != null && strike > 0 ? `:k${strike}` : ""
  const cacheKey = (monthPart ? key + ":" + monthPart + ":d" + days : key + ":d" + days) + strikePart
  const hit = cache.get(cacheKey)
  const startOfToday = chinaWallToUnix(`${today} 00:00:00`)
  if (
    days === 1 &&
    hit?.bars.length &&
    startOfToday != null &&
    hit.bars[hit.bars.length - 1]!.time >= startOfToday &&
    afterCashClose()
  ) {
    return publishCffexBars(key, days, hit.atm, hit.bars, hit.atm ? atmContractLabel(hit.atm) : "")
  }
  if (hit && Date.now() - hit.at < CACHE_MS && hit.bars.length) {
    const last = hit.bars[hit.bars.length - 1]
    if (days === 1 && startOfToday != null && last.time >= startOfToday) {
      return publishCffexBars(key, days, hit.atm, hit.bars, hit.atm ? atmContractLabel(hit.atm) : "")
    }
    if (days > 1 && hit.bars.length >= 2) {
      const firstDay = new Date(hit.bars[0]!.time * 1000).getUTCDate()
      const lastDay = new Date(last.time * 1000).getUTCDate()
      if (firstDay !== lastDay) return { bars: hit.bars, contract: hit.atm ? atmContractLabel(hit.atm) : "" }
    }
  }
  try {
    const cfg = INDEX[key as IndexKey]
    const [options, spotQuote] = await Promise.all([listCffexOptions(cfg.prefix), underlyingSpot(cfg.underlying)])
    const month = pickMonth(options, monthCode)
    if (!month) return hit?.bars.length ? { bars: hit.bars, contract: hit.atm ? atmContractLabel(hit.atm) : "" } : null
    const spot0 = spotQuote
    if (spot0 == null) return hit?.bars.length ? { bars: hit.bars, contract: hit.atm ? atmContractLabel(hit.atm) : "" } : null
    const pinned = strike != null && strike > 0
    const atm = pinned
      ? pickExactStrike(month.list, strike, month.month)
      : resolveAtm(month.list, spot0, month.month, hit?.atm ?? null, cfg.step)
    if (!atm) return hit?.bars.length ? { bars: hit.bars, contract: hit.atm ? atmContractLabel(hit.atm) : "" } : null
    const expireDay = addDaysShanghai(today, Math.max(Math.round(atm.dte), 1))
    const [callMin, putMin, spotMin] = await Promise.all([
      optionTrends(atm.callDm, atm.callSc, days),
      optionTrends(atm.putDm, atm.putSc, days),
      underlyingMinutes(cfg.underlying, days),
    ])
    const date = callMin.date || putMin.date
    if (days === 1 && date !== today) {
      return hit?.bars?.length ? { bars: hit.bars, contract: hit.atm ? atmContractLabel(hit.atm) : atmContractLabel(atm) } : null
    }
    const rebuilt = buildBars(callMin.points, putMin.points, spotMin, spot0, atm.strike, expireDay, !pinned)
    const bars = days === 1 ? mergeSettledBars(hit?.bars, rebuilt) : rebuilt
    const minBars = pinned ? 1 : 8
    if (bars.length < minBars) {
      return hit?.bars.length
        ? publishCffexBars(key, days, hit.atm ?? atm, hit.bars, hit.atm ? atmContractLabel(hit.atm) : atmContractLabel(atm))
        : pinned
          ? { bars: [], contract: atmContractLabel(atm) }
          : null
    }
    cache.set(cacheKey, { at: Date.now(), bars, atm })
    return publishCffexBars(key, days, atm, bars, atmContractLabel(atm))
  } catch {
    return hit?.bars.length ? publishCffexBars(key, days, hit.atm, hit.bars, hit.atm ? atmContractLabel(hit.atm) : "") : null
  }
}

const cffexListCache = new Map<string, { at: number; rows: Array<{ strike: number; label: string; atm: boolean }> }>()

export async function listCffexIvContracts(key: string, monthCode?: string | null) {
  if (!(key in INDEX)) return []
  const monthPart = monthCode ? String(monthCode).trim().toUpperCase() : ""
  const cacheKey = monthPart ? `${key}:${monthPart}` : key
  const hit = cffexListCache.get(cacheKey)
  if (hit && Date.now() - hit.at < 20_000) return hit.rows
  const cfg = INDEX[key as IndexKey]
  const [options, spot] = await Promise.all([listCffexOptions(cfg.prefix), underlyingSpot(cfg.underlying)])
  const month = pickMonth(options, monthCode)
  if (!month) return hit?.rows ?? []
  const pairs = new Map<number, { call?: EmOption; put?: EmOption }>()
  for (const row of month.list) {
    const pair = pairs.get(row.strike) || {}
    pair[row.side] = row
    pairs.set(row.strike, pair)
  }
  let atmStrike: number | null = null
  if (spot != null) {
    let best = Infinity
    for (const [rowStrike, pair] of pairs) {
      if (!pair.call || !pair.put) continue
      const dist = Math.abs(rowStrike - spot)
      if (dist < best) {
        best = dist
        atmStrike = rowStrike
      }
    }
  }
  const rows = [...pairs.entries()]
    .filter((entry): entry is [number, { call: EmOption; put: EmOption }] => !!entry[1].call && !!entry[1].put)
    .sort((a, b) => a[0] - b[0])
    .map(([rowStrike, pair]) => ({
      strike: rowStrike,
      label: `${pair.call.dm} / ${pair.put.dm}`,
      atm: atmStrike != null && rowStrike === atmStrike,
    }))
  cffexListCache.set(cacheKey, { at: Date.now(), rows })
  return rows
}

/** Near-month ATM call and put for the default 中证1000 chart. */
export async function listDefaultIndexAtmContracts(): Promise<CaptureContract[]> {
  const key: IndexKey = "1000index"
  const cfg = INDEX[key]
  try {
    const [options, spot] = await Promise.all([listCffexOptions(cfg.prefix), underlyingSpot(cfg.underlying)])
    const month = pickMonth(options, null)
    if (!month || spot == null) return []
    const atm = resolveAtm(month.list, spot, month.month, null, cfg.step)
    if (!atm) return []
    const expireDay = addDaysShanghai(todayShanghai(), Math.max(Math.round(atm.dte), 0))
    const common = {
      underlyingKey: key,
      monthCode: atm.month,
      strike: atm.strike,
      expireDay,
    }
    return [
      { ...common, contractId: atm.callDm, side: "call" as const, market: atm.callSc || EM_MARKET },
      { ...common, contractId: atm.putDm, side: "put" as const, market: atm.putSc || EM_MARKET },
    ]
  } catch {
    return []
  }
}

let cffexCapturePlan: { at: number; contracts: CaptureContract[] } | null = null

/** Every listed HO / IO / MO contract. Today's minutes come from futsseapi, not push2. */
export async function listCffexCaptureContracts(): Promise<CaptureContract[]> {
  if (cffexCapturePlan && Date.now() - cffexCapturePlan.at < 10 * 60_000 && cffexCapturePlan.contracts.length) {
    return cffexCapturePlan.contracts
  }
  const today = todayShanghai()
  const contracts: CaptureContract[] = []
  for (const key of Object.keys(INDEX) as IndexKey[]) {
    try {
      const options = await listCffexOptions(INDEX[key].prefix)
      for (const row of options) {
        const monthCode = row.dm.split("-")[0]?.toUpperCase() || ""
        if (!monthCode) continue
        contracts.push({
          underlyingKey: key,
          contractId: row.dm,
          side: row.side,
          monthCode,
          strike: row.strike,
          expireDay: addDaysShanghai(today, Math.max(Math.round(row.dte), 0)),
          market: row.sc || EM_MARKET,
        })
      }
    } catch {
      // one product failing leaves the others usable
    }
  }
  if (contracts.length) cffexCapturePlan = { at: Date.now(), contracts }
  return contracts
}

export async function fetchCffexCaptureMinutes(contracts: CaptureContract[]): Promise<StoredMinute[]> {
  const batches = await mapLimit(contracts, 6, async (contract) => {
    try {
      const live = await fetchRtdataTrends(`${contract.market || EM_MARKET}.${contract.contractId}`)
      const prints: StoredMinute[] = []
      for (const row of live.points) {
        if (!row.day || !inSessionMinute(row.hhmm)) continue
        prints.push({
          ...contract,
          day: row.day,
          hhmm: row.hhmm,
          price: row.price,
          volume: row.volume ?? null,
        })
      }
      return prints
    } catch {
      return [] as StoredMinute[]
    }
  })
  return batches.flat()
}

export async function fetchCffexSpotMinutes(days: number, onlyKeys?: string[], recentBars?: number): Promise<StoredMinute[]> {
  const today = todayShanghai()
  const rows: StoredMinute[] = []
  const keys = (onlyKeys?.length ? onlyKeys.filter((key): key is IndexKey => key in INDEX) : (Object.keys(INDEX) as IndexKey[]))
  for (const key of keys) {
    const map = await underlyingMinutes(INDEX[key].underlying, days, recentBars)
    for (const [stamp, price] of map) {
      const dated = stamp.includes(" ")
      const day = dated ? stamp.slice(0, 10) : today
      const hhmm = dated ? stamp.slice(11) : stamp
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !inSessionMinute(hhmm)) continue
      rows.push({
        underlyingKey: key,
        contractId: "SPOT",
        side: "spot",
        monthCode: "",
        strike: null,
        expireDay: null,
        day,
        hhmm,
        price,
        volume: null,
      })
    }
  }
  return rows
}
