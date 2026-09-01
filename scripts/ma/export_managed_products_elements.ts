/**
 * Export 投资 → 在管产品 → 查询要素 (产品要素 dialog) for every running product.
 *
 * Usage (PowerShell — starts SSH tunnel automatically):
 *   npx tsx scripts/ma/export_managed_products_elements.ts
 *
 * If tunnel already running:
 *   npx tsx scripts/ma/export_managed_products_elements.ts --no-tunnel
 *
 * Out: data/在管产品_产品要素_YYYY-MM-DD.xlsx
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

type TrackRow = {
  fund_name: string | null
  fund_short_name: string | null
  register_number: string | null
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
  risk_level?: string | null
  lock_period_desc?: string | null
  fee_pay_formula?: string | null
  fee_pay_formula_json?: unknown
}

type ElementPayload = Record<string, string | null>

const EXTRA_SELECT = `SELECT fund_name, fund_short_name, register_number,
              advisor, advisor2, inception_date::text, puton_date::text,
              mandator_name, manager_names,
              open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay,
              updated_at::text,
              risk_level, lock_period_desc, fee_pay_formula, fee_pay_formula_json
       FROM basicinfo_bfl_track`

const BASE_SELECT = `SELECT fund_name, fund_short_name, register_number,
              advisor, advisor2, inception_date::text, puton_date::text,
              mandator_name, manager_names,
              open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay,
              updated_at::text
       FROM basicinfo_bfl_track`

const HEADERS = [
  "序号",
  "列表产品名称",
  "备案编码",
  "一级策略",
  "二级策略",
  "三级策略",
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
  "风险等级",
  "预警线",
  "封闭期",
  "平仓线",
  "锁定期说明",
  "管理费率",
  "托管费",
  "管理费说明",
  "外包费",
  "业绩报酬说明",
  "业绩报酬公式",
  "最近更新",
  "要素状态",
] as const

function hasRedeemFields(row: {
  open_day?: string | null
  fee_purchase?: string | null
  fee_redeem?: string | null
  fee_manage?: string | null
  fee_pay?: string | null
  fee_manage_rate?: string | null
}): boolean {
  return [
    row.open_day,
    row.fee_purchase,
    row.fee_redeem,
    row.fee_manage,
    row.fee_pay,
    row.fee_manage_rate,
  ].some((v) => v != null && String(v).trim() !== "")
}

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
    const { resolveManagedProductBeian, MANAGED_PRODUCT_CUSTODIAN_OVERRIDES } = await import(
      "@/lib/server/managed-product-beian"
    )
    const { extraFieldsFromTrackRow, loadBasicinfoTrackByBeianKeys, resolveFundElementsBeianKeys } =
      await import("@/lib/server/fund-elements-lookup")
    const { lookupAmacMandatorName } = await import("@/lib/server/amac-fund-metadata")
    const { isWeakShortFee } = await import("@/lib/server/fund-contract-element-keywords")

    const products = await query<{
      product_name: string
      beian_hao: string | null
      short_name: string | null
      company_strategy_l1: string | null
      company_strategy_l2: string | null
      company_strategy_l3: string | null
    }>(
      `SELECT
         m.product_name,
         cache.beian_hao,
         cache.short_name,
         cache.company_strategy_l1,
         cache.company_strategy_l2,
         cache.company_strategy_l3
       FROM managed_products m
       INNER JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
       WHERE m.product_name <> '合计'
         AND (cache.net_asset_value IS NULL OR cache.net_asset_value > 0)
       ORDER BY m.sequence_no ASC NULLS LAST, m.id ASC`,
    )

    console.log(`在管产品(运行中): ${products.length}`)

    let withElements = 0
    let basicOnly = 0
    let missingBeian = 0
    let missingElements = 0

    const aoa: (string | number | null)[][] = [Array.from(HEADERS)]

    for (let i = 0; i < products.length; i++) {
      const p = products[i]
      const beian = resolveManagedProductBeian(p.product_name, p.beian_hao)
      process.stdout.write(`  [${i + 1}/${products.length}] ${p.product_name} ${beian || "(无备案)"} … `)

      let el: ElementPayload | null = null
      if (beian) {
        const keys = await resolveFundElementsBeianKeys(beian, p.product_name)
        const rows = await loadBasicinfoTrackByBeianKeys<TrackRow>(keys, EXTRA_SELECT).catch(() =>
          loadBasicinfoTrackByBeianKeys<TrackRow>(keys, BASE_SELECT),
        )
        const row = rows[0]
        if (row) {
          const extra = extraFieldsFromTrackRow(row)
          const resolvedBeian = (row.register_number || keys[0] || beian).trim()
          const pfiRows = await query<{ manager: string | null }>(
            `SELECT manager FROM private_fund_info
             WHERE beian_hao = ANY($1::text[])
             LIMIT 1`,
            [keys],
          ).catch(() => [] as { manager: string | null }[])
          const custodian =
            MANAGED_PRODUCT_CUSTODIAN_OVERRIDES[p.product_name] ||
            row.mandator_name?.trim() ||
            (await lookupAmacMandatorName(resolvedBeian || beian))
          const rate =
            row.fee_manage_rate != null && String(row.fee_manage_rate).trim() !== ""
              ? `${(parseFloat(row.fee_manage_rate) * 100).toFixed(2)}%`
              : null
          el = {
            fund_name: row.fund_name,
            register_number: row.register_number ?? resolvedBeian,
            advisor: row.advisor || null,
            fund_manager: pfiRows[0]?.manager || row.advisor || null,
            inception_date: row.inception_date ? row.inception_date.slice(0, 10) : null,
            puton_date: row.puton_date ? row.puton_date.slice(0, 10) : null,
            custodian: custodian || null,
            open_day: row.open_day || null,
            is_temporary_open: formatTemporaryOpen(row.is_temporary_open),
            fee_purchase: row.fee_purchase || null,
            add_amount: row.add_amount || null,
            fee_redeem: row.fee_redeem || null,
            precautious_line: row.precautious_line || null,
            closed_period: row.closed_period || null,
            stop_line: row.stop_line || null,
            fee_manage_rate: rate,
            fee_trust: isWeakShortFee(row.fee_trust) ? null : row.fee_trust || null,
            fee_manage: row.fee_manage || null,
            fee_admin_service: isWeakShortFee(row.fee_admin_service) ? null : row.fee_admin_service || null,
            fee_pay: row.fee_pay || null,
            risk_level: extra.risk_level || row.risk_level || null,
            lock_period_desc: extra.lock_period_desc,
            fee_pay_formula: extra.fee_pay_formula,
            updated_at: row.updated_at ? row.updated_at.slice(0, 10) : null,
          }
        }
      }

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
      console.log(status)

      aoa.push([
        i + 1,
        p.product_name,
        beian || null,
        p.company_strategy_l1,
        p.company_strategy_l2,
        p.company_strategy_l3,
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
        el?.risk_level ?? null,
        el?.precautious_line ?? null,
        el?.closed_period ?? null,
        el?.stop_line ?? null,
        el?.lock_period_desc ?? null,
        el?.fee_manage_rate ?? null,
        el?.fee_trust ?? null,
        el?.fee_manage ?? null,
        el?.fee_admin_service ?? null,
        el?.fee_pay ?? null,
        el?.fee_pay_formula ?? null,
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
    let outPath = path.join(outDir, `在管产品_产品要素_${stamp}.xlsx`)
    try {
      XLSX.writeFile(wb, outPath)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== "EBUSY" && code !== "EPERM") throw err
      outPath = path.join(outDir, `在管产品_产品要素_${stamp}_${Date.now()}.xlsx`)
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
