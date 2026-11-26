/**
 * Rebuild 周度回顾 策略平均净值 snapshots for every source universe.
 * The page reads ops_overview_snapshot and should not recompute on open.
 * The PM2 worker runs this at 06:10 and after the 22:45 周度回顾 Excel job
 * (Asia/Shanghai). Run it by hand on the server with:
 *
 *   npx tsx scripts/ma/weekly-review-strategy-nav-daily.ts
 *
 * Refuses to run from Windows next against the tunneled production database
 * unless --force is passed.
 */
import fs from "fs"
import path from "path"

function loadEnv() {
  for (const fname of [".env.local", ".env"]) {
    const envPath = path.join(process.cwd(), fname)
    if (!fs.existsSync(envPath)) continue
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (match && process.env[match[1]] == null) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
  }
}

function wantsForce(argv: string[]): boolean {
  return argv.includes("--force")
}

async function main() {
  loadEnv()
  const force = wantsForce(process.argv.slice(2))
  if (
    process.platform === "win32" &&
    (process.env.DATABASE_URL || "").includes(":5433/") &&
    !force
  ) {
    console.log("[weekly-strategy-nav] skipped: Windows against tunneled production DB (pass --force to override)")
    return
  }
  const { ensureDevPostgresTunnel } = await import("@/lib/server/dev-prod-db-tunnel")
  await ensureDevPostgresTunnel()
  const { refreshWeeklyReviewStrategyNavDaily } = await import("@/lib/server/weekly-review-strategy-nav")
  const result = await refreshWeeklyReviewStrategyNavDaily()
  console.log(`[weekly-strategy-nav] daily ${JSON.stringify(result)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
