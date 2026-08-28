/**
 * Nightly / on-demand drain of queued (and optionally failed) contract element extract jobs.
 *
 * Usage (via nightly_etl.py):
 *   npx tsx scripts/ma/contract_extract_etl.ts
 *
 * Direct:
 *   npx tsx scripts/ma/contract_extract_etl.ts [--retry-failed]
 *   npx tsx scripts/ma/contract_extract_etl.ts --rematch-review
 *   npx tsx scripts/ma/contract_extract_etl.ts --reextract-incomplete
 *   npx tsx scripts/ma/contract_extract_etl.ts --backfill-keywords
 *   npx tsx scripts/ma/contract_extract_etl.ts --fanout-share-classes
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const DEFAULT_TUNNEL_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

if (process.platform === "win32" && !process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
  process.env.DATABASE_URL = DEFAULT_TUNNEL_DB_URL
}
process.env.CONTRACT_EXTRACT_SSH_HOST ||= "root@8.154.33.143"
process.env.CONTRACT_EXTRACT_REMOTE_JOBS_DIR ||= "/root/market_dashboard_storage/fund-elements/jobs"

async function main() {
  const {
    backfillKeywordFieldsFromStoredContracts,
    fanoutAppliedElementsToShareClasses,
    processContractExtractQueue,
    rematchNeedsReviewExtractJobs,
    requeueIncompleteContractExtractJobs,
  } = await import("@/lib/server/fund-contract-extract-job")
  const retryFailed = process.argv.includes("--retry-failed") || process.argv.includes("--retryFailed")
  const rematchReview = process.argv.includes("--rematch-review") || process.argv.includes("--rematchReview")
  const reextractIncomplete =
    process.argv.includes("--reextract-incomplete") || process.argv.includes("--reextractIncomplete")
  const backfillKeywords =
    process.argv.includes("--backfill-keywords") || process.argv.includes("--backfillKeywords")
  const fanoutShareClasses =
    process.argv.includes("--fanout-share-classes") || process.argv.includes("--fanoutShareClasses")
  const beianHao = (process.argv.find((arg) => arg.startsWith("--beian=")) ?? "").slice("--beian=".length)
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
    if (fanoutShareClasses) {
      console.error("[contract_extract_etl] copying extracted 要素 onto empty share-class / FOF底层 rows…")
      const fanout = await fanoutAppliedElementsToShareClasses()
      console.error(
        `[contract_extract_etl] share-class fanout: processed=${fanout.processed} filled=${fanout.filled} ` +
          `skipped=${fanout.skipped} failed=${fanout.failed}`,
      )
      console.log(JSON.stringify({ ok: true, fanoutShareClasses: true, ...fanout }))
      process.exit(0)
    }
    if (backfillKeywords || reextractIncomplete) {
      console.error("[contract_extract_etl] backfilling keyword fields from stored contracts…")
      const backfill = await backfillKeywordFieldsFromStoredContracts(
        beianHao ? { beianHao } : undefined,
      )
      console.error(
        `[contract_extract_etl] keyword backfill: processed=${backfill.processed} filled=${backfill.filled} ` +
          `skipped=${backfill.skipped} failed=${backfill.failed}`,
      )
      if (backfillKeywords && !reextractIncomplete) {
        console.log(JSON.stringify({ ok: true, backfillKeywords: true, ...backfill }))
        process.exit(0)
      }
    }
    if (reextractIncomplete) {
      console.error("[contract_extract_etl] requeueing incomplete/failed contract extract jobs…")
      const queued = await requeueIncompleteContractExtractJobs()
      console.error(
        `[contract_extract_etl] queued=${queued.queued} from_materials=${queued.fromMaterials}`,
      )
    }
    console.error(
      `[contract_extract_etl] draining extract jobs${retryFailed ? " (including failed retries)" : ""}${reextractIncomplete ? " (after incomplete requeue)" : ""}…`,
    )
    const result = await processContractExtractQueue({
      retryFailed,
      maxJobs: reextractIncomplete ? 400 : 200,
      maxMs: 50 * 60 * 1000,
      yieldToUserTraffic: false,
    })
    console.error(
      `[contract_extract_etl] done: processed=${result.processed} applied=${result.applied} ` +
        `needs_review=${result.needsReview} failed=${result.failed} remaining=${result.remaining}`,
    )
    console.log(JSON.stringify({ ok: true, reextractIncomplete, ...result }))
    process.exit(0)
  } catch (e) {
    const message = e instanceof Error ? e.message || e.name : String(e)
    console.error("[contract_extract_etl] fatal:", message)
    if (e instanceof Error && e.stack) console.error(e.stack.split("\n").slice(0, 12).join("\n"))
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
