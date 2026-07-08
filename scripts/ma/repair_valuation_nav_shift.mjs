/**
 * Repair custody 估值表 NAV date shift (Guohai/GTJA 4级科目估值表_YYYYMMDD).
 *
 * Usage:
 *   npx tsx scripts/ma/repair_valuation_nav_shift.mjs [--days=90] [--skip-fetch]
 *   npx tsx scripts/ma/repair_valuation_nav_shift.mjs --db-fix-dates [--since=2026-06-01]
 *
 * --db-fix-dates  Fix stored dates from summary JSON (no IMAP). Use when code is fixed locally
 *                 but production cannot re-fetch mail yet.
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

function parseSince(argv) {
  const flag = argv.find((a) => a.startsWith("--since="))
  if (flag) return flag.slice("--since=".length)
  return "2026-01-01"
}

function normaliseDate(text) {
  const m = String(text ?? "").match(/(20\d{2})[-/.年]?(0?[1-9]|1[0-2])[-/.月]?(0?[1-9]|[12]\d|3[01])/)
  if (!m) return null
  return `${m[1]}-${`${m[2]}`.padStart(2, "0")}-${`${m[3]}`.padStart(2, "0")}`
}

function valuationSubjectSendDate(subject, filename) {
  const text = `${subject ?? ""}${filename ?? ""}`
  const afterTable = text.match(/估值表_(20\d{6})/u)
  if (afterTable) return normaliseDate(afterTable[1])
  const beforeTable = text.match(/_(20\d{6})_估值表/u)
  if (beforeTable) return normaliseDate(beforeTable[1])
  return null
}

function scanHeaderRowsForUnitNav(headerRows) {
  if (!Array.isArray(headerRows)) return null
  for (const row of headerRows.slice(0, 20)) {
    const joined = (row ?? []).map((c) => String(c ?? "")).join(" ")
    const m = joined.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (m && !/累计/.test(joined)) {
      const n = parseFloat(m[1])
      if (Number.isFinite(n) && n > 0.05 && n < 100) return n
    }
  }
  return null
}

async function repairDbFixDates(since) {
  const rows = await rawQuery(
    `SELECT id, crawl_email_account, email_uid, subject, attachment_filename,
            valuation_date::text AS valuation_date, unit_nav::text AS unit_nav,
            summary
     FROM ops_email_valuation_records
     WHERE valuation_date >= $1::date
       AND (
         subject ~ '估值表_20[0-9]{6}'
         OR subject ~ '_20[0-9]{6}_估值表'
         OR COALESCE(attachment_filename, '') ~ '估值表_20[0-9]{6}'
         OR COALESCE(attachment_filename, '') ~ '_20[0-9]{6}_估值表'
       )
     ORDER BY id ASC`,
    [since],
  )

  let valuationFixed = 0
  let navDeleted = 0
  let navInserted = 0

  for (const row of rows.rows) {
    const summary = row.summary ?? {}
    const summaryDate = normaliseDate(summary.valuation_date ?? "")
    const subjectDate = valuationSubjectSendDate(row.subject, row.attachment_filename)
    if (!summaryDate || !subjectDate || summaryDate !== subjectDate) continue
    if (row.valuation_date === summaryDate) continue

    const unitNav =
      scanHeaderRowsForUnitNav(summary.header_rows) ??
      (parseFloat(summary.unit_nav) > 0 ? parseFloat(summary.unit_nav) : null)

    const existing = await rawQuery(
      `SELECT id FROM ops_email_valuation_records
       WHERE crawl_email_account = $1 AND email_uid = $2
         AND attachment_filename = $3 AND valuation_date = $4::date
         AND id <> $5
       LIMIT 1`,
      [row.crawl_email_account, row.email_uid, row.attachment_filename ?? "", summaryDate, row.id],
    )

    if (existing.rows.length > 0) {
      await rawQuery(`DELETE FROM ops_email_valuation_records WHERE id = $1`, [row.id])
    } else {
      await rawQuery(
        `UPDATE ops_email_valuation_records
         SET valuation_date = $2::date,
             unit_nav = COALESCE($3::numeric, unit_nav)
         WHERE id = $1`,
        [row.id, summaryDate, unitNav],
      )
      valuationFixed += 1
    }

    const del = await rawQuery(
      `DELETE FROM ops_email_nav_records
       WHERE crawl_email_account = $1
         AND email_uid = $2
         AND source = 'attachment_valuation_table'
         AND nav_date = $3::date`,
      [row.crawl_email_account, row.email_uid, row.valuation_date],
    )
    navDeleted += del.rowCount ?? 0

    if (unitNav != null) {
      const keepId = existing.rows[0]?.id ?? row.id
      const ins = await rawQuery(
        `INSERT INTO ops_email_nav_records (
           crawl_email_account, email_uid, sent_at, subject, sender_email,
           attachment_filename, nav_date, nav, cumulative_nav, adjusted_nav,
           product_code, fund_name, source
         )
         SELECT crawl_email_account, email_uid, sent_at, subject, sender_email,
                attachment_filename, $2::date, $3::numeric, cumulative_nav, NULL,
                product_code, fund_name, COALESCE(source, 'attachment_valuation_table')
         FROM ops_email_valuation_records
         WHERE id = $1
         ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename) DO UPDATE SET
           nav = EXCLUDED.nav,
           product_code = EXCLUDED.product_code,
           fund_name = EXCLUDED.fund_name,
           subject = EXCLUDED.subject`,
        [keepId, summaryDate, unitNav],
      )
      navInserted += ins.rowCount ?? 0
    }
  }

  return { valuationFixed, navDeleted, navInserted, scanned: rows.rowCount }
}

const argv = process.argv.slice(2)
const dbFixDates = argv.includes("--db-fix-dates")

if (dbFixDates) {
  const since = parseSince(argv)
  const result = await repairDbFixDates(since)
  console.log(JSON.stringify({ ok: true, mode: "db-fix-dates", since, ...result }))
  process.exit(0)
}

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
