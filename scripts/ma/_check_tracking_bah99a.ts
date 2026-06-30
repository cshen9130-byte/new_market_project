import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")

  const before = await query<{ unit_nav: string; nav_date: string; return_pct: string }>(
    `SELECT unit_nav::text, nav_date::text, return_pct::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao = 'BAH99A'`,
  )
  console.log("ops_tracking_funds_list_cache BAH99A:", before[0] ?? "(none)")

  const { refreshTrackingFundsListCache } = await import("@/lib/server/tracking-funds-list-cache-pg")
  console.log("Rebuilding ops_tracking_funds_list_cache…")
  const n = await refreshTrackingFundsListCache()
  console.log(`Rebuilt ${n} rows.`)

  const after = await query<{ unit_nav: string; nav_date: string; return_pct: string }>(
    `SELECT unit_nav::text, nav_date::text, return_pct::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao = 'BAH99A'`,
  )
  console.log("ops_tracking_funds_list_cache BAH99A AFTER:", after[0] ?? "(none)")

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
