import { fmtIso, n, publicQuery } from "@/lib/db"

export const CCIDX_COMMODITY_INDEX_KEY = "100001.CCI"
export const CCIDX_COMMODITY_INDEX_LABEL = "中证商品指数"
export const CCIDX_COMMODITY_INDEX_TS_CODE = "100001.CCI"

const CCIDX_DATE_LINE_URL = "http://www.ccidx.com/CCI-ZZZS/index/getDateLine?indexId=100001.CCI"
const STALE_AFTER_DAYS = 4

type CcidxPoint = { date: string; value: number }

function ymd(value: Date | string): string {
  return String(value).slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

async function ensureAshareIndexTable(): Promise<void> {
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS public.raw_ashare_index_daily (
      trade_date  DATE          NOT NULL,
      ts_code     VARCHAR(20)   NOT NULL,
      close       NUMERIC(12,4) NOT NULL,
      source      VARCHAR(30)   NOT NULL DEFAULT 'choice',
      fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      CONSTRAINT raw_ashare_index_daily_uq UNIQUE (trade_date, ts_code)
    )
  `)
  await publicQuery(`
    CREATE INDEX IF NOT EXISTS raw_ashare_index_daily_code_date_idx
      ON public.raw_ashare_index_daily (ts_code, trade_date DESC)
  `)
}

async function queryCached(from: string, to: string): Promise<CcidxPoint[]> {
  try {
    const result = await publicQuery(
      `SELECT trade_date, close
       FROM public.raw_ashare_index_daily
       WHERE ts_code = $1
         AND trade_date >= $2::date
         AND trade_date <= $3::date
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC`,
      [CCIDX_COMMODITY_INDEX_TS_CODE, from, to],
    )
    return (result.rows as Array<{ trade_date: Date | string; close: string | number | null }>)
      .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
      .filter((row): row is CcidxPoint => row.value != null)
  } catch {
    return []
  }
}

async function latestCachedDate(): Promise<string | null> {
  try {
    const result = await publicQuery(
      `SELECT MAX(trade_date) AS trade_date
       FROM public.raw_ashare_index_daily
       WHERE ts_code = $1`,
      [CCIDX_COMMODITY_INDEX_TS_CODE],
    )
    const value = (result.rows[0] as { trade_date?: Date | string } | undefined)?.trade_date
    return value ? ymd(value) : null
  } catch {
    return null
  }
}

function parseCcidxPoints(payload: unknown): CcidxPoint[] {
  const root = payload as {
    data?: { dateLineJson?: Array<{ tradeDate?: string; closingPrice?: string | number | null }> }
  }
  const lines = root?.data?.dateLineJson
  if (!Array.isArray(lines)) return []

  const out: CcidxPoint[] = []
  for (const item of lines) {
    const date = ymd(item?.tradeDate ?? "")
    const value = n(item?.closingPrice)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value == null || value <= 0) continue
    out.push({ date, value })
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

async function fetchCcidxPoints(): Promise<CcidxPoint[]> {
  const res = await fetch(CCIDX_DATE_LINE_URL, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "http://www.ccidx.com/",
    },
  })
  if (!res.ok) throw new Error(`CCIDX ${res.status}`)
  return parseCcidxPoints(await res.json())
}

async function upsertCached(points: CcidxPoint[]): Promise<void> {
  if (!points.length) return
  await ensureAshareIndexTable()
  const chunkSize = 200
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize)
    const values: unknown[] = []
    const placeholders = chunk.map((point, idx) => {
      const base = idx * 3
      values.push(point.date, CCIDX_COMMODITY_INDEX_TS_CODE, point.value)
      return `($${base + 1}::date, $${base + 2}, $${base + 3}, 'ccidx')`
    })
    await publicQuery(
      `INSERT INTO public.raw_ashare_index_daily (trade_date, ts_code, close, source)
       VALUES ${placeholders.join(",")}
       ON CONFLICT (trade_date, ts_code) DO UPDATE
         SET close = EXCLUDED.close, source = EXCLUDED.source, fetched_at = NOW()`,
      values,
    )
  }
}

function needsRefresh(latest: string | null, to: string): boolean {
  if (!latest) return true
  const floor = addDays(todayIso(), -STALE_AFTER_DAYS)
  return latest < to && latest < floor
}

export async function loadCcidxCommodityIndexPrices(
  from: string,
  to: string,
): Promise<CcidxPoint[]> {
  const latest = await latestCachedDate()
  if (!needsRefresh(latest, to)) {
    return queryCached(from, to)
  }

  try {
    const fetched = await fetchCcidxPoints()
    try {
      await upsertCached(fetched)
    } catch {
      // DB may be unavailable; still serve the live series.
    }
    return fetched.filter((row) => row.date >= from && row.date <= to)
  } catch {
    return queryCached(from, to)
  }
}
