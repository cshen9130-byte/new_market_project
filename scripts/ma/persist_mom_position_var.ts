/**
 * Persist MOM book position VaR (sectors, sub-sectors, categories, products).
 *
 *   npx tsx scripts/ma/persist_mom_position_var.ts
 *   npx tsx scripts/ma/persist_mom_position_var.ts --force
 *
 * Without --force, an existing series is kept and the last 8 settlement dates
 * are replaced. A gap after the stored maximum is filled from that maximum.
 * --force recomputes every settlement date.
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const rebuild = process.argv.includes("--force")
  const { persistMomPositionVarHistory } = await import("@/lib/server/mom-position-var-store")
  const result = await persistMomPositionVarHistory({ rebuild })
  console.log(JSON.stringify(result))
  if (result.skipped) process.exitCode = 0
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
