/**
 * Export 基金数据库 funds that match:
 *   净值日期 = 1个月以内
 *   AND 中间缺失超1/10  (same rule as 运维 → 团队数据; 运作日 scopes the window)
 *
 * Usage:
 *   npx tsx scripts/ma/export_private_funds_nav1m_interior_gap.ts
 *   npx tsx scripts/ma/export_private_funds_nav1m_interior_gap.ts --no-tunnel
 *
 * Out: data/exports/私募基金_净值日期1个月以内_中间缺失超1_10_YYYY-MM-DD.csv
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"
import { analyzeInteriorNavGap } from "@/lib/server/nav-interior-gap"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const SSH_HOST = "root@8.154.33.143"
const LOCAL_PORT = 5433
const REMOTE_DB = "127.0.0.1:5432"
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

const BATCH = 400
const STAMP = new Date().toISOString().slice(0, 10)
const OUT_FILE = path.join(
  process.cwd(),
  "data",
  "exports",
  `私募基金_净值日期1个月以内_中间缺失超1_10_${STAMP}.csv`,
)

type FundRow = {
  beian_hao: string
  product_name: string
  strategy_l1: string | null
  strategy_l2: string | null
  manager: string | null
  inception_date: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
}

function waitForPort(port: number, timeoutMs = 20_000): Promise<boolean> {
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
        await new Promise((r) => setTimeout(r, 400))
      }
    }
    return false
  })()
}

async function startSshTunnel(): Promise<ChildProcess> {
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSH key not found: ${keyPath}`)
  }
  const child = spawn(
    "ssh",
    [
      "-i", keyPath,
      "-L", `${LOCAL_PORT}:${REMOTE_DB}`,
      "-N",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      SSH_HOST,
    ],
    { stdio: "ignore", windowsHide: true },
  )
  child.on("error", (err) => console.error("SSH process error:", err.message))
  const ready = await waitForPort(LOCAL_PORT)
  if (!ready) {
    child.kill()
    throw new Error(`SSH tunnel did not open localhost:${LOCAL_PORT} within 20s`)
  }
  console.log(`SSH tunnel ready on localhost:${LOCAL_PORT}`)
  return child
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s
}

function isoDay(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 10)
}

function beianAliases(code: string): string[] {
  const u = code.trim().toUpperCase()
  if (!u) return []
  const out = new Set<string>([u])
  if (u.startsWith("S") && u.length > 5) out.add(u.slice(1))
  if (!u.startsWith("S")) out.add(`S${u}`)
  else if (!u.startsWith("SS")) out.add(`S${u}`)
  return [...out]
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return ""
  return `${(n * 100).toFixed(2)}%`
}

function num(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return ""
  return n.toFixed(digits)
}

async function tableColumns(
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
  table: string,
): Promise<Set<string>> {
  const rows = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  return new Set(rows.map((r) => r.column_name))
}

async function existingTables(
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
  names: string[],
): Promise<Set<string>> {
  const rows = await query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [names],
  )
  return new Set(rows.map((r) => r.table_name))
}

async function main() {
  const noTunnel = process.argv.includes("--no-tunnel")
  let tunnel: ChildProcess | null = null

  try {
    if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
      process.env.DATABASE_URL = DEFAULT_DB_URL
    }

    if (noTunnel) {
      const ready = await waitForPort(LOCAL_PORT, 3_000)
      if (!ready) {
        throw new Error(`--no-tunnel was passed but nothing is listening on localhost:${LOCAL_PORT}`)
      }
    } else {
      const already = await waitForPort(LOCAL_PORT, 800)
      if (already) {
        console.log(`Using existing listener on localhost:${LOCAL_PORT}`)
      } else {
        tunnel = await startSshTunnel()
      }
    }

    const { query } = await import("@/lib/db")
    const infoCols = await tableColumns(query, "private_fund_info")
    const l2Select = infoCols.has("strategy_l2") ? "i.strategy_l2" : "NULL::text"

    const funds = await query<FundRow>(
      `SELECT
         i.beian_hao,
         i.product_name,
         i.strategy_l1,
         ${l2Select} AS strategy_l2,
         i.manager,
         i.inception_date::text AS inception_date,
         i.latest_nav::text AS latest_nav,
         i.latest_nav_date::text AS latest_nav_date,
         i.ret_1w::text AS ret_1w,
         i.ret_1m::text AS ret_1m,
         i.ret_3m::text AS ret_3m,
         i.ret_6m::text AS ret_6m,
         i.ret_1y::text AS ret_1y
       FROM private_fund_info i
       WHERE i.latest_nav_date >= CURRENT_DATE - INTERVAL '1 month'
       ORDER BY i.inception_date DESC NULLS LAST, i.beian_hao`,
    )
    console.log(`Universe (净值日期 1个月以内): ${funds.length}`)

    const tables = await existingTables(query, [
      "private_fund_nav",
      "private_fund_nav_group",
      "private_fund_nav_group_type6",
      "private_fund_nav_group_hy",
      "ops_email_nav_records",
    ])
    console.log(`NAV tables: ${[...tables].sort().join(", ") || "(none)"}`)

    const unions: string[] = []
    if (tables.has("private_fund_nav")) {
      unions.push(`SELECT beian_hao AS code, price_date
        FROM private_fund_nav
        WHERE beian_hao = ANY($1::text[]) AND price_date <= CURRENT_DATE AND nav IS NOT NULL`)
    }
    if (tables.has("private_fund_nav_group")) {
      unions.push(`SELECT beian_hao AS code, price_date
        FROM private_fund_nav_group
        WHERE beian_hao = ANY($1::text[]) AND price_date <= CURRENT_DATE AND nav IS NOT NULL`)
    }
    if (tables.has("private_fund_nav_group_type6")) {
      unions.push(`SELECT beian_hao AS code, price_date
        FROM private_fund_nav_group_type6
        WHERE beian_hao = ANY($1::text[]) AND price_date <= CURRENT_DATE AND nav IS NOT NULL`)
    }
    if (tables.has("private_fund_nav_group_hy")) {
      unions.push(`SELECT beian_hao AS code, price_date
        FROM private_fund_nav_group_hy
        WHERE beian_hao = ANY($1::text[]) AND price_date <= CURRENT_DATE AND nav IS NOT NULL`)
    }
    if (tables.has("ops_email_nav_records")) {
      unions.push(`SELECT product_code AS code, nav_date AS price_date
        FROM ops_email_nav_records
        WHERE product_code = ANY($1::text[]) AND nav_date IS NOT NULL AND nav IS NOT NULL`)
    }
    if (unions.length === 0) {
      throw new Error("No NAV tables found")
    }

    const datesByCode = new Map<string, Set<string>>()
    for (let i = 0; i < funds.length; i += BATCH) {
      const batch = funds.slice(i, i + BATCH)
      const codes = [...new Set(batch.flatMap((f) => beianAliases(f.beian_hao)))]
      const rows = await query<{ code: string; price_date: string }>(
        `SELECT DISTINCT UPPER(BTRIM(code)) AS code, price_date::text AS price_date
         FROM (${unions.join("\nUNION\n")}) t`,
        [codes],
      )
      for (const row of rows) {
        const code = row.code?.trim().toUpperCase()
        const day = isoDay(row.price_date)
        if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
        const list = datesByCode.get(code) ?? new Set<string>()
        list.add(day)
        datesByCode.set(code, list)
      }
      console.log(`  loaded NAV dates ${Math.min(i + BATCH, funds.length)}/${funds.length}`)
    }

    const operationDateByCode = new Map<string, string>()
    try {
      const opCodes = [...new Set(funds.flatMap((f) => beianAliases(f.beian_hao)))]
      for (let i = 0; i < opCodes.length; i += BATCH) {
        const batch = opCodes.slice(i, i + BATCH)
        const opRows = await query<{
          register_number: string | null
          record_key: string | null
          operation_date: string | null
        }>(
          `SELECT register_number, record_key, operation_date::text AS operation_date
           FROM basicinfo_bfl_track
           WHERE operation_date IS NOT NULL
             AND (register_number = ANY($1::text[]) OR record_key = ANY($1::text[]))`,
          [batch],
        )
        for (const row of opRows) {
          const day = isoDay(row.operation_date)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
          for (const raw of [row.register_number, row.record_key]) {
            for (const alias of beianAliases(raw ?? "")) {
              if (!operationDateByCode.has(alias)) operationDateByCode.set(alias, day)
            }
          }
        }
      }
    } catch {
      console.warn("operation_date column missing; scoring from first NAV")
    }

    const header = [
      "序号",
      "备案号",
      "产品名称",
      "管理人",
      "一级策略",
      "二级策略",
      "成立日期",
      "最新净值",
      "净值日期",
      "近一周收益",
      "近一月收益",
      "近三月收益",
      "近六月收益",
      "近一年收益",
      "首个净值日",
      "最近净值日",
      "净值点数",
      "典型间隔交易日",
      "估算缺失点数",
      "应有点数",
      "中间缺失比例",
    ]

    const gappedRows: string[][] = []
    let noSeries = 0
    for (const fund of funds) {
      const dates = new Set<string>()
      for (const alias of beianAliases(fund.beian_hao)) {
        for (const d of datesByCode.get(alias) ?? []) dates.add(d)
      }
      if (dates.size === 0) noSeries += 1
      const fromDate = beianAliases(fund.beian_hao)
        .map((alias) => operationDateByCode.get(alias))
        .find(Boolean) ?? null
      const stats = analyzeInteriorNavGap([...dates], fromDate)
      if (!stats.gapped) continue
      gappedRows.push([
        String(gappedRows.length + 1),
        fund.beian_hao,
        fund.product_name ?? "",
        fund.manager ?? "",
        fund.strategy_l1 ?? "",
        fund.strategy_l2 ?? "",
        fund.inception_date ?? "",
        fund.latest_nav ?? "",
        fund.latest_nav_date ?? "",
        fund.ret_1w ?? "",
        fund.ret_1m ?? "",
        fund.ret_3m ?? "",
        fund.ret_6m ?? "",
        fund.ret_1y ?? "",
        stats.first,
        stats.last,
        String(stats.count),
        num(stats.typical, 1),
        num(stats.missing, 2),
        num(stats.expected, 2),
        pct(stats.ratio),
      ])
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
    const lines = [
      header.map(csvEscape).join(","),
      ...gappedRows.map((r) => r.map(csvEscape).join(",")),
    ]
    fs.writeFileSync(OUT_FILE, `\uFEFF${lines.join("\n")}\n`, "utf8")

    console.log(`No NAV series found: ${noSeries}`)
    console.log(`中间缺失超1/10: ${gappedRows.length} / ${funds.length}`)
    console.log(`Wrote ${OUT_FILE}`)
  } finally {
    if (tunnel) tunnel.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
