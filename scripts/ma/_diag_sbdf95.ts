import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  isNavTableSubject,
  isNavTableAttachmentFilename,
  selectNavTableAttachments,
} from "../../lib/server/email-nav-attachment"
import { extractNavMetadata } from "../../lib/server/email-nav-extract"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"

loadProjectEnvFiles()

const BEIAN = "SBDF95"
const PRODUCT_NAME = "锐耐稳健对冲11号私募证券投资基金"
const SHORT_NAME = "锐耐稳健对冲11号"

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
  console.log("\n=== merge single spike (no DB) ===")
  console.log("rows:", merged.map((r) => ({ d: r.price_date, unit: r.nav, cum: r.cum_nav_withdrawal, adj: r.cumulative_nav })))
  console.log("spike removed:", !merged.some((r) => r.price_date === "2026-07-03"))

  const tailLegacy = [
    { price_date: "2026-07-01", nav: "1.0214", cumulative_nav: "1.0214", cum_nav_withdrawal: "1.0214", price_change: "" },
    { price_date: "2026-07-07", nav: "4.6831", cumulative_nav: "4.6831", cum_nav_withdrawal: "4.6831", price_change: "" },
    { price_date: "2026-07-08", nav: "4.6627", cumulative_nav: "4.6627", cum_nav_withdrawal: "4.6627", price_change: "" },
  ]
  const tailMerged = mergeNavSeriesWithEmail(tailLegacy, [])
  console.log("\n=== merge multi-day tail (no DB) ===")
  console.log("rows:", tailMerged.map((r) => ({ d: r.price_date, unit: r.nav })))
  console.log("tail removed:", !tailMerged.some((r) => r.price_date >= "2026-07-07"))

  try {
    const nav = await query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM ops_email_nav_records
       WHERE product_code = 'SBDF95'
          OR subject ILIKE '%SBDF95%'
          OR fund_name ILIKE '%锐耐%'
          OR attachment_filename ILIKE '%锐耐%'`,
    )

    const parse = await query<{ subj: string | null; sent_at: string }>(
      `SELECT left(subject, 100) AS subj, sent_at::text
       FROM ops_email_valuation_records
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

    const legacy = await loadPrivateFundLegacyNavRows(BEIAN, PRODUCT_NAME, SHORT_NAME)
    const email = await loadEmailNavSeries(BEIAN, PRODUCT_NAME)
    const nav_series = mergeNavSeriesWithEmail(legacy, email)
    console.log("\n=== merged series (legacy + email) ===")
    console.log("legacy rows:", legacy.length, "email rows:", email.length, "merged:", nav_series.length)
    for (const r of nav_series.filter((x) => x.price_date >= "2026-06-28")) {
      console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
    }
    const latestMerged = nav_series.at(-1)
    console.log("\nlatest merged:", latestMerged?.price_date, latestMerged?.nav, latestMerged?.cum_nav_withdrawal)
    const maxUnit = Math.max(...nav_series.map((r) => parseFloat(r.nav)))
    console.log("max unit:", maxUnit, "tail corrupt removed:", maxUnit < 2)
  } catch (err) {
    console.log("\n=== database (skipped — no connection) ===")
    console.log(String(err))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
