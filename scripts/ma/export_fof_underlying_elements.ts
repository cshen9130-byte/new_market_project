/**
 * One-off: export 投资 → FOF底层 → 操作 → 要素查询 data for every product.
 *
 * Usage (PowerShell — starts SSH tunnel automatically):
 *   npx tsx scripts/ma/export_fof_underlying_elements.ts
 *
 * If tunnel already running:
 *   npx tsx scripts/ma/export_fof_underlying_elements.ts --no-tunnel
 *
 * Out: data/FOF底层_产品要素_YYYY-MM-DD.xlsx
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import * as XLSX from "xlsx"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"
import { formatTemporaryOpen } from "@/lib/ma/fund-elements-extra"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const SSH_HOST = "root@8.154.33.143"
const LOCAL_PORT = 5433
const REMOTE_DB = "127.0.0.1:5432"
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

const HEADERS = [
  "列表产品名称",
  "备案编码",
  "产品全称",
  "备案编号",
  "投资顾问",
  "基金管理人",
  "成立日期",
  "备案日期",
  "托管券商",
  "开放日",
  "是否可临开",
  "申购费",
  "追加限制",
  "赎回费",
  "预警线",
  "封闭期",
  "平仓线",
  "管理费率",
  "托管费",
  "要素状态",
] as const

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
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSH key not found: ${keyPath}`)
  }

  const child = spawn(
    "ssh",
    [
      "-i",
      keyPath,
      "-L",
      `${LOCAL_PORT}:${REMOTE_DB}`,
      "-N",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ExitOnForwardFailure=yes",
      SSH_HOST,
    ],
    { stdio: "ignore", windowsHide: true },
  )

  child.on("error", (err) => {
    console.error("SSH process error:", err.message)
  })

  const ready = await waitForPort(LOCAL_PORT)
  if (!ready) {
    child.kill()
    throw new Error(`SSH tunnel did not open localhost:${LOCAL_PORT} within 20s`)
  }

  console.log(`SSH tunnel ready on localhost:${LOCAL_PORT}`)
  return child
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
        throw new Error(
          `--no-tunnel was passed but nothing is listening on localhost:${LOCAL_PORT}. Start the tunnel first.`,
        )
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
    const { sqlExcludeFofUnderlyingProduct } = await import("@/lib/server/fund-holding-code")

    const exclude = sqlExcludeFofUnderlyingProduct("f.product_name", "cache.beian_hao")
    const products = await query<{
      product_name: string
      short_name: string | null
      beian_hao: string | null
      market_value: string | null
    }>(
      `SELECT
         f.product_name,
         COALESCE(NULLIF(BTRIM(cache.short_name), ''), f.product_name) AS short_name,
         cache.beian_hao,
         COALESCE(cache.market_value, 0)::text AS market_value
       FROM fof_underlying_summary f
       LEFT JOIN ops_fof_overview_list_cache cache ON cache.fof_underlying_id = f.id
       WHERE f.product_name <> '合计'
         AND ${exclude}
         AND COALESCE(cache.market_value, 0) > 0
       ORDER BY f.sequence_no ASC NULLS LAST, f.id ASC`,
    )

    console.log(`FOF底层持仓产品: ${products.length}`)

    const { canonicalizeShareClassBeianCode } = await import("@/lib/server/share-class-product")
    const beians = [
      ...new Set(
        products
          .flatMap((p) => {
            const raw = (p.beian_hao || "").trim()
            if (!raw) return []
            const canonical = canonicalizeShareClassBeianCode(raw)
            return canonical && canonical !== raw ? [raw, canonical] : [raw]
          })
          .filter(Boolean),
      ),
    ]
    const elementsByBeian = new Map<string, Record<string, string | null>>()

    if (beians.length > 0) {
      const elementRows = await query<{
        register_number: string | null
        record_key: string | null
        fund_name: string | null
        advisor: string | null
        inception_date: string | null
        puton_date: string | null
        mandator_name: string | null
        open_day: string | null
        is_temporary_open: number | null
        fee_purchase: string | null
        add_amount: string | null
        fee_redeem: string | null
        precautious_line: string | null
        closed_period: string | null
        stop_line: string | null
        fee_manage_rate: string | null
        fee_trust: string | null
      }>(
        `SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(register_number), ''), NULLIF(BTRIM(record_key), '')))
                register_number, record_key,
                fund_name, advisor,
                inception_date::text, puton_date::text, mandator_name,
                open_day, is_temporary_open,
                fee_purchase, add_amount, fee_redeem,
                precautious_line, closed_period, stop_line,
                fee_manage_rate::text, fee_trust
         FROM basicinfo_bfl_track
         WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
         ORDER BY COALESCE(NULLIF(BTRIM(register_number), ''), NULLIF(BTRIM(record_key), '')),
                  updated_at DESC NULLS LAST, id DESC`,
        [beians],
      )

      const pfiRows = await query<{ beian_hao: string; manager: string | null }>(
        `SELECT beian_hao, manager FROM private_fund_info WHERE beian_hao = ANY($1::text[])`,
        [beians],
      ).catch(() => [] as { beian_hao: string; manager: string | null }[])
      const managerByBeian = new Map(pfiRows.map((r) => [r.beian_hao, r.manager]))

      for (const row of elementRows) {
        const key = (row.register_number || row.record_key || "").trim()
        if (!key) continue
        const rate = row.fee_manage_rate
          ? `${(parseFloat(row.fee_manage_rate) * 100).toFixed(2)}%`
          : null
        const tempOpen = formatTemporaryOpen(row.is_temporary_open)
        const payload = {
          fund_name: row.fund_name,
          register_number: row.register_number,
          advisor: row.advisor,
          fund_manager: managerByBeian.get(key) || row.advisor || null,
          inception_date: row.inception_date ? row.inception_date.slice(0, 10) : null,
          puton_date: row.puton_date ? row.puton_date.slice(0, 10) : null,
          custodian: row.mandator_name,
          open_day: row.open_day,
          is_temporary_open: tempOpen,
          fee_purchase: row.fee_purchase,
          add_amount: row.add_amount,
          fee_redeem: row.fee_redeem,
          precautious_line: row.precautious_line,
          closed_period: row.closed_period,
          stop_line: row.stop_line,
          fee_manage_rate: rate,
          fee_trust: row.fee_trust,
        }
        if (row.register_number) elementsByBeian.set(row.register_number.trim(), payload)
        if (row.record_key) elementsByBeian.set(row.record_key.trim(), payload)
      }
    }

    let withElements = 0
    let missingBeian = 0
    let missingElements = 0

    const aoa: (string | null)[][] = [Array.from(HEADERS)]
    for (const p of products) {
      const beian = (p.beian_hao || "").trim()
      const canonical = beian ? canonicalizeShareClassBeianCode(beian) : null
      const el = beian
        ? elementsByBeian.get(beian) || (canonical ? elementsByBeian.get(canonical) : undefined)
        : undefined
      let status = "有要素"
      if (!beian) {
        status = "无备案编码"
        missingBeian++
      } else if (!el) {
        status = "暂无产品要素数据"
        missingElements++
      } else {
        withElements++
      }

      aoa.push([
        p.short_name || p.product_name,
        beian || null,
        el?.fund_name ?? null,
        el?.register_number ?? (beian || null),
        el?.advisor ?? null,
        el?.fund_manager ?? null,
        el?.inception_date ?? null,
        el?.puton_date ?? null,
        el?.custodian ?? null,
        el?.open_day ?? null,
        el?.is_temporary_open ?? null,
        el?.fee_purchase ?? null,
        el?.add_amount ?? null,
        el?.fee_redeem ?? null,
        el?.precautious_line ?? null,
        el?.closed_period ?? null,
        el?.stop_line ?? null,
        el?.fee_manage_rate ?? null,
        el?.fee_trust ?? null,
        status,
      ])
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = HEADERS.map((h) => ({ wch: Math.max(12, Math.min(28, h.length * 2 + 4)) }))
    XLSX.utils.book_append_sheet(wb, ws, "产品要素")

    const outDir = path.join(process.cwd(), "data")
    fs.mkdirSync(outDir, { recursive: true })
    const outName = `FOF底层_产品要素_${new Date().toISOString().slice(0, 10)}.xlsx`
    const outPath = path.join(outDir, outName)
    XLSX.writeFile(wb, outPath)

    console.log(`有要素: ${withElements}  无备案编码: ${missingBeian}  暂无要素: ${missingElements}`)
    console.log(`Wrote ${outPath}`)
  } finally {
    if (tunnel && !tunnel.killed) {
      tunnel.kill()
      console.log("SSH tunnel closed.")
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
