/**
 * One-off: export 运维 → 团队数据 → 操作 → 产品要素 for every product.
 *
 * Usage (PowerShell — starts SSH tunnel automatically):
 *   npx tsx scripts/ma/export_ops_team_data_elements.ts
 *
 * If tunnel already running:
 *   npx tsx scripts/ma/export_ops_team_data_elements.ts --no-tunnel
 *
 * Out: data/运维团队数据_产品要素_YYYY-MM-DD.xlsx
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

type ElementRow = {
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
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
  updated_at: string | null
}

type ElementPayload = Record<string, string | null>

function hasRedeemFields(row: {
  mandator_name?: string | null
  open_day?: string | null
  fee_purchase?: string | null
  fee_redeem?: string | null
  precautious_line?: string | null
  closed_period?: string | null
  stop_line?: string | null
  fee_manage_rate?: string | null
  fee_trust?: string | null
  fee_manage?: string | null
  fee_admin_service?: string | null
  fee_pay?: string | null
  custodian?: string | null
}): boolean {
  return [
    row.mandator_name,
    row.custodian,
    row.open_day,
    row.fee_purchase,
    row.fee_redeem,
    row.precautious_line,
    row.closed_period,
    row.stop_line,
    row.fee_manage_rate,
    row.fee_trust,
    row.fee_manage,
    row.fee_admin_service,
    row.fee_pay,
  ].some((v) => v != null && String(v).trim() !== "")
}

function siblingCodes(code: string): string[] {
  const out = new Set<string>()
  if (/^S[A-Z0-9]{5,}$/i.test(code)) {
    const body = code.slice(1)
    out.add(body)
    out.add(`${body}A`)
    out.add(`A${body}`)
  }
  out.add(`${code}A`)
  return [...out]
}

function toPayload(row: ElementRow, managerByBeian: Map<string, string | null>): ElementPayload {
  const key = (row.register_number || row.record_key || "").trim()
  const rate =
    row.fee_manage_rate != null && String(row.fee_manage_rate).trim() !== ""
      ? `${(parseFloat(row.fee_manage_rate) * 100).toFixed(2)}%`
      : null
  const tempOpen = formatTemporaryOpen(row.is_temporary_open)
  return {
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
    fee_manage: row.fee_manage,
    fee_admin_service: row.fee_admin_service,
    fee_pay: row.fee_pay,
    updated_at: row.updated_at ? row.updated_at.slice(0, 10) : null,
  }
}

function mergeRedeem(primary: ElementPayload, donor: ElementPayload): ElementPayload {
  const keys = [
    "custodian",
    "open_day",
    "is_temporary_open",
    "fee_purchase",
    "add_amount",
    "fee_redeem",
    "precautious_line",
    "closed_period",
    "stop_line",
    "fee_manage_rate",
    "fee_trust",
    "fee_manage",
    "fee_admin_service",
    "fee_pay",
  ] as const
  const out = { ...primary }
  for (const k of keys) {
    if ((out[k] == null || String(out[k]).trim() === "") && donor[k] != null && String(donor[k]).trim() !== "") {
      out[k] = donor[k]
    }
  }
  return out
}

const HEADERS = [
  "列表产品名称",
  "备案编码",
  "产品来源",
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
  "管理费说明",
  "外包费",
  "业绩报酬说明",
  "最近更新",
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
    const { listTeamData } = await import("@/lib/server/team-data-query-pg")

    const { data: products, total } = await listTeamData({
      page: 1,
      pageSize: 200,
      keyword: "",
      strategySource: "company",
      strategyL1: "",
      strategyL2: "",
      strategyL3: "",
      sort: "",
      sortDir: "DESC",
    })

    console.log(`运维团队数据产品: ${products.length} (total=${total})`)

    const beians = [...new Set(products.map((p) => (p.beian_hao || "").trim()).filter(Boolean))]
    const elementsByBeian = new Map<string, ElementPayload>()

    if (beians.length > 0) {
      // Prefer rows that actually have 申赎要素 over newer AMAC-only basic rows.
      const elementRows = await query<ElementRow>(
        `SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(register_number), ''), NULLIF(BTRIM(record_key), '')))
                register_number, record_key,
                fund_name, advisor,
                inception_date::text, puton_date::text, mandator_name,
                open_day, is_temporary_open,
                fee_purchase, add_amount, fee_redeem,
                precautious_line, closed_period, stop_line,
                fee_manage_rate::text, fee_trust, fee_manage, fee_admin_service, fee_pay,
                updated_at::text
         FROM basicinfo_bfl_track
         WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
         ORDER BY COALESCE(NULLIF(BTRIM(register_number), ''), NULLIF(BTRIM(record_key), '')),
                  CASE
                    WHEN mandator_name IS NOT NULL OR open_day IS NOT NULL
                         OR fee_manage_rate IS NOT NULL OR fee_trust IS NOT NULL
                         OR fee_purchase IS NOT NULL OR fee_redeem IS NOT NULL
                         OR closed_period IS NOT NULL OR precautious_line IS NOT NULL
                         OR stop_line IS NOT NULL
                         OR NULLIF(BTRIM(fee_manage), '') IS NOT NULL
                         OR NULLIF(BTRIM(fee_pay), '') IS NOT NULL
                      THEN 0 ELSE 1
                  END,
                  updated_at DESC NULLS LAST, id DESC`,
        [beians],
      )

      const siblingCandidateSet = new Set<string>()
      for (const b of beians) for (const s of siblingCodes(b)) siblingCandidateSet.add(s)
      const siblingRows = siblingCandidateSet.size
        ? await query<ElementRow>(
            `SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(register_number), ''), NULLIF(BTRIM(record_key), '')))
                    register_number, record_key,
                    fund_name, advisor,
                    inception_date::text, puton_date::text, mandator_name,
                    open_day, is_temporary_open,
                    fee_purchase, add_amount, fee_redeem,
                    precautious_line, closed_period, stop_line,
                    fee_manage_rate::text, fee_trust, fee_manage, fee_admin_service, fee_pay,
                    updated_at::text
             FROM basicinfo_bfl_track
             WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
             ORDER BY COALESCE(NULLIF(BTRIM(register_number), ''), NULLIF(BTRIM(record_key), '')),
                      CASE
                        WHEN mandator_name IS NOT NULL OR open_day IS NOT NULL
                             OR fee_manage_rate IS NOT NULL OR fee_trust IS NOT NULL
                             OR fee_purchase IS NOT NULL OR fee_redeem IS NOT NULL
                             OR closed_period IS NOT NULL OR precautious_line IS NOT NULL
                             OR stop_line IS NOT NULL
                             OR NULLIF(BTRIM(fee_manage), '') IS NOT NULL
                             OR NULLIF(BTRIM(fee_pay), '') IS NOT NULL
                          THEN 0 ELSE 1
                      END,
                      updated_at DESC NULLS LAST, id DESC`,
            [[...siblingCandidateSet]],
          )
        : []

      const allLookupCodes = [...new Set([...beians, ...siblingCandidateSet])]
      const pfiRows = await query<{ beian_hao: string; manager: string | null }>(
        `SELECT beian_hao, manager FROM private_fund_info WHERE beian_hao = ANY($1::text[])`,
        [allLookupCodes],
      ).catch(() => [] as { beian_hao: string; manager: string | null }[])
      const managerByBeian = new Map(pfiRows.map((r) => [r.beian_hao, r.manager]))

      const siblingByCode = new Map<string, ElementPayload>()
      for (const row of siblingRows) {
        const key = (row.register_number || row.record_key || "").trim()
        if (!key || !hasRedeemFields(row)) continue
        siblingByCode.set(key, toPayload(row, managerByBeian))
      }

      for (const row of elementRows) {
        const key = (row.register_number || row.record_key || "").trim()
        if (!key) continue
        let payload = toPayload(row, managerByBeian)
        if (!hasRedeemFields(payload)) {
          for (const sib of siblingCodes(key)) {
            const donor = siblingByCode.get(sib)
            if (donor && hasRedeemFields(donor)) {
              payload = mergeRedeem(payload, donor)
              break
            }
          }
        }
        if (row.register_number) elementsByBeian.set(row.register_number.trim(), payload)
        if (row.record_key) elementsByBeian.set(row.record_key.trim(), payload)
      }
    }

    let withElements = 0
    let basicOnly = 0
    let missingBeian = 0
    let missingElements = 0

    const aoa: (string | null)[][] = [Array.from(HEADERS)]
    for (const p of products) {
      const beian = (p.beian_hao || "").trim()
      const el = beian ? elementsByBeian.get(beian) : undefined
      let status = "有要素"
      if (!beian) {
        status = "无备案编码"
        missingBeian++
      } else if (!el) {
        status = "暂无产品要素数据"
        missingElements++
      } else if (!hasRedeemFields(el)) {
        status = "仅基本信息"
        basicOnly++
      } else {
        withElements++
      }

      aoa.push([
        p.product_name,
        beian || null,
        p.product_source || null,
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
        el?.fee_manage ?? null,
        el?.fee_admin_service ?? null,
        el?.fee_pay ?? null,
        el?.updated_at ?? null,
        status,
      ])
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = HEADERS.map((h) => ({ wch: Math.max(12, Math.min(36, h.length * 2 + 4)) }))
    XLSX.utils.book_append_sheet(wb, ws, "产品要素")

    const outDir = path.join(process.cwd(), "data")
    fs.mkdirSync(outDir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 10)
    let outPath = path.join(outDir, `运维团队数据_产品要素_${stamp}.xlsx`)
    try {
      XLSX.writeFile(wb, outPath)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== "EBUSY" && code !== "EPERM") throw err
      outPath = path.join(outDir, `运维团队数据_产品要素_${stamp}_${Date.now()}.xlsx`)
      XLSX.writeFile(wb, outPath)
      console.log(`Primary xlsx locked; wrote alternate path.`)
    }

    console.log(
      `有要素: ${withElements}  仅基本信息: ${basicOnly}  无备案编码: ${missingBeian}  暂无要素: ${missingElements}`,
    )
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
