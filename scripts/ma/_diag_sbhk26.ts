import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  selectEmailNavSeriesRows,
  loadPrivateFundLegacyNavRows,
} from "../../lib/server/email-nav-query"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

async function main() {
  const beian = "SBHK26"
  const productName = "六妙星豪鑫6号"

  const raw = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, source, left(subject,100) AS subj,
            left(attachment_filename,80) AS att
     FROM ops_email_nav_records
     WHERE product_code IN ('SBHK26','BHK26A') OR fund_name ILIKE '%豪鑫6号%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 40`,
  )
  console.log("=== raw email nav (Jun+) ===")
  for (const r of raw.filter((x) => x.nav_date >= "2026-06-10")) console.log(r)

  const selected = selectEmailNavSeriesRows(
    raw.map((r) => ({
      nav_date: r.nav_date,
      nav: r.nav,
      cumulative_nav: r.cumulative_nav,
      adjusted_nav: r.adjusted_nav,
      product_code: r.product_code,
      fund_name: r.fund_name,
      subject: r.subj ?? "",
      attachment_filename: r.att ?? "",
      source: r.source,
    })),
    beian,
    [productName, "豪鑫6号"],
  )
  console.log("\n=== selectEmailNavSeriesRows Jun+ ===")
  for (const r of selected.filter((x) => x.nav_date >= "2026-06-10")) console.log(r)

  const series = await loadEmailNavSeries(beian, productName)
  console.log("\n=== loadEmailNavSeries Jun+ ===")
  for (const r of series.filter((x) => x.price_date >= "2026-06-10")) console.log(r)

  const legacy = await loadPrivateFundLegacyNavRows(beian, productName, "")
  console.log("\n=== legacy Jun+ ===")
  for (const r of legacy.filter((x) => x.price_date >= "2026-06-01").slice(-15)) console.log(r)

  const merged = await loadMergedFundNavRows(beian, productName, "")
  console.log("\n=== loadMergedFundNavRows Jun+ ===")
  for (const r of merged.filter((x) => x.price_date >= "2026-06-01").slice(-15)) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }

  const jun29 = merged.find((r) => r.price_date.startsWith("2026-06-29"))
  console.log("\n=== 2026-06-29 merged row ===", jun29)
}

main().catch(console.error)
