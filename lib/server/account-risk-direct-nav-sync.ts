/**
 * Copy 单账户 (cfmmc_daily_summary) NAV into 直投产品 (ops_email_nav_records
 * + custom_email_nav). Does not read or write public.mom_*.
 */

import { createHash } from "crypto"
import fs from "fs"
import path from "path"

import { publicQuery, query } from "@/lib/db"
import {
  aggregateEquityByDate,
  compoundAccountRiskNav,
} from "@/lib/server/account-risk-nav"
import {
  accountNoMatchesUserId,
  findImportBookByName,
  findImportBookForAccountNo,
  sourceFilesForBook,
  type ImportBook,
} from "@/lib/server/account-risk-books"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import { EMAIL_OPS_POOL_KEY, EMAIL_OPS_POOL_LABEL } from "@/lib/server/email-tracking-pool-sync"
import { invalidateDirectEmailVisibilityCaches } from "@/lib/server/direct-email-visibility"
import { invalidateTrackingPoolListCaches } from "@/lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"

export const ACCOUNT_RISK_NAV_POOL_SOURCE = "account_risk_nav_sync"
export const ACCOUNT_RISK_NAV_RECORD_SOURCE = "account_risk_nav"

const CONFIG_FILE = path.join(process.cwd(), "data", "account-risk-direct-nav-sync.json")
const PRODUCT_CODE_RE = /^[A-Z0-9]{4,10}$/i

export type AccountRiskDirectNavMapping = {
  enabled?: boolean
  bookName?: string
  accountNo?: string
  productName: string
  productCode: string
  crawlEmailAccount: string
}

export type AccountRiskDirectNavSyncItem = {
  productName: string
  productCode: string
  crawlEmailAccount: string
  status: "synced" | "skipped" | "failed"
  days?: number
  latestNav?: number
  latestNavDate?: string | null
  error?: string
}

export type AccountRiskDirectNavSyncResult = {
  ok: boolean
  items: AccountRiskDirectNavSyncItem[]
}

/** Latest 单账户 client_equity for a 直投 product. Empty when no settlement data. */
export type AccountRiskDirectMarketValue = {
  productCode: string
  productName: string
  bookName?: string
  marketValue: number
  asOfDate: string
}

let syncChain: Promise<unknown> = Promise.resolve()

function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = syncChain.then(fn, fn)
  syncChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function loadMappings(): AccountRiskDirectNavMapping[] {
  if (!fs.existsSync(CONFIG_FILE)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as {
      mappings?: AccountRiskDirectNavMapping[]
    }
    return Array.isArray(parsed.mappings) ? parsed.mappings : []
  } catch (err) {
    console.error("[account-risk-direct-nav] failed to read config", err)
    return []
  }
}

function saveMappings(mappings: unknown[]): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ mappings }, null, 2)}\n`, "utf8")
}

function findBookForMapping(mapping: AccountRiskDirectNavMapping): ImportBook | null {
  if (mapping.accountNo) {
    const byAccount = findImportBookForAccountNo(mapping.accountNo)
    if (byAccount) return byAccount
  }
  if (mapping.bookName) return findImportBookByName(mapping.bookName)
  return null
}

function liveDisplayName(mapping: AccountRiskDirectNavMapping): string {
  const book = findBookForMapping(mapping)
  const name = book?.name?.trim()
  return name || mapping.productName
}

function mappingMatchesAccount(
  mapping: AccountRiskDirectNavMapping,
  userId: string,
  oldLabel?: string,
): boolean {
  const uid = userId.trim()
  if (mapping.accountNo && accountNoMatchesUserId(mapping.accountNo, uid)) return true
  const label = oldLabel?.trim()
  if (label && (mapping.bookName === label || mapping.productName === label)) return true
  if (mapping.bookName && findImportBookForAccountNo(uid)?.name === mapping.bookName) return true
  return false
}

/** Persist 备注 → book/product title so the next sync does not write the old name back. */
export function renameAccountRiskDirectNavMappings(input: {
  userId: string
  oldLabel?: string
  newLabel: string
}): AccountRiskDirectNavMapping[] {
  const newLabel = input.newLabel.trim()
  if (!newLabel) return []
  const raw = loadMappings()
  let changed = false
  const updated: AccountRiskDirectNavMapping[] = []
  const next = raw.map((row) => {
    const mapping = normalizeMapping(row)
    if (!mapping || !mappingMatchesAccount(mapping, input.userId, input.oldLabel)) return row
    if (mapping.bookName === newLabel && mapping.productName === newLabel) {
      updated.push(mapping)
      return mapping
    }
    changed = true
    const renamed = { ...mapping, bookName: newLabel, productName: newLabel }
    updated.push(renamed)
    return renamed
  })
  if (changed) saveMappings(next)
  return updated
}

function rowHash(poolKey: string, beianHao: string, productName: string): string {
  return createHash("sha256").update(`${poolKey}::${beianHao}::${productName}`).digest("hex")
}

function emailUidFor(productCode: string): string {
  return `account-risk-nav:${productCode.trim().toUpperCase()}`
}

function normalizeMapping(raw: AccountRiskDirectNavMapping): AccountRiskDirectNavMapping | null {
  const productName = String(raw.productName ?? "").trim()
  const productCode = String(raw.productCode ?? "").trim().toUpperCase()
  const crawlEmailAccount = String(raw.crawlEmailAccount ?? "").trim().toLowerCase()
  if (!productName || !PRODUCT_CODE_RE.test(productCode) || !crawlEmailAccount.includes("@")) {
    return null
  }
  return {
    enabled: raw.enabled !== false,
    bookName: String(raw.bookName ?? "").trim() || undefined,
    accountNo: String(raw.accountNo ?? "").trim() || undefined,
    productName,
    productCode,
    crawlEmailAccount,
  }
}

async function loadEquityRows(mapping: AccountRiskDirectNavMapping): Promise<
  Array<{ date: string; client_equity: unknown; daily_pnl: unknown; deposit_wd: unknown }>
> {
  const params: unknown[] = []
  const where: string[] = []
  if (mapping.accountNo) {
    params.push(mapping.accountNo)
    where.push(`account_no = $${params.length}`)
  } else {
    const book = findBookForMapping(mapping)
    if (book) {
      const files = sourceFilesForBook(book.id)
      if (files.length > 0) {
        params.push(files)
        const n = params.length
        params.push(`${book.id}/%`)
        where.push(`(source_file = ANY($${n}::text[]) OR source_file LIKE $${n + 1})`)
      }
    }
  }
  if (where.length === 0) return []

  const res = await publicQuery(
    `SELECT trade_date::text AS date,
            COALESCE(client_equity, 0) AS client_equity,
            COALESCE(daily_pnl, 0) AS daily_pnl,
            COALESCE(deposit_wd, 0) AS deposit_wd
     FROM public.cfmmc_daily_summary
     WHERE ${where.join(" AND ")}
     ORDER BY trade_date ASC`,
    params,
  )
  return res.rows as Array<{
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
  }>
}

/**
 * Investor 市值 for 直投产品 that are 单账户 books.
 * Uses latest `public.cfmmc_daily_summary.client_equity` (account capital).
 * Does not read FOF 估值表 holdings or public.mom_*.
 */
export async function listAccountRiskDirectMarketValues(opts?: {
  cutoffDate?: string | null
}): Promise<AccountRiskDirectMarketValue[]> {
  const cutoff = String(opts?.cutoffDate ?? "").trim().slice(0, 10)
  const out: AccountRiskDirectMarketValue[] = []
  const seen = new Set<string>()
  for (const raw of loadMappings()) {
    const mapping = normalizeMapping(raw)
    if (!mapping || mapping.enabled === false) continue
    const live = withLiveDisplayName(mapping)
    const key = live.productCode.trim().toUpperCase()
    if (!key || seen.has(key)) continue
    const days = aggregateEquityByDate(await loadEquityRows(live))
    const eligible = cutoff ? days.filter((d) => d.date <= cutoff) : days
    const latest = eligible[eligible.length - 1]
    if (!latest || !(latest.equity > 0)) continue
    seen.add(key)
    out.push({
      productCode: live.productCode,
      productName: live.productName,
      bookName: live.bookName,
      marketValue: latest.equity,
      asOfDate: latest.date,
    })
  }
  return out
}

async function ensureDirectPoolDefinition(): Promise<void> {
  await query(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     SELECT $1, $2, 'team', '',
            COALESCE((SELECT MAX(sort_order) FROM tracking_custom_pools WHERE scope = 'team'), 0) + 1,
            NOW()
     ON CONFLICT (pool_key)
     DO UPDATE SET updated_at = NOW()`,
    [EMAIL_OPS_POOL_KEY, EMAIL_OPS_POOL_LABEL],
  )
}

async function upsertPoolRow(productCode: string, productName: string): Promise<void> {
  await ensureDirectPoolDefinition()
  const hash = rowHash(EMAIL_OPS_POOL_KEY, productCode, productName)
  const inserted = await query<{ ok: number }>(
    `INSERT INTO user_custom_pool
       (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
     SELECT $1,
            COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
            $3, $2, $4, $5, NOW(), NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2
     )
     RETURNING 1 AS ok`,
    [EMAIL_OPS_POOL_KEY, productCode, productName, hash, ACCOUNT_RISK_NAV_POOL_SOURCE],
  )
  if (inserted.length > 0) return
  await query(
    `UPDATE user_custom_pool
     SET product_name = $3, row_hash = $4, source_file = $5, updated_at = NOW()
     WHERE pool_key = $1 AND register_number = $2
       AND (product_name IS DISTINCT FROM $3 OR source_file IS DISTINCT FROM $5)`,
    [EMAIL_OPS_POOL_KEY, productCode, productName, hash, ACCOUNT_RISK_NAV_POOL_SOURCE],
  )
}

function renamedDisplayName(current: string, oldLabel: string, newLabel: string): string {
  const value = current.trim()
  if (!value) return value
  if (value === oldLabel) return newLabel
  const suffix = ` - ${oldLabel}`
  if (value.endsWith(suffix)) return `${value.slice(0, -oldLabel.length)}${newLabel}`
  return value
}

async function renamePoolAndNavDisplayNames(input: {
  productCode?: string
  oldLabel?: string
  newLabel: string
}): Promise<void> {
  const newLabel = input.newLabel.trim()
  const oldLabel = input.oldLabel?.trim()
  const productCode = input.productCode?.trim().toUpperCase()
  if (!newLabel) return

  const poolRows = await query<{ pool_key: string; register_number: string; product_name: string }>(
    `SELECT pool_key, register_number, product_name
     FROM user_custom_pool
     WHERE ($1::text IS NOT NULL AND register_number = $1)
        OR ($2::text IS NOT NULL AND (
          product_name = $2
          OR product_name LIKE '% - ' || $2
        ))`,
    [productCode || null, oldLabel || null],
  )
  for (const row of poolRows) {
    const nextName = renamedDisplayName(row.product_name, oldLabel || row.product_name, newLabel)
    if (nextName === row.product_name) continue
    const hash = rowHash(row.pool_key, row.register_number, nextName)
    await query(
      `UPDATE user_custom_pool
       SET product_name = $3, row_hash = $4, updated_at = NOW()
       WHERE pool_key = $1 AND register_number = $2`,
      [row.pool_key, row.register_number, nextName, hash],
    )
  }

  if (productCode) {
    await query(
      `UPDATE ops_email_nav_records
       SET fund_name = $1,
           subject = CASE
             WHEN subject LIKE '单账户净值 %' THEN $2
             ELSE subject
           END
       WHERE product_code = $3
         AND source = $4
         AND fund_name IS DISTINCT FROM $1`,
      [newLabel, `单账户净值 ${newLabel}`, productCode, ACCOUNT_RISK_NAV_RECORD_SOURCE],
    )
  }

  const cacheRows = await query<{ beian_hao: string; product_name: string; short_name: string | null }>(
    `SELECT beian_hao, product_name, short_name
     FROM ops_tracking_funds_list_cache
     WHERE ($1::text IS NOT NULL AND beian_hao = $1)
        OR ($2::text IS NOT NULL AND (
          product_name = $2 OR product_name LIKE '% - ' || $2
          OR short_name = $2 OR short_name LIKE '% - ' || $2
        ))`,
    [productCode || null, oldLabel || null],
  ).catch(() => [])
  for (const row of cacheRows) {
    const nextProduct = productCode && row.beian_hao === productCode
      ? newLabel
      : renamedDisplayName(row.product_name, oldLabel || row.product_name, newLabel)
    const nextShort = row.short_name
      ? (productCode && row.beian_hao === productCode
        ? newLabel
        : renamedDisplayName(row.short_name, oldLabel || row.short_name, newLabel))
      : nextProduct
    if (nextProduct === row.product_name && nextShort === row.short_name) continue
    await query(
      `UPDATE ops_tracking_funds_list_cache
       SET product_name = $2, short_name = $3, refreshed_at = NOW()
       WHERE beian_hao = $1`,
      [row.beian_hao, nextProduct, nextShort],
    )
  }
}

async function applyDisplayName(mapping: AccountRiskDirectNavMapping, oldLabel?: string): Promise<void> {
  const productName = liveDisplayName(mapping)
  await upsertPoolRow(mapping.productCode, productName)
  await renamePoolAndNavDisplayNames({
    productCode: mapping.productCode,
    oldLabel: oldLabel || mapping.productName,
    newLabel: productName,
  })
  try {
    await upsertTrackingFundListCacheEntry(mapping.productCode, productName)
  } catch (err) {
    console.warn("[account-risk-direct-nav] list cache upsert failed", mapping.productCode, err)
  }
}

/** Keep 跟踪产品 / 直投产品 titles in sync after a 监控中心 备注 change. */
export async function syncAccountRiskDirectNavDisplayNamesForAccount(input: {
  userId: string
  oldLabel?: string
  newLabel: string
}): Promise<void> {
  const renamed = renameAccountRiskDirectNavMappings(input)
  const seen = new Set<string>()
  const mappings = renamed.length > 0
    ? renamed
    : loadMappings()
        .map(normalizeMapping)
        .filter((m): m is AccountRiskDirectNavMapping => !!m && mappingMatchesAccount(m, input.userId, input.oldLabel))
  await withSyncLock(async () => {
    for (const mapping of mappings) {
      const key = mapping.productCode
      if (seen.has(key)) continue
      seen.add(key)
      await applyDisplayName({ ...mapping, bookName: input.newLabel, productName: input.newLabel }, input.oldLabel)
    }
    if (input.oldLabel && input.oldLabel.trim() !== input.newLabel.trim()) {
      await renamePoolAndNavDisplayNames({
        oldLabel: input.oldLabel,
        newLabel: input.newLabel,
      })
    }
    invalidateDirectEmailVisibilityCaches()
    invalidateTrackingPoolListCaches([])
  })
}

let reconcileInFlight: Promise<void> | null = null
let lastReconcileAt = 0
const RECONCILE_TTL_MS = 60_000

export async function reconcileAccountRiskDirectNavDisplayNamesSafe(): Promise<void> {
  try {
    await reconcileAccountRiskDirectNavDisplayNames()
  } catch (err) {
    console.warn("[account-risk-direct-nav] name reconcile failed", err)
  }
}

/** If a 备注 already changed, rewrite stale 跟踪产品 titles to the live book name. */
export function reconcileAccountRiskDirectNavDisplayNames(): Promise<void> {
  if (reconcileInFlight) return reconcileInFlight
  if (Date.now() - lastReconcileAt < RECONCILE_TTL_MS) return Promise.resolve()
  reconcileInFlight = (async () => {
    const mappings = loadMappings()
      .map(normalizeMapping)
      .filter((m): m is AccountRiskDirectNavMapping => !!m)
    let changed = false
    for (const mapping of mappings) {
      const live = withLiveDisplayName(mapping)
      const current = await query<{ product_name: string }>(
        `SELECT product_name FROM user_custom_pool WHERE register_number = $1 LIMIT 1`,
        [live.productCode],
      ).catch(() => [])
      const oldLabel = current[0]?.product_name || mapping.productName
      if (oldLabel === live.productName && live.bookName === mapping.bookName) continue
      if (live.productName !== mapping.productName || live.bookName !== mapping.bookName) {
        renameAccountRiskDirectNavMappings({
          userId: live.accountNo || "",
          oldLabel: mapping.productName,
          newLabel: live.productName,
        })
      }
      await applyDisplayName(live, oldLabel)
      changed = true
    }
    if (changed) {
      invalidateDirectEmailVisibilityCaches()
      invalidateTrackingPoolListCaches([])
    }
    lastReconcileAt = Date.now()
  })().finally(() => {
    reconcileInFlight = null
  })
  return reconcileInFlight
}

async function upsertNavSeries(
  mapping: AccountRiskDirectNavMapping,
  points: Array<{ date: string; nav: number }>,
): Promise<number> {
  await ensureEmailNavTable()
  const uid = emailUidFor(mapping.productCode)
  const attachment = `cfmmc:${mapping.accountNo || mapping.productCode}`
  const subject = `单账户净值 ${mapping.productName}`
  let count = 0
  for (const point of points) {
    await query(
      `INSERT INTO ops_email_nav_records
         (crawl_email_account, email_uid, sent_at, subject, sender_email, receiver_email,
          nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name, source, attachment_filename)
       VALUES ($1,$2,NOW(),$3,'account-risk-sync',$1,$4,$5,$5,$5,$6,$7,$8,$9)
       ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename, product_code) DO UPDATE SET
         sent_at = EXCLUDED.sent_at,
         subject = EXCLUDED.subject,
         nav = EXCLUDED.nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         adjusted_nav = EXCLUDED.adjusted_nav,
         fund_name = EXCLUDED.fund_name,
         source = EXCLUDED.source`,
      [
        mapping.crawlEmailAccount,
        uid,
        subject,
        point.date,
        point.nav,
        mapping.productCode,
        mapping.productName,
        ACCOUNT_RISK_NAV_RECORD_SOURCE,
        attachment,
      ],
    )
    count++
  }
  const dates = points.map((p) => p.date)
  if (dates.length > 0) {
    await query(
      `DELETE FROM ops_email_nav_records
       WHERE crawl_email_account = $1
         AND email_uid = $2
         AND product_code = $3
         AND NOT (nav_date = ANY($4::date[]))`,
      [mapping.crawlEmailAccount, uid, mapping.productCode, dates],
    )
  }
  return count
}

function withLiveDisplayName(mapping: AccountRiskDirectNavMapping): AccountRiskDirectNavMapping {
  const productName = liveDisplayName(mapping)
  const book = findBookForMapping(mapping)
  return {
    ...mapping,
    bookName: book?.name || mapping.bookName,
    productName,
  }
}

async function syncOne(mapping: AccountRiskDirectNavMapping): Promise<AccountRiskDirectNavSyncItem> {
  const live = withLiveDisplayName(mapping)
  const base = {
    productName: live.productName,
    productCode: live.productCode,
    crawlEmailAccount: live.crawlEmailAccount,
  }
  if (!live.enabled) {
    return { ...base, status: "skipped", error: "disabled" }
  }
  const rows = await loadEquityRows(live)
  const days = aggregateEquityByDate(rows)
  if (days.length === 0) {
    return { ...base, status: "skipped", error: "单账户无结算数据" }
  }
  const series = compoundAccountRiskNav(days)
  await upsertNavSeries(live, series)
  await applyDisplayName(live, mapping.productName)
  const latest = series[series.length - 1]
  return {
    ...base,
    status: "synced",
    days: series.length,
    latestNav: latest?.nav,
    latestNavDate: latest?.date ?? null,
  }
}

export async function syncAccountRiskDirectNav(): Promise<AccountRiskDirectNavSyncResult> {
  return withSyncLock(async () => {
    const raw = loadMappings()
    const mappings: AccountRiskDirectNavMapping[] = []
    let persisted = false
    const next = raw.map((row) => {
      const mapping = normalizeMapping(row)
      if (!mapping) return row
      const live = withLiveDisplayName(mapping)
      mappings.push(live)
      if (live.productName !== mapping.productName || live.bookName !== mapping.bookName) {
        persisted = true
        return live
      }
      return mapping
    })
    if (persisted) saveMappings(next)
    const items: AccountRiskDirectNavSyncItem[] = []
    for (const mapping of mappings) {
      try {
        items.push(await syncOne(mapping))
      } catch (err) {
        items.push({
          productName: mapping.productName,
          productCode: mapping.productCode,
          crawlEmailAccount: mapping.crawlEmailAccount,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    invalidateDirectEmailVisibilityCaches()
    invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY])
    return { ok: items.every((i) => i.status !== "failed"), items }
  })
}
