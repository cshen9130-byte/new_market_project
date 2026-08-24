/**
 * One-time export: scan every email in the three crawl mailboxes, classify each
 * message, and write a CSV with sender/receiver/subject plus FOF fund fields.
 *
 * Usage (PowerShell — script starts the SSH tunnel automatically):
 *   npx tsx scripts/ma/export_all_crawl_emails_classify.ts
 *
 * If the tunnel is already running:
 *   npx tsx scripts/ma/export_all_crawl_emails_classify.ts --no-tunnel
 *
 * Output: email_classify_export_<timestamp>.csv in the workspace root.
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import {
  extractFundNameFromText,
  extractNavMetadata,
  normalizeFundDisplayName,
} from "../../lib/server/email-nav-extract"
import { closeImapFlow, createSafeImapFlow } from "../../lib/server/imap-flow-safe"
import pg from "pg"
import { loadProjectEnvFiles, configureEtlDbTimeout } from "../../lib/server/load-project-env"
import {
  inferCustodianFromSenderEmail,
  inferCustodianFromText,
} from "../../lib/server/email-valuation-custodian"
import {
  getCrawlEmailByAccount,
  getImapFolders,
  type CrawlEmailAccount,
} from "../../lib/server/crawl-emails"

loadProjectEnvFiles()
configureEtlDbTimeout()

function dbConnectionString(explicit?: string): string {
  if (explicit) return explicit
  return DEFAULT_DB_URL
}

const TARGET_ACCOUNTS = [
  "ch_c7h8@163.com",
  "data@jinyuasset.com",
  "enter2021chy@sina.com",
]

const SSH_HOST = "root@8.154.33.143"
const LOCAL_PORT = 5433
const REMOTE_DB = "127.0.0.1:5432"
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

const FUND_NAME_RE =
  /[\u4e00-\u9fffA-Za-z0-9（）()·\-—－]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?/gu

const CUSTODIAN_SENDER_RE =
  /@(?:tg\.)?gtht\.com|@gtja\.com|@htsc\.com|@csc108\.com|@citics\.com|@guosen\.com|@cicc\.com|@gf\.com|@cmschina\.com|@essence\.com|@ebscn\.com|@chinastock\.com/i

const MANAGER_SENDER_RE =
  /私募|fund|asset|capital|invest/i

type EmailCategory =
  | "ta"
  | "custodian"
  | "private_fund_manager"
  | "valuation"
  | "nav"
  | "ledger"
  | "settlement"
  | "virtual_nav"
  | "performance_fee"
  | "other"

type CsvRow = {
  receiver_email: string
  sender_email: string
  subject: string
  sent_at: string
  imap_folder: string
  uid: string
  category: EmailCategory
  fof_mother_fund_name: string
  fof_sub_fund_name: string
  fund_name: string
}

type FundContext = {
  motherNames: Set<string>
  motherNorm: Set<string>
  underlyingToMother: Map<string, string>
  managedNames: Set<string>
  managedNorm: Set<string>
}

type AttachmentInfo = { filename: string }

type EnvelopeAddress = { name?: string; address?: string; mailbox?: string; host?: string }

function parseArgs() {
  const argv = process.argv.slice(2)
  return {
    noTunnel: argv.includes("--no-tunnel"),
    outFile: argv.find((a) => a.startsWith("--out="))?.slice("--out=".length),
    databaseUrl: argv.find((a) => a.startsWith("--database-url="))?.slice("--database-url=".length),
  }
}

function normKey(name: string): string {
  return normalizeFundDisplayName(name)
    .replace(/\s+/g, "")
    .replace(/类$/u, "")
    .toLowerCase()
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function formatSenderEmail(from: EnvelopeAddress[] | undefined): string {
  const first = from?.[0]
  if (!first) return ""
  if (first.address?.trim()) return first.address.trim()
  if (first.mailbox && first.host) return `${first.mailbox}@${first.host}`.trim()
  return (first.name ?? "").trim()
}

function collectAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: AttachmentInfo[] = [],
): AttachmentInfo[] {
  const fname: string =
    node.dispositionParameters?.filename ??
    node.dispositionParameters?.name ??
    node.parameters?.name ??
    ""
  const disp: string = (node.disposition ?? "").toLowerCase()
  if (fname && (disp === "attachment" || fname)) out.push({ filename: fname })
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectAttachments(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

function extractAllFundNames(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(FUND_NAME_RE)) {
    const name = normalizeFundDisplayName(m[0])
    const key = normKey(name)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

function classifyEmail(
  subject: string,
  senderEmail: string,
  attachments: AttachmentInfo[],
): EmailCategory {
  const attachmentNames = attachments.map((a) => a.filename).join(" ")
  const blob = `${subject} ${attachmentNames}`

  if (/结算单|交易结算单|盯市/u.test(blob)) return "settlement"
  if (/TA虚拟净值|TA\s*虚拟/u.test(subject)) return "ta"
  if (/^虚拟业绩报酬_/u.test(subject)) return "performance_fee"
  if (/虚拟净值|基金虚拟净值表现估[算值]/u.test(subject)) return "virtual_nav"
  if (/估值表|估值/i.test(blob) && !/净值表|虚拟净值表现/u.test(blob)) return "valuation"
  if (/台账|份额明细|投资者明细|持有人明细/u.test(blob)) return "ledger"
  if (/净值波动表|净值表|资产净值公告|单位净值|基金份额净值|净值发送|净值公告/u.test(blob)) return "nav"

  if (CUSTODIAN_SENDER_RE.test(senderEmail) || /资产托管|托管发送|托管/u.test(subject)) {
    return "custodian"
  }

  const custodianName = inferCustodianFromSenderEmail(senderEmail, subject)
    ?? inferCustodianFromText(subject)
  if (custodianName) return "custodian"

  if (/私募基金管理|管理人旗下|基金管理有限公司/u.test(subject)) return "private_fund_manager"
  if (MANAGER_SENDER_RE.test(senderEmail) && /私募|基金|净值|估值/u.test(blob)) {
    return "private_fund_manager"
  }

  if (/净值|估值|私募|基金份额|业绩报酬|虚拟净值|台账|份额明细|投资者明细|清盘|核算|证券投资基金/u.test(blob)) {
    return "nav"
  }

  return "other"
}

function extractTaFofPair(subject: string): { mother?: string; sub?: string } {
  const direct = subject.match(
    /([\u4e00-\u9fffA-Za-z0-9（）()·\-—－]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)【([^】]+)】\s*TA虚拟净值/iu,
  )
  if (direct) {
    return {
      sub: normalizeFundDisplayName(direct[1]),
      mother: normalizeFundDisplayName(direct[2]),
    }
  }

  if (!/TA虚拟净值/u.test(subject)) return {}

  const bracketFunds = [...subject.matchAll(/【([^】]+)】/gu)]
    .map((m) => m[1]?.trim() ?? "")
    .filter((s) => /私募证券|证券投资基金|投资基金/u.test(s))

  const allFunds = extractAllFundNames(subject)
  if (bracketFunds.length === 1) {
    const mother = normalizeFundDisplayName(bracketFunds[0])
    const sub = allFunds.find((f) => normKey(f) !== normKey(mother))
    return { mother, sub }
  }

  return {}
}

function extractPerformanceFeeMother(subject: string): string | null {
  const m = subject.match(/^虚拟业绩报酬_(.+?)_[A-Z0-9]+_/u)
  if (!m?.[1]) return null
  const name = normalizeFundDisplayName(m[1])
  return /私募证券|投资基金/u.test(name) ? name : null
}

function extractVirtualEstimateMother(subject: string): string | null {
  const m = subject.match(/【基金虚拟净值表现估[算值]】[^_]+_.+_\d{4}-\d{2}-\d{2}_(.+)$/u)
  if (!m?.[1]) return null
  const name = normalizeFundDisplayName(m[1])
  return /私募证券|投资基金/u.test(name) ? name : null
}

function resolveFundFields(
  subject: string,
  category: EmailCategory,
  ctx: FundContext,
): Pick<CsvRow, "fof_mother_fund_name" | "fof_sub_fund_name" | "fund_name"> {
  const empty = { fof_mother_fund_name: "", fof_sub_fund_name: "", fund_name: "" }

  if (category === "ta") {
    const taPair = extractTaFofPair(subject)
    if (taPair.mother || taPair.sub) {
      return {
        fof_mother_fund_name: taPair.mother ?? "",
        fof_sub_fund_name: taPair.sub ?? "",
        fund_name: "",
      }
    }
  }

  if (category === "performance_fee") {
    const mother = extractPerformanceFeeMother(subject)
    if (mother) {
      return { fof_mother_fund_name: mother, fof_sub_fund_name: "", fund_name: "" }
    }
  }

  if (category === "virtual_nav") {
    const mother = extractVirtualEstimateMother(subject)
    if (mother) {
      return { fof_mother_fund_name: mother, fof_sub_fund_name: "", fund_name: "" }
    }
  }

  const primary =
    extractFundNameFromText(subject)
    ?? extractNavMetadata(subject, "").fundName
  const allFunds = extractAllFundNames(subject)
  if (primary && allFunds.length === 0) allFunds.push(primary)

  if (allFunds.length === 0) {
    return primary ? { ...empty, fund_name: primary } : empty
  }

  const motherCandidates = allFunds.filter(
    (f) => ctx.motherNorm.has(normKey(f)) || ctx.managedNorm.has(normKey(f)),
  )
  const subCandidates = allFunds.filter((f) => {
    const key = normKey(f)
    return ctx.underlyingToMother.has(key) && !motherCandidates.some((m) => normKey(m) === key)
  })

  if (motherCandidates.length === 1 && subCandidates.length === 1) {
    return {
      fof_mother_fund_name: motherCandidates[0],
      fof_sub_fund_name: subCandidates[0],
      fund_name: "",
    }
  }

  if (motherCandidates.length === 1 && allFunds.length === 2) {
    const sub = allFunds.find((f) => normKey(f) !== normKey(motherCandidates[0]))
    if (sub) {
      return {
        fof_mother_fund_name: motherCandidates[0],
        fof_sub_fund_name: sub,
        fund_name: "",
      }
    }
  }

  for (const fund of allFunds) {
    const mother = ctx.underlyingToMother.get(normKey(fund))
    if (mother) {
      return {
        fof_mother_fund_name: mother,
        fof_sub_fund_name: fund,
        fund_name: "",
      }
    }
  }

  if (allFunds.length === 1) {
    const only = allFunds[0]
    if (ctx.motherNorm.has(normKey(only)) || ctx.managedNorm.has(normKey(only))) {
      return { fof_mother_fund_name: only, fof_sub_fund_name: "", fund_name: "" }
    }
    return { ...empty, fund_name: only }
  }

  if (primary) return { ...empty, fund_name: primary }
  return { ...empty, fund_name: allFunds[0] ?? "" }
}

async function loadFundContext(connectionString: string): Promise<FundContext> {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 600_000,
  })

  try {
    const [mothers, underlyings, managed] = await Promise.all([
      pool.query<{ product_name: string }>(
        `SELECT DISTINCT product_name FROM fof_mom_tracking WHERE NULLIF(BTRIM(product_name), '') IS NOT NULL`,
      ),
      pool.query<{ fof_fund_name: string; product_name: string }>(
        `SELECT DISTINCT fof_fund_name, product_name
         FROM fof_underlying_detail
         WHERE NULLIF(BTRIM(fof_fund_name), '') IS NOT NULL
           AND NULLIF(BTRIM(product_name), '') IS NOT NULL`,
      ),
      pool.query<{ product_name: string }>(
        `SELECT DISTINCT product_name FROM managed_products WHERE NULLIF(BTRIM(product_name), '') IS NOT NULL`,
      ),
    ])

  const motherNames = new Set<string>()
  const motherNorm = new Set<string>()
  for (const row of mothers.rows) {
    const name = normalizeFundDisplayName(row.product_name)
    motherNames.add(name)
    motherNorm.add(normKey(name))
  }

  const managedNames = new Set<string>()
  const managedNorm = new Set<string>()
  for (const row of managed.rows) {
    const name = normalizeFundDisplayName(row.product_name)
    managedNames.add(name)
    managedNorm.add(normKey(name))
  }

  const underlyingToMother = new Map<string, string>()
  for (const row of underlyings.rows) {
    underlyingToMother.set(
      normKey(row.product_name),
      normalizeFundDisplayName(row.fof_fund_name),
    )
  }

  return { motherNames, motherNorm, underlyingToMother, managedNames, managedNorm }
  } finally {
    await pool.end()
  }
}

async function waitForPort(port: number, timeoutMs = 20_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
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

async function resolveAccounts(): Promise<CrawlEmailAccount[]> {
  const accounts: CrawlEmailAccount[] = []
  const missing: string[] = []

  for (const account of TARGET_ACCOUNTS) {
    const row = await getCrawlEmailByAccount(account)
    if (!row) {
      missing.push(account)
      continue
    }
    if (!row.pass?.trim()) {
      missing.push(`${account} (no password)`)
      continue
    }
    accounts.push(row)
  }

  if (missing.length > 0) {
    console.warn("Skipping accounts not found in data/ops_crawl_emails.json:")
    for (const m of missing) console.warn(`  - ${m}`)
  }

  if (accounts.length === 0) {
    throw new Error("No crawl email accounts available. Check the 邮箱同步 settings in the dashboard.")
  }

  return accounts
}

async function scanMailbox(
  account: CrawlEmailAccount,
  ctx: FundContext,
): Promise<CsvRow[]> {
  const client = createSafeImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
    label: account.account,
  })

  const rows: CsvRow[] = []
  const folders = getImapFolders(account)

  await client.connect()
  try {
    for (const folder of folders) {
      let mailbox
      try {
        mailbox = await client.mailboxOpen(folder)
      } catch (err) {
        console.warn(`${account.account}: cannot open folder "${folder}": ${err instanceof Error ? err.message : err}`)
        continue
      }

      const total = mailbox.exists ?? 0
      console.log(`${account.account} / ${folder}: ${total} message(s)`)
      if (total === 0) continue

      const uids = (await client.search({ all: true }, { uid: true })) || []
      let processed = 0

      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      )) {
        processed++
        if (processed % 500 === 0) {
          console.log(`  ${account.account} / ${folder}: ${processed}/${uids.length}`)
        }

        const envelope = (msg as {
          envelope?: { subject?: string; date?: Date; from?: EnvelopeAddress[] }
        }).envelope
        const subject = envelope?.subject ?? ""
        const senderEmail = formatSenderEmail(envelope?.from)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const structure = (msg as any).bodyStructure
        const attachments = structure ? collectAttachments(structure) : []
        const sentAt =
          (msg as { internalDate?: Date }).internalDate
          ?? envelope?.date
          ?? new Date()
        const uid = String((msg as { uid?: number }).uid ?? "")

        const category = classifyEmail(subject, senderEmail, attachments)
        const fundFields = resolveFundFields(subject, category, ctx)

        rows.push({
          receiver_email: account.account,
          sender_email: senderEmail,
          subject,
          sent_at: sentAt.toISOString(),
          imap_folder: folder,
          uid,
          category,
          ...fundFields,
        })
      }
    }
  } finally {
    await closeImapFlow(client)
  }

  return rows
}

function writeCsv(filePath: string, rows: CsvRow[]): void {
  const headers: (keyof CsvRow)[] = [
    "receiver_email",
    "sender_email",
    "subject",
    "sent_at",
    "imap_folder",
    "uid",
    "category",
    "fof_mother_fund_name",
    "fof_sub_fund_name",
    "fund_name",
  ]

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ]
  fs.writeFileSync(filePath, `\uFEFF${lines.join("\n")}\n`, "utf-8")
}

async function main() {
  const { noTunnel, outFile, databaseUrl } = parseArgs()
  let tunnel: ChildProcess | null = null

  const connectionString = dbConnectionString(databaseUrl)

  if (!noTunnel) {
    tunnel = await startSshTunnel()
  } else {
    const ready = await waitForPort(LOCAL_PORT, 3_000)
    if (!ready) {
      throw new Error(
        `--no-tunnel was passed but nothing is listening on localhost:${LOCAL_PORT}. Start the tunnel first.`,
      )
    }
  }

  try {
    console.log("Loading FOF / managed fund context from PostgreSQL …")
    const ctx = await loadFundContext(connectionString)
    console.log(
      `  ${ctx.motherNames.size} mother funds, ${ctx.underlyingToMother.size} underlying mappings, ${ctx.managedNames.size} managed products`,
    )

    const accounts = await resolveAccounts()
    console.log(`Scanning ${accounts.length} mailbox(es) …`)

    const allRows: CsvRow[] = []
    for (const account of accounts) {
      const rows = await scanMailbox(account, ctx)
      console.log(`  ${account.account}: exported ${rows.length} row(s)`)
      allRows.push(...rows)
    }

    allRows.sort((a, b) => a.sent_at.localeCompare(b.sent_at))

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const outputPath = outFile
      ? path.resolve(process.cwd(), outFile)
      : path.join(process.cwd(), `email_classify_export_${stamp}.csv`)

    writeCsv(outputPath, allRows)

    const byCategory = new Map<string, number>()
    for (const row of allRows) {
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1)
    }

    console.log(`\nWrote ${allRows.length} rows to ${outputPath}`)
    console.log("Category breakdown:")
    for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat}: ${count}`)
    }
  } finally {
    if (tunnel && !tunnel.killed) {
      tunnel.kill()
      console.log("SSH tunnel closed.")
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
