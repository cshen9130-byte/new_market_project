import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
  selectEmailNavSeriesRows,
  collectFundNameAliases,
} from "../../lib/server/email-nav-query"

loadProjectEnvFiles()

async function trace(beian: string, name: string) {
  console.log(`\n### ${beian} ${name}`)
  const aliases = collectFundNameAliases(name, null)
  const raw = await query(
    `SELECT e.nav_date::text AS nav_date, e.nav::text, e.cumulative_nav::text,
            e.adjusted_nav::text, e.product_code, e.fund_name, e.subject, e.source
     FROM ops_email_nav_records e
     WHERE BTRIM(product_code) = $1
     ORDER BY nav_date ASC`,
    [beian],
  )
  console.log("raw email count", raw.length, "last", raw.at(-1))
  const selected = selectEmailNavSeriesRows(
    raw.map((r) => ({
      nav_date: r.nav_date.slice(0, 10),
      nav: r.nav,
      cumulative_nav: r.cumulative_nav,
      adjusted_nav: r.adjusted_nav,
      product_code: r.product_code,
      fund_name: r.fund_name,
      attachment_filename: null,
      subject: r.subject,
      source: r.source,
    })),
    beian,
    aliases,
  )
  console.log("selected count", selected.length, "last", selected.at(-1))
  const email = await loadEmailNavSeries(beian, name, null)
  console.log("loadEmailNavSeries count", email.length, "last", email.at(-1))
  const legacy = await loadPrivateFundLegacyNavRows(beian, name, "")
  console.log("legacy count", legacy.length, "last", legacy.at(-1))
  const ctx = { beian_hao: beian, product_name: name, short_name: null }
  const merged = mergeNavSeriesWithEmail(legacy, email, ctx)
  console.log("merged count", merged.length, "first", merged[0], "last", merged.at(-1))
}

async function main() {
  await trace("SBDF95", "锐耐稳健对冲11号私募证券投资基金")
  await trace("BDF95A", "锐耐稳健对冲11号A类")
}

main().catch(console.error)
