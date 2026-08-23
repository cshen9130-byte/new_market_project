import { SCALE_INDICES, type ScaleIndexPoint, type ScaleIndexSeries } from "@/lib/client/scale-indices"
import { query } from "@/lib/db"
import { sinaGet } from "@/lib/server/sina-fetch"

const QQ_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function toYmd(value: Date | string) {
  return String(value).slice(0, 10)
}

function mergeByDate(...lists: ScaleIndexPoint[][]) {
  const map = new Map<string, number>()
  for (const list of lists) {
    for (const row of list) {
      if (!map.has(row.date)) map.set(row.date, row.close)
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }))
}

function parseSinaDaily(text: string): ScaleIndexPoint[] {
  let rows: Array<{ day?: string; close?: string | number }> = []
  try {
    rows = JSON.parse(text) as Array<{ day?: string; close?: string | number }>
  } catch {
    const open = text.indexOf("[")
    const close = text.lastIndexOf("]")
    if (open < 0 || close < open) return []
    rows = JSON.parse(text.slice(open, close + 1)) as Array<{ day?: string; close?: string | number }>
  }
  const out: ScaleIndexPoint[] = []
  for (const row of rows) {
    const date = String(row.day || "").slice(0, 10)
    const close = num(row.close)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null) continue
    out.push({ date, close })
  }
  return out
}

async function fetchSinaDaily(symbol: string): Promise<ScaleIndexPoint[]> {
  const text = await sinaGet(
    `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=1023`,
    `https://finance.sina.com.cn/realstock/company/${symbol}/nc.shtml`,
  )
  return parseSinaDaily(text)
}

async function fetchQqDaily(symbol: string): Promise<ScaleIndexPoint[]> {
  const res = await fetch(
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(symbol)},day,,,1023,qfq`,
    { cache: "no-store", headers: { "User-Agent": QQ_UA } },
  )
  if (!res.ok) return []
  const json = (await res.json()) as {
    data?: Record<string, { day?: Array<Array<string | number>> }>
  }
  const rows = json.data?.[symbol]?.day || []
  const out: ScaleIndexPoint[] = []
  for (const row of rows) {
    const date = String(row?.[0] || "").slice(0, 10)
    const close = num(row?.[2])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null) continue
    out.push({ date, close })
  }
  return out
}

async function loadDbSpot() {
  const rows = await query<{ symbol: string; trade_date: string; close: string | number }>(
    `SELECT UPPER(symbol) AS symbol, trade_date::text AS trade_date, close
     FROM raw_spot_daily
     WHERE UPPER(symbol) IN ('IH', 'IF', 'IC', 'IM')
       AND close IS NOT NULL AND close > 0
     ORDER BY symbol, trade_date, fetched_at DESC`,
  )
  const bySymbol = new Map<string, ScaleIndexPoint[]>()
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.symbol}:${toYmd(row.trade_date)}`
    if (seen.has(key)) continue
    seen.add(key)
    const close = num(row.close)
    if (close == null) continue
    const list = bySymbol.get(row.symbol) || []
    list.push({ date: toYmd(row.trade_date), close })
    bySymbol.set(row.symbol, list)
  }
  return bySymbol
}

async function loadDbAshare() {
  const codes = SCALE_INDICES.map((item) => item.tsCode)
  try {
    const rows = await query<{ ts_code: string; trade_date: string; close: string | number }>(
      `SELECT ts_code, trade_date::text AS trade_date, close
       FROM raw_ashare_index_daily
       WHERE ts_code = ANY($1)
         AND close IS NOT NULL AND close > 0
       ORDER BY ts_code, trade_date`,
      [codes],
    )
    const byCode = new Map<string, ScaleIndexPoint[]>()
    for (const row of rows) {
      const close = num(row.close)
      if (close == null) continue
      const list = byCode.get(row.ts_code) || []
      list.push({ date: toYmd(row.trade_date), close })
      byCode.set(row.ts_code, list)
    }
    return byCode
  } catch {
    return new Map<string, ScaleIndexPoint[]>()
  }
}

let cache: { at: number; data: ScaleIndexSeries[] } | null = null
const CACHE_MS = 5 * 60_000

export async function getScaleIndexDaily(): Promise<ScaleIndexSeries[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data

  const [spot, ashare] = await Promise.all([loadDbSpot(), loadDbAshare()])
  const series = await Promise.all(
    SCALE_INDICES.map(async (item) => {
      const remote: ScaleIndexPoint[][] = []
      try {
        if (item.sina) remote.push(await fetchSinaDaily(item.sina))
      } catch {
        remote.push([])
      }
      try {
        remote.push(await fetchQqDaily(item.qq))
      } catch {
        remote.push([])
      }
      const dbRows = [
        ...(item.dbSymbol ? spot.get(item.dbSymbol) || [] : []),
        ...((ashare.get(item.tsCode) || []) as ScaleIndexPoint[]),
      ]
      return {
        id: item.id,
        name: item.name,
        color: item.color,
        points: mergeByDate(dbRows, ...remote),
      }
    }),
  )

  if (series.some((row) => row.points.length > 8) || !cache?.data.length) {
    cache = { at: Date.now(), data: series }
  }
  return cache?.data ?? series
}
