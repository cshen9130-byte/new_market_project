/**
 * Repair FOF list 最新涨跌幅 when Guotai TA虚拟净值 was skipped and
 * 估值表 history preferred lagging 1108 OTC 市价 over 1109.
 *
 * - Backfill missing email NAV from 1109 估值表 holdings (same figures detail uses)
 * - Delete misfiled Guotai TA rows stored under 在管 product codes
 * - Full-rebuild 估值表 NAV history (1109 preference)
 * - Refresh ops_fof_overview_list_cache
 */
import { writeFileSync } from "fs"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { upsertEmailNavRecords } = await import("../../lib/server/email-nav-pg")
  const { loadManagedUnderlyingNavHistory } = await import(
    "../../lib/server/managed-fof-underlying-pg"
  )
  const { refreshFofOverviewListCache } = await import(
    "../../lib/server/fof-overview-list-cache-pg"
  )
  const lines: string[] = []

  // 1) Remove Guotai TA rows mis-attributed to 在管 products (investor inside 【】).
  const deleted = await query(
    `DELETE FROM ops_email_nav_records
     WHERE subject ~ '】TA虚拟净值'
       AND subject ~ '【(荣熙共赢|金舆基石一号|金舆追风1号|衡颐海泰1号|抱朴聚融祥和一号)'
       AND (
         fund_name ~ '(荣熙共赢|金舆基石一号|金舆追风|衡颐海泰|抱朴聚融)'
         OR product_code IN ('SAVW72','SBNX55','SCJ536','SBPU97','SSG947')
       )
     RETURNING id::text, product_code, fund_name, nav_date::text, left(subject, 90) AS subject`,
  )
  lines.push(`deleted misfiled Guotai TA rows: ${deleted.length}`)
  for (const r of deleted.slice(0, 20)) lines.push(JSON.stringify(r))

  // 2) Backfill missing underlying email NAVs from preferred 1109 估值表 holdings.
  const gaps = await query<{
    beian_hao: string
    product_name: string
    nav_date: string
    unit_nav: string
    subject_code: string
  }>(
    `WITH fof AS (
       SELECT DISTINCT beian_hao, product_name
       FROM ops_fof_overview_list_cache
       WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
     ),
     preferred AS (
       SELECT
         f.beian_hao,
         f.product_name,
         r.valuation_date::text AS nav_date,
         h.price::float8 AS unit_nav,
         h.subject_code,
         ROW_NUMBER() OVER (
           PARTITION BY f.beian_hao, r.valuation_date
           ORDER BY
             CASE
               WHEN h.subject_code LIKE '1109%' THEN 0
               WHEN h.subject_code ILIKE '%OTC%' THEN 2
               WHEN h.subject_code LIKE '1108%' THEN 1
               ELSE 3
             END,
             h.price DESC NULLS LAST
         ) AS rn
       FROM fof f
       JOIN ops_email_valuation_holdings h
         ON (
           UPPER(TRIM(COALESCE(h.symbol, ''))) = UPPER(TRIM(f.beian_hao))
           OR h.subject_name ILIKE '%' || regexp_replace(f.product_name, '[ABC]类$', '') || '%'
         )
       JOIN ops_email_valuation_records r ON r.id = h.valuation_record_id
       WHERE r.valuation_date >= CURRENT_DATE - 14
         AND COALESCE(h.price, 0) > 0
         AND (
           h.subject_code LIKE '1109%'
           OR h.subject_code LIKE '1108%'
         )
     )
     SELECT p.beian_hao, p.product_name, p.nav_date, p.unit_nav::text, p.subject_code
     FROM preferred p
     WHERE p.rn = 1
       AND NOT EXISTS (
         SELECT 1 FROM ops_email_nav_records e
         WHERE e.nav_date = p.nav_date::date
           AND (
             UPPER(TRIM(COALESCE(e.product_code, ''))) = UPPER(TRIM(p.beian_hao))
             OR e.fund_name ILIKE '%' || regexp_replace(p.product_name, '[ABC]类$', '') || '%'
           )
       )
     ORDER BY p.beian_hao, p.nav_date`,
  )
  lines.push(`\ngap backfill candidates: ${gaps.length}`)

  const inserts = gaps.map((g, i) => ({
    crawlEmailAccount: "repair-guotai-ta-gap",
    emailUid: `repair-${g.beian_hao}-${g.nav_date}-${i}`,
    sentAt: `${g.nav_date}T08:00:00+08:00`,
    subject: `repair:估值表1109→email ${g.beian_hao}_${g.nav_date}`,
    senderEmail: "repair@local",
    navDate: g.nav_date,
    nav: parseFloat(g.unit_nav),
    cumulativeNav: parseFloat(g.unit_nav),
    adjustedNav: null as number | null,
    productCode: g.beian_hao,
    fundName: g.product_name,
    source: "body_table" as const,
    attachmentFilename: "",
  }))

  for (const g of gaps) {
    lines.push(
      `${g.beian_hao} ${g.nav_date} nav=${g.unit_nav} via ${g.subject_code} (${g.product_name})`,
    )
  }

  const saved = inserts.length > 0 ? await upsertEmailNavRecords(inserts) : 0
  lines.push(`\nupserted email NAV rows: ${saved}`)

  // 3) Full rebuild valuation history so list merge prefers 1109.
  lines.push("\nrebuilding 估值表 NAV history…")
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
  const targets = await query<{ product_name: string; beian_hao: string | null }>(
    `SELECT DISTINCT product_name, beian_hao FROM ops_fof_overview_list_cache`,
  )
  await loadManagedUnderlyingNavHistory(since, {
    targets: targets.map((t) => ({
      product_name: t.product_name,
      beian_hao: t.beian_hao,
    })),
    skipSymbolBackfill: true,
  })
  lines.push(`valuation history rebuilt for ${targets.length} products since ${since}`)

  lines.push("\nrefreshing FOF overview list cache…")
  const n = await refreshFofOverviewListCache({ reuseResolvedIdentities: true })
  lines.push(`cache refreshed rows=${n}`)

  // 5) Verify 标普 / 泰来 products.
  const probe = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text
     FROM ops_fof_overview_list_cache
     WHERE product_name ILIKE '%泰来%' OR product_name ILIKE '%标普%' OR beian_hao IN ('BVC41A','AVF39A','AGT37A','BHK26A')
     ORDER BY product_name`,
  )
  lines.push("\nPROBE:")
  for (const r of probe) {
    const ret = r.return_pct != null ? (parseFloat(r.return_pct) * 100).toFixed(2) + "%" : "null"
    lines.push(
      `${r.beian_hao} ${r.product_name} ${r.nav_date} nav=${r.unit_nav} ret=${ret}`,
    )
  }

  writeFileSync("scripts/ma/_repair_fof_ret_out.txt", lines.join("\n"), "utf8")
  console.log(lines.join("\n"))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
