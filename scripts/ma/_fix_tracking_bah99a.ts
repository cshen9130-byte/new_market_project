/**
 * Targeted fix: update BAH99A row in ops_tracking_funds_list_cache
 * using the correct email NAV (same logic the FOF cache already verified).
 *
 * Also recomputes sharpe/calmar from type6 history (email must not erase drawdowns).
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function navAtOrBefore(
  q: typeof import("@/lib/db").query,
  date: string,
): Promise<number | null> {
  const rows = await q<{ nav: string }>(
    `SELECT nav::text
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) = 'BAH99A'
       AND nav IS NOT NULL
       AND nav::numeric BETWEEN 0.1 AND 50
       AND nav_date <= $1::date
     ORDER BY nav_date DESC, id DESC
     LIMIT 1`,
    [date],
  )
  if (!rows[0]?.nav) return null
  return parseFloat(rows[0].nav)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const { query } = await import("@/lib/db")
  const { computeOneYearRiskMetrics } = await import("@/lib/server/list-cache-nav-batch")

  console.log("BEFORE:", (await query(
    `SELECT unit_nav::text, nav_date::text, return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text, sharpe_1y::text, calmar_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'BAH99A'`,
  ))[0] ?? "(none)")

  const latestRows = await query<{ nav_date: string; nav: string }>(
    `SELECT nav_date::text, nav::text
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) = 'BAH99A'
       AND nav IS NOT NULL
       AND nav::numeric BETWEEN 0.1 AND 50
     ORDER BY nav_date DESC, id DESC
     LIMIT 1`,
  )
  if (!latestRows[0]) { console.log("No plausible nav found"); process.exit(1) }
  const latestDate = latestRows[0].nav_date.slice(0, 10)
  const latestNav = parseFloat(latestRows[0].nav)

  const prevDay     = await navAtOrBefore(query, addDays(latestDate, -1))
  const prev7d      = await navAtOrBefore(query, addDays(latestDate, -7))
  const prev30d     = await navAtOrBefore(query, addDays(latestDate, -30))
  const prev90d     = await navAtOrBefore(query, addDays(latestDate, -90))
  const prev180d    = await navAtOrBefore(query, addDays(latestDate, -180))
  const prev365d    = await navAtOrBefore(query, addDays(latestDate, -365))

  const ret = (base: number | null) => base && base > 0 ? (latestNav / base - 1) : null

  const returnPct = ret(prevDay)
  const ret1w     = ret(prev7d)
  const ret1m     = ret(prev30d)
  const ret3m     = ret(prev90d)
  const ret6m     = ret(prev180d)
  const ret1y     = ret(prev365d)

  const type6 = await query<{ nav_date: string; nav: string }>(
    `SELECT price_date::text AS nav_date, nav::text
     FROM private_fund_nav_group_type6
     WHERE beian_hao = 'BAH99A'
       AND nav IS NOT NULL AND nav::numeric BETWEEN 0.1 AND 50
     ORDER BY price_date ASC`,
  )
  const risk = computeOneYearRiskMetrics(
    latestDate,
    type6.map((r) => ({ nav_date: r.nav_date, nav: parseFloat(r.nav) })),
  )
  console.log("type6 1Y risk:", risk)

  await query(
    `UPDATE ops_tracking_funds_list_cache
     SET unit_nav   = $1,
         nav_date   = $2,
         return_pct = $3,
         ret_1w     = $4,
         ret_1m     = $5,
         ret_3m     = $6,
         ret_6m     = $7,
         ret_1y     = $8,
         sharpe_1y  = $9,
         calmar_1y  = $10,
         refreshed_at = NOW()
     WHERE beian_hao = 'BAH99A'`,
    [latestNav, latestDate, returnPct, ret1w, ret1m, ret3m, ret6m, ret1y, risk.sharpe_1y, risk.calmar_1y],
  )

  console.log("AFTER:", (await query(
    `SELECT unit_nav::text, nav_date::text, return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text, sharpe_1y::text, calmar_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'BAH99A'`,
  ))[0] ?? "(none)")

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
