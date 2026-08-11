/**
 * Maps each 抓取邮箱 (crawl email account) to the login user who may see
 * products fetched from that mailbox in 直投产品 / 邮箱运维池.
 *
 * - Admin (role === "admin") always sees every product.
 * - When an email is linked to a user, only that user (+ admin) sees its products.
 * - Unmapped emails remain visible to everyone (preserves prior shared-pool behaviour).
 */

import fs from "fs"
import path from "path"
import { query } from "@/lib/db"
import { listCrawlEmails } from "@/lib/server/crawl-emails"
import { getUserById } from "@/lib/server/users"
import { EMAIL_OPS_POOL_KEY } from "@/lib/server/email-tracking-pool-sync"

/** True for real mailbox addresses; excludes sentinels like team_manual_upload. */
function isMailboxAccount(account: string): boolean {
  const a = account.trim().toLowerCase()
  return a.includes("@") && !a.includes(" ")
}

/**
 * Crawl mailboxes known to the system: configured IMAP accounts plus any
 * address that has already produced NAV / valuation rows. Config-only reads
 * can miss mailboxes that were removed from ops_crawl_emails.json (or lost
 * in a concurrent write) while their products remain in the pool.
 */
async function listKnownCrawlEmailAccounts(): Promise<string[]> {
  const fromConfig = listCrawlEmails()
    .map((e) => e.account.trim().toLowerCase())
    .filter(isMailboxAccount)

  const fromDbSql = `
    SELECT DISTINCT lower(btrim(crawl_email_account)) AS account
    FROM (
      SELECT crawl_email_account FROM ops_email_nav_records
      UNION ALL
      SELECT crawl_email_account FROM ops_email_valuation_records
    ) t
    WHERE crawl_email_account IS NOT NULL
      AND btrim(crawl_email_account) <> ''
      AND position('@' in crawl_email_account) > 0`

  const fromDbNavOnlySql = `
    SELECT DISTINCT lower(btrim(crawl_email_account)) AS account
    FROM ops_email_nav_records
    WHERE crawl_email_account IS NOT NULL
      AND btrim(crawl_email_account) <> ''
      AND position('@' in crawl_email_account) > 0`

  const dbRows = await query<{ account: string }>(fromDbSql).catch(() =>
    query<{ account: string }>(fromDbNavOnlySql).catch(() => []),
  )

  const set = new Set<string>(fromConfig)
  for (const row of dbRows) {
    const a = String(row.account || "").trim().toLowerCase()
    if (isMailboxAccount(a)) set.add(a)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export type DirectEmailVisibilityMapping = {
  /** Crawl mailbox address, lowercased */
  crawlEmailAccount: string
  /** auth_users.id, or "" for unmapped / visible to all */
  userId: string
  /** Display name snapshot for UI */
  userName: string
  updatedAt: string
}

type Store = {
  mappings: DirectEmailVisibilityMapping[]
  updatedAt: string | null
}

const DATA_FILE = path.join(process.cwd(), "data", "ops_direct_email_visibility.json")
const BACKUP_FILE = DATA_FILE + ".bak"

function emptyStore(): Store {
  return { mappings: [], updatedAt: null }
}

function tryParseStore(raw: string): Store | null {
  try {
    const parsed = JSON.parse(raw) as Store
    if (!parsed || !Array.isArray(parsed.mappings)) return null
    return {
      mappings: parsed.mappings
        .filter((m) => m && typeof m.crawlEmailAccount === "string")
        .map((m) => ({
          crawlEmailAccount: String(m.crawlEmailAccount).trim().toLowerCase(),
          userId: typeof m.userId === "string" ? m.userId.trim() : "",
          userName: typeof m.userName === "string" ? m.userName.trim() : "",
          updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : new Date().toISOString(),
        })),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    }
  } catch {
    return null
  }
}

function readStore(): Store {
  for (const filePath of [DATA_FILE, BACKUP_FILE]) {
    if (!fs.existsSync(filePath)) continue
    const parsed = tryParseStore(fs.readFileSync(filePath, "utf-8"))
    if (parsed) return parsed
  }
  return emptyStore()
}

function writeStore(store: Store): void {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const json = JSON.stringify(store, null, 2)
  const tmpFile = DATA_FILE + ".tmp"
  fs.writeFileSync(tmpFile, json, "utf-8")
  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE)
  }
  fs.renameSync(tmpFile, DATA_FILE)
}

/** Mapping keyed by lowercased crawl email account. */
export function readDirectEmailVisibilityMap(): Map<string, DirectEmailVisibilityMapping> {
  const store = readStore()
  const map = new Map<string, DirectEmailVisibilityMapping>()
  for (const row of store.mappings) {
    if (!row.crawlEmailAccount) continue
    map.set(row.crawlEmailAccount, row)
  }
  return map
}

/**
 * List rows for the settings UI: every known crawl mailbox, with current visibility link.
 */
export async function listDirectEmailVisibilityRows(): Promise<DirectEmailVisibilityMapping[]> {
  const map = readDirectEmailVisibilityMap()
  const now = new Date().toISOString()
  const accounts = await listKnownCrawlEmailAccounts()
  return accounts.map((key) => {
    const existing = map.get(key)
    return (
      existing ?? {
        crawlEmailAccount: key,
        userId: "",
        userName: "",
        updatedAt: now,
      }
    )
  })
}

export async function saveDirectEmailVisibilityMappings(
  updates: { crawlEmailAccount: string; userId: string; userName?: string }[],
): Promise<DirectEmailVisibilityMapping[]> {
  const map = readDirectEmailVisibilityMap()
  const now = new Date().toISOString()
  for (const u of updates) {
    const key = String(u.crawlEmailAccount || "").trim().toLowerCase()
    if (!key || !isMailboxAccount(key)) continue
    const userId = String(u.userId || "").trim()
    map.set(key, {
      crawlEmailAccount: key,
      userId,
      userName: userId ? String(u.userName || "").trim() : "",
      updatedAt: now,
    })
  }
  const store: Store = {
    mappings: Array.from(map.values()).sort((a, b) =>
      a.crawlEmailAccount.localeCompare(b.crawlEmailAccount),
    ),
    updatedAt: now,
  }
  writeStore(store)
  return listDirectEmailVisibilityRows()
}

/**
 * Resolve which crawl emails the user may see.
 * Returns null when no filter should be applied (admin, or no restrictive mappings).
 */
export async function resolveAllowedCrawlEmailsForUser(opts: {
  userId: string
  isAdmin: boolean
}): Promise<string[] | null> {
  if (opts.isAdmin) return null

  const map = readDirectEmailVisibilityMap()
  const restrictive = Array.from(map.values()).filter((m) => m.userId)
  if (restrictive.length === 0) return null

  const crawlAccounts = await listKnownCrawlEmailAccounts()
  const allowed = new Set<string>()
  for (const account of crawlAccounts) {
    const link = map.get(account)
    if (!link?.userId) {
      // Unmapped → visible to everyone
      allowed.add(account)
    } else if (link.userId === opts.userId) {
      allowed.add(account)
    }
  }
  return Array.from(allowed)
}

/**
 * Register numbers in the email ops pool that were fetched from any of the given crawl mailboxes.
 */
export async function resolveEmailPoolRegistersForCrawlEmails(
  crawlEmails: string[],
): Promise<string[]> {
  const emails = Array.from(
    new Set(
      crawlEmails
        .map((e) => String(e || "").trim().toLowerCase())
        .filter(isMailboxAccount),
    ),
  )
  if (emails.length === 0) return []

  // Match pool membership against email NAV / valuation provenance (code or fund name).
  const sql = `
    WITH email_keys AS (
      SELECT
        NULLIF(UPPER(BTRIM(product_code)), '') AS code,
        NULLIF(BTRIM(fund_name), '') AS fund_name
      FROM ops_email_nav_records
      WHERE lower(BTRIM(crawl_email_account)) = ANY($1::text[])
      UNION
      SELECT
        NULLIF(UPPER(BTRIM(product_code)), '') AS code,
        NULLIF(BTRIM(fund_name), '') AS fund_name
      FROM ops_email_valuation_records
      WHERE lower(BTRIM(crawl_email_account)) = ANY($1::text[])
    )
    SELECT DISTINCT p.register_number
    FROM user_custom_pool p
    WHERE p.pool_key = $2
      AND p.register_number IS NOT NULL
      AND (
        UPPER(BTRIM(p.register_number)) IN (SELECT code FROM email_keys WHERE code IS NOT NULL)
        OR EXISTS (
          SELECT 1 FROM email_keys e
          WHERE e.fund_name IS NOT NULL
            AND e.fund_name = p.product_name
        )
      )`

  const navOnlySql = `
    WITH email_keys AS (
      SELECT
        NULLIF(UPPER(BTRIM(product_code)), '') AS code,
        NULLIF(BTRIM(fund_name), '') AS fund_name
      FROM ops_email_nav_records
      WHERE lower(BTRIM(crawl_email_account)) = ANY($1::text[])
    )
    SELECT DISTINCT p.register_number
    FROM user_custom_pool p
    WHERE p.pool_key = $2
      AND p.register_number IS NOT NULL
      AND (
        UPPER(BTRIM(p.register_number)) IN (SELECT code FROM email_keys WHERE code IS NOT NULL)
        OR EXISTS (
          SELECT 1 FROM email_keys e
          WHERE e.fund_name IS NOT NULL
            AND e.fund_name = p.product_name
        )
      )`

  const rows = await query<{ register_number: string }>(sql, [emails, EMAIL_OPS_POOL_KEY]).catch(
    () => query<{ register_number: string }>(navOnlySql, [emails, EMAIL_OPS_POOL_KEY]),
  )

  return rows.map((r) => r.register_number)
}

/**
 * Register numbers (备案号) visible to the user inside the email-sourced pool.
 * null → no filter (show all pool rows).
 */
export async function resolveVisibleEmailPoolRegistersForUser(opts: {
  userId: string
  isAdmin?: boolean
}): Promise<string[] | null> {
  let isAdmin = opts.isAdmin
  if (isAdmin === undefined) {
    const user = await getUserById(opts.userId)
    isAdmin = user?.role === "admin"
  }
  const allowedEmails = await resolveAllowedCrawlEmailsForUser({
    userId: opts.userId,
    isAdmin: !!isAdmin,
  })
  if (allowedEmails === null) return null
  if (allowedEmails.length === 0) return []
  return resolveEmailPoolRegistersForCrawlEmails(allowedEmails)
}

export async function requireAdminUser(req: Request): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }
> {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return { ok: false, status: 401, error: "未登录" }
  const user = await getUserById(userId)
  if (!user) return { ok: false, status: 401, error: "用户不存在" }
  if (user.role !== "admin") return { ok: false, status: 403, error: "仅系统管理员可操作" }
  return { ok: true, userId }
}
