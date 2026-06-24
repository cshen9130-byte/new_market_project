/**
 * Remove shifted custody 估值表 NAV rows, then re-parse emails with fixed date logic.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/ma/repair_valuation_nav_shift.mjs [--days=90] [--skip-fetch]
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
import { rawQuery } from "../../lib/db.ts"

loadProjectEnvFiles()

function parseDays(argv) {
  const flag = argv.find((a) => a.startsWith("--days="))
  if (flag) {
    const n = parseInt(flag.slice("--days=".length), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 90
}

const argv = process.argv.slice(2)
const skipFetch = argv.includes("--skip-fetch")
const days = parseDays(argv)

const del = await rawQuery(
  `DELETE FROM ops_email_nav_records
   WHERE source = 'attachment_valuation_table'
     AND (
       subject ~ '估值表_20[0-9]{6}'
       OR subject ~ '_20[0-9]{6}_估值表'
       OR COALESCE(attachment_filename, '') ~ '估值表_20[0-9]{6}'
       OR COALESCE(attachment_filename, '') ~ '_20[0-9]{6}_估值表'
     )`,
)
console.log(`Removed ${del.rowCount ?? 0} shifted valuation-table NAV rows`)

if (skipFetch) {
  console.log(JSON.stringify({ ok: true, deleted: del.rowCount ?? 0, skippedFetch: true }))
  process.exit(0)
}

const { fetchEmailParseRecords } = await import("@/lib/server/email-parse-fetch")
const result = await fetchEmailParseRecords({ days, skipNavLatestRefresh: true })
console.log(JSON.stringify({ ok: true, deleted: del.rowCount ?? 0, days, ...result }))
