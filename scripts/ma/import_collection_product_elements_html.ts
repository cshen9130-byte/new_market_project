/**
 * Fill empty 产品要素 from a 集合型基金产品要素一览表 HTML (structured table, not a contract).
 *
 * Usage:
 *   npx tsx scripts/ma/import_collection_product_elements_html.ts "<html-path>" --dry-run
 *   npx tsx scripts/ma/import_collection_product_elements_html.ts "<html-path>"
 *
 * Only writes fields that are currently empty / weak. Existing values are left alone.
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const SSH_HOST = "root@8.154.33.143"
const LOCAL_PORT = 5433
const REMOTE_DB = "127.0.0.1:5432"
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

const DEFAULT_REDEEM_FEE =
  "不满90天1%；90-180天0.5%；180-365天0.25%；满365天免赎回费"

type SheetProduct = {
  sheetName: string
  names: string[]
  strategy: string
  benchmark: string
  initial: string
  additional: string
  subscriptionFee: string
  managementFee: string
  performanceFee: string
  closedPeriod: string
  redemptionFee: string
  openDay: string
  tags: string
}

function decodeAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r\n/g, "\n")
    .trim()
}

function attr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\bdata-${name}="([^"]*)"`, "i"))
  return m ? decodeAttr(m[1]) : ""
}

function expandProductNames(name: string): string[] {
  const trimmed = name.trim()
  if (!trimmed) return []
  const range = trimmed.match(/^(.*?)(\d+)\s*[-–—~至到]\s*(\d+)号$/u)
  if (!range) return [trimmed]
  const prefix = range[1]
  const from = Number(range[2])
  const to = Number(range[3])
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 20) {
    return [trimmed]
  }
  const out: string[] = []
  for (let i = from; i <= to; i++) out.push(`${prefix}${i}号`)
  return out
}

function parseSheetProducts(html: string): SheetProduct[] {
  const rows: SheetProduct[] = []
  const re = /<tr\b([^>]*)>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const attrs = match[1] ?? ""
    const sheetName = attr(attrs, "product-name")
    if (!sheetName) continue
    rows.push({
      sheetName,
      names: expandProductNames(sheetName),
      strategy: attr(attrs, "strategy"),
      benchmark: attr(attrs, "benchmark"),
      initial: attr(attrs, "initial"),
      additional: attr(attrs, "additional"),
      subscriptionFee: attr(attrs, "subscription-fee"),
      managementFee: attr(attrs, "management-fee"),
      performanceFee: attr(attrs, "performance-fee"),
      closedPeriod: attr(attrs, "closed-period"),
      redemptionFee: attr(attrs, "redemption-fee"),
      openDay: attr(attrs, "open-day"),
      tags: attr(attrs, "tags"),
    })
  }
  return rows
}

function noneLike(value: string): boolean {
  return !value || /^(无|—|-|不设置|不收取)$/u.test(value.trim())
}

function formatFeeRate(value: string): string | null {
  const s = value.trim()
  if (!s || noneLike(s)) return null
  const m = s.match(/([\d.]+)\s*%/)
  if (m) return `${m[1]}%`
  return s
}

function formatOpenDay(value: string): string | null {
  const s = value.replace(/[ \t]+/g, "").replace(/\n{2,}/g, "\n").trim()
  return s || null
}

function formatAddAmount(initial: string, additional: string): string | null {
  const first = initial.trim()
  const add = additional.trim()
  const bits: string[] = []
  if (first) {
    const wan = first.replace(/（含申购费）/g, "").trim()
    const note = /含申购费/.test(first) ? "（含申购费）" : ""
    bits.push(`首次不低于${wan}万元${note}`)
  }
  if (add) bits.push(`追加不低于${add}万元`)
  return bits.length ? bits.join("，") : null
}

function formatRedeemFee(value: string): string | null {
  const s = value.trim()
  if (!s) return null
  if (/见注释/.test(s)) return DEFAULT_REDEEM_FEE
  if (noneLike(s)) return "不收取赎回费"
  return s
}

function formatClosedPeriod(value: string): string | null {
  const s = value.trim()
  if (!s || noneLike(s)) return "不设置"
  return s
}

function formatFeePay(value: string): string | null {
  const s = value.trim()
  if (!s) return null
  if (noneLike(s)) return "不收取业绩报酬"
  return s
}

function formatFeeManage(value: string): string | null {
  const s = value.trim()
  if (!s) return null
  if (noneLike(s)) return "不收取管理费"
  const rate = formatFeeRate(s)
  return rate ? `年管理费率${rate}` : s
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

function htmlPathFromArgv(): string {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (!args[0]) {
    throw new Error("Usage: npx tsx scripts/ma/import_collection_product_elements_html.ts <html-path> [--dry-run]")
  }
  return args[0]
}

const FILL_KEYS = [
  "open_day",
  "fee_purchase",
  "add_amount",
  "fee_redeem",
  "closed_period",
  "fee_manage_rate",
  "fee_manage",
  "fee_pay",
] as const

function isStrictlyEmpty(value: string | null | undefined): boolean {
  const s = String(value ?? "").trim()
  return !s || s === "—" || /^-+$/.test(s)
}

function buildStrictFillBody(
  beian_hao: string,
  extracted: Record<(typeof FILL_KEYS)[number], string | null>,
  current: Record<string, string | null | undefined> | null,
): Record<string, string> & { beian_hao: string } {
  const body: Record<string, string> & { beian_hao: string } = { beian_hao }
  for (const key of FILL_KEYS) {
    const next = extracted[key]?.trim() || ""
    if (!next) continue
    if (!isStrictlyEmpty(current?.[key] as string | null | undefined)) continue
    body[key] = next
  }
  return body
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const noTunnel = process.argv.includes("--no-tunnel")
  const htmlPath = htmlPathFromArgv()
  if (!fs.existsSync(htmlPath)) throw new Error(`File not found: ${htmlPath}`)

  const products = parseSheetProducts(fs.readFileSync(htmlPath, "utf8"))
  if (!products.length) throw new Error("No product rows found in HTML")
  console.log(`Parsed ${products.length} sheet rows from ${path.basename(htmlPath)}`)

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

    const { pickHighConfidenceFundMatch } = await import("@/lib/server/fund-contract-element-extract")
    type ExtractedFundElements = import("@/lib/server/fund-contract-element-extract").ExtractedFundElements
    const { searchTrackingFunds } = await import("@/lib/server/fund-picker-search")
    const { query } = await import("@/lib/db")
    const { sqlFundNameMatch } = await import("@/lib/server/fund-name-match")
    const {
      appliedFieldKeys,
      loadExtractedElementDisplayValues,
      writeFundElementsFromBody,
    } = await import("@/lib/server/fund-elements-write")
    const { listFundFamilyProducts } = await import("@/lib/server/share-class-product")

    async function matchProduct(name: string, extracted: ExtractedFundElements) {
      const candidates = await searchTrackingFunds(name, 10)
      const hit = pickHighConfidenceFundMatch(extracted, candidates)
      if (hit) return hit
      const rows = await query<{ beian_hao: string; product_name: string }>(
        `SELECT beian_hao, product_name
         FROM private_fund_info
         WHERE ${sqlFundNameMatch("product_name", "$1")}
         LIMIT 5`,
        [name],
      ).catch(() => [] as { beian_hao: string; product_name: string }[])
      return pickHighConfidenceFundMatch(extracted, rows)
    }

    const empty = {
      fund_name: null,
      register_number: null,
      advisor: null,
      fund_manager: null,
      inception_date: null,
      puton_date: null,
      custodian: null,
      open_day: null,
      is_temporary_open: null,
      fee_purchase: null,
      add_amount: null,
      fee_redeem: null,
      precautious_line: null,
      closed_period: null,
      stop_line: null,
      fee_manage_rate: null,
      fee_trust: null,
      fee_manage: null,
      fee_admin_service: null,
      fee_pay: null,
      risk_level: null,
      lock_period_desc: null,
      fee_pay_formula: null,
    } satisfies ExtractedFundElements

    let matched = 0
    let filled = 0
    let skippedComplete = 0
    let unmatched = 0
    const unmatchedNames: string[] = []

    for (const product of products) {
      for (const name of product.names) {
        const extracted: ExtractedFundElements = {
          ...empty,
          fund_name: name,
          open_day: formatOpenDay(product.openDay),
          fee_purchase: noneLike(product.subscriptionFee)
            ? "0%"
            : formatFeeRate(product.subscriptionFee),
          add_amount: formatAddAmount(product.initial, product.additional),
          fee_redeem: formatRedeemFee(product.redemptionFee),
          closed_period: formatClosedPeriod(product.closedPeriod),
          fee_manage_rate: formatFeeRate(product.managementFee),
          fee_manage: formatFeeManage(product.managementFee),
          fee_pay: formatFeePay(product.performanceFee),
        }

        const hit = await matchProduct(name, extracted)
        if (!hit) {
          unmatched += 1
          unmatchedNames.push(name)
          console.log(`UNMATCHED  ${name}`)
          continue
        }
        matched += 1

        const family = await listFundFamilyProducts(hit.beian_hao)
        const targets = family.length ? family : [{ beian_hao: hit.beian_hao, product_name: hit.product_name }]
        const writtenKeys = new Set<string>()

        for (const target of targets) {
          const current = await loadExtractedElementDisplayValues(target.beian_hao, target.product_name, {
            exactBeian: true,
          })
          const nextExtracted = { ...extracted }
          const currentRate = parseFloat(String(current?.fee_manage_rate ?? "").replace(/%/g, ""))
          if (
            nextExtracted.fee_manage === "不收取管理费" &&
            Number.isFinite(currentRate) &&
            currentRate > 0
          ) {
            nextExtracted.fee_manage = null
          }
          const body = buildStrictFillBody(target.beian_hao, nextExtracted, current)
          const fields = appliedFieldKeys(body)
          if (!fields.length) continue
          for (const key of fields) writtenKeys.add(key)
          if (!dryRun) await writeFundElementsFromBody(body)
        }

        if (!writtenKeys.size) {
          skippedComplete += 1
          console.log(`SKIP       ${name}  ${hit.beian_hao}  already has elements`)
          continue
        }

        filled += 1
        console.log(
          `${dryRun ? "DRY FILL" : "FILLED"}     ${name}  ${hit.beian_hao}  ${hit.product_name}  +${[...writtenKeys].join(",")}`,
        )
      }
    }

    console.log("")
    console.log(
      `${dryRun ? "DRY RUN" : "DONE"}  sheet=${products.length} matched=${matched} ` +
        `filled=${filled} already_complete=${skippedComplete} unmatched=${unmatched}`,
    )
    if (unmatchedNames.length) {
      console.log(`Unmatched: ${unmatchedNames.join("；")}`)
    }
  } finally {
    if (tunnel) tunnel.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
