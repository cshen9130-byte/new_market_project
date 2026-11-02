import type { OverlayPoint } from "@/lib/client/realtime-overlay"
import { chinaWallToUnix, SINA_UA } from "@/lib/server/sina-fetch"
import { inSessionMinute, mapLimit, type CaptureContract, type StoredMinute } from "@/lib/server/option-minute-types"

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

type MinutePx = { hhmm: string; price: number; day?: string; volume?: number }

const cache: Map<string, { at: number; bars: OverlayPoint[]; contract: string | null; strike: number | null }> =
  (globalThis as { __etfAtmMinuteCache?: Map<string, { at: number; bars: OverlayPoint[]; contract: string | null; strike: number | null }> }).__etfAtmMinuteCache ??
  ((globalThis as { __etfAtmMinuteCache?: Map<string, { at: number; bars: OverlayPoint[]; contract: string | null; strike: number | null }> }).__etfAtmMinuteCache = new Map())

export type AtmMinuteSeries = { bars: OverlayPoint[]; contract: string }

function formatStrike(strike: number) {
  return strike.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function etfPairLabel(listed: string, yymm: string, strike: number) {
  const strikeText = formatStrike(strike)
  return `${listed}购${yymm}-${strikeText} / ${listed}沽${yymm}-${strikeText}`
}

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

async function underlyingMinutes(symbol: string, ndays = 1) {
  try {
    const days = Math.min(Math.max(Math.round(ndays) || 1, 1), 10)
    const datalen = Math.min(240 * days, 1600)
    const text = await jsonGet(
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
      if (!hhmm || close == null || !(close > 0)) continue
      if (days > 1) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
        map.set(`${day} ${hhmm}`, close)
      } else {
        map.set(hhmm, close)
      }
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

/** Drop a V-shaped print, then withhold the live tip until it agrees with the bar before it. */
function settleIvBars(bars: OverlayPoint[], maxRel = 0.06): OverlayPoint[] {
  const keep: OverlayPoint[] = []
  for (let i = 0; i < bars.length; i += 1) {
    const prev = bars[i - 1]
    const cur = bars[i]
    const next = bars[i + 1]
    if (prev && next && bars.length >= 3) {
      const mid = (prev.close + next.close) / 2
      if (mid > 0) {
        const neighborGap = Math.abs(prev.close - next.close) / mid
        const spike = Math.abs(cur.close - mid) / mid
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

function strikeGap(strikes: number[], spot: number) {
  const sorted = [...new Set(strikes.filter((strike) => strike > 0))].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1]! <= spot && spot <= sorted[i]!) return sorted[i]! - sorted[i - 1]!
  }
  let bestGap = 0.05
  let bestDist = Infinity
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i]! - sorted[i - 1]!
    const dist = Math.abs((sorted[i - 1]! + sorted[i]!) / 2 - spot)
    if (gap > 0 && dist < bestDist) {
      bestDist = dist
      bestGap = gap
    }
  }
  return bestGap
}

function buildBars(
  call: MinutePx[],
  put: MinutePx[],
  spotByMinute: Map<string, number>,
  fallbackSpot: number,
  strike: number,
  expireDay: string,
  date: string,
  agree = true,
  requireVolume = false,
) {
  const stampOf = (row: MinutePx) => (row.day ? `${row.day} ${row.hhmm}` : row.hhmm)
  const callPx = new Map(call.map((row) => [stampOf(row), row]))
  const putPx = new Map(put.map((row) => [stampOf(row), row]))
  const stamps = [...callPx.keys()].filter((key) => putPx.has(key)).sort()
  let spot = fallbackSpot
  const dated = [...spotByMinute.keys()].some((key) => key.includes(" "))
  if (dated) {
    const firstKey = [...spotByMinute.keys()].sort()[0]
    const firstSpot = firstKey ? spotByMinute.get(firstKey) : null
    if (firstSpot) spot = firstSpot
  }
  const bars: OverlayPoint[] = []
  for (const key of stamps) {
    const callBar = callPx.get(key)!
    const putBar = putPx.get(key)!
    if (requireVolume && ((callBar.volume ?? 0) <= 0 || (putBar.volume ?? 0) <= 0)) continue
    const spotKey = callBar.day ? `${callBar.day} ${callBar.hhmm}` : callBar.hhmm
    const quotedSpot = spotByMinute.get(spotKey)
    if (quotedSpot != null) spot = quotedSpot
    const time = chinaWallToUnix(`${callBar.day || date} ${callBar.hhmm}:00`)
    if (time == null || !(spot > 0)) continue
    const t = yearFraction(time, expireDay)
    const callIv = impliedVolPercent(callBar.price, spot, strike, t, "call")
    const putIv = impliedVolPercent(putBar.price, spot, strike, t, "put")
    if (callIv == null || putIv == null) continue
    const mid = (callIv + putIv) / 2
    if (!(mid > 0)) continue
    if (agree && Math.abs(callIv - putIv) > Math.max(3, mid * 0.18)) continue
    bars.push({ time, close: Math.round(mid * 100) / 100 })
  }
  return settleIvBars(bars)
}

async function resolveEtfAtm(key: string, prevStrike: number | null) {
  const cfg = ETF[key as EtfKey]
  const month = await frontMonth(cfg.cate)
  if (!month) return null
  const [quotes, spotQuote] = await Promise.all([
    chainQuotes(cfg.listed, month.yymm),
    underlyingSpot(cfg.underlying),
  ])
  const spot0 = spotQuote ?? quotes.find((row) => row.side === "call")?.strike ?? null
  if (spot0 == null) return null
  let best: { strike: number; call: string; put: string; dist: number } | null = null
  const byStrike = new Map<number, { call?: string; put?: string }>()
  for (const row of quotes) {
    const pair = byStrike.get(row.strike) || {}
    pair[row.side] = row.code
    byStrike.set(row.strike, pair)
  }
  const step = strikeGap([...byStrike.keys()], spot0)
  const stickyLimit = step * 0.85
  if (prevStrike != null && Math.abs(spot0 - prevStrike) <= stickyLimit) {
    const held = byStrike.get(prevStrike)
    if (held?.call && held.put) {
      best = { strike: prevStrike, call: held.call, put: held.put, dist: Math.abs(spot0 - prevStrike) }
    }
  }
  if (!best) {
    for (const [strike, pair] of byStrike) {
      if (!pair.call || !pair.put) continue
      const dist = Math.abs(strike - spot0)
      if (!best || dist < best.dist) best = { strike, call: pair.call, put: pair.put, dist }
    }
  }
  if (!best) return null
  return { cfg, month, spot0, best, contract: etfPairLabel(cfg.listed, month.yymm, best.strike) }
}

export async function etfAtmContractLabel(key: string): Promise<string | null> {
  if (!(key in ETF)) return null
  const hit = cache.get(key)
  if (hit?.contract && Date.now() - hit.at < 60_000) return hit.contract
  try {
    const resolved = await resolveEtfAtm(key, hit?.strike ?? null)
    if (!resolved) return hit?.contract ?? null
    const prev = cache.get(key)
    cache.set(key, {
      at: prev?.bars.length ? prev.at : Date.now(),
      bars: prev?.bars ?? [],
      contract: resolved.contract,
      strike: resolved.best.strike,
    })
    return resolved.contract
  } catch {
    return hit?.contract ?? null
  }
}

function countSessions(bars: OverlayPoint[]) {
  const days = new Set<string>()
  for (const bar of bars) {
    const d = new Date(bar.time * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    days.add(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`)
  }
  return days.size
}

async function sinaFiveDayPoints(code: string, requireVolume = true): Promise<MinutePx[]> {
  const text = await jsonGet(
    `${OPTION_API}/StockOptionDaylineService.getFiveDayLine?symbol=CON_OP_${code}`,
    OPTION_REFERER,
  )
  const days =
    (JSON.parse(text) as { result?: { data?: Array<Array<{ i?: string; p?: string; v?: string; d?: string }>> } })
      .result?.data || []
  const points: MinutePx[] = []
  for (const rows of days) {
    if (!Array.isArray(rows) || !rows.length) continue
    const day = rows.find((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.d || "")))?.d
    if (!day) continue
    for (const row of rows) {
      const hhmm = hhmmOf(String(row.i || ""))
      const price = num(row.p)
      const volume = num(row.v) ?? 0
      if (!hhmm || price == null || !(price > 0) || (requireVolume && !(volume > 0))) continue
      points.push({ day, hhmm, price, volume })
    }
  }
  return points
}

function latestSessionDays(points: MinutePx[], limit: number, skipDay: string) {
  const days: string[] = []
  const seen = new Set<string>()
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const day = points[i]?.day
    if (!day || day === skipDay || seen.has(day)) continue
    seen.add(day)
    days.push(day)
    if (days.length >= limit) break
  }
  return new Set(days)
}

async function etfLookbackBars(
  callCode: string,
  putCode: string,
  underlying: string,
  spot0: number,
  strike: number,
  expireDay: string,
  ndays: number,
  agree: boolean,
) {
  const [callHist, putHist, callToday, putToday, spotMin] = await Promise.all([
    sinaFiveDayPoints(callCode),
    sinaFiveDayPoints(putCode),
    optionMinutes(callCode),
    optionMinutes(putCode),
    underlyingMinutes(underlying, ndays),
  ])
  const today = todayShanghai()
  const keep = latestSessionDays(callHist, Math.max(ndays - 1, 1), today)
  const stampToday = (rows: MinutePx[], date: string | null): MinutePx[] =>
    rows.map((row) => ({ ...row, day: date || today, volume: row.volume ?? 1 }))
  const call = [...callHist.filter((row) => row.day && keep.has(row.day)), ...stampToday(callToday.points, callToday.date)]
  const put = [...putHist.filter((row) => row.day && keep.has(row.day)), ...stampToday(putToday.points, putToday.date)]
  const date = callToday.date || putToday.date || today
  return buildBars(call, put, spotMin, spot0, strike, expireDay, date, agree, false)
}

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

export async function fetchEtfAtmIvMinutes(key: string, ndays = 1): Promise<AtmMinuteSeries | null> {
  if (!(key in ETF)) return null
  const days = Math.min(Math.max(Math.round(ndays) || 1, 1), 10)
  const today = todayShanghai()
  const cacheKey = days === 1 ? key : `${key}:d${days}`
  const hit = cache.get(cacheKey)
  const startOfToday = chinaWallToUnix(`${today} 00:00:00`)
  if (
    days === 1 &&
    hit?.bars.length &&
    startOfToday != null &&
    hit.bars[hit.bars.length - 1]!.time >= startOfToday &&
    afterCashClose()
  ) {
    return { bars: hit.bars, contract: hit.contract || "" }
  }
  if (hit && Date.now() - hit.at < CACHE_MS && hit.bars.length) {
    const last = hit.bars[hit.bars.length - 1]
    const start = chinaWallToUnix(`${today} 00:00:00`)
    const freshToday = start != null && last.time >= start
    if (freshToday && (days === 1 || countSessions(hit.bars) >= 2)) return { bars: hit.bars, contract: hit.contract || "" }
  }
  try {
    const resolved = await resolveEtfAtm(key, cache.get(key)?.strike ?? hit?.strike ?? null)
    if (!resolved) return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || "" } : null
    if (days > 1) {
      const bars = await etfLookbackBars(
        resolved.best.call,
        resolved.best.put,
        resolved.cfg.underlying,
        resolved.spot0,
        resolved.best.strike,
        resolved.month.expireDay,
        days,
        false,
      )
      if (bars.length < 8 || countSessions(bars) < 2) {
        return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || resolved.contract } : null
      }
      cache.set(cacheKey, { at: Date.now(), bars, contract: resolved.contract, strike: resolved.best.strike })
      return { bars, contract: resolved.contract }
    }
    const [callMin, putMin, spotMin] = await Promise.all([
      optionMinutes(resolved.best.call),
      optionMinutes(resolved.best.put),
      underlyingMinutes(resolved.cfg.underlying),
    ])
    const date = callMin.date || putMin.date
    if (date !== today) return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || resolved.contract } : null
    // Drop minutes where the call and put vols disagree, unless that filter
    // throws away most of the session. A thin surviving subset plots as a
    // nearly straight line (沪深300 was left with 22 of 120 minutes).
    const strict = buildBars(
      callMin.points,
      putMin.points,
      spotMin,
      resolved.spot0,
      resolved.best.strike,
      resolved.month.expireDay,
      date,
    )
    const relaxed = buildBars(
      callMin.points,
      putMin.points,
      spotMin,
      resolved.spot0,
      resolved.best.strike,
      resolved.month.expireDay,
      date,
      false,
    )
    const bars = strict.length >= 8 && strict.length >= relaxed.length * 0.6 ? strict : relaxed
    if (bars.length < 8) return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || resolved.contract } : null
    cache.set(cacheKey, { at: Date.now(), bars, contract: resolved.contract, strike: resolved.best.strike })
    return { bars, contract: resolved.contract }
  } catch {
    return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || "" } : null
  }
}

export type IvStrikeChoice = { strike: number; label: string; atm: boolean }

function pairAt<T>(byStrike: Map<number, T>, strike: number): T | undefined {
  const direct = byStrike.get(strike)
  if (direct) return direct
  for (const [key, pair] of byStrike) {
    if (Math.abs(key - strike) < 1e-3) return pair
  }
  return undefined
}

const etfListCache = new Map<string, { at: number; rows: IvStrikeChoice[] }>()

export async function listEtfIvContracts(key: string): Promise<IvStrikeChoice[]> {
  if (!(key in ETF)) return []
  const hit = etfListCache.get(key)
  if (hit && Date.now() - hit.at < 20_000) return hit.rows
  const cfg = ETF[key as EtfKey]
  const month = await frontMonth(cfg.cate)
  if (!month) return hit?.rows ?? []
  const [quotes, spotQuote] = await Promise.all([
    chainQuotes(cfg.listed, month.yymm),
    underlyingSpot(cfg.underlying),
  ])
  const byStrike = new Map<number, { call?: string; put?: string }>()
  for (const row of quotes) {
    const pair = byStrike.get(row.strike) || {}
    pair[row.side] = row.code
    byStrike.set(row.strike, pair)
  }
  const spot0 = spotQuote
  let atmStrike: number | null = null
  if (spot0 != null) {
    let best = Infinity
    for (const [strike, pair] of byStrike) {
      if (!pair.call || !pair.put) continue
      const dist = Math.abs(strike - spot0)
      if (dist < best) {
        best = dist
        atmStrike = strike
      }
    }
  }
  const rows = [...byStrike.entries()]
    .filter(([, pair]) => pair.call && pair.put)
    .sort((a, b) => a[0] - b[0])
    .map(([strike]) => ({
      strike,
      label: etfPairLabel(cfg.listed, month.yymm, strike),
      atm: atmStrike != null && Math.abs(strike - atmStrike) < 1e-3,
    }))
  etfListCache.set(key, { at: Date.now(), rows })
  return rows
}

export async function fetchEtfStrikeIvMinutes(key: string, strike: number, ndays = 1): Promise<AtmMinuteSeries | null> {
  if (!(key in ETF) || !(strike > 0)) return null
  const days = Math.min(Math.max(Math.round(ndays) || 1, 1), 10)
  const cacheKey = days === 1 ? `${key}:k:${strike}` : `${key}:k:${strike}:d${days}`
  const today = todayShanghai()
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS && hit.bars.length) {
    const last = hit.bars[hit.bars.length - 1]
    const start = chinaWallToUnix(`${today} 00:00:00`)
    const freshToday = start != null && last.time >= start
    if (freshToday && (days === 1 || countSessions(hit.bars) >= 2)) return { bars: hit.bars, contract: hit.contract || "" }
  }
  try {
    const cfg = ETF[key as EtfKey]
    const month = await frontMonth(cfg.cate)
    if (!month) return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || "" } : null
    const [quotes, spotQuote] = await Promise.all([
      chainQuotes(cfg.listed, month.yymm),
      underlyingSpot(cfg.underlying),
    ])
    const byStrike = new Map<number, { call?: string; put?: string }>()
    for (const row of quotes) {
      const pair = byStrike.get(row.strike) || {}
      pair[row.side] = row.code
      byStrike.set(row.strike, pair)
    }
    const picked = pairAt(byStrike, strike)
    if (!picked?.call || !picked.put) {
      return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || "" } : { bars: [], contract: "" }
    }
    const exactStrike = [...byStrike.keys()].find((item) => Math.abs(item - strike) < 1e-3) ?? strike
    const contract = etfPairLabel(cfg.listed, month.yymm, exactStrike)
    const spot0 = spotQuote ?? exactStrike
    if (days > 1) {
      const bars = await etfLookbackBars(picked.call, picked.put, cfg.underlying, spot0, exactStrike, month.expireDay, days, false)
      if (bars.length < 2 || countSessions(bars) < 2) {
        return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || contract } : { bars: [], contract }
      }
      cache.set(cacheKey, { at: Date.now(), bars, contract, strike: exactStrike })
      return { bars, contract }
    }
    const [callMin, putMin, spotMin] = await Promise.all([
      optionMinutes(picked.call),
      optionMinutes(picked.put),
      underlyingMinutes(cfg.underlying),
    ])
    const date = callMin.date || putMin.date
    if (date !== today) return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || contract } : { bars: [], contract }
    const bars = buildBars(callMin.points, putMin.points, spotMin, spot0, exactStrike, month.expireDay, date, false)
    if (!bars.length) return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || contract } : { bars: [], contract }
    cache.set(cacheKey, { at: Date.now(), bars, contract, strike: exactStrike })
    return { bars, contract }
  } catch {
    return hit?.bars.length ? { bars: hit.bars, contract: hit.contract || "" } : null
  }
}

/** Average call/put IV. Agreement filter stays off so a stable skew still plots. */
export function ivBarsFromPair(
  call: MinutePx[],
  put: MinutePx[],
  spotByMinute: Map<string, number>,
  fallbackSpot: number,
  strike: number,
  expireDay: string,
): OverlayPoint[] {
  const date = call.find((row) => row.day)?.day || put.find((row) => row.day)?.day || todayShanghai()
  return buildBars(call, put, spotByMinute, fallbackSpot, strike, expireDay, date, false, false)
}

let etfCapturePlan: { at: number; contracts: CaptureContract[] } | null = null

async function etfExpireDay(cate: string, month: string) {
  const remText = await jsonGet(
    `${OPTION_API}/StockOptionService.getRemainderDay?exchange=null&cate=${encodeURIComponent(cate)}&date=${month}`,
    OPTION_REFERER,
  )
  const expireDay = String(
    (JSON.parse(remText) as { result?: { data?: { expireDay?: string } } }).result?.data?.expireDay || "",
  )
  return /^\d{4}-\d{2}-\d{2}$/.test(expireDay) ? expireDay : null
}

/** Every listed month of 50/300/500 ETF options, cached for the capture sweep. */
export async function listEtfCaptureContracts(): Promise<CaptureContract[]> {
  if (etfCapturePlan && Date.now() - etfCapturePlan.at < 10 * 60_000 && etfCapturePlan.contracts.length) {
    return etfCapturePlan.contracts
  }
  const contracts: CaptureContract[] = []
  for (const key of Object.keys(ETF) as EtfKey[]) {
    const cfg = ETF[key]
    try {
      const text = await jsonGet(
        `${OPTION_API}/StockOptionService.getStockName?exchange=null&cate=${encodeURIComponent(cfg.cate)}`,
        OPTION_REFERER,
      )
      const months = [
        ...new Set(
          ((JSON.parse(text) as { result?: { data?: { contractMonth?: string[] } } }).result?.data?.contractMonth ||
            []
          ).filter((month) => /^\d{4}-\d{2}$/.test(month)),
        ),
      ]
      for (const month of months) {
        const expireDay = await etfExpireDay(cfg.cate, month).catch(() => null)
        const yymm = month.replace("-", "").slice(2)
        const quotes = await chainQuotes(cfg.listed, yymm).catch(() => [])
        for (const row of quotes) {
          contracts.push({
            underlyingKey: key,
            contractId: row.code,
            side: row.side,
            monthCode: yymm,
            strike: row.strike,
            expireDay,
          })
        }
      }
    } catch {
      // one underlying failing leaves the others usable
    }
  }
  if (contracts.length) etfCapturePlan = { at: Date.now(), contracts }
  return contracts
}

async function etfContractPrints(code: string, history: boolean) {
  const today = todayShanghai()
  const prints: Array<{ day: string; hhmm: string; price: number; volume: number | null }> = []
  if (history) {
    const hist = await sinaFiveDayPoints(code, false)
    for (const row of hist) {
      if (!row.day || row.day === today || !inSessionMinute(row.hhmm)) continue
      prints.push({ day: row.day, hhmm: row.hhmm, price: row.price, volume: row.volume ?? null })
    }
  }
  const live = await optionMinutes(code)
  const day = live.date && /^\d{4}-\d{2}-\d{2}$/.test(live.date) ? live.date : today
  for (const row of live.points) {
    if (!inSessionMinute(row.hhmm)) continue
    prints.push({ day, hhmm: row.hhmm, price: row.price, volume: row.volume ?? null })
  }
  return prints
}

export async function fetchEtfCaptureMinutes(contracts: CaptureContract[], history: boolean): Promise<StoredMinute[]> {
  const batches = await mapLimit(contracts, 4, async (contract) => {
    try {
      const prints = await etfContractPrints(contract.contractId, history)
      return prints.map((row) => ({ ...contract, ...row }))
    } catch {
      return [] as StoredMinute[]
    }
  })
  return batches.flat()
}

export async function fetchEtfSpotMinutes(days: number): Promise<StoredMinute[]> {
  const today = todayShanghai()
  const rows: StoredMinute[] = []
  for (const key of Object.keys(ETF) as EtfKey[]) {
    const map = await underlyingMinutes(ETF[key].underlying, days)
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
