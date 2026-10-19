import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { writeFileSync } from "fs"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const lines: string[] = []
  const push = (s: string) => { lines.push(s); console.log(s) }

  const info = await query(
    `SELECT beian_hao, product_name, latest_nav::text, latest_nav_date::text, manager, inception_date::text
     FROM private_fund_info
     WHERE beian_hao ILIKE '%GA681%' OR product_name ILIKE '%集微%'
     ORDER BY beian_hao`
  )
  push("==== private_fund_info ====")
  for (const r of info as any[]) push(JSON.stringify(r))

  // Also search email for product codes related
  const codesQ = await query(
    `SELECT DISTINCT product_code, fund_name, count(*)::int AS n, max(nav_date)::text AS latest
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%集微%' OR product_code ILIKE '%GA681%' OR product_code ILIKE '%681A%'
     GROUP BY 1,2 ORDER BY latest DESC NULLS LAST`
  )
  push("\n==== email codes by name ====")
  for (const r of codesQ as any[]) push(JSON.stringify(r))

  const beians = new Set<string>(["GA681A"])
  for (const r of info as any[]) if (r.beian_hao) beians.add(r.beian_hao)
  for (const r of codesQ as any[]) if (r.product_code) beians.add(r.product_code)

  for (const code of beians) {
    push(`\n======== CODE ${code} ========`)

    const pfnCnt = await query(
      `SELECT count(*)::text AS c, min(price_date)::text AS mn, max(price_date)::text AS mx
       FROM private_fund_nav WHERE beian_hao=$1`, [code]
    )
    push(`pfn summary: ${JSON.stringify(pfnCnt[0])}`)
    const pfn = await query(
      `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav WHERE beian_hao=$1
       ORDER BY price_date DESC LIMIT 20`, [code]
    )
    push("private_fund_nav latest:")
    for (const r of pfn as any[]) push(JSON.stringify(r))

    // also early rows and around tip date
    const pfnTip = await query(
      `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav WHERE beian_hao=$1 AND price_date BETWEEN '2026-03-01' AND '2026-04-15'
       ORDER BY price_date`, [code]
    )
    push("private_fund_nav around 2026-03:")
    for (const r of pfnTip as any[]) push(JSON.stringify(r))

    try {
      const pfg = await query(
        `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
         FROM private_fund_nav_group WHERE beian_hao=$1
         ORDER BY price_date DESC LIMIT 10`, [code]
      )
      push("private_fund_nav_group:")
      for (const r of pfg as any[]) push(JSON.stringify(r))
    } catch (e: any) { push("pfg err " + e.message) }

    const team = await query(
      `SELECT nav_date::text, unit_nav::text, cumulative_nav::text, adjusted_nav::text, nav_type, created_at::text
       FROM ops_team_nav_manual WHERE beian_hao=$1
       ORDER BY nav_date DESC LIMIT 25`, [code]
    )
    push("ops_team_nav_manual:")
    for (const r of team as any[]) push(JSON.stringify(r))

    const email = await query(
      `SELECT id, nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
              product_code, fund_name, source,
              left(subject, 100) AS subject,
              left(coalesce(attachment_filename,''), 80) AS att
       FROM ops_email_nav_records
       WHERE product_code=$1
       ORDER BY nav_date DESC, id DESC LIMIT 40`, [code]
    )
    push("ops_email_nav_records by product_code:")
    for (const r of email as any[]) push(JSON.stringify(r))

    const cache = await query(
      `SELECT cache_key, beian_hao, product_name, short_name, nav_data_source,
              tip_nav_date::text, tip_unit_nav::text, refreshed_at::text,
              jsonb_array_length(nav_series) AS n,
              left(nav_series::text, 400) AS head
       FROM ops_private_fund_detail_nav_cache
       WHERE beian_hao=$1 OR cache_key ILIKE '%'||$1||'%'
       LIMIT 5`, [code]
    )
    push("detail cache:")
    for (const r of cache as any[]) push(JSON.stringify(r))
  }

  // screenshot values
  push("\n==== search unit~1.8601 recent ====")
  const shot = await query(
    `SELECT 'pfn' AS src, beian_hao, price_date::text AS d, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
     FROM private_fund_nav WHERE nav BETWEEN 1.859 AND 1.861 AND price_date >= '2026-09-01'
     UNION ALL
     SELECT 'email', coalesce(product_code,''), nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text
     FROM ops_email_nav_records WHERE nav BETWEEN 1.859 AND 1.861 AND nav_date >= '2026-09-01'
     LIMIT 40`
  )
  for (const r of shot as any[]) push(JSON.stringify(r))

  push("\n==== search tip unit 1.7625 ====")
  const tip = await query(
    `SELECT 'team' AS src, beian_hao, nav_date::text AS d, unit_nav::text AS u, cumulative_nav::text AS c
     FROM ops_team_nav_manual WHERE unit_nav BETWEEN 1.761 AND 1.764
     UNION ALL
     SELECT 'pfn', beian_hao, price_date::text, nav::text, cum_nav_withdrawal::text
     FROM private_fund_nav WHERE nav BETWEEN 1.761 AND 1.764 AND price_date BETWEEN '2026-03-10' AND '2026-03-30'
     LIMIT 30`
  )
  for (const r of tip as any[]) push(JSON.stringify(r))

  // cache tip for 集微
  push("\n==== cache tip 集微 / GA681 ====")
  const c2 = await query(
    `SELECT cache_key, beian_hao, product_name, tip_nav_date::text, tip_unit_nav::text, nav_data_source, refreshed_at::text,
            jsonb_array_length(nav_series) AS n
     FROM ops_private_fund_detail_nav_cache
     WHERE product_name ILIKE '%集微%' OR beian_hao ILIKE '%GA681%' OR cache_key ILIKE '%GA681%' OR cache_key ILIKE '%集微%'`
  )
  for (const r of c2 as any[]) push(JSON.stringify(r))

  writeFileSync("scripts/ma/_diag_ga681a_out.txt", lines.join("\n"), "utf8")
  console.log("\nWrote out file, lines=", lines.length)
}
main().catch((e) => { console.error(e); process.exit(1) })
