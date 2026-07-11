import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  selectEmailNavSeriesRows,
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const BEIAN = "SBFM35"
const NAME = "金友至远1号私募证券投资基金"

async function main() {
  const raw = await query(
    `SELECT id, nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, source, left(subject,120) AS subj
     FROM ops_email_nav_records
     WHERE product_code IN ('SBFM35','BFM35A')
        OR fund_name ILIKE '%金友至远%'
        OR subject ILIKE '%金友至远%'
     ORDER BY nav_date, id`,
  )
  console.log("=== ALL email rows May-Jul ===")
  for (const r of raw.filter((x) => x.nav_date >= "2026-05-20")) {
    console.log(r.nav_date, "id", r.id, "code", r.product_code, "nav", r.nav, "cum", r.cumulative_nav, "src", r.source)
    console.log("  ", r.subj)
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
    [NAME, "金友至远1号"],
  )
  console.log("\n=== selectEmailNavSeriesRows ===")
  for (const r of selected.filter((x) => x.nav_date >= "2026-05-20")) {
    console.log(r.nav_date, "nav", r.nav, "cum", r.cumulative_nav, "code", r.product_code, r.source)
  }

  const emailNav = await loadEmailNavSeries(BEIAN, NAME)
  console.log("\n=== loadEmailNavSeries ===")
  for (const r of emailNav.filter((x) => x.price_date >= "2026-05-20")) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cumulative_nav)
  }

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, NAME, "金友至远1号")
  const merged = mergeNavSeriesWithEmail(legacy, emailNav)
  console.log("\n=== merged May-Jul ===")
  for (const r of merged.filter((x) => x.price_date >= "2026-05-20")) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav, "chg", r.price_change)
  }
}

main().catch(console.error)
