/**
 * SBTX45 only: re-sync ops_email_nav_records unit NAV from valuation header_rows.
 * Valuation dates are already correct; stored nav values are one day off.
 *
 *   npx tsx scripts/ma/_fix_sbtx45_remote.mjs --apply
 */
import pg from "pg"

const BEIAN = "SBTX45"
const PRODUCT = "衡颐承和FOF1号"
const SINCE = "2026-07-01"

function scanHeaderRowsForUnitNav(headerRows) {
  if (!Array.isArray(headerRows)) return null
  for (const row of headerRows.slice(0, 20)) {
    const joined = (row ?? []).map((c) => String(c ?? "")).join(" ")
    const m = joined.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (m && !/累计/.test(joined)) {
      const n = parseFloat(m[1])
      if (Number.isFinite(n) && n > 0.05 && n < 100) return n
    }
  }
  return null
}

async function main() {
  const apply = process.argv.includes("--apply")
  const p = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5432/market_data",
  })

  console.log(apply ? "=== APPLY SBTX45 NAV RESYNC ===" : "=== DRY RUN ===")

  const vals = await p.query(
    `SELECT id::text, valuation_date::text, unit_nav::text, subject, attachment_filename,
            summary, crawl_email_account, email_uid
     FROM ops_email_valuation_records
     WHERE (subject ILIKE '%SBTX45%' OR attachment_filename ILIKE '%SBTX45%'
            OR subject ILIKE '%衡颐承和FOF1%' OR attachment_filename ILIKE '%衡颐承和FOF1%')
       AND valuation_date >= $1::date
     ORDER BY valuation_date ASC, id ASC`,
    [SINCE],
  )

  const before = await p.query(
    `SELECT nav_date::text, nav::text FROM ops_email_nav_records
     WHERE product_code = $1 AND nav_date >= $2::date
     ORDER BY nav_date`,
    [BEIAN, SINCE],
  )
  console.log("BEFORE nav:", before.rows)

  let updates = 0
  for (const row of vals.rows) {
    const headerNav = scanHeaderRowsForUnitNav(row.summary?.header_rows)
    if (headerNav == null) {
      console.log("skip (no header nav)", row.valuation_date)
      continue
    }
    const existing = before.rows.find((r) => r.nav_date === row.valuation_date)
    const cur = existing ? parseFloat(existing.nav) : null
    const changed = cur == null || Math.abs(cur - headerNav) >= 0.00005
    console.log({
      date: row.valuation_date,
      current: cur,
      headerNav,
      changed,
    })
    if (!apply || !changed) continue

    await p.query(
      `UPDATE ops_email_valuation_records SET unit_nav = $2 WHERE id = $1`,
      [row.id, headerNav],
    )

    // Remove any valuation-sourced NAV on this date for SBTX45, then insert correct one
    await p.query(
      `DELETE FROM ops_email_nav_records
       WHERE product_code = $1
         AND source = 'attachment_valuation_table'
         AND nav_date = $2::date`,
      [BEIAN, row.valuation_date],
    )

    await p.query(
      `INSERT INTO ops_email_nav_records
         (crawl_email_account, email_uid, sent_at, subject, sender_email,
          nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name, source, attachment_filename)
       VALUES ($1,$2,NOW(),$3,'',$4::date,$5::numeric,NULL,NULL,$6,$7,'attachment_valuation_table',$8)
       ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename) DO UPDATE SET
         nav = EXCLUDED.nav,
         product_code = EXCLUDED.product_code,
         fund_name = EXCLUDED.fund_name,
         source = EXCLUDED.source`,
      [
        row.crawl_email_account,
        row.email_uid,
        row.subject,
        row.valuation_date,
        headerNav,
        BEIAN,
        PRODUCT,
        row.attachment_filename ?? "",
      ],
    )
    updates++
  }

  if (apply) {
    const after = await p.query(
      `SELECT nav_date::text, nav::text FROM ops_email_nav_records
       WHERE product_code = $1 AND nav_date >= $2::date
       ORDER BY nav_date DESC`,
      [BEIAN, SINCE],
    )
    console.log("AFTER nav:", after.rows)
    console.log("updates:", updates)

    const latest = after.rows[0]
    const prev = after.rows[1]
    let ret = null
    if (latest && prev) {
      const a = parseFloat(latest.nav)
      const b = parseFloat(prev.nav)
      if (b) ret = a / b - 1
    }
    if (latest) {
      await p.query(
        `UPDATE ops_managed_products_list_cache cache
         SET beian_hao = 'SBTX45',
             unit_nav = $1::numeric,
             nav_date = $2::date,
             return_pct = $3::numeric,
             refreshed_at = NOW()
         FROM managed_products m
         WHERE cache.managed_product_id = m.id
           AND (m.product_name ILIKE '%承和FOF1%' OR cache.beian_hao = 'SBTX45')`,
        [latest.nav, latest.nav_date, ret],
      )
    }
    const cache = await p.query(
      `SELECT m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text, cache.return_pct::text
       FROM managed_products m
       LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
       WHERE m.product_name ILIKE '%承和FOF1%' OR cache.beian_hao = 'SBTX45'`,
    )
    console.log("cache:", cache.rows)

    // Spot-check other recently fixed funds unchanged
    for (const code of ["SBPC69", "SAVW72", "SBNX55", "SBPU97"]) {
      const r = await p.query(
        `SELECT product_code, nav_date::text, nav::text FROM ops_email_nav_records
         WHERE product_code = $1 ORDER BY nav_date DESC LIMIT 1`,
        [code],
      )
      console.log("unchanged check", code, r.rows[0] ?? null)
    }
  } else {
    console.log("Re-run with --apply")
  }

  await p.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
