/**
 * Copy 平台策略 into empty 团队策略 for every type6 product, then patch list caches.
 *
 *   npx tsx scripts/ma/backfill_team_strategy_from_platform.ts
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { backfillAllEmptyTeamStrategiesFromPlatform } = await import(
    "../../lib/server/fund-strategy-resolve"
  )
  const result = await backfillAllEmptyTeamStrategiesFromPlatform()
  const sample = result.rows.slice(0, 8).map((row) => ({
    beian_hao: row.beian_hao,
    l1: row.strategy_l1,
    l2: row.strategy_l2,
    l3: row.strategy_l3,
  }))
  console.log(JSON.stringify({ updated: result.updated, sample }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
