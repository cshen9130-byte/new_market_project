/**
 * Backfill ops_private_fund_detail_nav_cache for every fund in the
 * FOF / 在管产品 / 跟踪产品 list caches so product pages open instantly.
 *
 * Usage: npx tsx scripts/ops/warm-detail-nav-cache.ts [--concurrency=8]
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

function parseConcurrency(argv: string[]): number {
  for (const arg of argv) {
    const m = /^--concurrency=(\d+)$/.exec(arg)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n >= 1 && n <= 32) return n
    }
  }
  return 8
}

async function main() {
  loadDotEnv()
  const concurrency = parseConcurrency(process.argv.slice(2))
  console.log("warm_detail_nav_cache_start", new Date().toISOString(), { concurrency })

  const {
    ensureDetailNavCacheTable,
    listDetailNavCacheUniverse,
    refreshDetailNavCacheForFunds,
  } = await import("../../lib/server/fund-detail-nav-cache-pg")

  await ensureDetailNavCacheTable()
  const universe = await listDetailNavCacheUniverse()
  console.log("universe_size", universe.length)

  const result = await refreshDetailNavCacheForFunds(universe, {
    concurrency,
    label: "warm-detail-nav-cache",
  })

  console.log("warm_detail_nav_cache_done", new Date().toISOString(), result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
