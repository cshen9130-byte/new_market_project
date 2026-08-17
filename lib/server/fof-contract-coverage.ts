import { query } from "@/lib/db"
import { ensureElementExtractJobsTable } from "@/lib/server/fund-element-extract-jobs"
import { ensureFundContractMaterialsTable } from "@/lib/server/fund-contract-materials"
import {
  sqlExcludeFofUnderlyingProduct,
  sqlFofUnderlyingFundClassFilter,
} from "@/lib/server/fund-holding-code"
import { sqlHasUsableFundElements } from "@/lib/server/fund-elements-lookup"
import { fundDisplayNamesMatch } from "@/lib/server/fund-name-match"
import {
  ensureFofOverviewListCachePopulated,
} from "@/lib/server/fof-overview-list-cache-pg"
import { beianFamilyKey } from "@/lib/server/share-class-product"
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

type CoverageSource = {
  familyKey: string | null
  name: string
}

function nameCoversFofHolding(
  sourceName: string | null | undefined,
  productName: string,
  shortName: string | null,
): boolean {
  const src = (sourceName ?? "").trim()
  if (!src) return false
  // Parent / A / B / C share the same 合同 and 要素.
  const strippedSrc = src.replace(/[ABC]类/gu, "")
  const targets = [productName, shortName].filter((value): value is string => Boolean(value?.trim()))
  for (const target of targets) {
    const strippedTarget = target.replace(/[ABC]类/gu, "")
    if (fundDisplayNamesMatch(strippedSrc, strippedTarget)) return true
  }
  return false
}

function sourceCoversRow(row: FofContractCoverageRow, sources: CoverageSource[]): boolean {
  const rowKey = beianFamilyKey(row.beian_hao)
  for (const source of sources) {
    if (rowKey && source.familyKey && rowKey === source.familyKey) return true
    if (nameCoversFofHolding(source.name, row.product_name, row.short_name)) return true
  }
  return false
}

function rowMatchesFilter(row: FofContractCoverageRow, filter: FofContractCoverageFilter): boolean {
  if (filter === "missing_contract") return !row.missing_beian && !row.has_contract
  if (filter === "has_contract") return row.has_contract
  if (filter === "missing_beian") return row.missing_beian
  if (filter === "missing_elements") return !row.has_elements
  return true
}

async function loadContractSources(): Promise<CoverageSource[]> {
  const [materials, jobs] = await Promise.all([
    query<{ beian_hao: string; title: string }>(
      `SELECT beian_hao, COALESCE(title, '') AS title
       FROM ops_fund_contract_materials`,
    ),
    query<{ beian_hao: string | null; product_name: string | null }>(
      `SELECT beian_hao, product_name
       FROM ops_element_extract_jobs
       WHERE status = 'applied'`,
    ),
  ])
  const sources: CoverageSource[] = []
  for (const row of materials) {
    sources.push({
      familyKey: beianFamilyKey(row.beian_hao),
      name: row.title,
    })
  }
  for (const row of jobs) {
    sources.push({
      familyKey: beianFamilyKey(row.beian_hao),
      name: row.product_name ?? "",
    })
  }
  return sources
}

async function loadElementSources(): Promise<CoverageSource[]> {
  const rows = await query<{
    register_number: string | null
    record_key: string | null
    fund_name: string | null
    fund_short_name: string | null
  }>(
    `SELECT register_number, record_key, fund_name, fund_short_name
     FROM basicinfo_bfl_track
     WHERE ${sqlHasUsableFundElements()}`,
  ).catch(() => [] as Array<{
    register_number: string | null
    record_key: string | null
    fund_name: string | null
    fund_short_name: string | null
  }>)
  const sources: CoverageSource[] = []
  for (const row of rows) {
    const familyKey = beianFamilyKey(row.register_number) || beianFamilyKey(row.record_key)
    if (row.fund_name) sources.push({ familyKey, name: row.fund_name })
    if (row.fund_short_name && row.fund_short_name !== row.fund_name) {
      sources.push({ familyKey, name: row.fund_short_name })
    }
    if (!row.fund_name && !row.fund_short_name) {
      sources.push({ familyKey, name: "" })
    }
  }
  return sources
}

export async function loadFofContractCoverage(input?: {
  filter?: FofContractCoverageFilter
  q?: string
  holdingOnly?: boolean
  limit?: number
  offset?: number
}): Promise<FofContractCoverageResult> {
  await ensureFofOverviewListCachePopulated()
  await Promise.all([
    ensureFundContractMaterialsTable(),
    ensureElementExtractJobsTable(),
  ])

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
  const rawRows = await query<{
    id: string
    product_name: string
    short_name: string | null
    beian_hao: string | null
    missing_beian: boolean
    has_contract: boolean
    has_elements: boolean
  }>(
    `SELECT DISTINCT ON (${dedupeKey})
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
         WHERE ${sqlHasUsableFundElements("t")}
           AND NULLIF(BTRIM(cache.beian_hao), '') IS NOT NULL
           AND (
             UPPER(BTRIM(t.register_number)) = UPPER(BTRIM(cache.beian_hao))
             OR UPPER(BTRIM(t.record_key)) = UPPER(BTRIM(cache.beian_hao))
           )
       ) AS has_elements
     FROM fof_underlying_summary f
     LEFT JOIN ops_fof_overview_list_cache cache ON cache.fof_underlying_id = f.id
     WHERE ${where}
     ORDER BY ${dedupeKey},
       CASE WHEN f.product_name LIKE '场外%' THEN 1 ELSE 0 END,
       length(f.product_name) ASC,
       f.id
     LIMIT $${i}`,
    [...params, 500],
  )

  const [contractSources, elementSources] = await Promise.all([
    loadContractSources(),
    loadElementSources(),
  ])
  const allRows: FofContractCoverageRow[] = rawRows.map((r) => {
    const product_name = stripValuationSubjectPathPrefix(r.product_name) || r.product_name
    const short_name = r.short_name
      ? (stripValuationSubjectPathPrefix(r.short_name) || r.short_name)
      : null
    const row: FofContractCoverageRow = {
      id: r.id,
      product_name,
      beian_hao: r.beian_hao,
      short_name,
      has_contract: Boolean(r.has_contract),
      has_elements: Boolean(r.has_elements),
      missing_beian: Boolean(r.missing_beian),
    }
    if (!row.has_contract && sourceCoversRow(row, contractSources)) {
      row.has_contract = true
    }
    if (!row.has_elements && sourceCoversRow(row, elementSources)) {
      row.has_elements = true
    }
    return row
  })

  const counts = {
    total: allRows.length,
    has_contract: allRows.filter((row) => row.has_contract).length,
    missing_contract: allRows.filter((row) => !row.missing_beian && !row.has_contract).length,
    missing_beian: allRows.filter((row) => row.missing_beian).length,
    missing_elements: allRows.filter((row) => !row.has_elements).length,
  }
  const filtered = allRows.filter((row) => rowMatchesFilter(row, filter))
  return {
    counts,
    rows: filtered.slice(offset, offset + limit),
    total: filtered.length,
  }
}
