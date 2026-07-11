import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  selectEmailNavSeriesRows,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const BEIAN = "BFM35A"
const NAME = "金友至远1号私募证券投资基金A类份额"

async function main() {
  const pool = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav' AND (register_number ILIKE '%BFM35%' OR product_name ILIKE '%金友%')`,
  )
  console.log("pool rows:", pool)

  const cache = await query(
    `SELECT beian_hao, product_name, unit_nav::text, nav_date::text, return_pct::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao ILIKE '%BFM35%' OR product_name ILIKE '%金友%'`,
  )
  console.log("cache:", cache)

  const raw = await query(
    `SELECT id, nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name, source, left(subject,100) AS subj
     FROM ops_email_nav_records
     WHERE product_code IN ('SBFM35','BFM35A')
        OR fund_name ILIKE '%金友%'
        OR subject ILIKE '%BFM35A%'
     ORDER BY nav_date DESC, id DESC LIMIT 25`,
  )
  console.log("\nemail tail:")
  for (const r of raw.filter((x) => x.nav_date >= "2026-05-20")) console.log(r)

  const selected = selectEmailNavSeriesRows(
    raw.map((r) => ({
      nav_date: r.nav_date,
      nav: r.nav,
      cumulative_nav: r.cumulative_nav,
      adjusted_nav: null,
      product_code: r.product_code,
      fund_name: r.fund_name,
      subject: r.subj ?? "",
      attachment_filename: "",
      source: r.source,
    })),
    BEIAN,
    [NAME, "南京金友A类", "金友至远1号A类"],
  )
  console.log("\nselected:", selected.filter((r) => r.nav_date >= "2026-05-20"))

  const emailNav = await loadEmailNavSeries(BEIAN, NAME)
  console.log("\nemailNav:", emailNav.filter((r) => r.price_date >= "2026-05-20"))

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, NAME, "南京金友A类")
  console.log("\nlegacy:", legacy.filter((r) => r.price_date >= "2026-05-20"))

  const merged = await loadMergedFundNavRows(BEIAN, NAME, "南京金友A类")
  console.log("\nmerged:")
  for (const r of merged.filter((x) => x.price_date >= "2026-05-20")) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav, "chg", r.price_change)
  }

  const identity = { beian_hao: BEIAN, product_name: NAME, short_name: "南京金友A类" }
  const resolver = await BatchNavResolver.create([identity], "2026-07-11")
  console.log("\nBatchNavResolver:", resolver.resolveAt(identity, "2026-07-11"))
}

main().catch(console.error)
