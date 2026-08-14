import { query } from "@/lib/db"
import { ensureFundContractMaterialsTable } from "@/lib/server/fund-contract-materials"
import {
  sqlExcludeFofUnderlyingProduct,
  sqlFofUnderlyingFundClassFilter,
} from "@/lib/server/fund-holding-code"
import {
  ensureFofOverviewListCachePopulated,
} from "@/lib/server/fof-overview-list-cache-pg"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

export type FofContractCoverageFilter =
  | "all"
  | "missing_contract"
  | "has_contract"
  | "missing_beian"
  | "missing_elements"

export type FofContractCoverageRow = {
  id: string
  product_name: string
  beian_hao: string | null
  short_name: string | null
  has_contract: boolean
  has_elements: boolean
  missing_beian: boolean
}

export type FofContractCoverageResult = {
  counts: {
    total: number
    has_contract: number
    missing_contract: number
    missing_beian: number
    missing_elements: number
  }
  rows: FofContractCoverageRow[]
  total: number
}

async function ensureContractTable(): Promise<void> {
  await ensureFundContractMaterialsTable()
}

export async function loadFofContractCoverage(input?: {
  filter?: FofContractCoverageFilter
  q?: string
  holdingOnly?: boolean
  limit?: number
  offset?: number
}): Promise<FofContractCoverageResult> {
  await ensureFofOverviewListCachePopulated()
  await ensureContractTable()

  const filter = input?.filter ?? "all"
  const q = input?.q?.trim() ?? ""
  const holdingOnly = input?.holdingOnly !== false
  const limit = Math.min(500, Math.max(1, input?.limit ?? 100))
  const offset = Math.max(0, input?.offset ?? 0)

  const conditions: string[] = [
    "f.product_name <> '合计'",
    sqlExcludeFofUnderlyingProduct("f.product_name", "cache.beian_hao"),
    sqlFofUnderlyingFundClassFilter("private", "f.product_name", "cache.beian_hao"),
  ]
  const params: unknown[] = []
  let i = 1

  if (holdingOnly) {
    conditions.push("COALESCE(cache.market_value, 0) > 0")
  }
  if (q) {
    conditions.push(`(f.product_name ILIKE $${i} OR COALESCE(cache.beian_hao, '') ILIKE $${i} OR COALESCE(cache.short_name, '') ILIKE $${i})`)
    params.push(`%${q}%`)
    i++
  }

  const where = conditions.join(" AND ")
  const dedupeKey = `COALESCE(UPPER(BTRIM(cache.beian_hao)), 'id:' || f.id::text)`
  const baseSql = `
    SELECT DISTINCT ON (${dedupeKey})
      f.id::text AS id,
      f.product_name,
      COALESCE(cache.short_name, f.product_name) AS short_name,
      NULLIF(BTRIM(cache.beian_hao), '') AS beian_hao,
      (NULLIF(BTRIM(cache.beian_hao), '') IS NULL) AS missing_beian,
      EXISTS (
        SELECT 1 FROM ops_fund_contract_materials m
        WHERE NULLIF(BTRIM(cache.beian_hao), '') IS NOT NULL
          AND UPPER(BTRIM(m.beian_hao)) = UPPER(BTRIM(cache.beian_hao))
      ) AS has_contract,
      EXISTS (
        SELECT 1 FROM basicinfo_bfl_track t
        WHERE NULLIF(BTRIM(cache.beian_hao), '') IS NOT NULL
          AND (
            UPPER(BTRIM(t.register_number)) = UPPER(BTRIM(cache.beian_hao))
            OR UPPER(BTRIM(t.record_key)) = UPPER(BTRIM(cache.beian_hao))
          )
          AND (
            NULLIF(BTRIM(COALESCE(t.open_day, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(t.fee_purchase, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(t.fee_redeem, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(t.mandator_name, '')), '') IS NOT NULL
            OR t.fee_manage_rate IS NOT NULL
          )
      ) AS has_elements
    FROM fof_underlying_summary f
    LEFT JOIN ops_fof_overview_list_cache cache ON cache.fof_underlying_id = f.id
    WHERE ${where}
    ORDER BY ${dedupeKey},
      CASE WHEN f.product_name LIKE '场外%' THEN 1 ELSE 0 END,
      length(f.product_name) ASC,
      f.id
  `

  const countRows = await query<{
    total: string
    has_contract: string
    missing_contract: string
    missing_beian: string
    missing_elements: string
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE cov.has_contract)::text AS has_contract,
       COUNT(*) FILTER (WHERE NOT cov.missing_beian AND NOT cov.has_contract)::text AS missing_contract,
       COUNT(*) FILTER (WHERE cov.missing_beian)::text AS missing_beian,
       COUNT(*) FILTER (WHERE NOT cov.has_elements)::text AS missing_elements
     FROM (${baseSql}) cov`,
    params,
  )

  const filterClause =
    filter === "missing_contract"
      ? "AND NOT cov.missing_beian AND NOT cov.has_contract"
      : filter === "has_contract"
        ? "AND cov.has_contract"
        : filter === "missing_beian"
          ? "AND cov.missing_beian"
          : filter === "missing_elements"
            ? "AND NOT cov.has_elements"
            : ""

  const listParams = [...params, limit, offset]
  const rows = await query<{
    id: string
    product_name: string
    short_name: string | null
    beian_hao: string | null
    missing_beian: boolean
    has_contract: boolean
    has_elements: boolean
  }>(
    `SELECT
       cov.id,
       cov.product_name,
       cov.short_name,
       cov.beian_hao,
       cov.missing_beian,
       cov.has_contract,
       cov.has_elements
     FROM (${baseSql}) cov
     WHERE TRUE ${filterClause}
     ORDER BY cov.has_contract ASC, cov.missing_beian DESC, cov.product_name ASC
     LIMIT $${i} OFFSET $${i + 1}`,
    listParams,
  )

  const filteredCount = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM (${baseSql}) cov
     WHERE TRUE ${filterClause}`,
    params,
  )

  const c = countRows[0]
  return {
    counts: {
      total: parseInt(c?.total || "0", 10),
      has_contract: parseInt(c?.has_contract || "0", 10),
      missing_contract: parseInt(c?.missing_contract || "0", 10),
      missing_beian: parseInt(c?.missing_beian || "0", 10),
      missing_elements: parseInt(c?.missing_elements || "0", 10),
    },
    rows: rows.map((r) => {
      const product_name = stripValuationSubjectPathPrefix(r.product_name) || r.product_name
      const short_name = r.short_name
        ? (stripValuationSubjectPathPrefix(r.short_name) || r.short_name)
        : null
      return {
        id: r.id,
        product_name,
        beian_hao: r.beian_hao,
        short_name,
        has_contract: Boolean(r.has_contract),
        has_elements: Boolean(r.has_elements),
        missing_beian: Boolean(r.missing_beian),
      }
    }),
    total: parseInt(filteredCount[0]?.n || "0", 10),
  }
}
