/**
 * Dedicated PM2 worker process for scheduled background jobs.
 * Keeps heavy email/FOF/ETL work off the Next.js web event loop.
 *
 * Start (via PM2 ecosystem): pnpm worker:start
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

async function main(): Promise<void> {
  loadDotEnv()
  process.env.NEXT_RUNTIME = process.env.NEXT_RUNTIME || "nodejs"
  process.env.RUN_BACKGROUND_JOBS = "1"

  const { registerBackgroundJobs } = await import("../lib/server/background-jobs-scheduler")
  await registerBackgroundJobs()
  console.log(
    `[background-worker] online pid=${process.pid} — email/ETL/cache crons run here, not in next-server`,
  )

  // Keep the process alive even if every cron handle is somehow cleared.
  setInterval(() => {}, 60 * 60 * 1000)
}

main().catch((err) => {
  console.error("[background-worker] failed to start:", err)
  process.exit(1)
})
