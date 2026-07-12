/**
 * Diagnose + repair SBTX45 (衡颐承和FOF1号) custody 估值表 one-day date shift ONLY.
 * Does not touch other funds.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_fix_sbtx45_nav_shift.ts           # dry-run
 *   npx tsx scripts/ma/_fix_sbtx45_nav_shift.ts --apply
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { BatchNavResolver, clampPgNumeric } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

const BEIAN = "SBTX45"
const PRODUCT = "衡颐承和FOF1号"
const SINCE = "2026-07-01"

function normaliseDate(text: string): string | null {
  const m = String(text ?? "").match(/(20\d{2})[-/.年]?(0?[1-9]|1[0-2])[-/.月]?(0?[1-9]|[12]\d|3[01])/)
  if (!m) return null
  return `${m[1]}-${`${m[2]}`.padStart(2, "0")}-${`${m[3]}`.padStart(2, "0")}`
}

function valuationSubjectSendDate(subject: string, filename: string): string | null {
  const text = `${subject ?? ""}${filename ?? ""}`
  const afterTable = text.match(/估值表_(20\d{6})/u)
  if (afterTable) return normaliseDate(afterTable[1])
  const beforeTable = text.match(/_(20\d{6})_估值表/u)
  if (beforeTable) return normaliseDate(beforeTable[1])
  return null
}

function scanHeaderRowsForUnitNav(headerRows: unknown): number | null {
  if (!Array.isArray(headerRows)) return null
  for (const row of headerRows.slice(0, 20)) {
    const joined = (row as unknown[] ?? []).map((c) => String(c ?? "")).join(" ")
    const m = joined.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (m && !/累计/.test(joined)) {
      const n = parseFloat(m[1])
      if (Number.isFinite(n) && n > 0.05 && n < 100) return n
    }
  }
  return null
}

async function main() {
  const apply = process.argv.includes("--apply")
  console.log(apply ? "=== APPLY (SBTX45 only) ===" : "=== DRY RUN (SBTX45 only) ===")

  const nav = await query<{
    nav_date: string
    nav: string
    fund_name: string | null
    source: string
    subject: string
  }>(
    `SELECT nav_date::text, nav::text, fund_name, source, left(subject,100) AS subject
     FROM ops_email_nav_records
     WHERE product_code = $1 AND nav_date >= $2::date
     ORDER BY nav_date DESC, id DESC
     LIMIT 20`,
    [BEIAN, SINCE],
  )
  console.log("\nemail_nav_records:", nav)

  const vals = await query<{
    id: string
    valuation_date: string
    unit_nav: string | null
    subject: string
    attachment_filename: string | null
    summary: Record<string, unknown> | null
    crawl_email_account: string
    email_uid: string
  }>(
    `SELECT id::text, valuation_date::text, unit_nav::text, subject, attachment_filename,
            summary, crawl_email_account, email_uid
     FROM ops_email_valuation_records
     WHERE (subject ILIKE '%SBTX45%' OR attachment_filename ILIKE '%SBTX45%'
            OR subject ILIKE '%衡颐承和FOF1%' OR attachment_filename ILIKE '%衡颐承和FOF1%')
       AND valuation_date >= $1::date
     ORDER BY valuation_date DESC, id DESC`,
    [SINCE],
  )
  console.log("\nvaluation_records:")
  for (const row of vals) {
    const summary = row.summary ?? {}
    const summaryDate = normaliseDate(String(summary.valuation_date ?? ""))
    const subjectDate = valuationSubjectSendDate(row.subject, row.attachment_filename ?? "")
    const headerNav = scanHeaderRowsForUnitNav(summary.header_rows)
    console.log({
      id: row.id,
      stored_date: row.valuation_date,
      stored_nav: row.unit_nav,
      summaryDate,
      subjectDate,
      headerNav,
      needsFix: summaryDate && subjectDate && summaryDate === subjectDate && row.valuation_date !== summaryDate,
      subj: row.subject.slice(0, 90),
    })
  }

  const cache = await query(
    `SELECT m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
     WHERE m.product_name ILIKE '%承和FOF1%' OR cache.beian_hao = $1`,
    [BEIAN],
  )
  console.log("\nmanaged cache:", cache)

  let fixed = 0
  for (const row of vals) {
    const summary = row.summary ?? {}
    const summaryDate = normaliseDate(String(summary.valuation_date ?? ""))
    const subjectDate = valuationSubjectSendDate(row.subject, row.attachment_filename ?? "")
    if (!summaryDate || !subjectDate || summaryDate !== subjectDate) continue
    if (row.valuation_date === summaryDate) continue

    const unitNav =
      scanHeaderRowsForUnitNav(summary.header_rows)
      ?? (parseFloat(String(summary.unit_nav ?? "")) > 0 ? parseFloat(String(summary.unit_nav)) : null)

    console.log(`\nFIX candidate: stored ${row.valuation_date} → ${summaryDate}, nav ${row.unit_nav} → ${unitNav}`)
    if (!apply) continue

    const existing = await query(
      `SELECT id FROM ops_email_valuation_records
       WHERE crawl_email_account = $1 AND email_uid = $2
         AND attachment_filename = $3 AND valuation_date = $4::date
         AND id <> $5
       LIMIT 1`,
      [row.crawl_email_account, row.email_uid, row.attachment_filename ?? "", summaryDate, row.id],
    )

    if (existing.length > 0) {
      await query(`DELETE FROM ops_email_valuation_records WHERE id = $1`, [row.id])
      console.log("  deleted duplicate shifted valuation row", row.id)
    } else {
      await query(
        `UPDATE ops_email_valuation_records
         SET valuation_date = $2::date,
             unit_nav = COALESCE($3::numeric, unit_nav)
         WHERE id = $1`,
        [row.id, summaryDate, unitNav],
      )
      console.log("  updated valuation_date", row.id)
    }

    await query(
      `DELETE FROM ops_email_nav_records
       WHERE crawl_email_account = $1
         AND email_uid = $2
         AND source = 'attachment_valuation_table'
         AND nav_date = $3::date`,
      [row.crawl_email_account, row.email_uid, row.valuation_date],
    )

    if (unitNav != null) {
      await query(
        `INSERT INTO ops_email_nav_records
           (crawl_email_account, email_uid, sent_at, subject, sender_email,
            nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name, source, attachment_filename)
         SELECT $1, $2, sent_at, subject, sender_email,
                $3::date, $4::numeric, NULL, NULL, $5, $6, 'attachment_valuation_table', $7
         FROM ops_email_valuation_records WHERE id = $8
         ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename) DO UPDATE SET
           nav = EXCLUDED.nav,
           product_code = EXCLUDED.product_code,
           fund_name = EXCLUDED.fund_name,
           source = EXCLUDED.source`,
        [
          row.crawl_email_account,
          row.email_uid,
          summaryDate,
          unitNav,
          BEIAN,
          PRODUCT,
          row.attachment_filename ?? "",
          existing.length > 0
            ? existing[0].id
            : row.id,
        ],
      )
      // If we deleted the shifted valuation row, pull from the correct-date duplicate
      if (existing.length > 0) {
        await query(
          `INSERT INTO ops_email_nav_records
             (crawl_email_account, email_uid, sent_at, subject, sender_email,
              nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name, source, attachment_filename)
           SELECT crawl_email_account, email_uid, NOW(), subject, '',
                  valuation_date, COALESCE(unit_nav, $1), NULL, NULL, $2, $3,
                  'attachment_valuation_table', COALESCE(attachment_filename, '')
           FROM ops_email_valuation_records WHERE id = $4
           ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename) DO UPDATE SET
             nav = EXCLUDED.nav,
             product_code = EXCLUDED.product_code,
             fund_name = EXCLUDED.fund_name`,
          [unitNav, BEIAN, PRODUCT, existing[0].id],
        )
      }
    }
    fixed++
  }

  if (apply) {
    // If no valuation date mismatch but Jul 9 NAV still wrong, force from summary for 20260709
    const jul9 = vals.find((r) => {
      const sd = valuationSubjectSendDate(r.subject, r.attachment_filename ?? "")
      return sd === "2026-07-09" || r.valuation_date === "2026-07-09" || r.valuation_date === "2026-07-08"
    })
    if (jul9) {
      const summary = jul9.summary ?? {}
      const summaryDate = normaliseDate(String(summary.valuation_date ?? "")) ?? "2026-07-09"
      const unitNav = scanHeaderRowsForUnitNav(summary.header_rows)
      console.log("\nJul9 source row:", {
        stored: jul9.valuation_date,
        summaryDate,
        unitNav,
        id: jul9.id,
      })
      if (unitNav != null && summaryDate === "2026-07-09") {
        if (jul9.valuation_date !== "2026-07-09") {
          await query(
            `UPDATE ops_email_valuation_records SET valuation_date = '2026-07-09'::date, unit_nav = $2 WHERE id = $1`,
            [jul9.id, unitNav],
          )
        }
        await query(
          `DELETE FROM ops_email_nav_records
           WHERE product_code = $1 AND source = 'attachment_valuation_table'
             AND nav_date IN ('2026-07-08','2026-07-09')
             AND (subject ILIKE '%SBTX45%' OR subject ILIKE '%承和FOF1%' OR attachment_filename ILIKE '%SBTX45%')`,
          [BEIAN],
        )
        // Re-insert correct Jul 9; leave other dates alone except the shifted copy for this email
        await query(
          `INSERT INTO ops_email_nav_records
             (crawl_email_account, email_uid, sent_at, subject, sender_email,
              nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name, source, attachment_filename)
           VALUES ($1,$2,NOW(),$3,'',$4::date,$5::numeric,NULL,NULL,$6,$7,'attachment_valuation_table',$8)
           ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename) DO UPDATE SET
             nav = EXCLUDED.nav, product_code = EXCLUDED.product_code, fund_name = EXCLUDED.fund_name`,
          [
            jul9.crawl_email_account,
            jul9.email_uid,
            jul9.subject,
            "2026-07-09",
            unitNav,
            BEIAN,
            PRODUCT,
            jul9.attachment_filename ?? "",
          ],
        )
        // Also delete wrongly shifted nav for this uid on Jul 8 if it was the Jul9 email
        await query(
          `DELETE FROM ops_email_nav_records
           WHERE crawl_email_account = $1 AND email_uid = $2
             AND source = 'attachment_valuation_table' AND nav_date = '2026-07-08'`,
          [jul9.crawl_email_account, jul9.email_uid],
        )
        console.log("Ensured SBTX45 2026-07-09 NAV =", unitNav)
      }
    }

    await upsertTrackingFundListCacheEntry(BEIAN, PRODUCT)

    const asOf = new Date().toISOString().slice(0, 10)
    const identity = { beian_hao: BEIAN, product_name: PRODUCT, short_name: PRODUCT }
    const resolver = await BatchNavResolver.create([identity], asOf)
    const latest = resolver.resolveAt(identity, asOf)
    const daily =
      latest != null ? resolver.calcDailyReturnPct(identity, latest.nav, latest.nav_date, null) : null
    const period =
      latest != null ? resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date) : null

    await query(
      `UPDATE ops_managed_products_list_cache cache
       SET beian_hao = $1,
           unit_nav = $2,
           nav_date = $3::date,
           return_pct = $4,
           ret_1w = $5,
           ret_1m = $6,
           ret_3m = $7,
           ret_6m = $8,
           ret_1y = $9,
           refreshed_at = NOW()
       FROM managed_products m
       WHERE cache.managed_product_id = m.id
         AND (m.product_name ILIKE '%承和FOF1%' OR cache.beian_hao = $1)`,
      [
        BEIAN,
        clampPgNumeric(latest?.nav ?? null, 16, 6),
        latest?.nav_date ?? null,
        clampPgNumeric(daily, 16, 8),
        clampPgNumeric(period?.ret_1w ?? null, 16, 8),
        clampPgNumeric(period?.ret_1m ?? null, 16, 8),
        clampPgNumeric(period?.ret_3m ?? null, 16, 8),
        clampPgNumeric(period?.ret_6m ?? null, 16, 8),
        clampPgNumeric(period?.ret_1y ?? null, 16, 8),
      ],
    )
    console.log("\nresolver latest:", latest)
    console.log("managed cache patched for SBTX45 only")
    console.log("fixed valuation mismatches:", fixed)
  } else {
    console.log("\nRe-run with --apply to repair SBTX45 only.")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
