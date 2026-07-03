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
