/**
 * Scan ops_email_valuation_records vs ops_email_nav_records for CMS day-shift:
 * nav on date D differs from valuation header/col unit NAV on the same date.
 *
 * Usage:
 *   npx tsx scripts/ma/_scan_cms_nav_shift.ts [--since=2026-07-01] [--fix]
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"

loadProjectEnvFiles()

const SINCE =
  process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length) || "2026-07-01"
const DO_FIX = process.argv.includes("--fix")

async function main() {
  const { unitNavFromValuationSummary } = await import(
    "../../lib/server/email-valuation-nav-backfill.ts"
  )
  const { upsertEmailNavRecords } = await import("../../lib/server/email-nav-pg.ts")
  const { rawQuery } = await import("../../lib/db.ts")

  // Join valuation ↔ nav on same email+attachment+date+code (CMS custody pattern).
  const rows = await rawQuery(
    `SELECT v.id AS val_id, v.product_code, v.fund_name,
            v.valuation_date::text AS d,
            v.unit_nav::text AS col_unit,
            v.cumulative_nav::text AS cum,
            v.summary,
            v.crawl_email_account, v.email_uid, v.sent_at::text AS sent_at,
            v.subject, v.sender_email, v.attachment_filename, v.source,
            n.nav::text AS nav_unit, n.id AS nav_id
     FROM ops_email_valuation_records v
     JOIN ops_email_nav_records n
       ON n.crawl_email_account = v.crawl_email_account
      AND n.email_uid = v.email_uid
      AND n.attachment_filename = v.attachment_filename
      AND n.nav_date = v.valuation_date
      AND coalesce(n.product_code, '') = coalesce(v.product_code, '')
      AND n.source = 'attachment_valuation_table'
     WHERE v.valuation_date >= $1::date
       AND v.product_code IS NOT NULL
       AND btrim(v.product_code) <> ''
       AND (
         v.subject ~ '【估值表】'
         OR v.attachment_filename ~ '委托资产资产估值表'
         OR coalesce(v.summary->>'custodian', '') LIKE '%招商证券%'
       )
     ORDER BY v.product_code, v.valuation_date DESC`,
    [SINCE],
  )

  type Mismatch = {
    code: string
    name: string
    date: string
    header: number
    nav: number
    col: number | null
    row: (typeof rows.rows)[0]
  }
  const mismatches: Mismatch[] = []

  for (const row of rows.rows) {
    const fromHeader = unitNavFromValuationSummary(row.summary)
    const fromCol = row.col_unit != null ? parseFloat(row.col_unit) : NaN
    const truth =
      fromHeader != null && Number.isFinite(fromHeader)
        ? fromHeader
        : Number.isFinite(fromCol)
          ? fromCol
          : null
    const nav = row.nav_unit != null ? parseFloat(row.nav_unit) : NaN
    if (truth == null || !Number.isFinite(nav)) continue
    if (Math.abs(truth - nav) <= 1e-6) continue
    mismatches.push({
      code: String(row.product_code).toUpperCase(),
      name: String(row.fund_name ?? ""),
      date: String(row.d).slice(0, 10),
      header: truth,
      nav,
      col: Number.isFinite(fromCol) ? fromCol : null,
      row,
    })
  }

  const byCode = new Map<string, Mismatch[]>()
  for (const m of mismatches) {
    const arr = byCode.get(m.code) ?? []
    arr.push(m)
    byCode.set(m.code, arr)
  }

  console.log(
    `scanned ${rows.rows.length} CMS valuation↔nav pairs since ${SINCE}; ` +
      `${mismatches.length} mismatches across ${byCode.size} products`,
  )
  for (const [code, list] of [...byCode.entries()].sort()) {
    const name = list[0]?.name ?? ""
    console.log(`\n${code} ${name} (${list.length} days)`)
    for (const m of list.slice(0, 8)) {
      console.log(`  ${m.date}: nav=${m.nav} header=${m.header} col=${m.col}`)
    }
    if (list.length > 8) console.log(`  … +${list.length - 8} more`)
  }

  if (!DO_FIX || mismatches.length === 0) {
    if (!DO_FIX && mismatches.length > 0) {
      console.log("\nRe-run with --fix to repair all mismatched codes.")
    }
    return
  }

  // Repair per distinct valuation row (may heal summary + upsert nav)
  const seenVal = new Set<number>()
  const inserts = []
  let healedSummary = 0
  let healedCol = 0

  for (const m of mismatches) {
    const row = m.row
    if (seenVal.has(row.val_id)) continue
    seenVal.add(row.val_id)

    const unitNav = m.header
    const fromCol = row.col_unit != null ? parseFloat(row.col_unit) : NaN
    const summaryUnit = parseFloat(String(row.summary?.unit_nav ?? ""))

    if (!Number.isFinite(fromCol) || Math.abs(fromCol - unitNav) > 1e-9) {
      await rawQuery(
        `UPDATE ops_email_valuation_records SET unit_nav = $1 WHERE id = $2`,
        [unitNav, row.val_id],
      )
      healedCol += 1
    }
    if (
      row.summary &&
      typeof row.summary === "object" &&
      (!Number.isFinite(summaryUnit) || Math.abs(summaryUnit - unitNav) > 1e-9)
    ) {
      const nextSummary = { ...row.summary, unit_nav: unitNav }
      await rawQuery(
        `UPDATE ops_email_valuation_records SET summary = $1::jsonb WHERE id = $2`,
        [JSON.stringify(nextSummary), row.val_id],
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
      navDate: m.date,
      nav: unitNav,
      cumulativeNav: row.cum != null ? parseFloat(row.cum) : null,
      adjustedNav: null,
      productCode: row.product_code,
      fundName: row.fund_name,
      source: "attachment_valuation_table",
    })
  }

  const navUpserted = await upsertEmailNavRecords(inserts)
  console.log(
    `\nFIXED: codes=${byCode.size} healedCol=${healedCol} healedSummary=${healedSummary} navUpserted=${navUpserted}`,
  )
  console.log("Affected codes:", [...byCode.keys()].sort().join(", "))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
