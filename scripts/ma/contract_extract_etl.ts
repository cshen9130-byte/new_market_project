/**
 * Nightly / on-demand drain of queued (and optionally failed) contract element extract jobs.
 *
 * Usage (via nightly_etl.py):
 *   npx tsx scripts/ma/contract_extract_etl.ts
 *
 * Direct:
 *   npx tsx scripts/ma/contract_extract_etl.ts [--retry-failed]
 *   npx tsx scripts/ma/contract_extract_etl.ts --rematch-review
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"
import {
  processContractExtractQueue,
  rematchNeedsReviewExtractJobs,
} from "@/lib/server/fund-contract-extract-job"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const retryFailed = process.argv.includes("--retry-failed") || process.argv.includes("--retryFailed")
  const rematchReview = process.argv.includes("--rematch-review") || process.argv.includes("--rematchReview")
  try {
    if (rematchReview) {
      console.error("[contract_extract_etl] rematching needs_review jobs (reuse extracted JSON)…")
      const result = await rematchNeedsReviewExtractJobs({ maxJobs: 200 })
      console.error(
        `[contract_extract_etl] rematch done: processed=${result.processed} applied=${result.applied} ` +
          `needs_review=${result.needsReview} failed=${result.failed} remaining=${result.remaining}`,
      )
      console.log(JSON.stringify({ ok: true, rematch: true, ...result }))
      process.exit(0)
    }
    console.error(
      `[contract_extract_etl] draining extract jobs${retryFailed ? " (including failed retries)" : ""}…`,
    )
    const result = await processContractExtractQueue({
      retryFailed,
      maxJobs: 200,
      maxMs: 50 * 60 * 1000,
      yieldToUserTraffic: false,
    })
    console.error(
      `[contract_extract_etl] done: processed=${result.processed} applied=${result.applied} ` +
        `needs_review=${result.needsReview} failed=${result.failed} remaining=${result.remaining}`,
    )
    console.log(JSON.stringify({ ok: true, ...result }))
    process.exit(0)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[contract_extract_etl] fatal:", message)
    console.log(
      JSON.stringify({
        ok: false,
        error: message,
        processed: 0,
        applied: 0,
        needsReview: 0,
        failed: 0,
        remaining: 0,
      }),
    )
    process.exit(1)
  }
}

main()
