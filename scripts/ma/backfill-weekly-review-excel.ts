/**
 * Generate and cache the last three 周度回顾 Excel weeks
 * (equity, futures, and public-enhanced).
 *
 * Usage: npx tsx scripts/ma/backfill-weekly-review-excel.ts
 */
import { config } from "dotenv"
import { resolve } from "node:path"

config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

async function main() {
  const { backfillWeeklyReviewExcelLastWeeks } = await import("../../lib/server/weekly-review-excel-cache")
  const result = await backfillWeeklyReviewExcelLastWeeks("backfill-last-three")
  console.log(JSON.stringify(result, null, 2))
  const failed = result.items.filter((item) => !item.ok && !item.skipped)
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
