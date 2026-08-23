import { query } from "@/lib/db"

export type TurnoverConcentrationPoint = {
  date: string
  top1: number
  top5: number
  top10: number
  top25: number
}

type Row = {
  date: string
  top1: string | number | null
  top5: string | number | null
  top10: string | number | null
  top25: string | number | null
}

function num(value: string | number | null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

let cache: { at: number; data: TurnoverConcentrationPoint[] } | null = null
const CACHE_MS = 10 * 60_000

export async function getAshareTurnoverConcentration(): Promise<TurnoverConcentrationPoint[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data

  const rows = await query<Row>(
    `WITH ranked AS (
       SELECT
         trade_date,
         amount,
         SUM(amount) OVER (PARTITION BY trade_date) AS total_amount,
         COUNT(*) OVER (PARTITION BY trade_date) AS n,
         ROW_NUMBER() OVER (PARTITION BY trade_date ORDER BY amount DESC) AS rk
       FROM raw_ashare_daily
       WHERE amount > 0
     )
     SELECT
       trade_date::text AS date,
       SUM(amount) FILTER (WHERE rk <= GREATEST(1, CEIL(n * 0.01))) / NULLIF(MAX(total_amount), 0) * 100 AS top1,
       SUM(amount) FILTER (WHERE rk <= GREATEST(1, CEIL(n * 0.05))) / NULLIF(MAX(total_amount), 0) * 100 AS top5,
       SUM(amount) FILTER (WHERE rk <= GREATEST(1, CEIL(n * 0.10))) / NULLIF(MAX(total_amount), 0) * 100 AS top10,
       SUM(amount) FILTER (WHERE rk <= GREATEST(1, CEIL(n * 0.25))) / NULLIF(MAX(total_amount), 0) * 100 AS top25
     FROM ranked
     GROUP BY trade_date
     ORDER BY 1`,
  )

  const data = rows.flatMap((row) => {
    const top1 = num(row.top1)
    const top5 = num(row.top5)
    const top10 = num(row.top10)
    const top25 = num(row.top25)
    if (top1 == null || top5 == null || top10 == null || top25 == null) return []
    return [{ date: String(row.date).slice(0, 10), top1, top5, top10, top25 }]
  })

  if (data.length > 8 || !cache?.data.length) cache = { at: Date.now(), data }
  return cache?.data ?? data
}
