import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { ImapFlow } from "imapflow"
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
  crawlStatus: "成功" | "失败" | "未测试"
  remark: string
  createdAt: string
  updatedAt: string
}

export type CrawlEmailPublic = Omit<CrawlEmailAccount, "pass"> & {
  passMasked: string
}

const DATA_FILE = path.join(process.cwd(), "data", "ops_crawl_emails.json")

function readAll(): CrawlEmailAccount[] {
  if (!fs.existsSync(DATA_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as CrawlEmailAccount[]
  } catch {
    return []
  }
}

function writeAll(rows: CrawlEmailAccount[]): void {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf-8")
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
    })
  }

  return [...byAccount.values()]
}

/** Predefined crawl mailboxes that should always appear in the table. */
const KNOWN_CRAWL_ACCOUNTS = [
  {
    account: "ch_c7h8@163.com",
    remark: "净值接收",
    emailType: "163邮箱",
    imapHost: "imap.163.com",
    imapPort: 993,
  },
] as const

/** Ensure known mailboxes exist as table rows (without credentials until imported). */
export function ensureKnownCrawlEmails(): void {
  const rows = readAll()
  const existing = new Set(rows.map((r) => r.account.trim().toLowerCase()))
  let changed = false

  for (const known of KNOWN_CRAWL_ACCOUNTS) {
    if (existing.has(known.account.toLowerCase())) continue
    const now = new Date().toISOString()
    rows.push({
      id: randomUUID(),
      emailType: known.emailType,
      account: known.account,
      pass: "",
      imapHost: known.imapHost,
      imapPort: known.imapPort,
      crawlStatus: "未测试",
      remark: known.remark,
      createdAt: now,
      updatedAt: now,
    })
    existing.add(known.account.toLowerCase())
    changed = true
  }

  if (changed) writeAll(rows)
}

/** Import configured sender/settlement accounts; returns number of rows added or updated. */
export async function syncCrawlEmailsFromConfiguredAccounts(): Promise<number> {
  ensureKnownCrawlEmails()
  let changed = 0

  for (const candidate of collectImportCandidates()) {
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

export async function listCrawlEmailsReady(): Promise<CrawlEmailPublic[]> {
  ensureKnownCrawlEmails()
  await syncCrawlEmailsFromConfiguredAccounts()
  return listCrawlEmails()
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

  const client = new ImapFlow({
    host: imapHost.trim(),
    port: imapPort || 993,
    secure: true,
    auth: { user: account.trim(), pass: pass.trim() },
    logger: false,
  })

  try {
    await client.connect()
    await client.mailboxOpen("INBOX")
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore logout errors
    }
  }
}

export async function createCrawlEmail(input: {
  emailType: string
  account: string
  pass: string
  imapHost: string
  imapPort: number
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
    crawlStatus,
    remark: (input.remark ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  }

  const rows = readAll()
  rows.push(row)
  writeAll(rows)
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
