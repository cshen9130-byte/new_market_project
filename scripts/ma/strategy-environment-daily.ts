/**
 * Daily strategy-environment snapshot.
 *
 * The 策略环境 page reads public.strategy_environment_snapshot and does not
 * rescore the market on open. The PM2 worker runs this at 06:10 Asia/Shanghai,
 * after the overnight market ETL. Run it by hand with:
 *
 *   npx tsx scripts/ma/strategy-environment-daily.ts
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

async function main() {
  loadEnv()
  const { ensureDevPostgresTunnel } = await import("@/lib/server/dev-prod-db-tunnel")
  await ensureDevPostgresTunnel()
  const { refreshStrategyEnvironmentDaily } = await import("@/lib/server/strategy-environment-daily")
  await refreshStrategyEnvironmentDaily(true)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
