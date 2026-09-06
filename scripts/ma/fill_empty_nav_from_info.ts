/**
 * Last resort: write latest_nav from private_fund_info into still-empty CSVs.
 * Usage: npx tsx scripts/ma/fill_empty_nav_from_info.ts --no-tunnel
 */
import fs from "fs"
import net from "net"
import path from "path"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`
const STAMP = new Date().toISOString().slice(0, 10)
const OUT_ROOT = path.join(process.cwd(), "data", "exports", `private-funds-nav6m-${STAMP}`)

function waitForPort(port: number, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return (async () => {
    while (Date.now() < deadline) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = net.connect(port, "127.0.0.1")
          socket.once("connect", () => {
            socket.destroy()
            resolve()
          })
          socket.once("error", reject)
        })
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    return false
  })()
}

function isEmptyNavCsv(filePath: string): boolean {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim()
  return text.split(/\r?\n/).filter(Boolean).length <= 1
}

async function main() {
  if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
    process.env.DATABASE_URL = DEFAULT_DB_URL
  }
  if (!(await waitForPort(LOCAL_PORT))) throw new Error("no listener on 5433")
  const { query } = await import("@/lib/db")

  const empty: { beian: string; dest: string }[] = []
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.isFile() && ent.name.endsWith(".csv") && !ent.name.startsWith("_") && isEmptyNavCsv(full)) {
        empty.push({ beian: ent.name.split("_")[0], dest: full })
      }
    }
  }
  walk(OUT_ROOT)
  console.log(`Still empty: ${empty.length}`)
  if (empty.length === 0) return

  const ids = empty.map((x) => x.beian)
  const tips = await query<{ beian_hao: string; nav: string; d: string }>(
    `SELECT beian_hao, latest_nav::text AS nav, latest_nav_date::text AS d
     FROM private_fund_info
     WHERE beian_hao = ANY($1::text[])
       AND latest_nav IS NOT NULL AND latest_nav_date IS NOT NULL`,
    [ids],
  )
  const tipMap = new Map(tips.map((t) => [t.beian_hao, t]))
  let filled = 0
  for (const item of empty) {
    const tip = tipMap.get(item.beian)
    if (!tip) continue
    const date = String(tip.d).slice(0, 10)
    fs.writeFileSync(
      item.dest,
      `\uFEFF日期,单位净值,累计净值,日涨跌\n${date},${tip.nav},,\n`,
      "utf8",
    )
    filled += 1
  }
  console.log(`Wrote latest snapshot for ${filled} / ${empty.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
