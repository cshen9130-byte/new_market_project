/**
 * Targeted fix: update BAH99A row in ops_tracking_funds_list_cache
 * using the correct email NAV (same logic the FOF cache already verified).
 *
 * The full refreshTrackingFundsListCache() times out (6163 funds × ILIKE scan).
 * The email selection logic is already correct (isPlausibleEmailUnitNav /
 * preferEmailNavRow reject the 6273466.11 share-count row). Only the cache
 * row is stale — same root cause as the FOF overview list fix (see docs).
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

  console.log("BEFORE:", (await query(
    `SELECT unit_nav::text, nav_date::text, return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'BAH99A'`,
  ))[0] ?? "(none)")

  // Latest correct nav (product_code exact match, plausible range)
  const latestRows = await query<{ nav_date: string; nav: string; cumulative_nav: string | null }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text
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

  // Compute period returns
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

  console.log(`Latest: ${latestDate} unit_nav=${latestNav}`)
  console.log(`  prev_day=${prevDay}  return_pct=${returnPct?.toFixed(6)}`)
  console.log(`  prev_7d=${prev7d}   ret_1w=${ret1w?.toFixed(6)}`)
  console.log(`  prev_30d=${prev30d}  ret_1m=${ret1m?.toFixed(6)}`)
  console.log(`  prev_90d=${prev90d}  ret_3m=${ret3m?.toFixed(6)}`)
  console.log(`  prev_180d=${prev180d} ret_6m=${ret6m?.toFixed(6)}`)
  console.log(`  prev_365d=${prev365d} ret_1y=${ret1y?.toFixed(6)}`)

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
         refreshed_at = NOW()
     WHERE beian_hao = 'BAH99A'`,
    [latestNav, latestDate, returnPct, ret1w, ret1m, ret3m, ret6m, ret1y],
  )

  console.log("AFTER:", (await query(
    `SELECT unit_nav::text, nav_date::text, return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'BAH99A'`,
  ))[0] ?? "(none)")

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
