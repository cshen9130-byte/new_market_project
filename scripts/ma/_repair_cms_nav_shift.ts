/**
 * Repair CMS/招商 估值表 NAV day-shift for a single product.
 *
 * Header 单位净值 in ops_email_valuation_records is ground truth; copies it into
 * ops_email_nav_records and heals summary.unit_nav. Scoped by --code= only.
 *
 * Usage:
 *   npx tsx scripts/ma/_repair_cms_nav_shift.ts --code=SCU622
 *   npx tsx scripts/ma/_repair_cms_nav_shift.ts --code=SCJ536 --dry-run
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"

loadProjectEnvFiles()

const DRY = process.argv.includes("--dry-run")
const CODE = (
  process.argv.find((a) => a.startsWith("--code="))?.slice("--code=".length) || ""
).trim().toUpperCase()

if (!CODE) {
  console.error("Usage: npx tsx scripts/ma/_repair_cms_nav_shift.ts --code=SCU622")
  process.exit(1)
}

async function main() {
  const { unitNavFromValuationSummary } = await import(
    "../../lib/server/email-valuation-nav-backfill.ts"
  )
  const { upsertEmailNavRecords } = await import("../../lib/server/email-nav-pg.ts")
  const { rawQuery } = await import("../../lib/db.ts")

  const vals = await rawQuery(
    `SELECT id, crawl_email_account, email_uid, sent_at::text, subject, sender_email,
            attachment_filename, product_code, fund_name,
            valuation_date::text AS valuation_date,
            unit_nav::text AS unit_nav, cumulative_nav::text AS cumulative_nav,
            source, summary
     FROM ops_email_valuation_records
     WHERE product_code = $1
     ORDER BY valuation_date ASC, id ASC`,
    [CODE],
  )

  if (vals.rows.length === 0) {
    console.error(`No valuation rows for ${CODE}`)
    process.exit(1)
  }

  let healedCol = 0
  let healedSummary = 0
  const inserts = []

  for (const row of vals.rows) {
    const fromHeader = unitNavFromValuationSummary(row.summary)
    const fromCol = row.unit_nav != null ? parseFloat(row.unit_nav) : NaN
    const unitNav =
      fromHeader != null && Number.isFinite(fromHeader)
        ? fromHeader
        : Number.isFinite(fromCol)
          ? fromCol
          : null
    if (unitNav == null) continue

    const date = String(row.valuation_date).slice(0, 10)
    const summaryUnit = parseFloat(String(row.summary?.unit_nav ?? ""))
    const colDiffers = !Number.isFinite(fromCol) || Math.abs(fromCol - unitNav) > 1e-9
    const summaryDiffers = !Number.isFinite(summaryUnit) || Math.abs(summaryUnit - unitNav) > 1e-9

    console.log(
      `${date}: -> ${unitNav}` +
        (colDiffers ? ` (col was ${row.unit_nav})` : "") +
        (summaryDiffers ? ` (summary was ${row.summary?.unit_nav})` : ""),
    )

    if (!DRY && colDiffers) {
      await rawQuery(
        `UPDATE ops_email_valuation_records SET unit_nav = $1 WHERE id = $2`,
        [unitNav, row.id],
      )
      healedCol += 1
    }

    if (!DRY && summaryDiffers && row.summary && typeof row.summary === "object") {
      const nextSummary = { ...row.summary, unit_nav: unitNav }
      await rawQuery(
        `UPDATE ops_email_valuation_records SET summary = $1::jsonb WHERE id = $2`,
        [JSON.stringify(nextSummary), row.id],
      )
      healedSummary += 1
    }

    inserts.push({
      crawlEmailAccount: row.crawl_email_account,
      emailUid: row.email_uid,
      sentAt: row.sent_at,
      subject: row.subject ?? "",
      senderEmail: row.sender_email ?? "",
      attachmentFilename: row.attachment_filename ?? "",
      navDate: date,
      nav: unitNav,
      cumulativeNav: row.cumulative_nav != null ? parseFloat(row.cumulative_nav) : null,
      adjustedNav: null,
      productCode: row.product_code,
      fundName: row.fund_name,
      source: "attachment_valuation_table",
    })
  }

  if (DRY) {
    console.log(`[dry-run] ${CODE}: would upsert ${inserts.length} nav rows`)
    return
  }

  const navBackfilled = await upsertEmailNavRecords(inserts)
  console.log(
    `${CODE}: healedCol=${healedCol} healedSummary=${healedSummary} navUpserted=${navBackfilled}`,
  )

  const after = await rawQuery(
    `SELECT nav_date::text AS nav_date, nav::text AS nav
     FROM ops_email_nav_records
     WHERE product_code = $1 AND source = 'attachment_valuation_table'
       AND nav_date >= '2026-08-01'::date
     ORDER BY nav_date DESC`,
    [CODE],
  )
  console.log("after nav (Aug):", JSON.stringify(after.rows, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
