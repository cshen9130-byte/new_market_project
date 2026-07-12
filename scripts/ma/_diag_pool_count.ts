import pg from "pg"

const DB =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const POOL_KEY = "custom_email_nav"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  const count = await p.query(
    `SELECT COUNT(*)::int n FROM user_custom_pool WHERE pool_key = $1`,
    [POOL_KEY],
  )
  console.log("Pool total:", count.rows[0].n)

  const all = await p.query(
    `SELECT register_number, product_name, source_file
     FROM user_custom_pool WHERE pool_key = $1
     ORDER BY product_name`,
    [POOL_KEY],
  )

  const junkPatterns = [
    /^[\u4e00-\u9fff]{2,6}$/, // short Chinese-only names (managers)
    /^2026年/,
    /国泰海通/,
    /^号$/,
    /^aaa私募$/i,
  ]

  const nameOnly = all.rows.filter(
    (r) => !/^[A-Z0-9]{4,10}$/i.test(r.register_number.trim()),
  )
  console.log("\nName-only register_number rows:", nameOnly.length)
  for (const r of nameOnly) {
    console.log(" ", r.register_number, "|", r.product_name, "|", r.source_file)
  }

  const suspectedJunk = all.rows.filter((r) => {
    const reg = r.register_number.trim()
    const name = r.product_name.trim()
    if (junkPatterns.some((p) => p.test(reg) || p.test(name))) return true
    if (reg === name && reg.length < 8 && !/号|类/.test(reg)) return true
    return false
  })
  console.log("\nSuspected junk:", suspectedJunk.length)
  for (const r of suspectedJunk) {
    console.log(" ", r.register_number, "|", r.product_name)
  }

  const recent = await p.query(
    `SELECT register_number, product_name, source_file, updated_at::text
     FROM user_custom_pool WHERE pool_key = $1
     ORDER BY updated_at DESC NULLS LAST LIMIT 15`,
    [POOL_KEY],
  )
  console.log("\nMost recently updated:")
  for (const r of recent.rows) {
    console.log(" ", r.updated_at?.slice(0, 19), r.register_number, "|", r.product_name)
  }

  await p.end()
}

main().catch(console.error)
