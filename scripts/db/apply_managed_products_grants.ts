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

  const url = new URL(base)
  const sql = readFileSync(join(process.cwd(), "scripts/db/008_grant_managed_products_write.sql"), "utf8")
  const adminCandidates = [
    process.env.POSTGRES_ADMIN_URL,
    process.env.DATABASE_ADMIN_URL,
    `postgresql://postgres@${url.hostname}:${url.port}/${url.pathname.slice(1)}`,
  ].filter(Boolean) as string[]

  for (const adminUrl of adminCandidates) {
    const pool = new pg.Pool({ connectionString: adminUrl })
    try {
      await pool.query(sql)
      console.log("Grants applied successfully.")
      await pool.end()
      return
    } catch (err) {
      console.error("Grant attempt failed:", err instanceof Error ? err.message : err)
      await pool.end()
    }
  }

  console.error(
    "Could not apply grants automatically. Run on the DB server as postgres:\n" +
      "  sudo -u postgres psql -d market_data -f scripts/db/008_grant_managed_products_write.sql",
  )
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
