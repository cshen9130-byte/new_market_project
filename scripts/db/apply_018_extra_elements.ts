import { readFileSync, existsSync } from "fs"
import { join } from "path"
import pg from "pg"

function loadEnv() {
  for (const fname of [".env.local", ".env"]) {
    const f = join(process.cwd(), fname)
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith("#") || !t.includes("=")) continue
      const i = t.indexOf("=")
      const k = t.slice(0, i).trim()
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
      if (!process.env[k]) process.env[k] = v
    }
  }
}

async function main() {
  loadEnv()
  const base = process.env.DATABASE_URL
  if (!base) {
    console.error("DATABASE_URL not set")
    process.exit(1)
  }

  const sql = readFileSync(
    join(process.cwd(), "scripts/db/018_basicinfo_bfl_track_extra_elements.sql"),
    "utf8",
  )
  const url = new URL(base)
  const candidates = [
    process.env.POSTGRES_ADMIN_URL,
    process.env.DATABASE_ADMIN_URL,
    base,
    `postgresql://postgres@${url.hostname}:${url.port}/${url.pathname.slice(1)}`,
  ].filter(Boolean) as string[]

  let lastError: unknown
  for (const connectionString of candidates) {
    const pool = new pg.Pool({ connectionString })
    try {
      await pool.query(sql)
      const result = await pool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'basicinfo_bfl_track'
           AND column_name IN (
             'risk_level',
             'lock_period_desc',
             'fee_pay_formula',
             'fee_pay_formula_json'
           )
         ORDER BY 1`,
      )
      console.log(
        "OK columns:",
        result.rows.map((row) => row.column_name).join(", ") || "(none)",
      )
      await pool.end()
      return
    } catch (err) {
      lastError = err
      await pool.end().catch(() => undefined)
    }
  }

  console.error(lastError instanceof Error ? lastError.message : lastError)
  process.exit(1)
}

main()
