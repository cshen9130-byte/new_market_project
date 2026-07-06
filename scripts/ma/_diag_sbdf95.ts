import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  isNavTableSubject,
  isNavTableAttachmentFilename,
  selectNavTableAttachments,
} from "../../lib/server/email-nav-attachment"
import { extractNavMetadata } from "../../lib/server/email-nav-extract"
import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query"

loadProjectEnvFiles()

const subject =
  "【基金净值】SBDF95(总)_锐耐稳健对冲11号私募证券投资基金_20250808-20260702"
const filename =
  "【基金净值】锐耐稳健对冲11号私募证券投资基金(总)_20250808-20260702.xlsx"

async function main() {
  console.log("=== attachment selection ===")
  console.log("isNavTableSubject:", isNavTableSubject(subject))
  console.log("isNavTableAttachmentFilename:", isNavTableAttachmentFilename(filename))
  console.log(
    "selectNavTableAttachments:",
    selectNavTableAttachments(subject, [{ filename, part: "1" }]),
  )
  console.log("extractNavMetadata:", extractNavMetadata(subject, filename))

  const sampleLegacy = [
    { price_date: "2026-07-01", nav: "1.0214", cumulative_nav: "1.0214", cum_nav_withdrawal: "1.0214", price_change: "" },
    { price_date: "2026-07-03", nav: "4.6587", cumulative_nav: "4.6587", cum_nav_withdrawal: "4.6587", price_change: "" },
  ]
  const merged = mergeNavSeriesWithEmail(sampleLegacy, [])
  console.log("\n=== merge (no DB) ===")
  console.log("rows:", merged.map((r) => ({ d: r.price_date, unit: r.nav, cum: r.cum_nav_withdrawal, adj: r.cumulative_nav })))
  console.log("spike removed:", !merged.some((r) => r.price_date === "2026-07-03"))

  try {
    const nav = await query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM ops_email_nav_records
       WHERE product_code = 'SBDF95'
          OR subject ILIKE '%SBDF95%'
          OR fund_name ILIKE '%锐耐%'
          OR attachment_filename ILIKE '%锐耐%'`,
    )

    const parse = await query<{
      subj: string | null
      att: string | null
      nav_parse_status: string | null
      nav_saved_count: number | null
    }>(
      `SELECT left(subject, 100) AS subj,
              left(attachment_filename, 80) AS att,
              nav_parse_status,
              nav_saved_count
       FROM ops_email_parse_records
       WHERE subject ILIKE '%SBDF95%' OR subject ILIKE '%锐耐稳健%'
       ORDER BY sent_at DESC
       LIMIT 5`,
    )

    const latest = await query<{ nav_date: string; nav: string; cumulative_nav: string | null }>(
      `SELECT nav_date::text, nav::text, cumulative_nav::text
       FROM ops_email_nav_records
       WHERE product_code = 'SBDF95'
       ORDER BY nav_date DESC
       LIMIT 5`,
    )

    console.log("\n=== database ===")
    console.log("nav rows:", nav[0]?.n)
    console.log("parse records:", parse)
    console.log("latest email nav:", latest)
  } catch (err) {
    console.log("\n=== database (skipped — no connection) ===")
    console.log(String(err))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
