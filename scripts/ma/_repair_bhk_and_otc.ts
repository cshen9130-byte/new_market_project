import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")

  // Move section-4 earlier is code; here: clean OTC gap fills + fix BHK26A.
  const delOtc = await query(
    `DELETE FROM ops_email_nav_records
     WHERE crawl_email_account = 'repair-guotai-ta-gap'
       AND subject ILIKE '%110802%'
     RETURNING product_code, nav_date::text, nav::text`,
  )
  console.log("deleted OTC repair rows", delOtc.length)

  const keep = await query(
    `SELECT product_code, nav_date::text, nav::text, left(subject,60) s
     FROM ops_email_nav_records
     WHERE crawl_email_account = 'repair-guotai-ta-gap'
       AND product_code IN ('BVC41A','AGT37A','AVF39A')
     ORDER BY product_code, nav_date`,
  )
  console.log("kept 泰来 repair:")
  for (const r of keep) console.log(JSON.stringify(r))

  const vh = await query(
    `SELECT r.valuation_date::text, h.price::text, h.subject_code, r.product_code AS fof
     FROM ops_email_valuation_holdings h
     JOIN ops_email_valuation_records r ON r.id = h.valuation_record_id
     WHERE (h.symbol ILIKE '%BHK26%' OR h.subject_name ILIKE '%豪鑫6号%')
       AND r.valuation_date >= '2026-07-20'
       AND COALESCE(h.price,0) > 0
     ORDER BY r.valuation_date DESC, h.subject_code`,
  )
  console.log("\nBHK26A valuation prices:")
  for (const r of vh) console.log(JSON.stringify(r))

  // Prefer 1109 市价 as 实际净值 for estimate emails when stored nav looks like 虚拟
  // (multiple investors same day already identical — still may be virtual if extract was old).
  const preferred = await query<{
    nav_date: string
    unit_nav: string
  }>(
    `SELECT r.valuation_date::text AS nav_date, h.price::text AS unit_nav
     FROM ops_email_valuation_holdings h
     JOIN ops_email_valuation_records r ON r.id = h.valuation_record_id
     WHERE r.valuation_date >= '2026-07-01'
       AND h.subject_code LIKE '1109%'
       AND (UPPER(TRIM(h.symbol)) = 'BHK26A' OR h.subject_name ILIKE '%豪鑫6号%')
       AND COALESCE(h.price, 0) > 0
     ORDER BY r.valuation_date, h.price DESC`,
  )
  console.log("\nBHK26A 1109 preferred:", preferred)

  for (const p of preferred) {
    const upd = await query(
      `UPDATE ops_email_nav_records
       SET nav = $1::numeric
       WHERE product_code = 'BHK26A'
         AND nav_date = $2::date
         AND subject ILIKE '%虚拟净值表现估算%'
         AND nav IS DISTINCT FROM $1::numeric
       RETURNING id::text, nav_date::text, nav::text`,
      [p.unit_nav, p.nav_date],
    )
    if (upd.length) console.log("updated", upd.length, p.nav_date, "->", p.unit_nav)
  }

  // If no 1109, fall back to known Jul-24 实际净值 from TA body (1.0548).
  const jul24 = await query(
    `SELECT nav::text FROM ops_email_nav_records
     WHERE product_code='BHK26A' AND nav_date='2026-07-24' LIMIT 1`,
  )
  if (jul24[0] && parseFloat(jul24[0].nav) > 1.08) {
    const upd = await query(
      `UPDATE ops_email_nav_records
       SET nav = 1.0548
       WHERE product_code = 'BHK26A' AND nav_date = '2026-07-24'
         AND subject ILIKE '%虚拟净值表现估算%'
       RETURNING id::text, nav::text`,
    )
    console.log("forced Jul-24 实际净值 1.0548", upd.length)
  }

  const { refreshFofOverviewListCache } = await import(
    "../../lib/server/fof-overview-list-cache-pg"
  )
  await refreshFofOverviewListCache({ reuseResolvedIdentities: true })

  const probe = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao IN ('BVC41A','AVF39A','AGT37A','BHK26A')
     ORDER BY beian_hao`,
  )
  console.log("\nPROBE:")
  for (const r of probe) {
    const ret = r.return_pct != null ? (parseFloat(r.return_pct) * 100).toFixed(2) + "%" : "null"
    console.log(`${r.beian_hao} ${r.nav_date} nav=${r.unit_nav} ret=${ret}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
