import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import { resetEmailParseCursor } from "@/lib/server/email-parse-cursor"
import { readSenders } from "@/lib/server/email-dispatch"
import { readConfig as readSettlementEmailConfig } from "@/lib/server/settlement-email"

export const CRAWL_EMAIL_PRESETS = [
  { label: "163邮箱", imapHost: "imap.163.com", imapPort: 993 },
  { label: "QQ邮箱", imapHost: "imap.qq.com", imapPort: 993 },
  { label: "126邮箱", imapHost: "imap.126.com", imapPort: 993 },
  { label: "企业邮箱", imapHost: "imap.exmail.qq.com", imapPort: 993 },
  { label: "其他", imapHost: "", imapPort: 993 },
] as const

export type CrawlEmailAccount = {
  id: string
  emailType: string
  account: string
  pass: string
  imapHost: string
  imapPort: number
  imapFolders: string[]   // IMAP folders to search; defaults to ["INBOX"]
  crawlStatus: "成功" | "失败" | "未测试"
  remark: string
  createdAt: string
  updatedAt: string
}

export type CrawlEmailPublic = Omit<CrawlEmailAccount, "pass"> & {
  passMasked: string
}

/** Return the ordered list of IMAP folders to search for this account. */
export function getImapFolders(account: CrawlEmailAccount): string[] {
  return account.imapFolders?.length ? account.imapFolders : ["INBOX"]
}

const DATA_FILE = path.join(process.cwd(), "data", "ops_crawl_emails.json")

const BACKUP_FILE = DATA_FILE + ".bak"

function tryParseAccounts(raw: string): CrawlEmailAccount[] | null {
  try {
    const rows = JSON.parse(raw) as CrawlEmailAccount[]
    if (!Array.isArray(rows)) return null
    return rows.map((r) => ({
      ...r,
      imapFolders: Array.isArray(r.imapFolders) && r.imapFolders.length ? r.imapFolders : ["INBOX"],
    }))
  } catch {
    return null
  }
}

function readAll(): CrawlEmailAccount[] {
  // Try main file first, fall back to backup if main is corrupt/missing
  for (const filePath of [DATA_FILE, BACKUP_FILE]) {
    if (!fs.existsSync(filePath)) continue
    const rows = tryParseAccounts(fs.readFileSync(filePath, "utf-8"))
    if (rows !== null) return rows
  }
  return []
}

function writeAll(rows: CrawlEmailAccount[]): void {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const json = JSON.stringify(rows, null, 2)
  // Atomic write: write to temp file then rename, keep a backup of previous state
  const tmpFile = DATA_FILE + ".tmp"
  fs.writeFileSync(tmpFile, json, "utf-8")
  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE)
  }
  fs.renameSync(tmpFile, DATA_FILE)
}

export function toPublic(row: CrawlEmailAccount): CrawlEmailPublic {
  const { pass, ...rest } = row
  return { ...rest, passMasked: pass ? "******" : "" }
}

export function listCrawlEmails(): CrawlEmailPublic[] {
  return readAll().map(toPublic)
}

const SMTP_TO_IMAP: Record<string, { emailType: string; imapHost: string; imapPort: number }> = {
  "smtp.163.com": { emailType: "163邮箱", imapHost: "imap.163.com", imapPort: 993 },
  "smtp.qq.com": { emailType: "QQ邮箱", imapHost: "imap.qq.com", imapPort: 993 },
  "smtp.126.com": { emailType: "126邮箱", imapHost: "imap.126.com", imapPort: 993 },
  "smtp.exmail.qq.com": { emailType: "企业邮箱", imapHost: "imap.exmail.qq.com", imapPort: 993 },
}

function inferImapFromSmtpHost(host: string) {
  const key = host.trim().toLowerCase()
  return SMTP_TO_IMAP[key] ?? null
}

function inferImapFromEmailAccount(account: string) {
  const domain = account.split("@")[1]?.toLowerCase() ?? ""
  if (domain === "163.com") return SMTP_TO_IMAP["smtp.163.com"]
  if (domain === "qq.com") return SMTP_TO_IMAP["smtp.qq.com"]
  if (domain === "126.com") return SMTP_TO_IMAP["smtp.126.com"]
  return null
}

type ImportCandidate = {
  account: string
  pass: string
  remark: string
  emailType: string
  imapHost: string
  imapPort: number
  source: string
}

export type ImportableConfiguredEmail = {
  account: string
  remark: string
  emailType: string
  source: string
}

function collectImportCandidates(): ImportCandidate[] {
  const byAccount = new Map<string, ImportCandidate>()

  for (const sender of readSenders()) {
    const account = sender.user?.trim()
    const pass = sender.pass?.trim()
    if (!account || !pass) continue

    const imap = inferImapFromSmtpHost(sender.host) ?? inferImapFromEmailAccount(account)
    if (!imap) continue

    byAccount.set(account.toLowerCase(), {
      account,
      pass,
      remark: sender.name?.trim() || "",
      emailType: imap.emailType,
      imapHost: imap.imapHost,
      imapPort: imap.imapPort,
      source: "自动发邮件",
    })
  }

  const settlement = readSettlementEmailConfig()
  const settlementAccount = settlement.email?.trim()
  const settlementPass = settlement.pass?.trim()
  if (settlementAccount && settlementPass && !byAccount.has(settlementAccount.toLowerCase())) {
    const imapHost = settlement.imapHost?.trim() || "imap.163.com"
    const emailType =
      imapHost.includes("163") ? "163邮箱"
      : imapHost.includes("qq") ? "QQ邮箱"
      : imapHost.includes("126") ? "126邮箱"
      : "其他"
    byAccount.set(settlementAccount.toLowerCase(), {
      account: settlementAccount,
      pass: settlementPass,
      remark: "结算单邮箱",
      emailType,
      imapHost,
      imapPort: settlement.imapPort || 993,
      source: "结算单邮箱",
    })
  }

  return [...byAccount.values()]
}

export function listImportableConfiguredEmails(): ImportableConfiguredEmail[] {
  const existing = new Set(readAll().map((r) => r.account.trim().toLowerCase()))
  return collectImportCandidates()
    .filter((c) => !existing.has(c.account.toLowerCase()))
    .map(({ account, remark, emailType, source }) => ({ account, remark, emailType, source }))
}

/** Import only the selected configured accounts. */
export async function importConfiguredEmails(accounts: string[]): Promise<number> {
  const selected = new Set(accounts.map((a) => a.trim().toLowerCase()).filter(Boolean))
  if (selected.size === 0) return 0

  let changed = 0
  for (const candidate of collectImportCandidates()) {
    if (!selected.has(candidate.account.toLowerCase())) continue

    const existing = getCrawlEmailByAccount(candidate.account)
    if (!existing) {
      await createCrawlEmail(candidate)
      changed++
      continue
    }

    if (!existing.pass && candidate.pass) {
      await updateCrawlEmail(existing.id, {
        pass: candidate.pass,
        remark: candidate.remark || existing.remark,
        emailType: candidate.emailType,
        imapHost: candidate.imapHost,
        imapPort: candidate.imapPort,
      })
      changed++
    }
  }

  return changed
}

export function getCrawlEmailByAccount(account: string): CrawlEmailAccount | null {
  const key = account.trim().toLowerCase()
  return readAll().find((r) => r.account.trim().toLowerCase() === key) ?? null
}

export function getCrawlEmailById(id: string): CrawlEmailAccount | null {
  return readAll().find((r) => r.id === id) ?? null
}

export async function testImapConnection(
  account: string,
  pass: string,
  imapHost: string,
  imapPort: number,
): Promise<void> {
  if (!account.trim() || !pass.trim()) throw new Error("账户或密码不能为空")
  if (!imapHost.trim()) throw new Error("IMAP 服务器不能为空")

  const client = createSafeImapFlow({
    host: imapHost.trim(),
    port: imapPort || 993,
    secure: true,
    auth: { user: account.trim(), pass: pass.trim() },
    logger: false,
    label: account.trim(),
  })

  try {
    await client.connect()
    await client.mailboxOpen("INBOX")
  } finally {
    await closeImapFlow(client)
  }
}

export async function createCrawlEmail(input: {
  emailType: string
  account: string
  pass: string
  imapHost: string
  imapPort: number
  imapFolders?: string[]
  remark?: string
}): Promise<CrawlEmailPublic> {
  let crawlStatus: CrawlEmailAccount["crawlStatus"] = "未测试"
  try {
    await testImapConnection(input.account, input.pass, input.imapHost, input.imapPort)
    crawlStatus = "成功"
  } catch {
    crawlStatus = "失败"
  }

  const now = new Date().toISOString()
  const row: CrawlEmailAccount = {
    id: randomUUID(),
    emailType: input.emailType.trim(),
    account: input.account.trim(),
    pass: input.pass.trim(),
    imapHost: input.imapHost.trim(),
    imapPort: input.imapPort || 993,
    imapFolders: input.imapFolders?.length ? input.imapFolders : ["INBOX"],
    crawlStatus,
    remark: (input.remark ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  }

  const rows = readAll()
  rows.push(row)
  writeAll(rows)
  resetEmailParseCursor(row.account)
  return toPublic(row)
}

export async function updateCrawlEmail(
  id: string,
  patch: Partial<{
    emailType: string
    account: string
    pass: string
    imapHost: string
    imapPort: number
    imapFolders: string[]
    remark: string
  }>,
): Promise<CrawlEmailPublic | null> {
  const rows = readAll()
  const idx = rows.findIndex((r) => r.id === id)
  if (idx === -1) return null

  const current = rows[idx]
  const next: CrawlEmailAccount = {
    ...current,
    ...("emailType" in patch && patch.emailType !== undefined ? { emailType: patch.emailType.trim() } : {}),
    ...("account" in patch && patch.account !== undefined ? { account: patch.account.trim() } : {}),
    ...("pass" in patch && patch.pass !== undefined && patch.pass.trim() ? { pass: patch.pass.trim() } : {}),
    ...("imapHost" in patch && patch.imapHost !== undefined ? { imapHost: patch.imapHost.trim() } : {}),
    ...("imapPort" in patch && patch.imapPort !== undefined ? { imapPort: patch.imapPort } : {}),
    ...("imapFolders" in patch && Array.isArray(patch.imapFolders)
      ? { imapFolders: patch.imapFolders.length ? patch.imapFolders : ["INBOX"] }
      : {}),
    ...("remark" in patch && patch.remark !== undefined ? { remark: patch.remark.trim() } : {}),
    updatedAt: new Date().toISOString(),
  }

  const shouldRetest =
    ("account" in patch && patch.account !== undefined) ||
    ("pass" in patch && patch.pass !== undefined && patch.pass.trim()) ||
    ("imapHost" in patch && patch.imapHost !== undefined) ||
    ("imapPort" in patch && patch.imapPort !== undefined)

  if (shouldRetest) {
    try {
      await testImapConnection(next.account, next.pass, next.imapHost, next.imapPort)
      next.crawlStatus = "成功"
    } catch {
      next.crawlStatus = "失败"
    }
  }

  rows[idx] = next
  writeAll(rows)
  return toPublic(next)
}

export function deleteCrawlEmail(id: string): boolean {
  const rows = readAll()
  const filtered = rows.filter((r) => r.id !== id)
  if (filtered.length === rows.length) return false
  writeAll(filtered)
  return true
}
