/**
 * Rebuild ops_fof_overview_list_cache from the current (corrected) NAV
 * selection logic. Use after deploying email-selection fixes so the FOF概览
 * list reflects the right 单位净值 (e.g. BAH99A should be ~1.27, not 6.27M).
 *
 * Recomputes ALL funds from BatchNavResolver — does not single out any fund,
 * so already-correct funds stay correct.
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const { refreshFofOverviewListCache } = await import(
    "@/lib/server/fof-overview-list-cache-pg"
  )

  const before = await query<{ unit_nav: string; nav_date: string }>(
    `SELECT unit_nav::text, nav_date::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao = 'BAH99A'`,
  )
  console.log("BAH99A cache BEFORE:", before[0] ?? "(none)")

  console.log("Rebuilding FOF overview list cache (1–3 min)…")
  const n = await refreshFofOverviewListCache()
  console.log(`Rebuilt ${n} rows.`)

  const after = await query<{ unit_nav: string; nav_date: string; return_pct: string }>(
    `SELECT unit_nav::text, nav_date::text, return_pct::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao = 'BAH99A'`,
  )
  console.log("BAH99A cache AFTER:", after[0] ?? "(none)")

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
