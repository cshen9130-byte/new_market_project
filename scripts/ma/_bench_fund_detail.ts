import pg from "pg"
import path from "path"
import fs from "fs"

for (const fname of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), fname)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const beian = process.argv[2] || "SBAH99"

async function timed(label: string, sql: string, params: unknown[] = []) {
  const t0 = Date.now()
  try {
    const r = await pool.query(sql, params)
    console.log(`${label}: ${Date.now() - t0}ms rows=${r.rowCount}`)
    return r.rows
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`${label}: ERROR ${Date.now() - t0}ms ${msg}`)
    return []
  }
}

async function main() {
  console.log("Benchmark fund detail queries for", beian)

  const infoRows = await timed(
    "private_fund_info",
    "SELECT beian_hao, product_name FROM private_fund_info WHERE beian_hao = $1",
    [beian],
  )
  const bflRows = await timed(
    "private_fund_info_bfl",
    "SELECT product_name, short_name FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1",
    [beian],
  )

  const productName = infoRows[0]?.product_name ?? bflRows[0]?.product_name ?? ""
  const shortName = bflRows[0]?.short_name ?? ""

  await timed(
    "nav_union_full",
    `SELECT DISTINCT ON (price_date)
        price_date::text AS price_date,
        nav::text,
        cumulative_nav::text,
        cum_nav_withdrawal::text,
        price_change::text
     FROM (
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 0 AS pri
       FROM private_fund_nav_group_type6 WHERE beian_hao = $1
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 1 AS pri
       FROM private_fund_nav_group_type6 WHERE $2 <> '' AND product_name = $2
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 2 AS pri
       FROM private_fund_nav_group_type6 WHERE $3 <> '' AND product_name = $3
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 3 AS pri
       FROM private_fund_nav_group WHERE beian_hao = $1
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 4 AS pri
       FROM private_fund_nav_group WHERE $2 <> '' AND product_name = $2
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 5 AS pri
       FROM private_fund_nav_group WHERE $3 <> '' AND product_name = $3
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 6 AS pri
       FROM private_fund_nav_group_hy WHERE beian_hao = $1
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 7 AS pri
       FROM private_fund_nav_group_hy WHERE $2 <> '' AND product_name = $2
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 8 AS pri
       FROM private_fund_nav_group_hy WHERE $3 <> '' AND product_name = $3
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 9 AS pri
       FROM private_fund_nav WHERE beian_hao = $1
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 10 AS pri
       FROM private_fund_nav WHERE $2 <> '' AND product_name = $2
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 11 AS pri
       FROM private_fund_nav WHERE $3 <> '' AND product_name = $3
     ) nav_union
     ORDER BY price_date ASC, pri ASC`,
    [beian, productName, shortName],
  )

  await timed(
    "email_nav",
    `SELECT COUNT(*) AS cnt FROM ops_email_nav_records e
     WHERE e.nav_date IS NOT NULL AND e.nav IS NOT NULL
       AND (
         ($1 <> '' AND (
           e.product_code = $1
           OR COALESCE(e.attachment_filename, '') ILIKE '%' || $1 || '%'
           OR COALESCE(e.subject, '') ILIKE '%' || $1 || '%'
         ))
         OR EXISTS (
           SELECT 1 FROM unnest($2::text[]) AS alias(name)
           WHERE name <> ''
             AND (BTRIM(e.fund_name) = alias.name OR BTRIM(e.fund_name) LIKE alias.name || '%')
         )
       )`,
    [beian, [productName, shortName].filter(Boolean)],
  )

  await timed(
    "ops_team_nav_manual",
    "SELECT COUNT(*) FROM ops_team_nav_manual WHERE beian_hao = $1",
    [beian],
  )

  await timed(
    "pg_locks",
    `SELECT mode, locktype, relation::regclass, granted, COUNT(*)
     FROM pg_locks
     WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
     GROUP BY mode, locktype, relation, granted
     ORDER BY COUNT(*) DESC
     LIMIT 10`,
  )

  await timed(
    "pg_stat_activity",
    `SELECT pid, state, wait_event_type, wait_event, LEFT(query, 120) AS query
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()
     ORDER BY state`,
  )

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
