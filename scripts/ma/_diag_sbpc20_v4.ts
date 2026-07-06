/**
 * Diagnose why attachment_nav_table rows are being filtered out for SBPC20.
 */
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function q<T>(sql: string, args: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query(sql, args)
  return rows as T[]
}

async function main() {
  // Check 2026-06-25 rows in detail
  const rows = await q<{
    nav_date: string
    nav: string
    cumulative_nav: string
    adjusted_nav: string
    fund_name: string | null
    product_code: string | null
    source: string
    attachment_filename: string | null
    subject: string | null
  }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            fund_name, product_code, source,
            attachment_filename, left(subject, 80) AS subject
     FROM ops_email_nav_records
     WHERE product_code = 'SBPC20'
       AND nav_date = '2026-06-25'
     ORDER BY id ASC`,
    []
  )

  console.log(`\n=== 2026-06-25 rows (${rows.length}) ===`)
  for (const r of rows) {
    const meta = `${r.fund_name ?? ""} ${r.attachment_filename ?? ""}`
    const hasAClass = /A类/.test(meta)
    console.log(`  source=${r.source}, nav=${r.nav}, cum=${r.cumulative_nav}, adj=${r.adjusted_nav}`)
    console.log(`    fund_name="${r.fund_name}", filename="${r.attachment_filename}", subject="${r.subject}"`)
    console.log(`    meta has A类: ${hasAClass}`)
  }

  // Also check 2026-07-01 rows
  const rows2 = await q<{
    nav_date: string
    nav: string
    cumulative_nav: string
    adjusted_nav: string
    fund_name: string | null
    product_code: string | null
    source: string
    attachment_filename: string | null
    subject: string | null
  }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            fund_name, product_code, source,
            attachment_filename, left(subject, 80) AS subject
     FROM ops_email_nav_records
     WHERE product_code = 'SBPC20'
       AND nav_date = '2026-07-01'
     ORDER BY id ASC`,
    []
  )

  console.log(`\n=== 2026-07-01 rows (${rows2.length}) ===`)
  for (const r of rows2) {
    const meta = `${r.fund_name ?? ""} ${r.attachment_filename ?? ""}`
    const hasAClass = /A类/.test(meta)
    console.log(`  source=${r.source}, nav=${r.nav}, cum=${r.cumulative_nav}, adj=${r.adjusted_nav}`)
    console.log(`    fund_name="${r.fund_name}", filename="${r.attachment_filename}"`)
    console.log(`    meta has A类: ${hasAClass}`)
  }

  // Also check 2026-06-11 (ex-div date)
  const rows3 = await q<{
    nav_date: string
    nav: string
    cumulative_nav: string
    adjusted_nav: string
    fund_name: string | null
    product_code: string | null
    source: string
    attachment_filename: string | null
    subject: string | null
  }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            fund_name, product_code, source,
            attachment_filename, left(subject, 80) AS subject
     FROM ops_email_nav_records
     WHERE product_code = 'SBPC20'
       AND nav_date = '2026-06-11'
     ORDER BY id ASC`,
    []
  )

  console.log(`\n=== 2026-06-11 rows (${rows3.length}) ===`)
  for (const r of rows3) {
    const meta = `${r.fund_name ?? ""} ${r.attachment_filename ?? ""}`
    const hasAClass = /A类/.test(meta)
    console.log(`  source=${r.source}, nav=${r.nav}, cum=${r.cumulative_nav}, adj=${r.adjusted_nav}`)
    console.log(`    fund_name="${r.fund_name}", filename="${r.attachment_filename}"`)
    console.log(`    meta has A类: ${hasAClass}`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
