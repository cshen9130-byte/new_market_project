/**
 * Run valuation email fetch and report SBAH99 calendar range.
 */
import { fetchEmailParseRecords } from "@/lib/server/email-parse-fetch"
import { getFundValuationCalendarSummary } from "@/lib/server/fund-valuation-allocation"

async function main() {
  console.log("Fetching emails (730 days)...")
  const result = await fetchEmailParseRecords({ days: 730 })
  console.log("valuationSaved:", result.valuationSaved, "errors:", result.errors.length)

  const summary = await getFundValuationCalendarSummary("SBAH99")
  console.log("SBAH99 calendar:", {
    total: summary.total,
    dateFrom: summary.dateFrom,
    dateTo: summary.dateTo,
    needsEmailBackfill: summary.needsEmailBackfill,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
