/**
 * Crawl-email account management backed by PostgreSQL.
 *
 * The table `ops_crawl_email_accounts` is auto-created on first use.
 * On first use we also migrate any existing rows from the legacy
 * `data/ops_crawl_emails.json` file so no data is lost.
 *
 * Storing accounts in the shared DB (instead of a local JSON file) means
 * every team member's machine and the production server see the same list.
 */

import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { publicQuery } from "@/lib/db"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import { resetEmailParseCursor } from "@/lib/server/email-parse-cursor"
import { readSenders } from "@/lib/server/email-dispatch"
import { readConfig as readSettlementEmailConfig } from "@/lib/server/settlement-email"
import { getServerStoragePath } from "@/lib/server/storage"

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
  imapFolders: string[]
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

// ---------------------------------------------------------------------------
// DDL — auto-created on first use
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_crawl_email_accounts (
    id            TEXT        PRIMARY KEY,
    email_type    TEXT        NOT NULL DEFAULT '',
    account       TEXT        NOT NULL,
    pass          TEXT        NOT NULL DEFAULT '',
    imap_host     TEXT        NOT NULL DEFAULT '',
    imap_port     INTEGER     NOT NULL DEFAULT 993,
    imap_folders  TEXT[]      NOT NULL DEFAULT ARRAY['INBOX'],
    crawl_status  TEXT        NOT NULL DEFAULT '未测试',
    remark        TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ops_crawl_email_accounts_account_unique UNIQUE (account)
  );
`

let tableReady = false

async function ensureTable(): Promise<void> {
  if (tableReady) return
  await publicQuery(CREATE_TABLE_SQL)
  // Legacy JSON can contain stale / colliding ids. Never fail page loads on it —
  // the DB is the source of truth once the table exists.
  try {
    await migrateFromJson()
  } catch (err) {
    console.error("[crawl-emails] JSON migration skipped:", err)
  }
  tableReady = true
}

// ---------------------------------------------------------------------------
// One-time migration from the legacy JSON file
// ---------------------------------------------------------------------------

const LEGACY_JSON = path.join(process.cwd(), "data", "ops_crawl_emails.json")
const LEGACY_BACKUP = LEGACY_JSON + ".bak"

function durableJsonPaths(): string[] {
  return [LEGACY_JSON, LEGACY_BACKUP, getServerStoragePath("ops_crawl_emails.json")]
}

function readLegacyRows(filePath: string): LegacyRow[] {
  if (!fs.existsSync(filePath)) return []
  try {
    const rows = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function mergeLegacyRows(sources: LegacyRow[][]): LegacyRow[] {
  const byAccount = new Map<string, LegacyRow>()
  for (const rows of sources) {
    for (const row of rows) {
      const account = row.account?.trim()
      if (!account) continue
      const key = account.toLowerCase()
      const prev = byAccount.get(key)
      if (!prev) {
        byAccount.set(key, row)
        continue
      }
      const prevPass = (prev.pass ?? "").trim()
      const nextPass = (row.pass ?? "").trim()
      const prevUpdated = Date.parse(prev.updatedAt ?? "") || 0
      const nextUpdated = Date.parse(row.updatedAt ?? "") || 0
      if ((!prevPass && nextPass) || nextUpdated >= prevUpdated) {
        byAccount.set(key, { ...prev, ...row, pass: nextPass || prevPass })
      }
    }
  }
  return [...byAccount.values()]
}

type LegacyRow = {
  id?: string
  emailType?: string
  account?: string
  pass?: string
  imapHost?: string
  imapPort?: number
  imapFolders?: string[]
  crawlStatus?: string
  remark?: string
  createdAt?: string
  updatedAt?: string
}

async function persistLegacyCopies(accounts: CrawlEmailAccount[]): Promise<void> {
  const json = JSON.stringify(accounts, null, 2)
  for (const filePath of [LEGACY_JSON, getServerStoragePath("ops_crawl_emails.json")]) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const tmp = filePath + ".tmp"
      fs.writeFileSync(tmp, json, "utf-8")
      if (filePath === LEGACY_JSON && fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, LEGACY_BACKUP)
      }
      fs.renameSync(tmp, filePath)
    } catch {
      // Storage dir may be missing locally; DB remains the source of truth.
    }
  }
}

async function loadAccountsFromDb(): Promise<CrawlEmailAccount[]> {
  const { rows } = await publicQuery(
    `SELECT * FROM ops_crawl_email_accounts ORDER BY created_at ASC`,
  )
  return (rows as DbRow[]).map(rowToAccount)
}

async function migrateFromJson(): Promise<void> {
  const rows = mergeLegacyRows(durableJsonPaths().map(readLegacyRows))
  if (rows.length === 0) return

  const existing = await loadAccountsFromDb()
  const existingIds = new Set(existing.map((a) => a.id))
  const existingAccounts = new Set(existing.map((a) => a.account.trim().toLowerCase()))

  for (const r of rows) {
    const account = r.account?.trim()
    if (!account) continue
    if (existingAccounts.has(account.toLowerCase())) continue

    // JSON copies from several machines can reuse the same id for different
    // accounts. ON CONFLICT (account) does not cover that, and the insert
    // then violates ops_crawl_email_accounts_pkey.
    let id = r.id || randomUUID()
    if (existingIds.has(id)) id = randomUUID()

    const folders = Array.isArray(r.imapFolders) && r.imapFolders.length ? r.imapFolders : ["INBOX"]
    const now = new Date().toISOString()
    await publicQuery(
      `INSERT INTO ops_crawl_email_accounts
         (id, email_type, account, pass, imap_host, imap_port, imap_folders,
          crawl_status, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      [
        id,
        (r.emailType ?? "").trim(),
        account,
        (r.pass ?? "").trim(),
        (r.imapHost ?? "").trim(),
        r.imapPort ?? 993,
        folders,
        r.crawlStatus ?? "未测试",
        (r.remark ?? "").trim(),
        r.createdAt ?? now,
        r.updatedAt ?? now,
      ],
    )
    existingIds.add(id)
    existingAccounts.add(account.toLowerCase())
  }
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

type DbRow = {
  id: string
  email_type: string
  account: string
  pass: string
  imap_host: string
  imap_port: number | string
  imap_folders: string[]
  crawl_status: string
  remark: string
  created_at: string | Date
  updated_at: string | Date
}

function rowToAccount(r: DbRow): CrawlEmailAccount {
  const folders = Array.isArray(r.imap_folders) && r.imap_folders.length ? r.imap_folders : ["INBOX"]
  return {
    id: r.id,
    emailType: r.email_type,
    account: r.account,
    pass: r.pass,
    imapHost: r.imap_host,
    imapPort: Number(r.imap_port) || 993,
    imapFolders: folders,
    crawlStatus: (r.crawl_status as CrawlEmailAccount["crawlStatus"]) ?? "未测试",
    remark: r.remark,
    createdAt: typeof r.created_at === "string" ? r.created_at : (r.created_at as Date).toISOString(),
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : (r.updated_at as Date).toISOString(),
  }
}

export function toPublic(row: CrawlEmailAccount): CrawlEmailPublic {
  const { pass, ...rest } = row
  return { ...rest, passMasked: pass ? "******" : "" }
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

export async function listCrawlEmails(): Promise<CrawlEmailPublic[]> {
  await ensureTable()
  const { rows } = await publicQuery(
    `SELECT * FROM ops_crawl_email_accounts ORDER BY created_at ASC`,
  )
  return (rows as DbRow[]).map((r) => toPublic(rowToAccount(r)))
}

export async function getCrawlEmailByAccount(account: string): Promise<CrawlEmailAccount | null> {
  await ensureTable()
  const { rows } = await publicQuery(
    `SELECT * FROM ops_crawl_email_accounts WHERE lower(btrim(account)) = lower(btrim($1))`,
    [account],
  )
  return rows.length ? rowToAccount(rows[0] as DbRow) : null
}

export async function getCrawlEmailById(id: string): Promise<CrawlEmailAccount | null> {
  await ensureTable()
  const { rows } = await publicQuery(
    `SELECT * FROM ops_crawl_email_accounts WHERE id = $1`,
    [id],
  )
  return rows.length ? rowToAccount(rows[0] as DbRow) : null
}

// ---------------------------------------------------------------------------
// IMAP connection test
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createCrawlEmail(input: {
  emailType: string
  account: string
  pass: string
  imapHost: string
  imapPort: number
  imapFolders?: string[]
  remark?: string
}): Promise<CrawlEmailPublic> {
  await ensureTable()

  let crawlStatus: CrawlEmailAccount["crawlStatus"] = "未测试"
  try {
    await testImapConnection(input.account, input.pass, input.imapHost, input.imapPort)
    crawlStatus = "成功"
  } catch {
    crawlStatus = "失败"
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  const folders = input.imapFolders?.length ? input.imapFolders : ["INBOX"]

  const { rows } = await publicQuery(
    `INSERT INTO ops_crawl_email_accounts
       (id, email_type, account, pass, imap_host, imap_port, imap_folders,
        crawl_status, remark, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (account) DO NOTHING
     RETURNING *`,
    [
      id,
      input.emailType.trim(),
      input.account.trim(),
      input.pass.trim(),
      input.imapHost.trim(),
      input.imapPort || 993,
      folders,
      crawlStatus,
      (input.remark ?? "").trim(),
      now,
      now,
    ],
  )

  if (!rows.length) throw new Error(`抓取邮箱已存在: ${input.account}`)

  const account = rowToAccount(rows[0] as DbRow)
  resetEmailParseCursor(account.account)
  await persistLegacyCopies(await loadAccountsFromDb())
  return toPublic(account)
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
  await ensureTable()
  const existing = await getCrawlEmailById(id)
  if (!existing) return null

  const next: CrawlEmailAccount = {
    ...existing,
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
    ("pass" in patch && patch.pass !== undefined && patch.pass.trim() !== "") ||
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

  const { rows } = await publicQuery(
    `UPDATE ops_crawl_email_accounts SET
       email_type   = $1,
       account      = $2,
       pass         = $3,
       imap_host    = $4,
       imap_port    = $5,
       imap_folders = $6,
       crawl_status = $7,
       remark       = $8,
       updated_at   = $9
     WHERE id = $10
     RETURNING *`,
    [
      next.emailType,
      next.account,
      next.pass,
      next.imapHost,
      next.imapPort,
      next.imapFolders,
      next.crawlStatus,
      next.remark,
      next.updatedAt,
      id,
    ],
  )

  if (!rows.length) return null
  await persistLegacyCopies(await loadAccountsFromDb())
  return toPublic(rowToAccount(rows[0] as DbRow))
}

/**
 * Upsert a crawl-email account into the DB, including its password.
 * Called after every successful mailbox fetch so that credentials added on any
 * machine are automatically persisted to the shared DB for all other machines.
 * Uses ON CONFLICT (account) DO UPDATE so it is safe to call repeatedly.
 */
export async function persistCrawlEmailAccount(account: CrawlEmailAccount): Promise<void> {
  await ensureTable()
  await publicQuery(
    `INSERT INTO ops_crawl_email_accounts
       (id, email_type, account, pass, imap_host, imap_port, imap_folders,
        crawl_status, remark, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'成功',$8,$9,NOW())
     ON CONFLICT (account) DO UPDATE SET
       pass         = EXCLUDED.pass,
       imap_host    = EXCLUDED.imap_host,
       imap_port    = EXCLUDED.imap_port,
       imap_folders = EXCLUDED.imap_folders,
       crawl_status = '成功',
       updated_at   = NOW()`,
    [
      account.id,
      account.emailType,
      account.account.trim(),
      account.pass.trim(),
      account.imapHost.trim(),
      account.imapPort || 993,
      account.imapFolders?.length ? account.imapFolders : ["INBOX"],
      account.remark,
      account.createdAt,
    ],
  )
}

export async function deleteCrawlEmail(id: string): Promise<boolean> {
  await ensureTable()
  const res = await publicQuery(
    `DELETE FROM ops_crawl_email_accounts WHERE id = $1 RETURNING id`,
    [id],
  )
  if (res.rows.length > 0) await persistLegacyCopies(await loadAccountsFromDb())
  return res.rows.length > 0
}

// ---------------------------------------------------------------------------
// Import from other configured email sources (SMTP senders / settlement email)
// ---------------------------------------------------------------------------

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

export async function listImportableConfiguredEmails(): Promise<ImportableConfiguredEmail[]> {
  await ensureTable()
  const { rows: existing } = await publicQuery(
    `SELECT lower(btrim(account)) AS account FROM ops_crawl_email_accounts`,
  )
  const existingSet = new Set(existing.map((r) => String(r.account)))
  return collectImportCandidates()
    .filter((c) => !existingSet.has(c.account.toLowerCase()))
    .map(({ account, remark, emailType, source }) => ({ account, remark, emailType, source }))
}

export async function importConfiguredEmails(accounts: string[]): Promise<number> {
  const selected = new Set(accounts.map((a) => a.trim().toLowerCase()).filter(Boolean))
  if (selected.size === 0) return 0

  let changed = 0
  for (const candidate of collectImportCandidates()) {
    if (!selected.has(candidate.account.toLowerCase())) continue

    const existing = await getCrawlEmailByAccount(candidate.account)
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
