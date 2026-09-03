/**
 * Rebuild 自建基金 NAV from saved generation rules.
 * Usage: npx tsx scripts/ma/refresh_custom_fund_nav.ts
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { refreshAllCustomFundNavFromRules } = await import(
    "../../lib/server/custom-fund-nav-daily-refresh"
  )
  const result = await refreshAllCustomFundNavFromRules()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
