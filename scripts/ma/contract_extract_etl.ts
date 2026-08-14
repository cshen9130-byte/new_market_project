/**
 * Nightly / on-demand drain of queued (and optionally failed) contract element extract jobs.
 *
 * Usage (via nightly_etl.py):
 *   npx tsx scripts/ma/contract_extract_etl.ts
 *
 * Direct:
 *   npx tsx scripts/ma/contract_extract_etl.ts [--retry-failed]
 */

import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"
import { processContractExtractQueue } from "@/lib/server/fund-contract-extract-job"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const retryFailed = process.argv.includes("--retry-failed") || process.argv.includes("--retryFailed")
  try {
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
