import fs from "fs"
import path from "path"

/** Load `.env.local` / `.env` into process.env (same logic as scripts/ma/nightly_etl.py). */
export function loadProjectEnvFiles(): void {
  const seen = new Set<string>()
  let base = process.cwd()

  for (let depth = 0; depth < 4; depth++) {
    for (const fname of [".env.local", ".env"]) {
        const filePath = path.join(base, fname)
        if (seen.has(filePath) || !fs.existsSync(filePath)) continue
        seen.add(filePath)

        const text = fs.readFileSync(filePath, "utf8")
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
          const eq = trimmed.indexOf("=")
          const key = trimmed.slice(0, eq).trim()
          let value = trimmed.slice(eq + 1).trim()
          if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1)
          }
          if (key && process.env[key] === undefined) {
            process.env[key] = value
          }
        }
    }
    base = path.dirname(base)
  }
}

/** ETL / cache-rebuild scripts need longer queries than the web app default (60s). */
export function configureEtlDbTimeout(): void {
  if (!process.env.DB_STATEMENT_TIMEOUT) {
    process.env.DB_STATEMENT_TIMEOUT = "600000"
  }
}

function databaseUrlHasPassword(url: string): boolean {
  return /:\/\/[^/:@]+:[^@]+@/.test(url)
}

/**
 * Load `.env.local` / `.env` and ensure `DATABASE_URL` has a string password before `lib/db` imports.
 * Server scripts often set `DB_HOST` / `DB_USER` / `DB_PASSWORD` without `DATABASE_URL`; pg SCRAM fails
 * when the parsed password is `undefined`.
 */
export function ensureScriptDatabaseEnv(): void {
  loadProjectEnvFiles()

  const existing = process.env.DATABASE_URL?.trim()
  if (existing && databaseUrlHasPassword(existing)) return

  const password = process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : ""
  const host = process.env.DB_HOST?.trim() || "127.0.0.1"
  const port = process.env.DB_PORT?.trim() || "5432"
  const database = process.env.DB_NAME?.trim() || "market_data"
  const user = process.env.DB_USER?.trim() || "market_user"

  process.env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}
