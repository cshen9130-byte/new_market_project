import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  const pool = await p.query(
    `SELECT register_number, product_name, source_file
     FROM user_custom_pool WHERE pool_key = 'custom_email_nav'
     ORDER BY product_name`,
  )
  console.log("count", pool.rows.length)
  console.log(
    "manual:",
    pool.rows.filter((r) => r.source_file === "manual_add").map((r) => `${r.register_number}|${r.product_name}`),
  )

  // Likely missing vs known repair targets / related products
  const want = [
    "SQQ26A",
    "SQQ300",
    "SNG210",
    "SVN917",
    "ST9331",
    "SCQ804",
    "ACZ75B",
    "SACZ75",
    "BBR65A",
    "SAGW15",
    "SXN097",
    "SB969A",
    "青钱基石1号B",
    "峰云汇高地一号B",
  ]
  for (const w of want) {
    const hit = pool.rows.find(
      (r) =>
        r.register_number === w
        || r.product_name.includes(w)
        || r.register_number.toUpperCase() === w.toUpperCase(),
    )
    console.log(hit ? `OK  ${w} → ${hit.register_number}|${hit.product_name}` : `MISS ${w}`)
  }

  // Any name-only still
  console.log(
    "\nname-only:",
    pool.rows.filter((r) => !/^[A-Z0-9]{4,10}$/i.test(r.register_number)),
  )

  await p.end()
}

main().catch(console.error)
