/**
 * Live SBPC20 diagnosis via SSH tunnel (5433).
 * Usage: npx tsx scripts/ma/_diag_sbpc20_live.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  selectEmailNavSeriesRows,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const BEIAN = "SBPC20"
const NAME = "六妙星九紫一号私募证券投资基金"
const SHORT = "六妙星九紫一号"

async function main() {
  const raw = await query<{
    id: number
    nav_date: string
    nav: string
    cumulative_nav: string | null
    adjusted_nav: string | null
    product_code: string | null
    fund_name: string | null
    source: string | null
    subj: string | null
    attachment_filename: string | null
  }>(
    `SELECT id, nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, source, left(subject, 120) AS subj, attachment_filename
     FROM ops_email_nav_records
     WHERE product_code = 'SBPC20'
        OR subject ILIKE '%九紫一号%'
        OR fund_name ILIKE '%九紫%'
        OR attachment_filename ILIKE '%SBPC20%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 80`,
  )

  console.log("=== email rows 2026-06-25 .. 2026-07-10 ===")
  for (const r of raw.filter((x) => x.nav_date >= "2026-06-25" && x.nav_date <= "2026-07-10")) {
    console.log(
      r.nav_date,
      "nav", r.nav,
      "cum", r.cumulative_nav,
      "adj", r.adjusted_nav,
      "src", r.source,
      "code", r.product_code,
      "id", r.id,
    )
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
      attachment_filename: r.attachment_filename ?? "",
      source: r.source,
    })),
    BEIAN,
    [NAME, SHORT],
  )
  console.log("\n=== selectEmailNavSeriesRows (Jun-Jul) ===")
  for (const r of selected.filter((x) => x.nav_date >= "2026-06-25")) {
    console.log(r.nav_date, "unit", r.nav, "cum", r.cumulative_nav, "adj", r.adjusted_nav)
  }

  const emailSeries = await loadEmailNavSeries(BEIAN, NAME, SHORT, [])
  console.log("\n=== loadEmailNavSeries Jun-Jul ===")
  for (const r of emailSeries.filter((x) => x.price_date >= "2026-06-25" && x.price_date <= "2026-07-10")) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cumulative_nav, "adj", r.adjusted_nav)
  }

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, NAME, SHORT)
  console.log(`\n=== legacy rows: ${legacy.length} ===`)
  for (const r of legacy.filter((x) => x.price_date >= "2026-06-25" && x.price_date <= "2026-07-10")) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }

  const merged = mergeNavSeriesWithEmail(legacy, emailSeries)
  console.log("\n=== merged Jun-Jul (what detail API should show) ===")
  for (const r of merged.filter((x) => x.price_date >= "2026-06-25" && x.price_date <= "2026-07-10")) {
    console.log(
      r.price_date,
      "unit", r.nav,
      "cum", r.cum_nav_withdrawal,
      "adj", r.cumulative_nav,
      "chg", Number.isFinite(parseFloat(r.price_change)) ? (+parseFloat(r.price_change)).toFixed(2) + "%" : r.price_change,
    )
  }

  const r702 = merged.find((r) => r.price_date === "2026-07-02")
  const r703 = merged.find((r) => r.price_date === "2026-07-03")
  if (r702) {
    const unit = parseFloat(r702.nav)
    const cum = parseFloat(r702.cum_nav_withdrawal)
    console.log("\nJul2 check: unit", unit, "cum", cum, "offset", cum - unit)
    console.log("  PASS cum>unit+0.05?", cum - unit > 0.05)
  }
  if (r703) {
    const chg = parseFloat(r703.price_change)
    console.log("Jul3 check: chg", chg.toFixed(2) + "%", "PASS |chg|<5%?", Math.abs(chg) < 5)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
