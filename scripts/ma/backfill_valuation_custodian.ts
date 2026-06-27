/**
 * Backfill 托管券商 on stored valuation email records (header_rows + optional IMAP re-fetch).
 *
 * Usage: npx tsx scripts/ma/backfill_valuation_custodian.ts
 */

import { config } from "dotenv"
import { resolve } from "node:path"

config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

import { backfillValuationCustodianFromRecords } from "../../lib/server/email-valuation-metrics-backfill.ts"
import {
  ensureEmailValuationTable,
  resolveAndPersistValuationCustodian,
} from "../../lib/server/email-valuation-pg.ts"
import { query } from "../../lib/db.ts"

await ensureEmailValuationTable()

console.log("Pass 1: summary/header_rows backfill...")
console.log(await backfillValuationCustodianFromRecords())

const missing = await query<{ id: string }>(
  `SELECT id FROM ops_email_valuation_records
   WHERE custodian IS NULL OR BTRIM(custodian) = ''
   ORDER BY valuation_date DESC, id DESC
   LIMIT 200`,
)

console.log(`Pass 2: IMAP re-fetch for ${missing.length} records still missing custodian...`)
let imapUpdated = 0
for (const row of missing) {
  const resolved = await resolveAndPersistValuationCustodian(parseInt(row.id, 10))
  if (resolved) imapUpdated++
}
console.log({ imapUpdated })

process.exit(0)
