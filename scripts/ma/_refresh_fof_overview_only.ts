/** Rebuild ops_fof_overview_list_cache only (faster than full _refresh_fof_cache). */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "../../lib/server/load-project-env.ts"

async function main() {
  loadProjectEnvFiles()
  configureEtlDbTimeout()
  const { refreshFofOverviewListCache } = await import("../../lib/server/fof-overview-list-cache-pg.ts")
  const n = await refreshFofOverviewListCache()
  console.log(JSON.stringify({ ok: true, cacheRows: n }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
