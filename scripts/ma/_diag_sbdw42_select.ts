import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { selectEmailNavSeriesRows } from "../../lib/server/email-nav-query"

loadProjectEnvFiles()

async function main() {
  const rows = await query(
    `SELECT e.nav_date::text AS nav_date, e.nav::text, e.cumulative_nav::text,
            e.adjusted_nav::text, e.product_code, e.fund_name, e.attachment_filename, e.subject, e.source
     FROM ops_email_nav_records e
     WHERE product_code = 'SBDW42' OR fund_name ILIKE '%青钱基石1号%'
     ORDER BY nav_date ASC, id ASC`,
  )

  const all = selectEmailNavSeriesRows(rows, "SBDW42", ["青钱基石1号私募证券投资基金", "青钱基石1号"])
  const nonVirtual = rows.filter((r) => !/虚拟/u.test(`${r.subject ?? ""}${r.fund_name ?? ""}${r.attachment_filename ?? ""}`))
  const manage = selectEmailNavSeriesRows(nonVirtual, "SBDW42", ["青钱基石1号私募证券投资基金", "青钱基石1号"])

  console.log("all tail:", all.slice(-5).map((r) => [r.nav_date, r.nav]))
  console.log("manage tail:", manage.slice(-5).map((r) => [r.nav_date, r.nav]))
  console.log("\nraw Jul 7-9:")
  for (const r of rows.filter((x) => x.nav_date >= "2026-07-07")) {
    console.log(r.nav_date, r.nav, r.fund_name, /虚拟/u.test(`${r.subject}${r.fund_name}`) ? "V" : "")
  }
}

main().catch(console.error)
