/**
 * Advance 私募基金 list (private_fund_info) NAV from product-page merge.
 *
 * Usage:
 *   npx tsx scripts/ma/refresh_private_fund_list_from_product_nav.ts
 *
 * Prints JSON to stdout for nightly_etl.py.
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { refreshPrivateFundListNavFromProductPage } = await import(
    "../../lib/server/private-fund-list-nav-sync"
  )
  const result = await refreshPrivateFundListNavFromProductPage()
  console.error(
    `[private-fund-list-nav-sync] candidates=${result.candidates} resolved=${result.resolved} updated=${result.updated}`,
  )
  console.log(JSON.stringify({ ok: true, ...result }))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[private-fund-list-nav-sync] failed: ${message}`)
    console.log(JSON.stringify({ ok: false, error: message }))
    process.exit(1)
  })
