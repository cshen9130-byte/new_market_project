/**
 * Repair leftover calendar-year product_code `2026` on 鸣石广胜 / 鸣石广鸣 emails
 * and drop the bogus /2026 identity so the 鸣石广胜 chart is not mixed with
 * 鸣石广鸣 2.5552. Does not rewrite 草本致远 SND951, C2026→SBDU00, or other
 * already-fixed funds.
 *
 *   npx tsx scripts/ma/_repair_mingshi_year_code_nav.ts
 *   npx tsx scripts/ma/_repair_mingshi_year_code_nav.ts --apply
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

const APPLY = process.argv.includes("--apply")
const YEAR_RE = "^(19|20)[0-9]{2}$"

async function main() {
  const { query } = await import("@/lib/db")

  const yearRows = await query<{
    product_code: string
    fund_name: string | null
    n: string
    sample_nav: string | null
    sample_date: string | null
  }>(
    `SELECT BTRIM(product_code) AS product_code,
            LEFT(COALESCE(fund_name, ''), 60) AS fund_name,
            COUNT(*)::text AS n,
            MAX(nav)::text AS sample_nav,
            MAX(nav_date)::text AS sample_date
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) ~ $1
     GROUP BY 1, 2
     ORDER BY COUNT(*) DESC
     LIMIT 40`,
    [YEAR_RE],
  )
  console.log("=== leftover year product_code ===")
  for (const row of yearRows) {
    console.log(
      `${row.product_code} n=${row.n} nav=${row.sample_nav} date=${row.sample_date} name=${row.fund_name}`,
    )
  }

  const c2026 = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_email_nav_records
     WHERE UPPER(BTRIM(product_code)) IN ('C2026', 'SBDU00')
       AND fund_name ILIKE '%桫罗稳鸿%'`,
  )
  const snd951 = await query<{ n: string; code: string | null }>(
    `SELECT COUNT(*)::text AS n, MAX(BTRIM(product_code)) AS code
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%草本致远1号%'
       AND fund_name NOT ILIKE '%B类%'
       AND fund_name NOT ILIKE '%C类%'`,
  )
  console.log(`桫罗稳鸿 C2026/SBDU00 rows=${c2026[0]?.n} (must stay)`)
  console.log(`草本致远1号 rows=${snd951[0]?.n} sample_code=${snd951[0]?.code} (must stay SND951)`)

  const caches = await query<{ src: string; beian_hao: string | null; product_name: string | null }>(
    `SELECT 'detail' AS src, beian_hao, product_name
     FROM ops_private_fund_detail_nav_cache
     WHERE cache_key IN ('2026', 'SBNJ90', 'SNK642', 'SND951')
        OR beian_hao IN ('2026', 'SBNJ90', 'SNK642', 'SND951')
     UNION ALL
     SELECT 'tracking', beian_hao, product_name
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao IN ('2026', 'SBNJ90', 'SNK642', 'SND951')
        OR product_name ILIKE '%鸣石广胜中证A500%'
        OR product_name ILIKE '%鸣石广鸣中证1000指数增强1号%'
     UNION ALL
     SELECT 'team_data', beian_hao, product_name
     FROM ops_team_data_products
     WHERE beian_hao IN ('2026', 'SBNJ90', 'SNK642', 'SND951')
        OR product_name ILIKE '%鸣石广胜%'
        OR product_name ILIKE '%鸣石广鸣%'
        OR product_name ILIKE '%草本致远1号%'`,
  ).catch(() => [] as Array<{ src: string; beian_hao: string | null; product_name: string | null }>)
  console.log("=== identity / cache ===")
  for (const row of caches) {
    console.log(`${row.src} ${row.beian_hao} ${row.product_name}`)
  }

  if (!APPLY) {
    console.log("dry-run only; pass --apply to write 鸣石 year-code rows + drop /2026 caches")
    return
  }

  const caobenYear = await query<{ n: string }>(
    `DELETE FROM ops_email_nav_records
     WHERE fund_name ILIKE '%草本致远1号%'
       AND fund_name NOT ILIKE '%B类%'
       AND fund_name NOT ILIKE '%C类%'
       AND BTRIM(product_code) ~ $1
     RETURNING 1 AS n`,
    [YEAR_RE],
  )

  await query(
    `DELETE FROM ops_email_nav_records a
     WHERE fund_name ILIKE '%鸣石广胜中证A500指数增强1号量化%'
       AND BTRIM(product_code) ~ $1
       AND EXISTS (
         SELECT 1 FROM ops_email_nav_records b
         WHERE b.crawl_email_account IS NOT DISTINCT FROM a.crawl_email_account
           AND b.email_uid IS NOT DISTINCT FROM a.email_uid
           AND b.nav_date IS NOT DISTINCT FROM a.nav_date
           AND COALESCE(b.attachment_filename, '') = COALESCE(a.attachment_filename, '')
           AND UPPER(BTRIM(b.product_code)) = 'SBNJ90'
       )`,
    [YEAR_RE],
  )
  const guangsheng = await query<{ n: string }>(
    `UPDATE ops_email_nav_records
     SET product_code = 'SBNJ90'
     WHERE fund_name ILIKE '%鸣石广胜中证A500指数增强1号量化%'
       AND fund_name NOT ILIKE '%B类%'
       AND fund_name NOT ILIKE '%C类%'
       AND BTRIM(product_code) ~ $1
     RETURNING 1 AS n`,
    [YEAR_RE],
  )

  await query(
    `DELETE FROM ops_email_nav_records a
     WHERE fund_name ILIKE '%鸣石广鸣中证1000指数增强1号%'
       AND fund_name NOT ILIKE '%期%'
       AND BTRIM(product_code) ~ $1
       AND EXISTS (
         SELECT 1 FROM ops_email_nav_records b
         WHERE b.crawl_email_account IS NOT DISTINCT FROM a.crawl_email_account
           AND b.email_uid IS NOT DISTINCT FROM a.email_uid
           AND b.nav_date IS NOT DISTINCT FROM a.nav_date
           AND COALESCE(b.attachment_filename, '') = COALESCE(a.attachment_filename, '')
           AND UPPER(BTRIM(b.product_code)) = 'SNK642'
       )`,
    [YEAR_RE],
  )
  await query(
    `UPDATE ops_email_nav_records
     SET product_code = 'SNK642'
     WHERE fund_name ILIKE '%鸣石广鸣中证1000指数增强1号%'
       AND fund_name NOT ILIKE '%期%'
       AND fund_name NOT ILIKE '%B类%'
       AND fund_name NOT ILIKE '%C类%'
       AND BTRIM(product_code) ~ $1`,
    [YEAR_RE],
  )
  const leftover = await query<{ n: string }>(
    `DELETE FROM ops_email_nav_records
     WHERE BTRIM(product_code) ~ $1
     RETURNING 1 AS n`,
    [YEAR_RE],
  )

  await query(
    `UPDATE ops_team_data_products
     SET beian_hao = 'SBNJ90'
     WHERE product_name ILIKE '%鸣石广胜中证A500指数增强1号量化%'
       AND beian_hao IN ('2026', '')`,
  ).catch(() => [])
  await query(
    `UPDATE ops_team_data_products
     SET beian_hao = 'SNK642'
     WHERE product_name ILIKE '%鸣石广鸣中证1000指数增强1号%'
       AND product_name NOT ILIKE '%期%'
       AND beian_hao IN ('2026', '')`,
  ).catch(() => [])
  await query(
    `UPDATE ops_team_data_products
     SET beian_hao = 'SND951'
     WHERE product_name ILIKE '%草本致远1号%'
       AND product_name NOT ILIKE '%B类%'
       AND product_name NOT ILIKE '%C类%'
       AND beian_hao IN ('2026', '')`,
  ).catch(() => [])

  await query(
    `DELETE FROM ops_private_fund_detail_nav_cache
     WHERE cache_key IN ('2026', 'SBNJ90', 'SNK642', 'A500')
        OR beian_hao IN ('2026', 'SBNJ90', 'SNK642', 'A500')`,
  ).catch(() => [])
  await query(
    `DELETE FROM ops_tracking_funds_list_cache WHERE beian_hao IN ('2026', 'A500')`,
  ).catch(() => [])
  await query(
    `DELETE FROM ops_fof_overview_list_cache WHERE beian_hao = '2026'`,
  ).catch(() => [])
  await query(
    `DELETE FROM ops_managed_products_list_cache WHERE beian_hao = '2026'`,
  ).catch(() => [])

  const afterCaoben = await query<{ code: string | null; n: string }>(
    `SELECT MAX(BTRIM(product_code)) AS code, COUNT(*)::text AS n
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%草本致远1号%'
       AND fund_name NOT ILIKE '%B类%'
       AND fund_name NOT ILIKE '%C类%'`,
  )
  const afterLuo = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_email_nav_records
     WHERE UPPER(BTRIM(product_code)) = 'C2026'`,
  )
  const afterYear = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_email_nav_records WHERE BTRIM(product_code) ~ $1`,
    [YEAR_RE],
  )
  console.log(`deleted 草本致远 year dupes=${caobenYear.length} updated 鸣石广胜=${guangsheng.length} leftover_year_deleted=${leftover.length}`)
  console.log(`草本致远 still code=${afterCaoben[0]?.code} n=${afterCaoben[0]?.n}`)
  console.log(`C2026 rows still=${afterLuo[0]?.n} leftover year codes=${afterYear[0]?.n}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
