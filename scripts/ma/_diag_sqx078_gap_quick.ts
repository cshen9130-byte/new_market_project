import { loadProjectEnvFiles, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"
loadProjectEnvFiles()
ensureScriptDatabaseEnv()

async function main() {
  const { query } = await import("@/lib/db")
  const {
    loadPrivateFundLegacyNavRows,
    loadEmailNavSeries,
    mergeNavSeriesWithEmail,
  } = await import("@/lib/server/email-nav-query")

  const BEIAN = "SQX078"
  const productName = "特夫郁金香全量化私募证券投资基金"

  const gapRows = await query<{ nav_date: string; nav: string; cum: string; subj: string }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text AS cum, left(subject,90) AS subj
     FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = $1
       AND nav_date BETWEEN '2026-05-30' AND '2026-06-14'
     ORDER BY nav_date`,
    [BEIAN],
  )
  console.log("gap email rows:", gapRows.length)
  for (const r of gapRows) console.log(r.nav_date, r.nav, r.cum, r.subj)

  const acctRows = await query<{ nav_date: string; acct: string; subj: string }>(
    `SELECT nav_date::text, crawl_email_account AS acct, left(subject,80) AS subj
     FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = $1
     ORDER BY nav_date LIMIT 5`,
    [BEIAN],
  )
  console.log("\nemail by account (first 5):", acctRows)

  const allEmail = await query<{ nav_date: string; nav: string; acct: string }>(
    `SELECT nav_date::text, nav::text, crawl_email_account AS acct
     FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = $1 ORDER BY nav_date`,
    [BEIAN],
  )
  console.log("\nall email dates:", allEmail.map((r) => `${r.nav_date}@${r.acct}`).join(", "))

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, productName, "特夫郁金香全量化")
  const email = await loadEmailNavSeries(BEIAN, productName, "特夫郁金香全量化")
  const merged = mergeNavSeriesWithEmail(legacy, email)
  const window = merged.filter((r) => r.price_date >= "2026-05-25" && r.price_date <= "2026-06-20")
  console.log("\nmerged (legacy+email):")
  for (const r of window) console.log(r.price_date, r.nav, r.cum_nav_withdrawal)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
