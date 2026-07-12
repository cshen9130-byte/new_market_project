import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  selectEmailNavSeriesRows,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const BEIAN = "SBPC20"
const NAME = "六妙星九紫一号私募证券投资基金"

async function main() {
  const raw = await query(
    `SELECT id, nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, source, left(subject,110) AS subj
     FROM ops_email_nav_records
     WHERE product_code = 'SBPC20' OR subject ILIKE '%九紫一号%' OR fund_name ILIKE '%九紫%'
     ORDER BY nav_date DESC, id DESC LIMIT 40`,
  )

  console.log("=== email Jul window ===")
  for (const r of raw.filter((x) => x.nav_date >= "2026-06-25" && x.nav_date <= "2026-07-10")) {
    console.log(r.nav_date, "nav", r.nav, "cum", r.cumulative_nav, "src", r.source, "id", r.id)
    console.log(" ", r.subj)
  }

  const selected = selectEmailNavSeriesRows(
    raw.map((r) => ({
      nav_date: r.nav_date,
      nav: r.nav,
      cumulative_nav: r.cumulative_nav,
      adjusted_nav: r.adjusted_nav,
      product_code: r.product_code,
      fund_name: r.fund_name,
      subject: r.subj ?? "",
      attachment_filename: "",
      source: r.source,
    })),
    BEIAN,
    [NAME, "六妙星九紫一号"],
  )
  console.log("\n=== selected Jun-Jul ===")
  for (const r of selected.filter((x) => x.nav_date >= "2026-06-25")) {
    console.log(r.nav_date, "unit", r.nav, "cum", r.cumulative_nav)
  }

  const merged = await loadMergedFundNavRows(BEIAN, NAME, "六妙星九紫一号")
  console.log("\n=== merged Jun-Jul ===")
  for (const r of merged.filter((x) => x.price_date >= "2026-06-25" && x.price_date <= "2026-07-10")) {
    console.log(
      r.price_date,
      "unit", r.nav,
      "cum", r.cum_nav_withdrawal,
      "adj", r.cumulative_nav,
      "chg", r.price_change,
    )
  }
}

main().catch(console.error)
