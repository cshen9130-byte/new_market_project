import { INDEX_FUTURES, type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_IV, type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { query } from "@/lib/db"
import { chinaWallToUnix, SINA_UA, sinaGet } from "@/lib/server/sina-fetch"

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

function parseCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function barsFromMinCsv(text: string): OverlayPoint[] {
  const lines = parseCsv(text)
  if (lines.length < 2) return []
  const header = lines[0].toLowerCase()
  const date = todayShanghai()
  const bars: OverlayPoint[] = []
  for (const line of lines.slice(header.includes("time") || header.includes("date") ? 1 : 0)) {
    const parts = line.split(",").map((p) => p.trim())
    if (parts.length < 2) continue
    const stamp = parts[0]
    const close = num(parts[1])
    if (close == null || !(close > 0)) continue
    const rounded = Math.round(close * 100) / 100
    const day = stamp.includes(" ") ? stamp : /^\d{1,2}:\d{2}/.test(stamp) ? `${date} ${stamp}` : stamp
    const time = chinaWallToUnix(day.length === 16 ? `${day}:00` : day)
    if (time == null) continue
    bars.push({ time, close: rounded })
  }
  return bars
}

const OPTBBS_MIN_FILE: Record<string, string> = {
  "50etf": "vix50",
  "50index": "vix50index",
  "300etf": "vix300",
  "300index": "vixindex",
  "500etf": "vix500",
  "1000etf": "vix1000",
  "1000index": "vixindex1000",
}

async function fetchText(url: string, referer: string) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": SINA_UA,
      Referer: referer,
    },
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.text()
}

async function fetchOptbbsMin(code: string) {
  const file = OPTBBS_MIN_FILE[code] || code
  const paths = [
    `http://1.optbbs.com/d/csv/d/${file}.csv`,
    `https://1.optbbs.com/d/csv/d/${file}.csv`,
    `https://1.optbbs.com/d/csv/data/${code}.min.csv`,
  ]
  let lastErr: Error | null = null
  for (const url of paths) {
    try {
      const bars = barsFromMinCsv(await fetchText(url, "http://1.optbbs.com/s/vix.shtml"))
      if (bars.length >= 8) return bars
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastErr || new Error(`optbbs ${code} empty`)
}

async function fetchOptbbsDailyLast(code: string) {
  const file = OPTBBS_MIN_FILE[code]
  const urls = file
    ? [`http://1.optbbs.com/d/csv/d/${file}.csv`, `https://1.optbbs.com/d/csv/data/${code}.csv`]
    : [`https://1.optbbs.com/d/csv/data/${code}.csv`]
  for (const url of urls) {
    try {
      const lines = parseCsv(await fetchText(url, "http://1.optbbs.com/s/vix.shtml"))
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const parts = lines[i].split(",")
        const close = num(parts[parts.length === 2 ? 1 : 4] ?? parts[1])
        const stamp = parts[0]?.trim() || ""
        const time = /\d{4}-\d{2}-\d{2}/.test(stamp)
          ? chinaWallToUnix(stamp.includes(" ") ? stamp : `${stamp} 15:00:00`)
          : chinaWallToUnix(`${todayShanghai()} ${/^\d{1,2}:\d{2}/.test(stamp) ? stamp : "15:00:00"}`)
        if (close != null && time != null) return { close, time, date: stamp }
      }
    } catch {
      // try next url
    }
  }
  return null
}

async function fetchSinaQvixMin(symbol: string) {
  const text = await sinaGet(
    `https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionServiceService.getUndelayMinLine?symbol=${encodeURIComponent(symbol)}`,
    "https://stock.finance.sina.com.cn/option/quotes.html",
  )
  const json = JSON.parse(text) as {
    result?: { data?: { minLine?: Array<Array<string | number>> } }
  }
  const rows = json.result?.data?.minLine || []
  const date = todayShanghai()
  const bars: OverlayPoint[] = []
  for (const row of rows) {
    const hhmm = String(row[0] || "")
    const close = num(row[1])
    const time = chinaWallToUnix(`${date} ${hhmm.length === 5 ? `${hhmm}:00` : hhmm}`)
    if (time == null || close == null) continue
    bars.push({ time, close })
  }
  return bars
}

const SINA_QVIX_SYMBOL: Record<string, string> = {
  "50etf": "50ETF",
  "50index": "50ETF",
  "300etf": "300ETF",
  "300index": "300ETF",
  "500etf": "500ETF",
  "1000etf": "1000ETF",
  "1000index": "1000ETF",
}

let dailyCache: { at: number; byKey: Record<string, OverlayPoint[]> } | null = null
const DAILY_TTL_MS = 5 * 60_000

async function fetchQvixDailyFromDb(key: string): Promise<OverlayPoint[]> {
  if (dailyCache && Date.now() - dailyCache.at < DAILY_TTL_MS) {
    return dailyCache.byKey[key] || []
  }
  try {
    const rows = await query<{ trade_date: string; underlying_key: string; iv: string | number }>(
      `SELECT trade_date::text AS trade_date, underlying_key, iv
       FROM raw_option_iv_qvix_daily
       WHERE underlying_key IN ('50etf','50index','300etf','300index','500etf','1000index','1000etf')
         AND iv IS NOT NULL AND iv > 0
       ORDER BY trade_date ASC`,
    )
    const byKey: Record<string, OverlayPoint[]> = {}
    for (const row of rows) {
      const close = num(row.iv)
      const day = String(row.trade_date).slice(0, 10)
      const time = chinaWallToUnix(`${day} 15:00:00`)
      if (close == null || time == null) continue
      const list = byKey[row.underlying_key] || (byKey[row.underlying_key] = [])
      list.push({ time, close })
    }
    dailyCache = { at: Date.now(), byKey }
    return byKey[key] || []
  } catch {
    return dailyCache?.byKey[key] || []
  }
}

async function fetchOptbbsPre(code: string): Promise<number | null> {
  const file = OPTBBS_MIN_FILE[code] || code
  try {
    const text = await fetchText(`http://1.optbbs.com/d/csv/d/${file}.csv`, "http://1.optbbs.com/s/vix.shtml")
    for (const line of parseCsv(text).slice(1)) {
      const pre = num(line.split(",")[2])
      if (pre != null && pre > 0) return pre
    }
  } catch {
    return null
  }
  return null
}

async function loadIv(product: IndexProduct): Promise<IvSnapshot> {
  const meta = INDEX_IV[product]
  const codes = [...new Set([meta.key, meta.fallback])]
  let bars: OverlayPoint[] = []
  let source: string | null = null
  for (const code of codes) {
    try {
      bars = await fetchOptbbsMin(code)
      if (bars.length >= 8) {
        source = `optbbs:${code}`
        break
      }
      bars = []
    } catch {
      // try next
    }
  }
  if (!bars.length) {
    try {
      bars = await fetchSinaQvixMin(SINA_QVIX_SYMBOL[meta.key] || "50ETF")
      if (bars.length) source = "sina"
    } catch {
      // ignore
    }
  }
  if (bars.length < 8) {
    for (const code of codes) {
      const daily = await fetchQvixDailyFromDb(code)
      if (daily.length >= 2) {
        bars = daily.slice(-90)
        source = `db:${code}`
        break
      }
    }
  }
  if (bars.length < 2) {
    for (const code of codes) {
      const pre = await fetchOptbbsPre(code)
      if (pre == null) continue
      const openT = chinaWallToUnix(`${todayShanghai()} 09:30:00`)
      const closeT = chinaWallToUnix(`${todayShanghai()} 15:00:00`)
      if (openT != null && closeT != null) {
        bars = [
          { time: openT, close: pre },
          { time: closeT, close: pre },
        ]
        source = `optbbs-pre:${code}`
        break
      }
    }
  }
  let value = bars.at(-1)?.close ?? null
  if (value == null) {
    for (const code of codes) {
      try {
        const last = await fetchOptbbsDailyLast(code)
        if (last) {
          value = last.close
          source = `optbbs-daily:${code}`
          bars = [{ time: last.time, close: last.close }]
          break
        }
      } catch {
        // ignore
      }
    }
  }
  const prev = bars.length < 2
    ? null
    : source?.startsWith("db:")
      ? bars[bars.length - 2]?.close ?? null
      : bars[0].close
  const change = value != null && prev != null ? value - prev : null
  const pct = change != null && prev ? (change / prev) * 100 : null
  return {
    product,
    key: meta.key,
    option: meta.option,
    name: meta.name,
    value,
    change,
    pct,
    source,
    bars,
  }
}

let inflight: Promise<Record<IndexProduct, IvSnapshot>> | null = null
let cached: { at: number; data: Record<IndexProduct, IvSnapshot> } | null = null
const TTL_MS = 3000

export async function getQvixRealtime() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  if (inflight) return inflight
  inflight = (async () => {
    const rows = await Promise.all(INDEX_FUTURES.map((item) => loadIv(item.product)))
    return Object.fromEntries(rows.map((row) => [row.product, row])) as Record<IndexProduct, IvSnapshot>
  })().finally(() => {
    inflight = null
  })
  const data = await inflight
  cached = { at: Date.now(), data }
  return data
}
