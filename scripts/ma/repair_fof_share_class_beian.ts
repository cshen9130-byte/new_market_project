/**
 * Repair mistaken S-prefixed share-class 备案号 in FOF tables/cache
 * (SBTH74B → BTH74B, STA891A → TA891A).
 *
 * Usage:
 *   npx tsx scripts/ma/repair_fof_share_class_beian.ts
 *   npx tsx scripts/ma/repair_fof_share_class_beian.ts --no-tunnel
 */
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"

const LOCAL_PORT = 5433
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

async function waitForPort(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
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
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

async function startSshTunnel(): Promise<ChildProcess> {
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  const child = spawn(
    "ssh",
    [
      "-i",
      keyPath,
      "-L",
      `${LOCAL_PORT}:127.0.0.1:5432`,
      "-N",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ExitOnForwardFailure=yes",
      "root@8.154.33.143",
    ],
    { stdio: "ignore", windowsHide: true },
  )
  if (!(await waitForPort(LOCAL_PORT))) {
    child.kill()
    throw new Error("tunnel failed")
  }
  return child
}

async function main() {
  const noTunnel = process.argv.includes("--no-tunnel")
  let tunnel: ChildProcess | null = null
  try {
    process.env.DATABASE_URL = DEFAULT_DB_URL
    if (!noTunnel && !(await waitForPort(LOCAL_PORT, 800))) {
      tunnel = await startSshTunnel()
      console.log("tunnel ready")
    } else {
      console.log("using existing tunnel / --no-tunnel")
    }
    process.env.DATABASE_URL = DEFAULT_DB_URL

    const { query } = await import("@/lib/db")
    const { canonicalizeShareClassBeianCode } = await import("@/lib/server/share-class-product")

    const tables = [
      "fof_underlying_detail",
      "investment_tracking_fof_underlying",
      "ops_fof_overview_list_cache",
    ] as const

    for (const table of tables) {
      const rows = await query<{ code: string }>(
        `SELECT DISTINCT beian_hao AS code
         FROM ${table}
         WHERE beian_hao ~ '^[Ss][A-Za-z][A-Za-z0-9]{4,7}[ABCabc]$'`,
      )

      let updated = 0
      for (const row of rows) {
        const from = String(row.code || "").trim()
        const to = canonicalizeShareClassBeianCode(from)
        if (!to || to === from.toUpperCase()) continue
        const result = await query(
          `UPDATE ${table}
           SET beian_hao = $2
           WHERE beian_hao = $1
           RETURNING 1`,
          [from, to],
        )
        if (result.length) {
          updated += result.length
          console.log(`[${table}] ${from} → ${to} (${result.length} rows)`)
        }
      }
      console.log(`[${table}] updated ${updated} / distinct bad codes ${rows.length}`)
    }

    // Verify the two known products
    const check = await query(
      `SELECT 'cache' AS src, product_name, beian_hao FROM ops_fof_overview_list_cache
       WHERE product_name ILIKE '%善庆常晋%B%' OR product_name ILIKE '%瀛岳核心%A%'
       UNION ALL
       SELECT 'detail', product_name, beian_hao FROM fof_underlying_detail
       WHERE product_name ILIKE '%善庆常晋%' OR product_name ILIKE '%瀛岳核心%'`,
    )
    console.log("verify:", JSON.stringify(check, null, 2))
  } finally {
    if (tunnel && !tunnel.killed) tunnel.kill()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
