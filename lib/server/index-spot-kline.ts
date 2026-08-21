import type { IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_SPOT, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { aggregateCloseSeries, type TimeframeId } from "@/lib/client/timeframes"
import { query } from "@/lib/db"
import { chinaWallToUnix, sinaGet } from "@/lib/server/sina-fetch"

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseRows(text: string): OverlayPoint[] {
  let rows: Array<{ day?: string; close?: string | number }> = []
  try {
    rows = JSON.parse(text) as Array<{ day?: string; close?: string | number }>
  } catch {
    const open = text.indexOf("[")
    const close = text.lastIndexOf("]")
    if (open < 0 || close < open) return []
    rows = JSON.parse(text.slice(open, close + 1)) as Array<{ day?: string; close?: string | number }>
  }
  const bars: OverlayPoint[] = []
  for (const row of rows) {
    const day = String(row.day || "")
    const close = num(row.close)
    const time = chinaWallToUnix(day)
    if (time == null || close == null || !(close > 0)) continue
    bars.push({ time, close })
  }
  return sortUnique(bars)
}

function sortUnique(bars: OverlayPoint[]) {
  const map = new Map<number, OverlayPoint>()
  for (const bar of bars) map.set(bar.time, bar)
  return [...map.values()].sort((a, b) => a.time - b.time)
}

async function fetchScale(sina: string, scale: number, datalen: number) {
  const text = await sinaGet(
    `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sina}&scale=${scale}&ma=no&datalen=${datalen}`,
    `https://finance.sina.com.cn/realstock/company/${sina}/nc.shtml`,
  )
  return parseRows(text)
}

async function fetchDailyFromDb(product: IndexProduct): Promise<OverlayPoint[]> {
  try {
    const rows = await query<{ trade_date: string; close: number }>(
      `SELECT trade_date::text AS trade_date, close::float8 AS close
         FROM raw_spot_daily
        WHERE UPPER(symbol) = $1 AND close IS NOT NULL AND close::float8 > 0
        ORDER BY trade_date`,
      [product],
    )
    const bars: OverlayPoint[] = []
    for (const row of rows) {
      const day = String(row.trade_date).slice(0, 10)
      const time = chinaWallToUnix(`${day} 00:00:00`)
      const close = num(row.close)
      if (time == null || close == null) continue
      bars.push({ time, close })
    }
    return sortUnique(bars)
  } catch {
    return []
  }
}

const SCALE: Partial<Record<TimeframeId, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
}

const cache = new Map<string, { at: number; data: OverlayPoint[] }>()

export async function getIndexSpotKline(product: IndexProduct, interval: TimeframeId) {
  const key = `${product}:${interval}`
  const ttl = interval === "1d" || interval === "1w" || interval === "1M" ? 60_000 : 12_000
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data

  const sina = INDEX_SPOT[product].sina
  let data: OverlayPoint[] = []
  const scale = SCALE[interval]
  if (scale != null) {
    data = await fetchScale(sina, scale, interval === "1m" ? 390 : 1023)
    if (data.length < 8 && interval !== "1m") {
      data = aggregateCloseSeries(await fetchScale(sina, 1, 390), interval)
    }
  } else if (interval === "4h") {
    const hourly = await fetchScale(sina, 60, 1023)
    data = aggregateCloseSeries(hourly.length ? hourly : await fetchScale(sina, 1, 390), "4h")
  } else {
    const sinaDaily = await fetchScale(sina, 240, 400)
    const dbDaily = await fetchDailyFromDb(product)
    const daily = sortUnique([...dbDaily, ...sinaDaily])
    data = interval === "1d" ? daily : aggregateCloseSeries(daily, interval)
  }

  data = sortUnique(data)
  if (data.length >= 8 || !hit?.data.length) cache.set(key, { at: Date.now(), data })
  else data = hit.data
  return data
}
