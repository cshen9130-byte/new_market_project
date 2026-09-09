/**
 * Ingest local 估值表 workbooks through the same pipeline as email parse / manual upload.
 * Skip a product when it already has this valuation_date or a newer one.
 *
 * Usage:
 *   npx tsx scripts/ma/_ingest_local_valuation_files.ts
 */
import { createHash } from "crypto"
import fs, { readFileSync } from "fs"
import net from "net"
import path, { basename } from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433

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
  if (await waitForPort(LOCAL_PORT, 800)) {
    console.log(`Using existing listener on localhost:${LOCAL_PORT}`)
    return null
  }
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  if (!fs.existsSync(keyPath)) throw new Error(`SSH key not found: ${keyPath}`)
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
    throw new Error("SSH tunnel did not open localhost:5433")
  }
  console.log("SSH tunnel ready on localhost:5433")
  return child
}

const MANUAL_CRAWL_ACCOUNT = "team_manual_upload"

const FILES: Array<{
  path: string
  storedFilename?: string
  hintCode?: string
  hintName?: string
}> = [
  {
    path: "d:\\微信\\documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-09\\SBVC85_峰云汇高山一号私募证券投资基金_20260826_估值表(1).xls",
    hintCode: "SBVC85",
    hintName: "峰云汇高山一号",
  },
  {
    path: "d:\\微信\\documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-09\\SCN157爱凡哲多策略海纳16号私募证券投资基金估值表20260825(1).xlsx",
    hintCode: "SCN157",
    hintName: "爱凡哲多策略海纳16号",
  },
  {
    path: "d:\\微信\\documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-09\\证券投资基金估值表_特夫郁金香全量化私募证券投资基金_20260826(1).xls",
    hintCode: "SQX078",
    hintName: "特夫郁金香全量化",
  },
  {
    path: "d:\\coding\\market_website\\tmp\\SVW787_valuation.pdf",
    storedFilename: "SVW787_慕途基本面量化1号私募证券投资基金_20260825_外包章_估值表(1).pdf",
    hintCode: "SVW787",
    hintName: "慕途基本面量化1号",
  },
]

function manualEmailUid(beianHao: string, filename: string, buffer: Buffer): string {
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  return `${beianHao}_${hash}_${filename}`
}

async function lookupLatestValuation(options: {
  productCode: string | null
  fundName: string | null
}): Promise<{ product_code: string | null; fund_name: string | null; latest_date: string } | null> {
  const { query } = await import("../../lib/db")
  const { sqlFundNameMatch } = await import("../../lib/server/fund-name-match")
  const code = options.productCode?.trim().toUpperCase() || ""
  const name = options.fundName?.trim() || ""
  if (!code && !name) return null

  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1
  if (code) {
    conditions.push(`UPPER(BTRIM(product_code)) = $${idx++}`)
    params.push(code)
  }
  if (name) {
    conditions.push(sqlFundNameMatch("fund_name", `$${idx++}`))
    params.push(name)
  }
  const rows = await query<{
    product_code: string | null
    fund_name: string | null
    latest_date: string
  }>(
    `SELECT product_code, fund_name, MAX(valuation_date)::text AS latest_date
     FROM ops_email_valuation_records
     WHERE ${conditions.join(" OR ")}
     GROUP BY product_code, fund_name
     ORDER BY latest_date DESC NULLS LAST
     LIMIT 1`,
    params,
  )
  return rows[0] ?? null
}

async function ingestFiles() {
  const { extractValuationFromBuffer, extractValuationFromPdfBuffer } = await import(
    "../../lib/server/email-valuation-attachment"
  )
  const { upsertEmailValuationRecords } = await import("../../lib/server/email-valuation-pg")
  const { upsertEmailNavRecords } = await import("../../lib/server/email-nav-pg")
  type EmailValuationInsert = import("../../lib/server/email-valuation-pg").EmailValuationInsert
  type EmailNavInsert = import("../../lib/server/email-nav-pg").EmailNavInsert
  const { refreshValuationPipelineForTouchedFunds } = await import(
    "../../lib/server/valuation-cache-refresh"
  )
  const { backfillCustodyValuationNavFromRecords } = await import(
    "../../lib/server/email-valuation-nav-backfill"
  )

  const inserts: EmailValuationInsert[] = []
  const navInserts: EmailNavInsert[] = []
  const decisions: Array<Record<string, unknown>> = []

  for (const file of FILES) {
    const filename = file.storedFilename ?? basename(file.path)
    const buffer = readFileSync(file.path)
    const extracted = /\.pdf$/i.test(filename)
      ? await extractValuationFromPdfBuffer(buffer, filename, filename)
      : extractValuationFromBuffer(buffer, filename, filename)
    if (!extracted) {
      decisions.push({ filename, action: "failed", reason: "无法解析估值表" })
      continue
    }

    const productCode = (
      extracted.productCode?.trim() || file.hintCode || ""
    ).toUpperCase()
    const fundName = extracted.fundName?.trim() || file.hintName || filename
    const existing = await lookupLatestValuation({
      productCode: productCode || null,
      fundName,
    })
    const existingDate = existing?.latest_date?.slice(0, 10) ?? null

    if (existingDate && existingDate >= extracted.valuationDate) {
      decisions.push({
        filename,
        action: "skipped",
        productCode,
        fundName,
        fileDate: extracted.valuationDate,
        existingDate,
        reason:
          existingDate === extracted.valuationDate
            ? "该日估值表已入库"
            : "库中已有更新估值表",
      })
      continue
    }

    const sentAt = new Date().toISOString()
    const subject = `${productCode || fundName}_${filename}`
    inserts.push({
      crawlEmailAccount: MANUAL_CRAWL_ACCOUNT,
      emailUid: manualEmailUid(productCode || fundName, filename, buffer),
      sentAt,
      subject,
      senderEmail: "",
      attachmentFilename: filename,
      productCode: productCode || null,
      fundName,
      valuationDate: extracted.valuationDate,
      unitNav: extracted.unitNav,
      cumulativeNav: extracted.cumulativeNav,
      custodyBalance: extracted.custodyBalance,
      netAssetValue: extracted.netAssetValue,
      paidInCapital: extracted.paidInCapital,
      totalAsset: extracted.totalAsset,
      totalLiability: extracted.totalLiability,
      custodian: extracted.custodian,
      netAsset: extracted.netAssetValue,
      underlyingHoldings: extracted.underlyingHoldings,
      holdingsCount: extracted.holdingsCount,
      source: "manual_upload",
      summary: extracted.analysis.summary,
      holdings: extracted.analysis.portfolio_data,
    })
    if (extracted.unitNav != null) {
      navInserts.push({
        crawlEmailAccount: MANUAL_CRAWL_ACCOUNT,
        emailUid: manualEmailUid(productCode || fundName, filename, buffer),
        sentAt,
        subject,
        senderEmail: "",
        attachmentFilename: filename,
        navDate: extracted.valuationDate,
        nav: extracted.unitNav,
        cumulativeNav: extracted.cumulativeNav,
        adjustedNav: null,
        productCode: productCode || null,
        fundName,
        source: "attachment_valuation_table",
      })
    }
    decisions.push({
      filename,
      action: existingDate ? "import_newer" : "import_missing",
      productCode,
      fundName,
      fileDate: extracted.valuationDate,
      existingDate,
      unitNav: extracted.unitNav,
      holdingsCount: extracted.holdingsCount,
    })
  }

  let valuationSaved = 0
  let holdingsSaved = 0
  let navSaved = 0
  let navBackfilled = 0
  let pipeline: { metricsUpserted: number; cacheInvalidated: number } | null = null

  if (inserts.length > 0) {
    const valuationResult = await upsertEmailValuationRecords(inserts)
    valuationSaved = valuationResult.recordsSaved
    holdingsSaved = valuationResult.holdingsSaved
    if (navInserts.length > 0) {
      navSaved = await upsertEmailNavRecords(navInserts)
    }
    const backfill = await backfillCustodyValuationNavFromRecords({
      sinceDate: "2026-08-01",
    })
    navBackfilled = backfill.navBackfilled
    pipeline = await refreshValuationPipelineForTouchedFunds(
      inserts.map((row) => ({
        productCode: row.productCode ?? "",
        fundName: row.fundName ?? "",
      })),
    )
  }

  console.log(
    JSON.stringify(
      {
        decisions,
        valuationSaved,
        holdingsSaved,
        navSaved,
        navBackfilled,
        pipeline,
      },
      null,
      2,
    ),
  )
}

async function main() {
  const tunnel = await ensureTunnel()
  try {
    await ingestFiles()
  } finally {
    tunnel?.kill()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
