/**
 * Nightly FOF底层 申赎台账 from parent-FOF 估值表 share changes
 * (+ 交易确认单 overlay). Writes ops_ledger_records used by
 * 运维 → 台账管理 / 产品跟踪.
 *
 * Confirmed / manual / instruction rows are never overwritten.
 *
 * Usage (via nightly_etl.py):
 *   npx tsx scripts/ma/ops_ledger_from_valuation_etl.ts
 *
 * Run directly:
 *   npx tsx scripts/ma/ops_ledger_from_valuation_etl.ts
 */

import {
  configureEtlDbTimeout,
  ensureScriptDatabaseEnv,
} from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  try {
    const { generateFofUnderlyingLedgerFromValuation } = await import(
      "@/lib/server/ops-ledger-from-valuation"
    )
    console.error("[ops_ledger_from_valuation_etl] generating 申赎台账 from 估值表…")
    const result = await generateFofUnderlyingLedgerFromValuation()
    console.error(
      `[ops_ledger_from_valuation_etl] done: products=${result.products} ` +
        `candidates=${result.candidates} inserted=${result.inserted} ` +
        `updated=${result.updated} confirmMatched=${result.confirmMatched} ` +
        `skippedProtected=${result.skippedProtected} skippedDeleted=${result.skippedDeleted}`,
    )
    console.log(JSON.stringify({ ok: true, ...result }))
    process.exit(0)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ops_ledger_from_valuation_etl] fatal:", message)
    console.log(
      JSON.stringify({
        ok: false,
        error: message,
        products: 0,
        candidates: 0,
        inserted: 0,
        updated: 0,
        skippedProtected: 0,
        skippedDeleted: 0,
        confirmMatched: 0,
      }),
    )
    process.exit(1)
  }
}

void main()
