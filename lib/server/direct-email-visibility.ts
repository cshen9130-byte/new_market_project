/**
 * Maps each 抓取邮箱 (crawl email account) to the login users who may see
 * products fetched from that mailbox in 直投产品. 邮箱运维池 is not filtered.
 *
 * - `hidden` (or sentinel userId) means 全部账户不可见 — nobody sees it, including admin.
 * - When an email is linked to one or more users, only those users (+ admin) see its products.
 * - Explicit empty `userIds` (not hidden) means 全部账户可见.
 * - Mailboxes not yet saved in the store default to 全部账户不可见.
 */

import fs from "fs"
import path from "path"
import { query } from "@/lib/db"
import { listCrawlEmails } from "@/lib/server/crawl-emails"
import { getUserById } from "@/lib/server/users"
import { EMAIL_OPS_POOL_KEY } from "@/lib/server/email-tracking-pool-sync"
import { SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF } from "@/lib/server/fund-holding-code"

/** True for real mailbox addresses; excludes sentinels like team_manual_upload. */
function isMailboxAccount(account: string): boolean {
  const a = account.trim().toLowerCase()
  return a.includes("@") && !a.includes(" ")
}

const CRAWL_OR_RECEIVER_MATCH = `
  (
    lower(BTRIM(crawl_email_account)) = ANY($1::text[])
    OR EXISTS (
      SELECT 1 FROM unnest($1::text[]) sel
      WHERE NULLIF(btrim(sel), '') IS NOT NULL
        AND position(lower(btrim(sel)) in lower(COALESCE(receiver_email, ''))) > 0
    )
  )
`

/**
 * Crawl mailboxes known to the system: configured IMAP accounts plus any
 * address that has already produced NAV / valuation rows. Config-only reads
 * can miss mailboxes that were removed from ops_crawl_emails.json (or lost
 * in a concurrent write) while their products remain in the pool.
 */
async function listKnownCrawlEmailAccounts(): Promise<string[]> {
  const cached = global._knownCrawlEmailsCache
  if (cached && Date.now() - cached.at < KNOWN_CRAWL_EMAILS_TTL_MS) {
    return cached.value
  }

  const fromConfig = (await listCrawlEmails())
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
  const value = Array.from(set).sort((a, b) => a.localeCompare(b))
  global._knownCrawlEmailsCache = { at: Date.now(), value }
  return value
}

/** Stored in `userId` so older readers treat hidden mailboxes as unmatched. */
export const HIDDEN_VISIBILITY_SENTINEL = "__none__"

export type DirectEmailVisibilityMapping = {
  /** Crawl mailbox address, lowercased */
  crawlEmailAccount: string
  /** First linked auth_users.id, "" for 全部账户可见, or HIDDEN_VISIBILITY_SENTINEL */
  userId: string
  /** Display name snapshot for the first linked user */
  userName: string
  /** All linked auth_users.id values. Empty when visible-to-all or hidden. */
  userIds: string[]
  /** Display name snapshots aligned with userIds */
  userNames: string[]
  /** True = 全部账户不可见 (nobody, including admin, can see this mailbox). */
  hidden: boolean
  updatedAt: string
}

type Store = {
  mappings: DirectEmailVisibilityMapping[]
  updatedAt: string | null
}

const DATA_FILE = path.join(process.cwd(), "data", "ops_direct_email_visibility.json")
const BACKUP_FILE = DATA_FILE + ".bak"

const KNOWN_CRAWL_EMAILS_TTL_MS = 60_000
const VISIBLE_REGISTERS_TTL_MS = 60_000

declare global {
  // eslint-disable-next-line no-var
  var _knownCrawlEmailsCache: { at: number; value: string[] } | undefined
  // eslint-disable-next-line no-var
  var _emailPoolVisibilityCache: Map<string, { at: number; value: string[] | null }> | undefined
}

function emptyStore(): Store {
  return { mappings: [], updatedAt: null }
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const v = id.trim()
    if (!v || v === HIDDEN_VISIBILITY_SENTINEL || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function parseIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return uniqueIds(raw.map((x) => String(x ?? "")))
}

function parseNameList(raw: unknown, len: number): string[] {
  if (!Array.isArray(raw)) return Array.from({ length: len }, () => "")
  return Array.from({ length: len }, (_, i) => {
    const v = raw[i]
    return typeof v === "string" ? v.trim() : ""
  })
}

function normalizeMapping(raw: {
  crawlEmailAccount?: unknown
  userId?: unknown
  userName?: unknown
  userIds?: unknown
  userNames?: unknown
  hidden?: unknown
  updatedAt?: unknown
}): DirectEmailVisibilityMapping | null {
  const crawlEmailAccount = String(raw?.crawlEmailAccount || "").trim().toLowerCase()
  if (!crawlEmailAccount) return null
  const hidden =
    raw?.hidden === true || String(raw?.userId || "").trim() === HIDDEN_VISIBILITY_SENTINEL
  let userIds = parseIdList(raw?.userIds)
  const legacyId = String(raw?.userId || "").trim()
  if (userIds.length === 0 && legacyId && legacyId !== HIDDEN_VISIBILITY_SENTINEL) {
    userIds = [legacyId]
  }
  if (hidden) userIds = []
  const userNames = parseNameList(raw?.userNames, userIds.length)
  if (userIds.length > 0 && !userNames[0]) {
    const legacyName = typeof raw?.userName === "string" ? raw.userName.trim() : ""
    if (legacyName) userNames[0] = legacyName
  }
  return {
    crawlEmailAccount,
    userId: hidden ? HIDDEN_VISIBILITY_SENTINEL : userIds[0] || "",
    userName: hidden ? "" : userNames[0] || (typeof raw?.userName === "string" ? raw.userName.trim() : ""),
    userIds,
    userNames,
    hidden,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  }
}

function tryParseStore(raw: string): Store | null {
  try {
    const parsed = JSON.parse(raw) as Store
    if (!parsed || !Array.isArray(parsed.mappings)) return null
    return {
      mappings: parsed.mappings
        .map((m) => normalizeMapping(m))
        .filter((m): m is DirectEmailVisibilityMapping => !!m),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    }
  } catch {
    return null
  }
}

function linkedUserIds(link: DirectEmailVisibilityMapping): string[] {
  if (link.hidden || link.userId === HIDDEN_VISIBILITY_SENTINEL) return []
  if (Array.isArray(link.userIds) && link.userIds.length > 0) return uniqueIds(link.userIds)
  if (link.userId) return uniqueIds([link.userId])
  return []
}

/** Visibility policy for a known mailbox. Unsaved (not in store) defaults to hidden. */
export function visibilityMode(
  link: DirectEmailVisibilityMapping | undefined,
): "all" | "none" | "users" {
  if (!link) return "none"
  if (link.hidden || link.userId === HIDDEN_VISIBILITY_SENTINEL) return "none"
  return linkedUserIds(link).length > 0 ? "users" : "all"
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

function hiddenDefaultRow(account: string, now: string): DirectEmailVisibilityMapping {
  return {
    crawlEmailAccount: account,
    userId: HIDDEN_VISIBILITY_SENTINEL,
    userName: "",
    userIds: [],
    userNames: [],
    hidden: true,
    updatedAt: now,
  }
}

/**
 * List rows for the settings UI: every known crawl mailbox, with current visibility link.
 * Mailboxes not yet saved default to 全部账户不可见.
 */
export async function listDirectEmailVisibilityRows(): Promise<DirectEmailVisibilityMapping[]> {
  const map = readDirectEmailVisibilityMap()
  const now = new Date().toISOString()
  const accounts = await listKnownCrawlEmailAccounts()
  return accounts.map((key) => map.get(key) ?? hiddenDefaultRow(key, now))
}

export async function saveDirectEmailVisibilityMappings(
  updates: {
    crawlEmailAccount: string
    userId?: string
    userIds?: string[]
    userName?: string
    userNames?: string[]
    hidden?: boolean
  }[],
): Promise<DirectEmailVisibilityMapping[]> {
  const map = readDirectEmailVisibilityMap()
  const now = new Date().toISOString()
  for (const u of updates) {
    const key = String(u.crawlEmailAccount || "").trim().toLowerCase()
    if (!key || !isMailboxAccount(key)) continue
    const normalized = normalizeMapping({ ...u, crawlEmailAccount: key, updatedAt: now })
    if (!normalized) continue
    map.set(key, normalized)
  }
  const store: Store = {
    mappings: Array.from(map.values()).sort((a, b) =>
      a.crawlEmailAccount.localeCompare(b.crawlEmailAccount),
    ),
    updatedAt: now,
  }
  writeStore(store)
  invalidateDirectEmailVisibilityCaches()
  return listDirectEmailVisibilityRows()
}

export function invalidateDirectEmailVisibilityCaches(): void {
  global._knownCrawlEmailsCache = undefined
  global._emailPoolVisibilityCache = undefined
}

/**
 * Resolve which crawl emails the user may see.
 * Returns null when no filter should be applied (every mailbox is 全部账户可见).
 * Hidden mailboxes stay hidden for everyone, including admin.
 */
export async function resolveAllowedCrawlEmailsForUser(opts: {
  userId: string
  isAdmin: boolean
}): Promise<string[] | null> {
  const map = readDirectEmailVisibilityMap()
  const crawlAccounts = await listKnownCrawlEmailAccounts()
  const allowed = new Set<string>()
  let hasRestriction = false
  for (const account of crawlAccounts) {
    const link = map.get(account)
    const mode = visibilityMode(link)
    if (mode === "all") {
      allowed.add(account)
      continue
    }
    if (mode === "none") {
      hasRestriction = true
      continue
    }
    if (opts.isAdmin || (link && linkedUserIds(link).includes(opts.userId))) {
      allowed.add(account)
    } else {
      hasRestriction = true
    }
  }
  if (!hasRestriction) return null
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
  // A filter chip can be the IMAP mailbox (crawl_email_account) or a To/Cc address
  // on mail that landed in another crawled mailbox (e.g. cwsj@hengyifund.cn in ch_c7h8).
  // FOF底层 NAV often comes from the parent FOF 估值表; include those holdings too.
  const fofHoldingKeysSql = `
      UNION
      SELECT
        NULLIF(UPPER(BTRIM(m.underlying_product_code)), '') AS code,
        NULLIF(BTRIM(m.underlying_name), '') AS fund_name
      FROM ops_managed_fof_underlying m
      JOIN ops_email_valuation_records v ON v.id = m.valuation_record_id
      WHERE (
        lower(BTRIM(v.crawl_email_account)) = ANY($1::text[])
        OR EXISTS (
          SELECT 1 FROM unnest($1::text[]) sel
          WHERE NULLIF(btrim(sel), '') IS NOT NULL
            AND position(lower(btrim(sel)) in lower(COALESCE(v.receiver_email, ''))) > 0
        )
      )
        AND m.unit_nav IS NOT NULL
        AND NOT ${SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF}`

  const sql = `
    WITH email_keys AS (
      SELECT
        NULLIF(UPPER(BTRIM(product_code)), '') AS code,
        NULLIF(BTRIM(fund_name), '') AS fund_name
      FROM ops_email_nav_records
      WHERE ${CRAWL_OR_RECEIVER_MATCH}
      UNION
      SELECT
        NULLIF(UPPER(BTRIM(product_code)), '') AS code,
        NULLIF(BTRIM(fund_name), '') AS fund_name
      FROM ops_email_valuation_records
      WHERE ${CRAWL_OR_RECEIVER_MATCH}
      ${fofHoldingKeysSql}
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
      WHERE ${CRAWL_OR_RECEIVER_MATCH}
      ${fofHoldingKeysSql}
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

  const crawlOnlySql = `
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
    () =>
      query<{ register_number: string }>(navOnlySql, [emails, EMAIL_OPS_POOL_KEY]).catch(() =>
        query<{ register_number: string }>(crawlOnlySql, [emails, EMAIL_OPS_POOL_KEY]),
      ),
  )

  return rows.map((r) => r.register_number)
}

/**
 * Register numbers (备案号) visible to the user on 直投产品.
 * null → no filter (show all pool rows). Does not apply to 邮箱运维池.
 */
export async function resolveVisibleEmailPoolRegistersForUser(opts: {
  userId: string
  isAdmin?: boolean
}): Promise<string[] | null> {
  const cacheKey = `${opts.userId}\u0000${opts.isAdmin === undefined ? "?" : opts.isAdmin ? "1" : "0"}`
  const visCache = global._emailPoolVisibilityCache ?? (global._emailPoolVisibilityCache = new Map())
  const hit = visCache.get(cacheKey)
  if (hit && Date.now() - hit.at < VISIBLE_REGISTERS_TTL_MS) return hit.value

  let isAdmin = opts.isAdmin
  if (isAdmin === undefined) {
    const user = await getUserById(opts.userId)
    isAdmin = user?.role === "admin"
  }
  const allowedEmails = await resolveAllowedCrawlEmailsForUser({
    userId: opts.userId,
    isAdmin: !!isAdmin,
  })
  const value =
    allowedEmails === null
      ? null
      : allowedEmails.length === 0
        ? []
        : await resolveEmailPoolRegistersForCrawlEmails(allowedEmails)
  visCache.set(cacheKey, { at: Date.now(), value })
  return value
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
