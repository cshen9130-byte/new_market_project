/**
 * Refresh ops_managed_fof_underlying from stored email 估值表.
 *
 * Usage: npx tsx scripts/ma/refresh_managed_fof_underlying.ts
 */

import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

async function main() {
  const { refreshManagedFofUnderlying } = await import("@/lib/server/managed-fof-underlying-pg")
  const rows = await refreshManagedFofUnderlying()
  console.log(JSON.stringify({ ok: true, rowsRefreshed: rows }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
