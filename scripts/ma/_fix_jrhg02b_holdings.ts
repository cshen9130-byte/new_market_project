/**
 * Production data fix: 金舆锡泰一号 holds 交睿宏观配置1号B类 under custodian
 * ticker JRHG02B, while 底层汇总 / 持仓 keys the same product as JX860B.
 *
 * Remap the ticker and strip 场外_ path prefixes so the live 持仓 query matches.
 *
 * Usage:
 *   npx tsx scripts/ma/_fix_jrhg02b_holdings.ts
 */
import fs from "fs"
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

async function ensureTunnel(): Promise<ChildProcess | null> {
  process.env.DATABASE_URL = DEFAULT_DB_URL
  if (await waitForPort(LOCAL_PORT, 800)) {
    console.log(`Using existing listener on localhost:${LOCAL_PORT}`)
    return null
  }
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  if (!fs.existsSync(keyPath)) throw new Error(`SSH key not found: ${keyPath}`)
  const child = spawn(
    "ssh",
    [
      "-i", keyPath,
      "-L", `${LOCAL_PORT}:127.0.0.1:5432`,
      "-N",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      "root@8.154.33.143",
    ],
    { stdio: "ignore", windowsHide: true },
  )
  if (!(await waitForPort(LOCAL_PORT))) {
    child.kill()
    throw new Error("SSH tunnel did not open localhost:5433")
  }
  console.log("SSH tunnel ready on localhost:5433")
  return child
}

async function main() {
  const tunnel = await ensureTunnel()
  try {
    const { query } = await import("../../lib/db")
    const { listUnderlyingHoldings } = await import("../../lib/server/managed-fof-underlying-pg")

    const before = await query<{
      id: string
      fof_product_name: string
      underlying_product_code: string | null
      underlying_name: string
      market_value: string | null
    }>(
      `SELECT id::text, fof_product_name, underlying_product_code, underlying_name, market_value::text
       FROM ops_managed_fof_underlying
       WHERE COALESCE(market_value, 0) > 0
         AND (
           UPPER(BTRIM(underlying_product_code)) IN ('JRHG02B', 'JRHG02', 'JX860B')
           OR underlying_name ILIKE '%交睿宏观配置1号%'
         )
       ORDER BY fof_product_name`,
    )
    console.log("before managed rows:", before)

    const holdingsBefore = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ops_email_valuation_holdings
       WHERE UPPER(BTRIM(symbol)) IN ('JRHG02B', 'JRHG02')`,
    )
    console.log("holdings with JRHG02*:", holdingsBefore[0]?.n)

    const updatedHoldings = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE ops_email_valuation_holdings
         SET symbol = 'JX860B'
         WHERE UPPER(BTRIM(symbol)) IN ('JRHG02B', 'JRHG02')
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM updated`,
    )
    console.log("updated valuation holdings.symbol:", updatedHoldings[0]?.n)

    const updatedManaged = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE ops_managed_fof_underlying
         SET
           underlying_product_code = 'JX860B',
           underlying_name = CASE
             WHEN underlying_name LIKE '场外%' AND STRPOS(underlying_name, '.') > 0
               THEN SUBSTRING(underlying_name FROM '([^.]+)$')
             ELSE underlying_name
           END
         WHERE UPPER(BTRIM(underlying_product_code)) IN ('JRHG02B', 'JRHG02')
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM updated`,
    )
    console.log("updated managed underlying rows:", updatedManaged[0]?.n)

    const mv = await query<{ mv: string }>(
      `SELECT COALESCE(SUM(market_value), 0)::text AS mv
       FROM ops_managed_fof_underlying
       WHERE COALESCE(market_value, 0) > 0
         AND UPPER(BTRIM(underlying_product_code)) = 'JX860B'`,
    )
    const totalMv = mv[0]?.mv ?? "0"
    console.log("combined JX860B market value:", totalMv)

    const cache = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE ops_fof_overview_list_cache
         SET market_value = $1::numeric, refreshed_at = NOW()
         WHERE UPPER(BTRIM(beian_hao)) = 'JX860B'
            OR product_name ILIKE '%交睿宏观配置1号%B类%'
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM updated`,
      [totalMv],
    )
    console.log("updated list cache rows:", cache[0]?.n)

    const summary = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE fof_underlying_summary
         SET market_value = $1::numeric, updated_at = NOW()
         WHERE product_name ILIKE '%交睿宏观配置1号%B类%'
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM updated`,
      [totalMv],
    )
    console.log("updated fof_underlying_summary rows:", summary[0]?.n)

    const after = await query(
      `SELECT fof_product_name, underlying_product_code, underlying_name, market_value::text
       FROM ops_managed_fof_underlying
       WHERE COALESCE(market_value, 0) > 0
         AND UPPER(BTRIM(underlying_product_code)) = 'JX860B'
       ORDER BY fof_product_name`,
    )
    console.log("after JX860B rows:", after)

    const modal = await listUnderlyingHoldings({
      beianHao: "JX860B",
      productName: "交睿宏观配置1号私募证券投资基金B类",
    })
    console.log("持仓 modal:", modal)
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
