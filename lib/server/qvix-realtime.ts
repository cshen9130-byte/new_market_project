import { INDEX_FUTURES, type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_IV, type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
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
    const close = num(parts[parts.length === 2 ? 1 : 4] ?? parts[1])
    if (close == null) continue
    const day = stamp.includes(" ") ? stamp : /^\d{1,2}:\d{2}/.test(stamp) ? `${date} ${stamp}` : stamp
    const time = chinaWallToUnix(day.length === 16 ? `${day}:00` : day)
    if (time == null) continue
    bars.push({ time, close })
  }
  return bars
}

async function fetchOptbbsMin(code: string) {
  const res = await fetch(`https://1.optbbs.com/d/csv/data/${code}.min.csv`, {
    cache: "no-store",
    headers: {
      "User-Agent": SINA_UA,
      Referer: "https://1.optbbs.com/",
    },
  })
  if (!res.ok) throw new Error(`optbbs ${code} ${res.status}`)
  return barsFromMinCsv(await res.text())
}

async function fetchOptbbsDailyLast(code: string) {
  const res = await fetch(`https://1.optbbs.com/d/csv/data/${code}.csv`, {
    cache: "no-store",
    headers: {
      "User-Agent": SINA_UA,
      Referer: "https://1.optbbs.com/",
    },
  })
  if (!res.ok) throw new Error(`optbbs daily ${code} ${res.status}`)
  const lines = parseCsv(await res.text())
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const parts = lines[i].split(",")
    const close = num(parts[4] ?? parts[1])
    const time = chinaWallToUnix(`${parts[0]} 15:00:00`)
    if (close != null && time != null) return { close, time, date: parts[0] }
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
  "1000index": "1000ETF",
}

async function loadIv(product: IndexProduct): Promise<IvSnapshot> {
  const meta = INDEX_IV[product]
  const codes = [...new Set([meta.key, meta.fallback])]
  let bars: OverlayPoint[] = []
  let source: string | null = null
  for (const code of codes) {
    try {
      bars = await fetchOptbbsMin(code)
      if (bars.length) {
        source = `optbbs:${code}`
        break
      }
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
  const prev = bars.length > 1 ? bars[0].close : null
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
