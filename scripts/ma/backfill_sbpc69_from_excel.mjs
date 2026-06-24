/**
 * Replace shifted email NAV rows with correct dates from a reference xlsx.
 *
 * Usage:
 *   npx tsx scripts/ma/backfill_sbpc69_from_excel.mjs [xlsx-path] [product-code] [fund-name]
 */
import fs from "fs"

import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
import { rawQuery } from "../../lib/db.ts"
import { analyzeNavWorkbook } from "../../lib/server/nav-cleaner.ts"
import { upsertEmailNavRecords } from "../../lib/server/email-nav-pg.ts"

loadProjectEnvFiles()

const EXCEL = process.argv[2] ?? "c:/Users/13904/Downloads/衡颐海宸1号净值20260624.xlsx"
const PRODUCT_CODE = process.argv[3] ?? "SBPC69"
const FUND_NAME = process.argv[4] ?? "衡颐海宸1号"

if (!fs.existsSync(EXCEL)) {
  console.error("Excel not found:", EXCEL)
  process.exit(1)
}

const excel = analyzeNavWorkbook(fs.readFileSync(EXCEL), "ref.xlsx")
console.log(`Loaded ${excel.rows.length} rows from ${EXCEL}`)

const del = await rawQuery(
  `DELETE FROM ops_email_nav_records
   WHERE product_code = $1
     AND source = 'attachment_valuation_table'`,
  [PRODUCT_CODE],
)
console.log(`Removed ${del.rowCount ?? 0} shifted rows`)

const meta = {
  crawlEmailAccount: "excel_backfill",
  emailUid: `${PRODUCT_CODE.toLowerCase()}-excel-20260624`,
  sentAt: new Date().toISOString(),
  subject: `${PRODUCT_CODE}_${FUND_NAME}_excel_backfill`,
  senderEmail: "",
  attachmentFilename: `${FUND_NAME}净值20260624.xlsx`,
}

const records = excel.rows.map((row) => ({
  nav: row.unitNav,
  navDate: row.date,
  cumulativeNav: row.cumulativeNav,
  adjustedNav: row.adjustedNav ?? row.cumulativeNav,
  productCode: PRODUCT_CODE,
  fundName: FUND_NAME,
  source: "attachment_nav_table",
  ...meta,
}))

const saved = await upsertEmailNavRecords(records)
console.log(`Upserted ${saved} NAV rows`)

const latest = await rawQuery(
  `SELECT nav_date::text, nav::text
   FROM ops_email_nav_records
   WHERE product_code = $1 OR subject ILIKE '%' || $1 || '%'
   ORDER BY nav_date DESC
   LIMIT 5`,
  [PRODUCT_CODE],
)
console.log("Latest after backfill:")
for (const r of latest.rows) console.log(`  ${r.nav_date}  ${r.nav}`)
