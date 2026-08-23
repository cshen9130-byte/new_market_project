import {
  SCALE_INDICES,
  type ScaleIndexBeatSeries,
  type ScaleIndexFreq,
  type ScaleIndexId,
} from "@/lib/client/scale-indices"
import { query } from "@/lib/db"
import { getScaleIndexDaily } from "@/lib/server/scale-index-daily"

type BeatRow = {
  date: string
  hs300: string | number | null
  zz500: string | number | null
  zz1000: string | number | null
  zz2000: string | number | null
  sz50: string | number | null
  zzqz: string | number | null
}

const AVG_COLS = `
  AVG(CASE WHEN i.hs300 IS NULL THEN NULL WHEN s.ret > i.hs300 THEN 1.0 ELSE 0.0 END) * 100 AS hs300,
  AVG(CASE WHEN i.zz500 IS NULL THEN NULL WHEN s.ret > i.zz500 THEN 1.0 ELSE 0.0 END) * 100 AS zz500,
  AVG(CASE WHEN i.zz1000 IS NULL THEN NULL WHEN s.ret > i.zz1000 THEN 1.0 ELSE 0.0 END) * 100 AS zz1000,
  AVG(CASE WHEN i.zz2000 IS NULL THEN NULL WHEN s.ret > i.zz2000 THEN 1.0 ELSE 0.0 END) * 100 AS zz2000,
  AVG(CASE WHEN i.sz50 IS NULL THEN NULL WHEN s.ret > i.sz50 THEN 1.0 ELSE 0.0 END) * 100 AS sz50,
  AVG(CASE WHEN i.zzqz IS NULL THEN NULL WHEN s.ret > i.zzqz THEN 1.0 ELSE 0.0 END) * 100 AS zzqz`

function alignIndexCloses(series: Awaited<ReturnType<typeof getScaleIndexDaily>>) {
  const dates = [...new Set(series.flatMap((row) => row.points.map((p) => p.date)))].sort()
  const maps = new Map(series.map((row) => [row.id, new Map(row.points.map((p) => [p.date, p.close]))]))
  const col = (id: ScaleIndexId) => dates.map((date) => maps.get(id)?.get(date) ?? null)
  return {
    dates,
    hs300: col("hs300"),
    zz500: col("zz500"),
    zz1000: col("zz1000"),
    zz2000: col("zz2000"),
    sz50: col("sz50"),
    zzqz: col("zzqz"),
  }
}

function rowsToPoints(rows: BeatRow[], id: ScaleIndexId) {
  return rows
    .map((row) => {
      const value = Number(row[id])
      return Number.isFinite(value) ? { date: String(row.date).slice(0, 10), value } : null
    })
    .filter((row): row is { date: string; value: number } => row != null)
}

async function beatRatioDaily(aligned: ReturnType<typeof alignIndexCloses>) {
  return query<BeatRow>(
    `WITH idx_px AS (
       SELECT * FROM unnest($1::date[], $2::float8[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[])
         AS t(trade_date, hs300, zz500, zz1000, zz2000, sz50, zzqz)
     ),
     idx_ret AS (
       SELECT
         trade_date,
         hs300 / NULLIF(LAG(hs300) OVER (ORDER BY trade_date), 0) - 1 AS hs300,
         zz500 / NULLIF(LAG(zz500) OVER (ORDER BY trade_date), 0) - 1 AS zz500,
         zz1000 / NULLIF(LAG(zz1000) OVER (ORDER BY trade_date), 0) - 1 AS zz1000,
         zz2000 / NULLIF(LAG(zz2000) OVER (ORDER BY trade_date), 0) - 1 AS zz2000,
         sz50 / NULLIF(LAG(sz50) OVER (ORDER BY trade_date), 0) - 1 AS sz50,
         zzqz / NULLIF(LAG(zzqz) OVER (ORDER BY trade_date), 0) - 1 AS zzqz
       FROM idx_px
     ),
     stk AS (
       SELECT
         trade_date,
         close / NULLIF(LAG(close) OVER (PARTITION BY ts_code ORDER BY trade_date), 0) - 1 AS ret
       FROM raw_ashare_daily
       WHERE close > 0 AND COALESCE(volume, 0) > 0
     )
     SELECT s.trade_date::text AS date, ${AVG_COLS}
     FROM stk s
     JOIN idx_ret i ON i.trade_date = s.trade_date
     WHERE s.ret IS NOT NULL
     GROUP BY s.trade_date
     ORDER BY 1`,
    [aligned.dates, aligned.hs300, aligned.zz500, aligned.zz1000, aligned.zz2000, aligned.sz50, aligned.zzqz],
  )
}

async function beatRatioPeriod(aligned: ReturnType<typeof alignIndexCloses>, fmt: string) {
  return query<BeatRow>(
    `WITH idx_px AS (
       SELECT * FROM unnest($1::date[], $2::float8[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[])
         AS t(trade_date, hs300, zz500, zz1000, zz2000, sz50, zzqz)
     ),
     idx_last AS (
       SELECT DISTINCT ON (to_char(trade_date, $8))
         to_char(trade_date, $8) AS period_key,
         trade_date,
         hs300, zz500, zz1000, zz2000, sz50, zzqz
       FROM idx_px
       ORDER BY to_char(trade_date, $8), trade_date DESC
     ),
     idx_ret AS (
       SELECT
         period_key,
         trade_date,
         hs300 / NULLIF(LAG(hs300) OVER (ORDER BY period_key), 0) - 1 AS hs300,
         zz500 / NULLIF(LAG(zz500) OVER (ORDER BY period_key), 0) - 1 AS zz500,
         zz1000 / NULLIF(LAG(zz1000) OVER (ORDER BY period_key), 0) - 1 AS zz1000,
         zz2000 / NULLIF(LAG(zz2000) OVER (ORDER BY period_key), 0) - 1 AS zz2000,
         sz50 / NULLIF(LAG(sz50) OVER (ORDER BY period_key), 0) - 1 AS sz50,
         zzqz / NULLIF(LAG(zzqz) OVER (ORDER BY period_key), 0) - 1 AS zzqz
       FROM idx_last
     ),
     stk_last AS (
       SELECT DISTINCT ON (ts_code, to_char(trade_date, $8))
         to_char(trade_date, $8) AS period_key,
         ts_code,
         close
       FROM raw_ashare_daily
       WHERE close > 0 AND COALESCE(volume, 0) > 0
       ORDER BY ts_code, to_char(trade_date, $8), trade_date DESC
     ),
     stk_ret AS (
       SELECT
         period_key,
         close / NULLIF(LAG(close) OVER (PARTITION BY ts_code ORDER BY period_key), 0) - 1 AS ret
       FROM stk_last
     )
     SELECT i.trade_date::text AS date, ${AVG_COLS}
     FROM stk_ret s
     JOIN idx_ret i ON i.period_key = s.period_key
     WHERE s.ret IS NOT NULL
     GROUP BY i.trade_date
     ORDER BY 1`,
    [aligned.dates, aligned.hs300, aligned.zz500, aligned.zz1000, aligned.zz2000, aligned.sz50, aligned.zzqz, fmt],
  )
}

const cache = new Map<ScaleIndexFreq, { at: number; data: ScaleIndexBeatSeries[] }>()
const CACHE_MS = 10 * 60_000

const PERIOD_FMT: Record<Exclude<ScaleIndexFreq, "d">, string> = {
  w: "IYYY-IW",
  m: "YYYY-MM",
}

export async function getScaleIndexBeatRatio(freq: ScaleIndexFreq = "d"): Promise<ScaleIndexBeatSeries[]> {
  const hit = cache.get(freq)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data

  const indexSeries = await getScaleIndexDaily()
  const aligned = alignIndexCloses(indexSeries)
  if (!aligned.dates.length) return []

  const rows = freq === "d" ? await beatRatioDaily(aligned) : await beatRatioPeriod(aligned, PERIOD_FMT[freq])
  const data = SCALE_INDICES.map((item) => ({
    id: item.id,
    name: item.name,
    color: item.color,
    points: rowsToPoints(rows, item.id),
  }))

  if (data.some((row) => row.points.length > 8) || !hit?.data.length) {
    cache.set(freq, { at: Date.now(), data })
  }
  return cache.get(freq)?.data ?? data
}
