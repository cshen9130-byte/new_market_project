/**
 * One-shot incremental 在管产品 + FOF list cache refresh (same path as 15m cron).
 * Used for latency-vs-rebuild experiments on the server.
 */
import fs from "fs"
import path from "path"

function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env")
  if (!fs.existsSync(envPath)) return
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!key || process.env[key] !== undefined) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

async function main() {
  loadDotEnv()
  console.log("rebuild_start", new Date().toISOString())
  const { refreshManagedAndFofListCachesIncremental } = await import(
    "../../lib/server/email-nav-latest-pg"
  )
  const result = await refreshManagedAndFofListCachesIncremental()
  console.log("rebuild_done", new Date().toISOString(), result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
