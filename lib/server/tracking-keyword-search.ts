import { query } from "@/lib/db"
import { expandFundSearchKeywords } from "@/lib/server/fund-name-match"
import {
  REGISTER_POOL_TABLE,
  teamVisibleTrackingFundsUnionSql,
} from "@/lib/server/tracking-pool-membership"

export type TrackingKeywordSuggestion = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

type CatalogRow = TrackingKeywordSuggestion

const CATALOG_TTL_MS = 60_000
const catalogs = new Map<string, { ts: number; rows: CatalogRow[] }>()
const catalogInflight = new Map<string, Promise<CatalogRow[]>>()

function catalogKey(opts: { pool: string; isMineAllPool: boolean }): string {
  return `${opts.pool}\u0000${opts.isMineAllPool ? "1" : "0"}`
}

function catalogSql(opts: { pool: string; isCustomPool: boolean; isMineAllPool: boolean }): { sql: string; params: unknown[] } {
  const { pool, isCustomPool, isMineAllPool } = opts
  if (pool === "all") {
    return {
      sql: `SELECT c.beian_hao, c.product_name, c.short_name
            FROM ops_tracking_funds_list_cache c
            WHERE c.beian_hao IN (
              SELECT DISTINCT f.beian_hao FROM (${teamVisibleTrackingFundsUnionSql()}) f
            )`,
      params: [],
    }
  }
  if (pool === "bfl") {
    return {
      sql: `SELECT beian_hao, product_name, NULL::text AS short_name
            FROM private_fund_info_bfl
            WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL`,
      params: [],
    }
  }
  if (pool === "bfl_ops") {
    return {
      sql: `SELECT DISTINCT ON (t.register_number)
              t.register_number AS beian_hao,
              COALESCE(NULLIF(BTRIM(t.fund_short_name), ''), t.fund_name) AS product_name,
              t.fund_name AS short_name
            FROM type6_ops_team_full t
            WHERE t.register_number IS NOT NULL
            ORDER BY t.register_number`,
      params: [],
    }
  }
  if (isCustomPool) {
    const poolSql = isMineAllPool
      ? "(p.pool_key = 'mine_default' OR p.pool_key LIKE 'mine_custom_%')"
      : "p.pool_key = $1"
    return {
      sql: `SELECT DISTINCT ON (c.beian_hao) c.beian_hao, c.product_name, c.short_name
            FROM ops_tracking_funds_list_cache c
            JOIN user_custom_pool p ON p.register_number = c.beian_hao
            WHERE ${poolSql}
            ORDER BY c.beian_hao`,
      params: isMineAllPool ? [] : [pool],
    }
  }
  const table = REGISTER_POOL_TABLE[pool] ?? "tracking_pool"
  return {
    sql: `SELECT c.beian_hao, c.product_name, c.short_name
          FROM ops_tracking_funds_list_cache c
          WHERE c.beian_hao IN (
            SELECT register_number FROM ${table} WHERE register_number IS NOT NULL
          )`,
    params: [],
  }
}

async function loadTrackedNameCatalog(opts: {
  pool: string
  isCustomPool: boolean
  isMineAllPool: boolean
}): Promise<CatalogRow[]> {
  const key = catalogKey(opts)
  const hit = catalogs.get(key)
  if (hit && Date.now() - hit.ts < CATALOG_TTL_MS) return hit.rows
  const pending = catalogInflight.get(key)
  if (pending) return pending
  const promise = (async () => {
    const { sql, params } = catalogSql(opts)
    const rows = await query<CatalogRow>(sql, params)
    const cleaned = rows.filter((row) => row.beian_hao && row.product_name)
    catalogs.set(key, { ts: Date.now(), rows: cleaned })
    return cleaned
  })()
  catalogInflight.set(key, promise)
  try {
    return await promise
  } finally {
    catalogInflight.delete(key)
  }
}

function rowMatches(row: CatalogRow, terms: string[]): boolean {
  const name = row.product_name || ""
  const shortName = row.short_name || ""
  const code = (row.beian_hao || "").toLowerCase()
  return terms.some((term) => {
    const folded = term.toLowerCase()
    return name.includes(term) || shortName.includes(term) || code.includes(folded)
  })
}

function isPrefix(row: CatalogRow, terms: string[]): boolean {
  const name = row.product_name || ""
  const shortName = row.short_name || ""
  const code = (row.beian_hao || "").toLowerCase()
  return terms.some((term) => {
    const folded = term.toLowerCase()
    return name.startsWith(term) || shortName.startsWith(term) || code.startsWith(folded)
  })
}

function matchCatalog(rows: CatalogRow[], keyword: string): CatalogRow[] {
  const terms = expandFundSearchKeywords(keyword)
  if (!terms.length) return []
  return rows
    .filter((row) => rowMatches(row, terms))
    .sort((a, b) => {
      const pa = isPrefix(a, terms) ? 0 : 1
      const pb = isPrefix(b, terms) ? 0 : 1
      if (pa !== pb) return pa - pb
      const la = (a.product_name || "").length
      const lb = (b.product_name || "").length
      if (la !== lb) return la - lb
      return (a.product_name || "").localeCompare(b.product_name || "", "zh-CN")
    })
}

/**
 * Beian codes in this pool whose tracked name matches the keyword.
 * Filtering is in memory against a short-lived catalog of tracked names,
 * so each keystroke does not scan the full disclosure catalog.
 * `null` means the catalog could not be loaded.
 */
export async function resolveTrackingKeywordBeianCodes(opts: {
  keyword: string
  pool: string
  isCustomPool: boolean
  isMineAllPool: boolean
  limit?: number
}): Promise<string[] | null> {
  const keyword = opts.keyword.trim()
  if (!keyword) return []
  try {
    const catalog = await loadTrackedNameCatalog(opts)
    const matched = matchCatalog(catalog, keyword)
    const codes = matched.map((row) => row.beian_hao)
    return opts.limit ? codes.slice(0, opts.limit) : codes
  } catch (err) {
    console.error("[tracking-keyword] catalog", err)
    return null
  }
}

export async function suggestTrackingKeywords(opts: {
  keyword: string
  pool: string
  isCustomPool: boolean
  isMineAllPool: boolean
  limit?: number
}): Promise<TrackingKeywordSuggestion[]> {
  const keyword = opts.keyword.trim()
  if (!keyword) return []
  const limit = opts.limit ?? 12
  try {
    const catalog = await loadTrackedNameCatalog(opts)
    return matchCatalog(catalog, keyword).slice(0, limit)
  } catch (err) {
    console.error("[tracking-keyword] suggest", err)
    return []
  }
}
