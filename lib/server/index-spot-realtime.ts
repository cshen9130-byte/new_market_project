import { INDEX_FUTURES, type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_SPOT, type SpotSnapshot } from "@/lib/client/realtime-overlay"
import { chinaWallToUnix, sinaGet } from "@/lib/server/sina-fetch"

function num(value: string | undefined) {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseIndexHq(text: string) {
  const quotes = new Map<
    string,
    { last: number | null; preClose: number | null; date: string | null; time: string | null }
  >()
  const re = /var hq_str_(sh\d+)="([^"]*)";/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const symbol = match[1].toLowerCase()
    const parts = match[2].split(",")
    quotes.set(symbol, {
      last: num(parts[3]),
      preClose: num(parts[2]),
      date: parts[30] || null,
      time: parts[31] || null,
    })
  }
  return quotes
}

async function fetchMinBars(sina: string) {
  const text = await sinaGet(
    `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sina}&scale=1&ma=no&datalen=390`,
    `https://finance.sina.com.cn/realstock/company/${sina}/nc.shtml`,
  )
  let rows: Array<{ day?: string; close?: string }> = []
  try {
    rows = JSON.parse(text) as Array<{ day?: string; close?: string }>
  } catch {
    const open = text.indexOf("[")
    const close = text.lastIndexOf("]")
    if (open < 0 || close < open) return []
    rows = JSON.parse(text.slice(open, close + 1)) as Array<{ day?: string; close?: string }>
  }
  const bars: SpotSnapshot["bars"] = []
  for (const row of rows) {
    const day = String(row.day || "")
    const close = num(String(row.close ?? ""))
    const time = chinaWallToUnix(day)
    if (time == null || close == null) continue
    bars.push({ time, close })
  }
  return bars
}

let inflight: Promise<Record<IndexProduct, SpotSnapshot>> | null = null
let cached: { at: number; data: Record<IndexProduct, SpotSnapshot> } | null = null
const TTL_MS = 2000

export async function getIndexSpotRealtime() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  if (inflight) return inflight
  inflight = (async () => {
    const list = INDEX_FUTURES.map((item) => INDEX_SPOT[item.product].sina).join(",")
    const hqText = await sinaGet(`https://hq.sinajs.cn/list=${list}`, "https://finance.sina.com.cn")
    const quotes = parseIndexHq(hqText)
    const entries = await Promise.all(
      INDEX_FUTURES.map(async (item) => {
        const meta = INDEX_SPOT[item.product]
        const quote = quotes.get(meta.sina)
        let bars: SpotSnapshot["bars"] = []
        try {
          bars = await fetchMinBars(meta.sina)
        } catch {
          bars = []
        }
        const lastBar = bars.at(-1)
        const price = quote?.last ?? lastBar?.close ?? null
        const preClose = quote?.preClose ?? null
        const change = price != null && preClose != null ? price - preClose : null
        const pct = change != null && preClose ? (change / preClose) * 100 : null
        if (quote?.date && quote.time && price != null) {
          const time = chinaWallToUnix(`${quote.date} ${quote.time.slice(0, 5)}`)
          if (time != null) {
            const prev = bars.at(-1)
            if (!prev || time > prev.time) bars.push({ time, close: price })
            else if (prev.time === time) prev.close = price
          }
        }
        const snap: SpotSnapshot = {
          product: item.product,
          sina: meta.sina,
          name: meta.name,
          price,
          preClose,
          change,
          pct,
          updateTime: quote?.time ?? null,
          bars,
        }
        return [item.product, snap] as const
      }),
    )
    return Object.fromEntries(entries) as Record<IndexProduct, SpotSnapshot>
  })().finally(() => {
    inflight = null
  })
  const data = await inflight
  cached = { at: Date.now(), data }
  return data
}
