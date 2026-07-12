/**
 * Compare email_unique_fund_names.csv vs 邮箱运维池 (custom_email_nav).
 * Usage: npx tsx scripts/ma/compare_email_funds_to_pool.ts
 */
import fs from "fs"
import path from "path"
import pg from "pg"
import { normalizeFundDisplayName } from "../../lib/server/email-nav-extract"

const DB_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const POOL_KEY = "custom_email_nav"

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out
}

function normKey(name: string): string {
  return normalizeFundDisplayName(name)
    .replace(/[ABC]类$/u, "")
    .replace(/私募$/u, "")
    .replace(/\s+/g, "")
    .toLowerCase()
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function readEmailUniqueFunds(cwd: string): string[] {
  const file = path.join(cwd, "email_unique_fund_names.csv")
  const lines = fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const nameIdx = headers.indexOf("fund_name")
  return lines.slice(1).map((line) => parseCsvLine(line)[nameIdx]?.trim()).filter(Boolean)
}

async function main() {
  const cwd = process.cwd()
  const emailFunds = readEmailUniqueFunds(cwd)
  const emailByKey = new Map(emailFunds.map((n) => [normKey(n), n]))

  const pool = new pg.Pool({ connectionString: DB_URL })
  try {
    const poolRes = await pool.query<{ product_name: string; register_number: string }>(
      `SELECT product_name, register_number
       FROM user_custom_pool
       WHERE pool_key = $1
       ORDER BY product_name`,
      [POOL_KEY],
    )

    const poolByKey = new Map<string, { name: string; beian: string }>()
    for (const r of poolRes.rows) {
      poolByKey.set(normKey(r.product_name), {
        name: r.product_name,
        beian: r.register_number ?? "",
      })
    }

    const missing: string[] = []
    for (const [key, name] of emailByKey) {
      if (!poolByKey.has(key)) missing.push(name)
    }

    const extra: { name: string; beian: string }[] = []
    for (const [key, row] of poolByKey) {
      if (!emailByKey.has(key)) extra.push({ name: row.name, beian: row.beian })
    }

    missing.sort((a, b) => a.localeCompare(b, "zh-CN"))
    extra.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))

    const outPath = path.join(cwd, "email_funds_missing_from_pool.csv")
    const lines = [
      "fund_name,register_number,status",
      ...missing.map((n) => `${csvEscape(n)},,missing_from_pool`),
      ...extra.map((e) => `${csvEscape(e.name)},${csvEscape(e.beian)},in_pool_not_in_email_csv`),
    ]
    fs.writeFileSync(outPath, `\uFEFF${lines.join("\n")}\n`, "utf-8")

    console.log("Email unique funds (CSV):     ", emailFunds.length)
    console.log("Pool rows (custom_email_nav): ", poolRes.rows.length)
    console.log("Missing from pool:            ", missing.length)
    console.log("In pool but not email CSV:    ", extra.length)
    console.log("\n=== Missing from 邮箱运维池 ===")
    for (const m of missing) console.log(`  - ${m}`)
    console.log(`\nWrote ${outPath}`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
