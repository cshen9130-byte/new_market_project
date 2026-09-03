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
import { findImportBookByName, sourceFilesForBook } from "@/lib/server/account-risk-books"
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
  }
  if (mapping.bookName) {
    const book = findImportBookByName(mapping.bookName)
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

async function syncOne(mapping: AccountRiskDirectNavMapping): Promise<AccountRiskDirectNavSyncItem> {
  const base = {
    productName: mapping.productName,
    productCode: mapping.productCode,
    crawlEmailAccount: mapping.crawlEmailAccount,
  }
  if (!mapping.enabled) {
    return { ...base, status: "skipped", error: "disabled" }
  }
  const rows = await loadEquityRows(mapping)
  const days = aggregateEquityByDate(rows)
  if (days.length === 0) {
    return { ...base, status: "skipped", error: "单账户无结算数据" }
  }
  const series = compoundAccountRiskNav(days)
  await upsertNavSeries(mapping, series)
  await upsertPoolRow(mapping.productCode, mapping.productName)
  try {
    await upsertTrackingFundListCacheEntry(mapping.productCode, mapping.productName)
  } catch (err) {
    console.warn("[account-risk-direct-nav] list cache upsert failed", mapping.productCode, err)
  }
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
    const mappings = loadMappings().map(normalizeMapping).filter((m): m is AccountRiskDirectNavMapping => !!m)
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
