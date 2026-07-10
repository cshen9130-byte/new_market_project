import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  selectEmailNavSeriesRows,
  loadPrivateFundLegacyNavRows,
} from "../../lib/server/email-nav-query"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

const cases = [
  { beian: "SAVM35", name: "笃熙景泰泰渊流1号" },
  { beian: "SAVN35", name: "尚熙禀泰渊流1号" },
]

async function diagOne(beian: string, productName: string) {
  console.log(`\n========== ${productName} (${beian}) ==========`)

  const raw = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, source, left(subject,110) AS subj,
            left(attachment_filename,80) AS att
     FROM ops_email_nav_records
     WHERE product_code ILIKE $1 OR product_code ILIKE $2 OR fund_name ILIKE $3
        OR subject ILIKE $3 OR attachment_filename ILIKE $1
     ORDER BY nav_date DESC, id DESC LIMIT 25`,
    [beian, beian.slice(0, -1) + "%", `%${productName.slice(0, 4)}%`],
  )
  console.log("raw email (Jul):", raw.filter((r) => r.nav_date >= "2026-06-20"))

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
    [productName],
  )
  console.log("selected tail:", selected.filter((r) => r.nav_date >= "2026-06-20"))

  const series = await loadEmailNavSeries(beian, productName)
  console.log("loadEmailNavSeries tail:", series.filter((r) => r.price_date >= "2026-06-20"))

  const merged = await loadMergedFundNavRows(beian, productName, "")
  console.log("merged tail:")
  for (const r of merged.filter((x) => x.price_date >= "2026-06-20").slice(-12)) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }
}

async function main() {
  await diagOne("SAVM35", "笃熙景泰泰渊流1号")
  const merged = await loadMergedFundNavRows("SAVM35", "笃熙景泰泰渊流1号", "")
  console.log("\n=== full merged series (景泰 name) ===")
  for (const r of merged) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }
  await diagOne("SAVN35", "尚熙禀泰渊流1号")
}

main().catch(console.error)
