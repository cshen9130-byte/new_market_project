import { query, fmtIso } from "@/lib/db"
import { extractManagerBrand, lookupRepresentativeProduct } from "@/lib/server/fund-company-query"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export interface ManagerProductRow {
  beian_hao: string
  product_name: string
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  benchmark: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

export interface DistributionSlice {
  name: string
  count: number
  pct: number
}

export interface RepresentativeProduct {
  beian_hao: string
  product_name: string
  benchmark: string | null
}

const ALLOWED_SORT: Record<string, string> = {
  product_name: "i.product_name",
  latest_nav: "i.latest_nav",
  ret_1w: "i.ret_1w",
  ret_1m: "i.ret_1m",
  ret_3m: "i.ret_3m",
  ret_6m: "i.ret_6m",
  ret_1y: "i.ret_1y",
  sharpe_1y: "i.sharpe_1y",
  calmar_1y: "i.calmar_1y",
  inception_date: "i.inception_date",
}

function fmtNum(v: unknown): string | null {
  if (v == null) return null
  return String(v)
}

export async function resolveManagerNameByRegistrationNo(
  registrationNo: string,
): Promise<string | null> {
  const mgr = await lookupManagerByRegistrationNo(registrationNo)
  return mgr?.manager_name ?? null
}

function managerMatchParams(managerName: string): [string, string, string] {
  const brand = extractManagerBrand(managerName)
  return [`%${managerName}%`, brand ?? "", brand ? `%${brand}%` : ""]
}

function buildDistribution(rows: { name: string | null; count: string }[]): DistributionSlice[] {
  const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0)
  if (total <= 0) return []
  return rows
    .map((r) => {
      const count = parseInt(r.count, 10)
      return {
        name: r.name?.trim() || "未知",
        count,
        pct: Math.round((count / total) * 10000) / 100,
      }
    })
    .sort((a, b) => b.count - a.count)
}

export async function loadManagerFundsSummary(registrationNo: string) {
  const managerName = await resolveManagerNameByRegistrationNo(registrationNo)
  if (!managerName) return null

  const [managerLike, brand, brandLike] = managerMatchParams(managerName)

  const repPrimary = await lookupRepresentativeProduct(managerName)
  const repRows = await query<{ beian_hao: string; product_name: string; benchmark: string | null }>(
    `SELECT i.beian_hao, i.product_name, i.benchmark
     FROM private_fund_info i
     WHERE (i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))
       AND i.product_name ~ '优选[0-9]+号'
       AND i.product_name NOT ILIKE '%类%'
     ORDER BY i.product_name
     LIMIT 12`,
    [managerLike, brand, brandLike],
  ).catch(() => [] as { beian_hao: string; product_name: string; benchmark: string | null }[])

  const representative_products: RepresentativeProduct[] =
    repRows.length > 0
      ? repRows.map((r) => ({
          beian_hao: r.beian_hao,
          product_name: r.product_name,
          benchmark: r.benchmark,
        }))
      : repPrimary
        ? [{ ...repPrimary, benchmark: null }]
        : []

  const [strategyL1Rows, strategyL2Rows, custodianRows] = await Promise.all([
    query<{ name: string | null; count: string }>(
      `SELECT COALESCE(NULLIF(BTRIM(i.strategy_l1), ''), '未知') AS name, COUNT(*)::text AS count
       FROM private_fund_info i
       WHERE (i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))
       GROUP BY 1
       ORDER BY COUNT(*) DESC`,
      [managerLike, brand, brandLike],
    ).catch(() => []),
    query<{ name: string | null; count: string }>(
      `SELECT COALESCE(NULLIF(BTRIM(i.strategy_l2), ''), '未知') AS name, COUNT(*)::text AS count
       FROM private_fund_info i
       WHERE (i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))
       GROUP BY 1
       ORDER BY COUNT(*) DESC`,
      [managerLike, brand, brandLike],
    ).catch(() => []),
    query<{ name: string | null; count: string }>(
      `SELECT COALESCE(NULLIF(BTRIM(t.mandator_name), ''), '未知') AS name,
              COUNT(*)::text AS count
       FROM private_fund_info i
       LEFT JOIN basicinfo_bfl_track t ON t.register_number = i.beian_hao
       WHERE (i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))
       GROUP BY 1
       ORDER BY COUNT(*) DESC`,
      [managerLike, brand, brandLike],
    ).catch(() => []),
  ])

  return {
    manager_name: managerName,
    representative_products,
    strategy_distribution_l1: buildDistribution(strategyL1Rows),
    strategy_distribution_l2: buildDistribution(strategyL2Rows),
    custodian_distribution: buildDistribution(custodianRows),
  }
}

export async function loadManagerProducts(options: {
  registrationNo: string
  page: number
  pageSize: number
  keyword: string
  strategy: string
  sortKey: string
  sortDir: "ASC" | "DESC"
  cutoffDate: string
}) {
  const managerName = await resolveManagerNameByRegistrationNo(options.registrationNo)
  if (!managerName) {
    return {
      data: [] as ManagerProductRow[],
      total: 0,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: 1,
      strategies: [] as string[],
      cutoff_date: options.cutoffDate,
      manager_name: null,
    }
  }

  const [managerLike, brand, brandLike] = managerMatchParams(managerName)
  const conditions: string[] = ["(i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))"]
  const filterParams: unknown[] = [managerLike, brand, brandLike]
  let pi = 4

  if (options.keyword) {
    conditions.push(`(i.product_name ILIKE $${pi} OR i.beian_hao ILIKE $${pi})`)
    filterParams.push(`%${options.keyword}%`)
    pi++
  }

  if (options.strategy && options.strategy !== "全部") {
    conditions.push(`(i.strategy_l1 = $${pi} OR i.strategy_l2 = $${pi})`)
    filterParams.push(options.strategy)
    pi++
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`
  const sortParam = ALLOWED_SORT[options.sortKey] ? options.sortKey : "product_name"
  const sortCol = ALLOWED_SORT[sortParam]
  const offset = (options.page - 1) * options.pageSize

  const strategyRows = await query<{ strategy_l1: string | null }>(
    `SELECT DISTINCT i.strategy_l1
     FROM private_fund_info i
     WHERE (i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))
       AND i.strategy_l1 IS NOT NULL AND BTRIM(i.strategy_l1) <> ''
     ORDER BY i.strategy_l1`,
    [managerLike, brand, brandLike],
  ).catch(() => [] as { strategy_l1: string | null }[])

  const [countRow, rows] = await Promise.all([
    query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM private_fund_info i ${whereClause}`,
      filterParams,
    ),
    query<{
      beian_hao: string
      product_name: string
      strategy_l1: string | null
      strategy_l2: string | null
      inception_date: string | Date | null
      benchmark: string | null
      ret_1w: string | number | null
      ret_1m: string | number | null
      ret_3m: string | number | null
      ret_6m: string | number | null
      ret_1y: string | number | null
      sharpe_1y: string | number | null
      calmar_1y: string | number | null
      latest_nav: string | number | null
      latest_nav_date: string | Date | null
    }>(
      `SELECT
         i.beian_hao,
         i.product_name,
         i.strategy_l1,
         i.strategy_l2,
         i.inception_date,
         i.benchmark,
         i.ret_1w::text,
         i.ret_1m::text,
         i.ret_3m::text,
         i.ret_6m::text,
         i.ret_1y::text,
         i.sharpe_1y::text,
         i.calmar_1y::text,
         i.latest_nav::text,
         i.latest_nav_date::text
       FROM private_fund_info i
       ${whereClause}
       ORDER BY ${sortCol} ${options.sortDir} NULLS LAST, i.product_name ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...filterParams, options.pageSize, offset],
    ),
  ])

  const total = parseInt(countRow[0]?.total || "0", 10)
  const data: ManagerProductRow[] = rows.map((r) => ({
    beian_hao: r.beian_hao,
    product_name: r.product_name,
    strategy_l1: r.strategy_l1,
    strategy_l2: r.strategy_l2,
    inception_date: r.inception_date ? fmtIso(r.inception_date) : null,
    benchmark: r.benchmark,
    ret_1w: fmtNum(r.ret_1w),
    ret_1m: fmtNum(r.ret_1m),
    ret_3m: fmtNum(r.ret_3m),
    ret_6m: fmtNum(r.ret_6m),
    ret_1y: fmtNum(r.ret_1y),
    sharpe_1y: fmtNum(r.sharpe_1y),
    calmar_1y: fmtNum(r.calmar_1y),
    latest_nav: fmtNum(r.latest_nav),
    latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
  }))

  return {
    data,
    total,
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.max(1, Math.ceil(total / options.pageSize)),
    strategies: strategyRows.map((r) => r.strategy_l1).filter(Boolean) as string[],
    cutoff_date: options.cutoffDate,
    manager_name: managerName,
  }
}
