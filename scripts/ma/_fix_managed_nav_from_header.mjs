/**
 * Resync unit NAV from valuation header_rows for specific 在管产品 only.
 * Same issue as SBTX45: dates correct, values shifted one day vs Excel header.
 *
 * Usage (on server):
 *   DATABASE_URL=... npx tsx scripts/ma/_fix_managed_nav_from_header.mjs --apply
 */
import pg from "pg"

const FUNDS = [
  { beian: "SBPU97", product: "衡颐海泰1号", aliases: ["SBPU97", "衡颐海泰1号", "海泰1号"] },
  { beian: "SSG947", product: "抱朴聚融祥和一号", aliases: ["SSG947", "S52247", "抱朴聚融祥和", "抱朴聚融"] },
]

const SINCE = "2026-07-01"
const UNCHANGED_CHECK = ["SBTX45", "SBPC69", "SAVW72", "SBNX55"]

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

function valMatchSql(aliases, startParam) {
  const parts = aliases.map((_, i) => {
    const p = `$${startParam + i}`
    return `(subject ILIKE ${p} OR attachment_filename ILIKE ${p})`
  })
  return {
    sql: parts.join(" OR "),
    params: aliases.map((a) => `%${a}%`),
  }
}

async function resyncFund(p, fund, apply) {
  console.log(`\n=== ${fund.product} (${fund.beian}) ===`)
  const { sql, params } = valMatchSql(fund.aliases, 2)

  const vals = await p.query(
    `SELECT id::text, valuation_date::text, unit_nav::text, subject, attachment_filename,
            summary, crawl_email_account, email_uid
     FROM ops_email_valuation_records
     WHERE (${sql})
       AND valuation_date >= $1::date
     ORDER BY valuation_date ASC, id ASC`,
    [SINCE, ...params],
  )

  const before = await p.query(
    `SELECT nav_date::text, nav::text FROM ops_email_nav_records
     WHERE product_code = $1 AND nav_date >= $2::date
     ORDER BY nav_date`,
    [fund.beian, SINCE],
  )
  // Also check alias codes (SSG947 / S52247)
  const beforeAlias = fund.beian === "SSG947"
    ? await p.query(
        `SELECT product_code, nav_date::text, nav::text FROM ops_email_nav_records
         WHERE product_code IN ('SSG947','S52247') AND nav_date >= $1::date
         ORDER BY nav_date, product_code`,
        [SINCE],
      )
    : { rows: [] }

  console.log("valuation rows:", vals.rows.length)
  console.log("BEFORE nav:", before.rows)
  if (beforeAlias.rows.length) console.log("BEFORE alias nav:", beforeAlias.rows)

  let updates = 0
  for (const row of vals.rows) {
    const headerNav = scanHeaderRowsForUnitNav(row.summary?.header_rows)
    if (headerNav == null) {
      console.log("skip (no header nav)", row.valuation_date, row.subject?.slice(0, 60))
      continue
    }
    const existing = before.rows.find((r) => r.nav_date === row.valuation_date)
    const cur = existing ? parseFloat(existing.nav) : null
    const changed = cur == null || Math.abs(cur - headerNav) >= 0.00005
    console.log({ date: row.valuation_date, current: cur, headerNav, changed })
    if (!apply || !changed) continue

    await p.query(
      `UPDATE ops_email_valuation_records SET unit_nav = $2 WHERE id = $1`,
      [row.id, headerNav],
    )

    await p.query(
      `DELETE FROM ops_email_nav_records
       WHERE product_code = ANY($1::text[])
         AND source = 'attachment_valuation_table'
         AND nav_date = $2::date`,
      [fund.beian === "SSG947" ? ["SSG947", "S52247"] : [fund.beian], row.valuation_date],
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
        fund.beian,
        fund.product,
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
      [fund.beian, SINCE],
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
         SET beian_hao = $1,
             unit_nav = $2::numeric,
             nav_date = $3::date,
             return_pct = $4::numeric,
             refreshed_at = NOW()
         FROM managed_products m
         WHERE cache.managed_product_id = m.id
           AND (m.product_name ILIKE $5 OR cache.beian_hao = $1 OR cache.beian_hao = $6)`,
        [
          fund.beian,
          latest.nav,
          latest.nav_date,
          ret,
          `%${fund.product.slice(0, 6)}%`,
          fund.beian === "SSG947" ? "S52247" : fund.beian,
        ],
      )
    }
    const cache = await p.query(
      `SELECT m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text
       FROM managed_products m
       LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
       WHERE m.product_name ILIKE $1 OR cache.beian_hao = ANY($2::text[])`,
      [
        `%${fund.product.slice(0, 6)}%`,
        fund.beian === "SSG947" ? ["SSG947", "S52247"] : [fund.beian],
      ],
    )
    console.log("cache:", cache.rows)
  }

  return updates
}

async function main() {
  const apply = process.argv.includes("--apply")
  const p = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5432/market_data",
  })

  console.log(apply ? "=== APPLY (2 funds only) ===" : "=== DRY RUN ===")

  let total = 0
  for (const fund of FUNDS) {
    total += await resyncFund(p, fund, apply)
  }

  if (apply) {
    console.log("\n=== unchanged checks ===")
    for (const code of UNCHANGED_CHECK) {
      const r = await p.query(
        `SELECT product_code, nav_date::text, nav::text FROM ops_email_nav_records
         WHERE product_code = $1 ORDER BY nav_date DESC LIMIT 1`,
        [code],
      )
      console.log(code, r.rows[0] ?? null)
    }
    console.log("total updates:", total)
  } else {
    console.log("\nRe-run with --apply")
  }

  await p.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
