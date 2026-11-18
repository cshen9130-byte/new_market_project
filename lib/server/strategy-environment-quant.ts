/**
 * Extra 宽基量化 inputs that are not in the daily stock aggregate:
 * style-turnover HHI, and SH+SZ margin balance.
 * The score reads the stored rows. Refresh runs only when the table is behind.
 */

import { execFile } from "child_process"
import path from "path"
import { promisify } from "util"
import { query } from "@/lib/db"

const execFileAsync = promisify(execFile)
const MARGIN_STALE_DAYS = 4

export type QuantPrint = { date: string; value: number }

async function ensureTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS derived_ashare_style_hhi_daily (
      trade_date   DATE PRIMARY KEY,
      hhi_amount   DOUBLE PRECISION NOT NULL,
      computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS derived_ashare_margin_daily (
      trade_date      DATE PRIMARY KEY,
      margin_balance  DOUBLE PRECISION NOT NULL,
      fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function latestStockDate(): Promise<string | null> {
  const rows = await query<{ d: string | null }>(
    `SELECT MAX(trade_date)::text AS d FROM raw_ashare_daily`,
  )
  return rows[0]?.d?.slice(0, 10) ?? null
}

async function refreshStyleHhi(): Promise<void> {
  const [stockDate, stored] = await Promise.all([
    latestStockDate(),
    query<{ d: string | null }>(`SELECT MAX(trade_date)::text AS d FROM derived_ashare_style_hhi_daily`),
  ])
  if (!stockDate || (stored[0]?.d?.slice(0, 10) ?? "") >= stockDate) return
  await query(
    `INSERT INTO derived_ashare_style_hhi_daily (trade_date, hhi_amount)
     WITH px AS (
       SELECT trade_date, amount::float8 AS amount, turn::float8 AS turn, close::float8 AS close,
              LAG(close::float8, 20) OVER (PARTITION BY ts_code ORDER BY trade_date) AS prev20
       FROM raw_ashare_daily
       WHERE trade_date >= CURRENT_DATE - 900
         AND amount > 0 AND turn > 0.05 AND turn < 40 AND close > 0
     ),
     base AS (
       SELECT trade_date, amount, amount / (turn / 100.0) AS cap, close / prev20 - 1 AS ret20
       FROM px
       WHERE prev20 > 0
     ),
     ordered AS (
       SELECT trade_date, amount, cap, ret20,
              SUM(cap) OVER (PARTITION BY trade_date) AS tot,
              SUM(cap) OVER (PARTITION BY trade_date ORDER BY cap ROWS UNBOUNDED PRECEDING) AS run
       FROM base
     ),
     sized AS (
       SELECT trade_date, amount, ret20,
              CASE
                WHEN (run - cap) / NULLIF(tot, 0) < 1.0 / 3 THEN 1
                WHEN (run - cap) / NULLIF(tot, 0) < 2.0 / 3 THEN 2
                ELSE 3
              END AS sz
       FROM ordered
     ),
     marked AS (
       SELECT trade_date, amount, sz,
              NTILE(2) OVER (PARTITION BY trade_date, sz ORDER BY ret20) AS gr
       FROM sized
     ),
     shares AS (
       SELECT trade_date, sz, gr, SUM(amount) AS amt
       FROM marked
       GROUP BY trade_date, sz, gr
     ),
     tot AS (
       SELECT trade_date, SUM(amt) AS amt FROM shares GROUP BY trade_date
     )
     SELECT s.trade_date, SUM(POWER(s.amt / t.amt, 2))
     FROM shares s
     JOIN tot t ON t.trade_date = s.trade_date
     WHERE t.amt > 0
     GROUP BY s.trade_date
     ON CONFLICT (trade_date) DO UPDATE
       SET hhi_amount = EXCLUDED.hhi_amount, computed_at = NOW()`,
  )
}

async function refreshMargin(): Promise<void> {
  const rows = await query<{ d: string | null }>(
    `SELECT MAX(trade_date)::text AS d FROM derived_ashare_margin_daily`,
  )
  const latest = rows[0]?.d?.slice(0, 10) ?? ""
  const staleBefore = new Date(Date.now() - MARGIN_STALE_DAYS * 86_400_000).toISOString().slice(0, 10)
  if (latest && latest >= staleBefore) return
  const script = path.join(process.cwd(), "scripts", "ma", "fetch_ashare_margin.py")
  const { stdout } = await execFileAsync("python", [script], {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  const batch: Array<[string, number]> = []
  for (const line of stdout.split(/\r?\n/)) {
    const [date, raw] = line.trim().split(",")
    const value = Number(raw)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !(value > 0)) continue
    batch.push([date, value])
  }
  if (!batch.length) return
  const dates = batch.map((row) => row[0])
  const values = batch.map((row) => row[1])
  await query(
    `INSERT INTO derived_ashare_margin_daily (trade_date, margin_balance)
     SELECT d::date, v
     FROM unnest($1::text[], $2::float8[]) AS t(d, v)
     ON CONFLICT (trade_date) DO UPDATE
       SET margin_balance = EXCLUDED.margin_balance, fetched_at = NOW()`,
    [dates, values],
  )
}

export async function loadQuantExtras(): Promise<{ style: Map<string, number>; margin: QuantPrint[] }> {
  try {
    await ensureTables()
    await Promise.all([
      refreshStyleHhi().catch((err) => console.error("[strategy-environment] style hhi", err)),
      refreshMargin().catch((err) => console.error("[strategy-environment] margin", err)),
    ])
    const [styleRows, marginRows] = await Promise.all([
      query<{ trade_date: string; hhi_amount: number }>(
        `SELECT trade_date::text AS trade_date, hhi_amount::float8 AS hhi_amount
         FROM derived_ashare_style_hhi_daily
         WHERE trade_date >= CURRENT_DATE - 800
         ORDER BY trade_date`,
      ),
      query<{ trade_date: string; margin_balance: number }>(
        `SELECT trade_date::text AS trade_date, margin_balance::float8 AS margin_balance
         FROM derived_ashare_margin_daily
         WHERE trade_date >= CURRENT_DATE - 800
         ORDER BY trade_date`,
      ),
    ])
    return {
      style: new Map(styleRows.map((row) => [row.trade_date.slice(0, 10), Number(row.hhi_amount)])),
      margin: marginRows.map((row) => ({ date: row.trade_date.slice(0, 10), value: Number(row.margin_balance) })),
    }
  } catch (err) {
    console.error("[strategy-environment] quant extras", err)
    return { style: new Map(), margin: [] }
  }
}
